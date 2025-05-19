/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
                return;
            }

            var loanRec = context.newRecord;
            var loanId = loanRec.id;
            var loanType = loanRec.getValue('custrecord_st_repay_loan_type');
            if (loanType != 6) {
                log.debug('Loan Type Check', 'Script will not execute as custrecord_st_repay_loan_type is not 1');
                return;
            }

            var loanAmount = loanRec.getValue('custrecord_principal_amt');
            var startDateStr = loanRec.getValue('custrecord_start_date');
            var endDateStr = loanRec.getValue('custrecord_end_date');
            var annualInterestRate = loanRec.getValue('custrecord_interest_rate');
            var vendorid = loanRec.getValue('custrecord_lender_name');
            var TDS_rate = loanRec.getValue('custrecord_ln_repay_tds_rate') || 0;
            var TDS_RATE = TDS_rate / 100;
             var pfother_charge = Number(loanRec.getValue('custrecord_st_pf_other_charge')) || 0;


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
               cashflow: loanAmount - pfother_charge,
                vendorid: vendorid,
                daysInMonth: 0,
                month: 'Start Date',
                expense: 0,
                 pfother_charge: pfother_charge
            });

            var HIGH_PERCENT = 0.10;
            var LOW_PERCENT = 0.05;
            var totalMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth()) + 1;

            for (var monthIndex = 0; monthIndex < totalMonths; monthIndex++) {
                var year = startDate.getFullYear();
                var month = startDate.getMonth() + monthIndex;
                year += Math.floor(month / 12);
                month = month % 12;

                var currentMonthDate = new Date(year, month, 1);
                var lastDayOfMonth = new Date(year, month + 1, 0);
                if (lastDayOfMonth > endDate) lastDayOfMonth = new Date(endDate);

                var daysInMonth = Math.round((lastDayOfMonth - currentMonthDate) / (1000 * 60 * 60 * 24)) + 1;
                var daysInYear = getDaysInYear(year);

                var dailyInterestRate = (annualInterestRate / 100) / daysInYear;
                var interest = remainingBalance * dailyInterestRate * daysInMonth;
                var tds = interest * TDS_RATE;
                var netInterest = interest - tds;
                var expense = interest;

                
                var principalPercent = monthIndex < 7 ? HIGH_PERCENT : LOW_PERCENT;
                var principal = loanAmount * principalPercent;

                
                if (principal > remainingBalance || monthIndex === totalMonths - 1) {
                    principal = remainingBalance;
                }

                var cashflow = principal + interest;
                remainingBalance -= principal;
                if (Math.abs(remainingBalance) < 0.01) {
                    remainingBalance = 0;
                }

                var monthName = getMonthName(month) + ' ' + year;

                createChildPaymentSchedule({
                    parentLoanId: loanId,
                    scheduleDate: lastDayOfMonth,
                    daysInPeriod: daysInMonth,
                    interest: parseFloat(interest.toFixed(2)),
                    tds: parseFloat(tds.toFixed(2)),
                    netInterest: parseFloat(netInterest.toFixed(2)),
                    principal: parseFloat(principal.toFixed(2)),
                    remainingBalance: parseFloat(remainingBalance.toFixed(2)),
                    cashflow: parseFloat(cashflow.toFixed(2)),
                    vendorid: vendorid,
                    daysInMonth: daysInMonth,
                    month: monthName,
                    expense: parseFloat(expense.toFixed(2))
                });
            }

            log.audit('Repayment Schedule Created for Loan', loanId);
        } catch (error) {
            log.error('Error Generating Repayment Schedule', error.message);
        }
    }

    function getDaysInYear(year) {
        return ((year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)) ? 366 : 365;
    }

    function getMonthName(monthIndex) {
        var monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
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
             paymentRec.setValue('custrecord_st_pf_other_charges', scheduleData.pfother_charge);
            paymentRec.save();
        } catch (error) {
            log.error('Error Creating Payment Schedule Record', error.message);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
