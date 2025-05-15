/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/runtime', 'N/format'], function (search, record, runtime, format) {

    function getInputData() {
        try {
            log.debug('getInputData', 'Starting getInputData function');

            var searchObj = search.create({
                type: "customrecordloan_repayment_schedule",
                filters: [
                    ["custrecord_parent_loan_id.custrecord_linked_journal", "anyof", "@NONE@"],
                    "AND",
                    ["custrecord_parent_loan_id.custrecord_interest_paid", "greaterthan", "0.00"],
                    "AND",
                    ["custrecord_parent_loan_id.custrecord_payment_date", "on", getCurrentDate()]
                    // ["custrecord_parent_loan_id.custrecord_payment_date", "onorbefore", getCurrentDate()]
                ],
                columns: [
                    "custrecord_lender_name",
                    "custrecorddebit_account",
                    "custrecord_credit_account",
                    "custrecord_repay_currency",
                    search.createColumn({ name: "internalid", join: "CUSTRECORD_PARENT_LOAN_ID"}),
                    search.createColumn({ name: "custrecord_parent_loan_id", join: "CUSTRECORD_PARENT_LOAN_ID" }),
                    search.createColumn({ name: "custrecord_payment_date", join: "CUSTRECORD_PARENT_LOAN_ID" }),
                    search.createColumn({ name: "custrecord_ln_repay_cashflow", join: "CUSTRECORD_PARENT_LOAN_ID" }),
                    search.createColumn({ name: "custrecord_interest_paid", join: "CUSTRECORD_PARENT_LOAN_ID" }),
                    search.createColumn({ name: "custrecord_ln_repay_principal_amt", join: "CUSTRECORD_PARENT_LOAN_ID" })
                ]
            });

            log.debug('getInputData', 'Search created successfully');
            return searchObj;
        } catch (e) {
            log.error('getInputData Error', e.message);
            throw e; 
        }
    }

    function map(context) {
        try {
            log.debug('map', 'Starting map function with context: ' + context.value);
    
          
            var result = JSON.parse(context.value);
            
            
            var parentLoanId = result.values["custrecord_parent_loan_id.CUSTRECORD_PARENT_LOAN_ID"].value;
            var internalid = result.values["internalid.CUSTRECORD_PARENT_LOAN_ID"].value;
            var principalAmount = parseFloat(result.values["custrecord_ln_repay_principal_amt.CUSTRECORD_PARENT_LOAN_ID"]) || 0;
            var debitAccount = result.values["custrecorddebit_account"].value;
            var paymentdate = result.values["custrecord_payment_date.CUSTRECORD_PARENT_LOAN_ID"];
            var vendor = result.values["custrecord_lender_name"].value;
            var creditAccount = result.values["custrecord_credit_account"].value;
            var currency = result.values["custrecord_repay_currency"].value;
            var cashFlow = parseFloat(result.values["custrecord_ln_repay_cashflow.CUSTRECORD_PARENT_LOAN_ID"]) || 0;
            var interestPaid = parseFloat(result.values["custrecord_interest_paid.CUSTRECORD_PARENT_LOAN_ID"]) || 0;
    
            log.debug('map', 'Extracted data - ParentLoanId: ' + parentLoanId + ', InternalId: ' + internalid + ', PrincipalAmount: ' + principalAmount + ', DebitAccount: ' + debitAccount + ', Vendor: ' + vendor + ', CreditAccount: ' + creditAccount + ', CashFlow: ' + cashFlow + ', InterestPaid: ' + interestPaid + ', PaymentDate: ' + paymentdate);
    
            if (!parentLoanId) {
                log.error('map Error', 'ParentLoanId is undefined or null. Skipping this record.');
                return;
            }
    
          
            context.write(parentLoanId, {
                loanRecordId: result.id,
                debitAccount: debitAccount,
                creditAccount: creditAccount,
                cashFlow: cashFlow,
                interestPaid: interestPaid,
                vendor: vendor,
                internalid: internalid,
                paymentdate: paymentdate,
                currency :currency ,
                principalAmount: principalAmount
            });
        } catch (e) {
            log.error('map Error', e.message);
            throw e;
        }
    }

    function reduce(context) {
        try {
            log.debug('reduce', 'Starting reduce function with context: ' + JSON.stringify(context));

            var loanDetails = context.values.map(function (value) {
                return JSON.parse(value);
            });
            log.debug('reduce', 'Parsed loan details: ' + JSON.stringify(loanDetails));

            loanDetails.forEach(function (detail) {
                try {
                    log.debug('reduce', 'Processing detail: ' + JSON.stringify(detail));

                    var vendorId = detail.vendor;
                    var subsidiary = getSubsidiaryFromVendor(vendorId);
                    log.debug('reduce', 'Fetched subsidiary: ' + subsidiary + ' for vendorId: ' + vendorId);

                    var journalId = createJournalEntry(detail.debitAccount, detail.creditAccount, detail.cashFlow, detail.interestPaid, vendorId, subsidiary, detail.internalid, detail.paymentdate,detail.currency);
                    log.debug('reduce', 'Created journal entry with ID: ' + journalId);

                    if (journalId) {
                        record.submitFields({
                            type: 'customrecord_loan_payment_schedule',
                            id: detail.internalid,
                            values: { custrecord_linked_journal: journalId }
                        });
                        log.debug('reduce', 'Updated repayment schedule with journal ID: ' + journalId);
                    }
                } catch (e) {
                    log.error('reduce Detail Processing Error', e.message);
                   
                }
            });
        } catch (e) {
            log.error('reduce Error', e.message);
            throw e; 
        }
    }

    function createJournalEntry(debitAccount, creditAccount, cashFlow, interestPaid, vendorId, subsidiary, internalid, paymentdate,currency ) {
        try {
            log.debug('createJournalEntry', 'Creating journal entry with DebitAccount: ' + debitAccount + ', CreditAccount: ' + creditAccount + ', CashFlow: ' + cashFlow + ', InterestPaid: ' + interestPaid + ', VendorId: ' + vendorId + ', Subsidiary: ' + subsidiary + ', InternalId: ' + internalid);

            var journal = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });

            if (subsidiary) {
                journal.setValue({ fieldId: 'subsidiary', value: subsidiary });
            }
            if (internalid) {
                journal.setValue({ fieldId: 'custbody_loan_payment_linked', value: internalid });
            }
            if (vendorId) {
                journal.setValue({ fieldId: 'entity', value: vendorId });
            }
            if (paymentdate) {
                var parsedDate = format.parse({ value: paymentdate, type: format.Type.DATE });
                journal.setValue({ fieldId: 'trandate', value: parsedDate });
            }
            if (currency ) {              
                journal.setValue({ fieldId: 'currency', value: currency  });
            }

            journal.selectNewLine({ sublistId: 'line' });
            journal.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: debitAccount });
            journal.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: cashFlow });
            journal.commitLine({ sublistId: 'line' });

            journal.selectNewLine({ sublistId: 'line' });
            journal.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: creditAccount });
            journal.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: cashFlow });
            journal.commitLine({ sublistId: 'line' });

            var journalId = journal.save();
            log.debug('createJournalEntry', 'Journal entry created successfully with ID: ' + journalId);
            return journalId;
        } catch (e) {
            log.error('createJournalEntry Error', e.message);
            return null;
        }
    }

    function getSubsidiaryFromVendor(vendorId) {
        try {
            log.debug('getSubsidiaryFromVendor', 'Fetching subsidiary for VendorId: ' + vendorId);

            if (!vendorId) return null;

            var vendorRecord = record.load({ type: record.Type.VENDOR, id: vendorId });
            var subsidiary = vendorRecord.getValue('subsidiary');
            log.debug('getSubsidiaryFromVendor', 'Fetched subsidiary: ' + subsidiary);
            return subsidiary;
        } catch (e) {
            log.error('getSubsidiaryFromVendor Error', e.message);
            return null;
        }
    }

    function getCurrentDate() {
        try {
            var currentDate = format.format({ value: new Date(), type: format.Type.DATE });
            log.debug('getCurrentDate', 'Current date: ' + currentDate);
            return currentDate;
        } catch (e) {
            log.error('getCurrentDate Error', e.message);
            throw e;
        }
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce
    };
});