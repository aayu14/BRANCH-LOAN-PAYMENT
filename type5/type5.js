/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {

    function afterSubmit(context) {
        try {
            if (context.type != context.UserEventType.CREATE) {
                return;
            }

            var loanRec = context.newRecord;
            var loanId = loanRec.id;

            var loanType = loanRec.getValue('custrecord_st_repay_loan_type');
            if (loanType != 5) {
                log.debug('Loan Type Check', 'Script will not execute as custrecord_st_repay_loan_type is not 5');
                return;
            }

            var loanAmount = loanRec.getValue('custrecord_principal_amt');
            var startDateStr = loanRec.getValue('custrecord_start_date');
            var endDateStr = loanRec.getValue('custrecord_end_date');
            var annualInterestRate = loanRec.getValue('custrecord_interest_rate');
            var vendorid = loanRec.getValue('custrecord_lender_name');
            var TDS_rate = loanRec.getValue('custrecord_ln_repay_tds_rate') || 0;
            var TDS_RATE = TDS_rate / 100;

            if (!loanAmount || isNaN(loanAmount) || !startDateStr || !endDateStr || !annualInterestRate || isNaN(annualInterestRate)) {
                log.debug('Validation Failed', 'Loan amount, start date, end date, or interest rate is missing or invalid.');
                return;
            }

            var startDate = new Date(startDateStr);
            var endDate = new Date(endDateStr);
            if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate) {
                log.debug('Invalid Start or End Date', 'Start Date: ' + startDateStr + ' , End Date: ' + endDateStr);
                return;
            }

        
            var paymentDateValue = loanRec.getValue('custrecord_payment_date');
            var fixedPaymentDay = 12;
            if (paymentDateValue) {
                if (paymentDateValue instanceof Date) {
                    fixedPaymentDay = paymentDateValue.getDate();
                } else {
                    fixedPaymentDay = parseInt(paymentDateValue, 10);
                }
            }
            if (!fixedPaymentDay || fixedPaymentDay < 1 || fixedPaymentDay > 31) {
                throw new Error('Invalid payment day specified. Must be between 1 and 31.');
            }

            var remainingBalance = loanAmount;
            var monthsDiff = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
            var monthlyPrincipal = parseFloat((loanAmount / monthsDiff).toFixed(2));

            var currentDate = new Date(startDate);
            currentDate.setDate(fixedPaymentDay);

            
            createChildPaymentSchedule({
                parentLoanId: loanId,
                scheduleDate: startDate,
                daysInPeriod: 0,
                interest: 0,
                tds: 0,
                netInterest: 0,
                principal: 0,
                remainingBalance: remainingBalance,
                cashflow: 0,
                vendorid: vendorid,
                daysInMonth: 0,
                month: 'Disbursement',
                expense: 0
            });

            for (var i = 1; i <= monthsDiff; i++) {
                if (currentDate > endDate) break;

                var year = currentDate.getFullYear();
                var month = currentDate.getMonth();
                var daysInYear = getDaysInYear(year);

                var prevDate = new Date(currentDate);
                prevDate.setMonth(prevDate.getMonth() - 1);

               
                var actualCurrentDate = getAdjustedDate(year, month, fixedPaymentDay);
                var actualPrevDate = getAdjustedDate(prevDate.getFullYear(), prevDate.getMonth(), fixedPaymentDay);

                var noOfDays = Math.round((actualCurrentDate - actualPrevDate) / (1000 * 60 * 60 * 24));

                var interest = parseFloat((remainingBalance * annualInterestRate / 100 * (noOfDays / daysInYear)).toFixed(2));
                var tds = parseFloat((interest * TDS_RATE).toFixed(2));
                var netInterest = parseFloat((interest - tds).toFixed(2));
                var cashflow = parseFloat((interest + monthlyPrincipal).toFixed(2));
                var expense = parseFloat((interest + tds).toFixed(2));

                remainingBalance = parseFloat((remainingBalance - monthlyPrincipal).toFixed(2));
                if (remainingBalance < 0) remainingBalance = 0;

                var monthName = getMonthShortName(month) + '-' + String(year).slice(-2);

                createChildPaymentSchedule({
                    parentLoanId: loanId,
                    scheduleDate: actualCurrentDate,
                    daysInPeriod: noOfDays,
                    interest: interest,
                    tds: tds,
                    netInterest: netInterest,
                    principal: monthlyPrincipal,
                    remainingBalance: remainingBalance,
                    cashflow: cashflow,
                    vendorid: vendorid,
                    daysInMonth: noOfDays,
                    month: monthName,
                    expense: expense
                });

                currentDate.setMonth(currentDate.getMonth() + 1);
            }

            log.audit('Repayment Schedule Created for Loan', loanId);

        } catch (error) {
            log.error('Error Generating Repayment Schedule', error.message);
        }
    }

    function getAdjustedDate(year, month, day) {
        var date = new Date(year, month, day);
        if (date.getMonth() != month) {
            return new Date(year, month + 1, 0); 
        }
        return date;
    }

    function getDaysInYear(year) {
        return ((year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)) ? 366 : 365;
    }

    function getMonthShortName(monthIndex) {
        var monthNames = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        ];
        return monthNames[monthIndex];
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
            paymentRec.setValue('custrecord_ln_repay_principal_amt', scheduleData.principal.toFixed(2));
            paymentRec.setValue('custrecord_interest_paid', scheduleData.interest.toFixed(2));
            paymentRec.setValue('custrecord_ln_repay_net_interest', scheduleData.netInterest.toFixed(2));
            paymentRec.setValue('custrecord_ln_repay_ending_balance', scheduleData.remainingBalance.toFixed(2));
            paymentRec.setValue('custrecord_ln_repay_tds', scheduleData.tds.toFixed(2));
            paymentRec.setValue('custrecord_ln_repay_monthly_expns', scheduleData.expense.toFixed(2));
            paymentRec.save();
        } catch (error) {
            log.error('Error Creating Payment Schedule Record', error.message);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
