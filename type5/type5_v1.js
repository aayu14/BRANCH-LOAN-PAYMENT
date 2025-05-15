/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE) return;

            var loanRec = context.newRecord;
            var loanId = loanRec.id;
            var loanType = loanRec.getValue('custrecord_st_repay_loan_type');

            if (loanType != 5) {
                log.debug('Loan Type Check', 'Skipping script as custrecord_st_repay_loan_type is not 5');
                return;
            }

            var loanAmount = parseFloat(loanRec.getValue('custrecord_principal_amt') || 0);
            var startDateStr = loanRec.getValue('custrecord_start_date');
            var endDateStr = loanRec.getValue('custrecord_end_date');
            var annualInterestRate = parseFloat(loanRec.getValue('custrecord_interest_rate') || 0);
            var vendorid = loanRec.getValue('custrecord_lender_name');
            var TDS_rate = parseFloat(loanRec.getValue('custrecord_ln_repay_tds_rate') || 0) / 100;
            var paymentDateValue = loanRec.getValue('custrecord_payment_date');

            if (!loanAmount || !startDateStr || !endDateStr || !annualInterestRate) {
                log.debug('Validation Failed', 'Loan amount, start date, end date, or interest rate is missing or invalid.');
                return;
            }

            var startDate = new Date(startDateStr);
            var endDate = new Date(endDateStr);
            if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate) {
                log.debug('Invalid Start or End Date', 'Start Date: ' + startDateStr + ' , End Date: ' + endDateStr);
                return;
            }

            var fixedPaymentDay = getFixedPaymentDay(paymentDateValue);
            var currentDate = new Date(startDate);
            currentDate.setDate(fixedPaymentDay);

            var remainingBalance = loanAmount;

            createChildPaymentSchedule({
                parentLoanId: loanId,
                scheduleDate: startDateStr,
                daysInPeriod: 0,
                interest: 0,
                tds: 0,
                netInterest: 0,
                principal: 0,
                remainingBalance: remainingBalance,
                cashflow: 0,
                vendorid: vendorid,
                month: 'Start Date',
                expense: 0
            });

            var monthsDiff = getMonthDifference(startDate, endDate);

            for (var i = 1; i <= monthsDiff; i++) {
                if (currentDate > endDate) break;

                var lastDayOfCurrentMonth = getLastDayOfMonth(currentDate);
                var paymentDate = new Date(currentDate);
                paymentDate.setDate(Math.min(fixedPaymentDay, lastDayOfCurrentMonth.getDate()));

                var daysInPeriod = calculateDaysInPeriod(i === 1 ? startDate : getPreviousPaymentDate(currentDate, fixedPaymentDay), paymentDate);
                var daysInYear = getDaysInYear(paymentDate.getFullYear());

                var interest = roundToTwo((remainingBalance * annualInterestRate / 100) * (daysInPeriod / daysInYear));
                var tds = roundToTwo(interest * TDS_rate);
                var netInterest = roundToTwo(interest - tds);

                var principal = (paymentDate.getTime() === endDate.getTime()) ? remainingBalance : 0;
                var cashflow = interest + principal;
                remainingBalance = roundToTwo(remainingBalance - principal);

                var monthName = getMonthName(paymentDate.getMonth()) + ' ' + paymentDate.getFullYear();
                var expense = roundToTwo(remainingBalance * (annualInterestRate / 100) * (daysInPeriod / daysInYear));

                createChildPaymentSchedule({
                    parentLoanId: loanId,
                    scheduleDate: paymentDate,
                    daysInPeriod: daysInPeriod,
                    interest: interest,
                    tds: tds,
                    netInterest: netInterest,
                    principal: principal,
                    remainingBalance: remainingBalance,
                    cashflow: cashflow,
                    vendorid: vendorid,
                    month: monthName,
                    expense: expense
                });

                currentDate.setMonth(currentDate.getMonth() + 1);
                currentDate.setDate(Math.min(fixedPaymentDay, getLastDayOfMonth(currentDate).getDate()));
            }

            log.audit('Repayment Schedule Created for Loan', loanId);

        } catch (error) {
            log.error('Error Generating Repayment Schedule', error.message);
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

    function calculateDaysInPeriod(prevDate, currentDate) {
        return Math.ceil((currentDate - prevDate) / (1000 * 60 * 60 * 24));
    }

    function getPreviousPaymentDate(currentDate, fixedDay) {
        var prev = new Date(currentDate);
        prev.setMonth(prev.getMonth() - 1);
        prev.setDate(Math.min(fixedDay, getLastDayOfMonth(prev).getDate()));
        return prev;
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
        var monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"];
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
            paymentRec.save();
        } catch (error) {
            log.error('Error Creating Payment Schedule Record', error.message);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
