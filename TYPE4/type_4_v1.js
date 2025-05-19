/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {
    function afterSubmit(context) {
        try {
             if (context.type != context.UserEventType.CREATE ) {  
                return;
            }
            var loanRec = context.newRecord; 
            var loanId = loanRec.id;

            var loanType = loanRec.getValue('custrecord_st_repay_loan_type');
            if (loanType != 4) {
                log.debug('Loan Type Check', 'Script will not execute as custrecord_st_repay_loan_type is not 1');
                return;
            }
            

            var startDate = new Date(loanRec.getValue('custrecord_start_date'));
            var endDate = new Date(loanRec.getValue('custrecord_end_date'));
            var vendorid = loanRec.getValue('custrecord_lender_name');
            var loanAmount = loanRec.getValue('custrecord_principal_amt');
            var annualInterestRate = parseFloat(loanRec.getValue('custrecord_interest_rate'));
            var remainingBalance = loanAmount;
            var TDS_rate = loanRec.getValue('custrecord_ln_repay_tds_rate') || 0;
            var TDS_RATE = TDS_rate / 100;

            if (!loanAmount || isNaN(loanAmount) || !startDate || !endDate || !annualInterestRate || isNaN(annualInterestRate)) {
                log.debug('Validation Failed', 'Loan amount, start date, end date, or interest rate is missing or invalid.');
                return;
            }

            var paymentDateValue = loanRec.getValue('custrecord_payment_dates');
            var fixedPaymentDay = null;
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

            function getDaysInYear(year) {
                return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
            }

            function getMonthName(monthIndex) {
                var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                return monthNames[monthIndex];
            }

            function getLastDayOfMonth(date) {
                return new Date(date.getFullYear(), date.getMonth() + 1, 0);
            }

            function createChildPaymentSchedule(params) {
                var repaymentRecord = record.create({
                    type: 'customrecord_loan_repayment_schedule',
                    isDynamic: true
                });

                repaymentRecord.setValue('custrecord_parent_loan', params.parentLoanId);
                repaymentRecord.setValue('custrecord_payment_date', params.scheduleDate);
                repaymentRecord.setValue('custrecord_no_of_days', params.daysInPeriod);
                repaymentRecord.setValue('custrecord_interest_amount', params.interest);
                repaymentRecord.setValue('custrecord_tds_amount', params.tds);
                repaymentRecord.setValue('custrecord_interest_net_of_tds', params.netInterest);
                repaymentRecord.setValue('custrecord_principal_amount', params.principal);
                repaymentRecord.setValue('custrecord_ending_balance', params.remainingBalance);
                repaymentRecord.setValue('custrecord_cashflow', params.cashflow);
                repaymentRecord.setValue('custrecord_lender_name_link', params.vendorid);
                repaymentRecord.setValue('custrecord_days_in_month', params.daysInMonth);
                repaymentRecord.setValue('custrecord_month', params.month);
                repaymentRecord.setValue('custrecord_expense_amount', params.expense);
                repaymentRecord.save();
            }

   
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
                month: getMonthName(startDate.getMonth()) + ' ' + startDate.getFullYear(),
                expense: 0,
                pfother_charge:pfother_charge
            });

            remainingBalance = roundToTwo(remainingBalance - pfother_charge);
            var endOfStartMonth = getLastDayOfMonth(startDate);
            if (endOfStartMonth > endDate) {
                endOfStartMonth = new Date(endDate);
            }

            var daysSecondPeriod = Math.ceil((endOfStartMonth - startDate) / (1000 * 60 * 60 * 24));
            var interestSecond = parseFloat((remainingBalance * (annualInterestRate / 100) * (daysSecondPeriod / getDaysInYear(startDate.getFullYear()))).toFixed(2));
            var tdsSecond = interestSecond * TDS_RATE;
            var netInterestSecond = parseFloat((interestSecond - tdsSecond).toFixed(2));
            var expenseSecond = remainingBalance * (annualInterestRate / 100) * (daysSecondPeriod / getDaysInYear(startDate.getFullYear()));

            createChildPaymentSchedule({
                parentLoanId: loanId,
                scheduleDate: endOfStartMonth,
                daysInPeriod: daysSecondPeriod,
                interest: interestSecond,
                tds: tdsSecond,
                netInterest: netInterestSecond,
                principal: 0,
                remainingBalance: remainingBalance,
                cashflow: interestSecond,
                vendorid: vendorid,
                daysInMonth: daysSecondPeriod,
                month: getMonthName(endOfStartMonth.getMonth()) + ' ' + endOfStartMonth.getFullYear(),
                expense: parseFloat(expenseSecond.toFixed(2))
            });

           
            var previousDate = new Date(endOfStartMonth);
            var currentDate = new Date(previousDate);
            currentDate.setMonth(currentDate.getMonth() + 1);
            currentDate.setDate(fixedPaymentDay);

          
            if (currentDate > endDate) {
                currentDate = new Date(endDate);
            }

            while (currentDate <= endDate) {
                var daysInPeriod = Math.ceil((currentDate - previousDate) / (1000 * 60 * 60 * 24));
                var year = currentDate.getFullYear();
                var dailyInterest = (annualInterestRate / 100) / getDaysInYear(year);
                var interest = parseFloat((remainingBalance * dailyInterest * daysInPeriod).toFixed(2));
                var tds = interest * TDS_RATE;
                var netInterest = parseFloat((interest - tds).toFixed(2));
                var expense = remainingBalance * dailyInterest * daysInPeriod;
                  var pfother_charge = parseFloat(loanRec.getValue('custrecord_st_pf_other_charge') || 0);
                var principal = 0;
                if (currentDate.getTime() === endDate.getTime()) {
                    principal = remainingBalance;
                    remainingBalance = 0;
                }

                var cashflow = interest + principal;
                remainingBalance -= principal;

                if (Math.abs(remainingBalance) < 0.01) remainingBalance = 0;

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
                    daysInMonth: daysInPeriod,
                    month: getMonthName(currentDate.getMonth()) + ' ' + currentDate.getFullYear(),
                    expense: parseFloat(expense.toFixed(2))
                });

                previousDate = new Date(currentDate);
                currentDate.setMonth(currentDate.getMonth() + 1);
                currentDate.setDate(fixedPaymentDay);

                if (currentDate > endDate) {
                    currentDate = new Date(endDate);
                }
            }

        } catch (e) {
            log.error('Error in afterSubmit', e.message || e.toString());
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
