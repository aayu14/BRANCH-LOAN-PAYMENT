/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */

define(['N/record', 'N/log'], function (record, log) {

    var MONTHS_PER_PAYMENT = 3;

    function afterSubmit(context) {
        try {
          
            if (context.type != context.UserEventType.CREATE ) {  
                return;
            }
            var loanRec = context.newRecord;
            var loanId = loanRec.id;
            var loanType = loanRec.getValue('custrecord_st_repay_loan_type');
            if (loanType != 1) {
                log.debug('Loan Type Check', 'Script will not execute as custrecord_st_repay_loan_type is not 1');
                return;
            }
           
            var loanAmount = loanRec.getValue('custrecord_principal_amt');
            var startDateStr = loanRec.getValue('custrecord_start_date');
            var endDateStr = loanRec.getValue('custrecord_end_date');
            var annualInterestRate = loanRec.getValue('custrecord_interest_rate');
            var vendorid = loanRec.getValue('custrecord_lender_name');
            var TDS_rate  = loanRec.getValue('custrecord_ln_repay_tds_rate') || 0 ;
            var TDS_RATE = TDS_rate/100 ;

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
                cashflow: 0,
                vendorid: vendorid,
                daysInMonth: 0,
                month: 'Start Date',
                expense: 0
            });

            var currentDate = new Date(startDate);
            currentDate.setDate(1);

            while (currentDate <= endDate) {
                var year = currentDate.getFullYear();
                var month = currentDate.getMonth();

                var lastDayOfMonth = new Date(year, month + 1, 0);
                if (lastDayOfMonth > endDate) lastDayOfMonth = new Date(endDate);

                var daysInMonth;
                if (currentDate.getFullYear() === startDate.getFullYear() && currentDate.getMonth() === startDate.getMonth()) {
                    daysInMonth = (lastDayOfMonth - startDate) / (1000 * 60 * 60 * 24) + 1;
                } else {
                    daysInMonth = lastDayOfMonth.getDate();
                }
                daysInMonth = Math.round(daysInMonth);

               var daysInYear = getDaysInYear(year);//
               var dailyInterest = (annualInterestRate / 100) / daysInYear;
               // var netDailyInterest = dailyInterest * (1 + (TDS_RATE));

                // var dailyInterest = (annualInterestRate / 100) / 365;
                var expense = remainingBalance * dailyInterest * daysInMonth;

                var monthsSinceStart = (year - startDate.getFullYear()) * 12 + month - startDate.getMonth();
                var isQuarterly = monthsSinceStart % MONTHS_PER_PAYMENT === MONTHS_PER_PAYMENT - 1;

                var interest = 0, tds = 0, netInterest = 0, principal = 0, cashflow = 0, daysInPeriod = daysInMonth;

                if (isQuarterly || lastDayOfMonth.getTime() === endDate.getTime()) {
                    var quarterStart = new Date(currentDate);
                    quarterStart.setMonth(currentDate.getMonth() - (MONTHS_PER_PAYMENT - 1));
                    quarterStart.setDate(1);
                    if (quarterStart < startDate) quarterStart = new Date(startDate);

                    var quarterEnd = new Date(year, month + 1, 0);
                    if (quarterEnd > endDate) quarterEnd = new Date(endDate);

                    var quarterlyDays = calculateDaysInPeriod(quarterStart, quarterEnd);

                    // interest = parseFloat((remainingBalance * (annualInterestRate / 100) * (quarterlyDays / 365)).toFixed(2));
                    interest = parseFloat((remainingBalance * (annualInterestRate / 100) * (quarterlyDays / daysInYear)).toFixed(2));
                    var tds = interest * TDS_RATE;
                    netInterest = parseFloat((interest - tds).toFixed(2));
                     // netInterest =  parseFloat((interest + tds).toFixed(2));

                    if (lastDayOfMonth.getTime() === endDate.getTime()) {
                        principal = remainingBalance;
                        remainingBalance = 0; 
                    } else {
                        principal = 0;
                    }

                    cashflow =  interest  + principal;

                   
                    remainingBalance -= principal;
                    if (Math.abs(remainingBalance) < 0.01) { 
                        remainingBalance = 0;
                    }
                }

                var monthName = getMonthName(month) + ' ' + year;

                createChildPaymentSchedule({
                    parentLoanId: loanId,
                    scheduleDate: lastDayOfMonth,
                    daysInPeriod: daysInPeriod,
                    interest:interest,
                    tds: tds,
                    netInterest: netInterest,
                    principal: principal,
                    remainingBalance: remainingBalance,
                    cashflow: cashflow,
                    vendorid: vendorid,
                    daysInMonth: daysInMonth,
                    month: monthName,
                    expense: parseFloat(expense.toFixed(2))
                });

                currentDate.setMonth(currentDate.getMonth() + 1);
            }

            log.audit('Repayment Schedule Created for Loan', loanId);
        } catch (error) {
            log.error('Error Generating Repayment Schedule', error.message);
        }
    }

    function calculateDaysInPeriod(startDate, endDate) {
        return Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    }

    function getMonthName(monthIndex) {
        var monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        return monthNames[monthIndex];
    }
    function getDaysInYear(year) {
    return ((year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)) ? 366 : 365;
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