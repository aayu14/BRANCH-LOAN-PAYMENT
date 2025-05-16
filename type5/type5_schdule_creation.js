/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) return;

            var loanRec = context.newRecord;
            var loanId = loanRec.id;
            var loanType = loanRec.getValue('custrecord_st_repay_loan_type');

            if (loanType != 5) return;

            var loanAmount = parseFloat(loanRec.getValue('custrecord_principal_amt') || 0);
            var startDateStr = loanRec.getValue('custrecord_start_date');
            var endDateStr = loanRec.getValue('custrecord_end_date');
            var annualInterestRate = parseFloat(loanRec.getValue('custrecord_interest_rate') || 0);
            var vendorid = loanRec.getValue('custrecord_lender_name');
            var TDS_rate = parseFloat(loanRec.getValue('custrecord_ln_repay_tds_rate') || 0) / 100;
            var paymentDateValue = loanRec.getValue('custrecord_payment_dates');
            var pfother_charge = parseFloat(loanRec.getValue('custrecord_st_pf_other_charge') || 0);

            if (!loanAmount || !startDateStr || !endDateStr || !annualInterestRate) return;

            var startDate = new Date(startDateStr);
            var endDate = new Date(endDateStr);
            if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate) return;

            var fixedPaymentDay = getFixedPaymentDay(paymentDateValue);
            var currentDate = calculateFirstPaymentDate(startDate, fixedPaymentDay);

            var monthsDiff = getMonthDifference(startDate, endDate);
            var monthlyPrincipal = roundToTwo(loanAmount / monthsDiff);
            var remainingBalance = loanAmount;

         
            createChildPaymentSchedule({
                parentLoanId: loanId,
                scheduleDate: startDate,
                daysInPeriod: 0,
                interest: 0,
                tds: 0,
                netInterest: 0,
                principal: 0,
                remainingBalance: remainingBalance,
                cashflow: remainingBalance,
                vendorid: vendorid,
                month: 'Start Date',
                expense: 0,
                pfother_charge: pfother_charge
            });

            remainingBalance = roundToTwo(remainingBalance - pfother_charge);

            var prevPaymentDate = new Date(startDate);

            for (var i = 1; i <= monthsDiff; i++) {
                if (currentDate > endDate) break;

                var lastDayOfCurrentMonth = getLastDayOfMonth(currentDate);
                if (currentDate > lastDayOfCurrentMonth) currentDate = lastDayOfCurrentMonth;

                var daysInPeriod = calculateDaysInPeriod(prevPaymentDate, currentDate);
                daysInPeriod = Math.max(daysInPeriod, 0);

                var daysInYear = getDaysInYear(currentDate.getFullYear());
                var interest = roundToTwo((remainingBalance * annualInterestRate / 100) * (daysInPeriod / daysInYear));
                var tds = roundToTwo(interest * TDS_rate);
                var netInterest = roundToTwo(interest - tds);

                var principal = (i === monthsDiff || monthlyPrincipal > remainingBalance) ? remainingBalance : monthlyPrincipal;
                var cashflow = roundToTwo(interest + principal);
                remainingBalance = roundToTwo(remainingBalance - principal);

                var monthName = getMonthName(currentDate.getMonth()) + '-' + currentDate.getFullYear().toString().substr(2);
                var expense = interest;

                createChildPaymentSchedule({
                    parentLoanId: loanId,
                    scheduleDate: currentDate,
                    daysInPeriod: daysInPeriod,
                    interest: interest,
                    tds: tds,
                    netInterest: netInterest,
                    principal: principal,
                    remainingBalance: remainingBalance,
                    cashflow: cashflow,
                    vendorid: vendorid,
                    month: monthName,
                    expense: expense,
                    pfother_charge: null
                });

                prevPaymentDate = new Date(currentDate);
                currentDate.setMonth(currentDate.getMonth() + 1);
                currentDate.setDate(Math.min(fixedPaymentDay, getLastDayOfMonth(currentDate).getDate()));
            }

        } catch (error) {
            log.error('Error Generating Repayment Schedule', error.stack);
        }
    }

    function getFixedPaymentDay(paymentDateValue) {
        var day = null;
        if (paymentDateValue) {
            if (paymentDateValue instanceof Date) {
                day = paymentDateValue.getDate();
            } else {
                day = parseInt(paymentDateValue, 10);
            }
        }
        if (!day || day < 1 || day > 31) {
            throw new Error('Invalid payment day specified. Must be between 1 and 31.');
        }
        return day;
    }

    function calculateFirstPaymentDate(startDate, fixedDay) {
        var proposed = new Date(startDate.getFullYear(), startDate.getMonth(), fixedDay);
        if (proposed <= startDate) {
            proposed.setMonth(proposed.getMonth() + 1);
        }
        var lastDayOfMonth = getLastDayOfMonth(proposed);
        proposed.setDate(Math.min(fixedDay, lastDayOfMonth.getDate()));
        return proposed;
    }

    function calculateDaysInPeriod(prevDate, currentDate) {
        var start = new Date(prevDate.getFullYear(), prevDate.getMonth(), prevDate.getDate());
        var end = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
        return Math.floor((end - start) / (1000 * 60 * 60 * 24));
    }

    function getLastDayOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    }

    function getDaysInYear(year) {
        return ((year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)) ? 366 : 365;
    }

    function getMonthDifference(start, end) {
        return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    }

    function getMonthName(monthIndex) {
        var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return monthNames[monthIndex];
    }

    function roundToTwo(num) {
        return Math.round(num * 100) / 100;
    }

    function createChildPaymentSchedule(scheduleData) {
        try {
            var paymentRec = record.create({
                type: 'customrecord_loan_payment_schedule',
                isDynamic: true
            });
            paymentRec.setValue('custrecord_parent_loan_id', scheduleData.parentLoanId);
            paymentRec.setValue('custrecord_ln_repay_cashflow', scheduleData.cashflow);
            paymentRec.setValue('custrecord_ln_repay_month', scheduleData.month);
            paymentRec.setValue('custrecord__ln_repay_no_days', scheduleData.daysInPeriod);
            paymentRec.setValue('custrecord_payment_lender', scheduleData.vendorid);
            paymentRec.setValue('custrecord_payment_date', scheduleData.scheduleDate);
            paymentRec.setValue('custrecord_ln_repay_principal_amt', scheduleData.principal);
            paymentRec.setValue('custrecord_interest_paid', scheduleData.interest);
            paymentRec.setValue('custrecord_ln_repay_net_interest', scheduleData.netInterest);
            paymentRec.setValue('custrecord_ln_repay_ending_balance', scheduleData.remainingBalance);
            paymentRec.setValue('custrecord_ln_repay_tds', scheduleData.tds);
            paymentRec.setValue('custrecord_ln_repay_monthly_expns', scheduleData.expense);
            paymentRec.setValue('custrecord_st_pf_other_charges', scheduleData.pfother_charge);
            paymentRec.save();
        } catch (error) {
            log.error('Error Creating Payment Schedule Record', error.stack);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
