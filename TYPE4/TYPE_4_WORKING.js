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
            if (loanType != 4) return;

            var loanAmount = Number(loanRec.getValue('custrecord_principal_amt')) || 0;
            var startDateStr = loanRec.getValue('custrecord_start_date');
            var endDateStr = loanRec.getValue('custrecord_end_date');
            var annualInterestRate = Number(loanRec.getValue('custrecord_interest_rate')) || 0;
            var vendorid = loanRec.getValue('custrecord_lender_name');
            var TDS_rate = (Number(loanRec.getValue('custrecord_ln_repay_tds_rate')) || 0) / 100;
            var paymentDateValue = loanRec.getValue('custrecord_payment_dates');
            var pfother_charge = Number(loanRec.getValue('custrecord_st_pf_other_charge')) || 0;

            if (!loanAmount || !startDateStr || !endDateStr || !annualInterestRate) return;

            var startDate = new Date(startDateStr);
            var endDate = new Date(endDateStr);
            if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate) return;

            var fixedPaymentDay = getFixedPaymentDay(paymentDateValue);

            createChildPaymentSchedule({
                parentLoanId: loanId,
                scheduleDate: startDate,
                daysInPeriod: 0,
                interest: 0,
                tds: 0,
                netInterest: 0,
                principal: 0,
                remainingBalance: loanAmount,
                cashflow: roundToTwo(-loanAmount + pfother_charge),
                vendorid: vendorid,
                month: getMonthName(startDate.getMonth()) + '-' + startDate.getFullYear().toString().substr(2),
                expense: 0,
                pfother_charge: pfother_charge
            });

            var remainingBalance = roundToTwo(loanAmount - pfother_charge);

         
            var endOfMonthDate = getLastDayOfMonth(startDate);
            var daysInPeriodToEndOfMonth = calculateDaysInPeriod(startDate, endOfMonthDate);
            var interestToEndOfMonth = roundToTwo((remainingBalance * annualInterestRate / 100) * (daysInPeriodToEndOfMonth / getDaysInYear(endOfMonthDate.getFullYear())));
            var tdsToEndOfMonth = roundToTwo(interestToEndOfMonth * TDS_rate);
            var netInterestToEndOfMonth = roundToTwo(interestToEndOfMonth - tdsToEndOfMonth);

            createChildPaymentSchedule({
                parentLoanId: loanId,
                scheduleDate: endOfMonthDate,
                daysInPeriod: daysInPeriodToEndOfMonth,
                interest: interestToEndOfMonth,
                tds: tdsToEndOfMonth,
                netInterest: netInterestToEndOfMonth,
                principal: 0,
                remainingBalance: remainingBalance,
                cashflow: interestToEndOfMonth,
                vendorid: vendorid,
                month: getMonthName(endOfMonthDate.getMonth()) + '-' + endOfMonthDate.getFullYear().toString().substr(2),
                expense: interestToEndOfMonth,
                pfother_charge: null
            });

           
            var tempDate = new Date(endOfMonthDate);
            var principalMonths = [];
            while (tempDate < endDate) {
                var nextDate = new Date(tempDate.getFullYear(), tempDate.getMonth() + 1, fixedPaymentDay);
                nextDate.setDate(Math.min(fixedPaymentDay, getLastDayOfMonth(nextDate).getDate()));
                if (nextDate > endDate) break;

                var daysInPeriod = calculateDaysInPeriod(tempDate, nextDate);
                var isFeb = (nextDate.getMonth() === 1); 
                var isEligibleMonth = (isFeb && daysInPeriod >= 28) || (!isFeb && daysInPeriod >= 30);
                if (isEligibleMonth) principalMonths.push(nextDate);

                tempDate = new Date(nextDate);
            }

            var totalPrincipalMonths = principalMonths.length;
            if (totalPrincipalMonths === 0) totalPrincipalMonths = 1; 
            var monthlyPrincipal = roundToTwo(remainingBalance / totalPrincipalMonths);

           
            var prevPaymentDate = new Date(endOfMonthDate);
            var principalCounter = 0;

            while (prevPaymentDate < endDate) {
                var currentDate = new Date(prevPaymentDate.getFullYear(), prevPaymentDate.getMonth() + 1, fixedPaymentDay);
                currentDate.setDate(Math.min(fixedPaymentDay, getLastDayOfMonth(currentDate).getDate()));
                if (currentDate > endDate) break;

                var daysInPeriod = calculateDaysInPeriod(prevPaymentDate, currentDate);
                var isFeb = (currentDate.getMonth() === 1);
                var isEligibleMonth = (isFeb && daysInPeriod >= 28) || (!isFeb && daysInPeriod >= 30);

                var daysInYear = getDaysInYear(currentDate.getFullYear());
                var interest = roundToTwo((remainingBalance * annualInterestRate / 100) * (daysInPeriod / daysInYear));
                var tds = roundToTwo(interest * TDS_rate);
                var netInterest = roundToTwo(interest - tds);

                var principal = 0;
                if (isEligibleMonth && principalCounter < totalPrincipalMonths) {
                    principalCounter++;
                    principal = (principalCounter === totalPrincipalMonths)
                        ? remainingBalance 
                        : Math.min(monthlyPrincipal, remainingBalance);
                }

                var cashflow = roundToTwo(interest + principal);
                remainingBalance = roundToTwo(remainingBalance - principal);

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
                    month: getMonthName(currentDate.getMonth()) + '-' + currentDate.getFullYear().toString().substr(2),
                    expense: interest,
                    pfother_charge: null
                });

                prevPaymentDate = new Date(currentDate);
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

    function getMonthName(monthIndex) {
        var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
