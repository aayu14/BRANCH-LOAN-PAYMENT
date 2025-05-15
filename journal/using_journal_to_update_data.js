/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/log'], function (search, record, log) {
   function getInputData() {
    try {
      var searchObj = search.create({
        type: "customrecordloan_repayment_schedule",
        filters: [
          ["custrecord_parent_loan_id.custrecord_linked_journal", "noneof", "@NONE@"],
          "AND",
          ["custrecord_parent_loan_id.custrecord_ln_repay_principal_amt", "greaterthan", "0.00"] ,
          "AND", 
      ["custrecord_loan_status","anyof","1"]
        ],
        columns: [
          "custrecord_principal_amt",
          search.createColumn({
            name: "custrecord_ln_repay_principal_amt",
            join: "CUSTRECORD_PARENT_LOAN_ID"
          }),
          search.createColumn({
            name: "formulanumeric",
            formula: "{custrecord_principal_amt} - {custrecord_parent_loan_id.custrecord_ln_repay_principal_amt}"
          }),
          search.createColumn({
            name: "custrecord_linked_journal",
            join: "CUSTRECORD_PARENT_LOAN_ID"
          }),
          "internalid",
          search.createColumn({
            name: "internalid",
            join: "CUSTRECORD_PARENT_LOAN_ID"
          }),
          search.createColumn({
            name: "custrecord_parent_loan_id",
            join: "CUSTRECORD_PARENT_LOAN_ID"
          })
        ]
      });

      log.debug('Search Created', 'Search Object Created Successfully');
      return searchObj;
    } catch (error) {
      log.error('Error in getInputData', error.message);
      throw error; 
    }
  }

  function map(context) {
    try {
      var result = JSON.parse(context.value);

      log.debug('Map Context Value', JSON.stringify(result));

      var repaymentScheduleId = result.id;
      var childLoanId = result.values["internalid.CUSTRECORD_PARENT_LOAN_ID"].value;
      var remainingAmt = parseFloat(result.values["formulanumeric"]);
      var journalId = result.values["custrecord_linked_journal.CUSTRECORD_PARENT_LOAN_ID"].value;

      log.debug(
        "Mapping Record",
        "Repayment Schedule ID:" +
          repaymentScheduleId +
          ", Child Loan ID: " +
          childLoanId +
          ", Remaining Amount:" +
          remainingAmt +
          ", Journal ID:" +
          journalId
      );

      var journalRecord = record.load({
        type: record.Type.JOURNAL_ENTRY,
        id: journalId
      });

      var journalStatus = journalRecord.getValue("approvalstatus");
      log.debug("Journal Status", "Journal ID: " + journalId + ", Status: " + journalStatus);

      if (journalStatus == "2") {
        var repaymentScheduleRecord = record.load({
          type: "customrecordloan_repayment_schedule",
          id: repaymentScheduleId
        });
        repaymentScheduleRecord.setValue({
          fieldId: "custrecord_current_remai_amt",
          value: remainingAmt
        });
         repaymentScheduleRecord.setValue({
          fieldId: "custrecord_loan_status",
          value: 2
        });
        repaymentScheduleRecord.save();
        log.debug("Repayment Schedule Saved", "Remaining Amount Updated Successfully");
      } else if (journalStatus == "3") {
        
        var repaymentScheduleRecord = record.load({
          type: "customrecord_loan_payment_schedule",
          id: childLoanId
        });
        repaymentScheduleRecord.setValue({
          fieldId: "custrecord_linked_journal",
          value: ""
        });
        repaymentScheduleRecord.save();
        log.debug("Repayment Schedule Updated", "Linked Journal Removed");
      } else {
        log.debug(
          "Journal Pending",
          "No Action for Repayment Schedule ID: " + repaymentScheduleId + ", Journal ID:" + journalId
        );
      }
    } catch (error) {
      log.error("Error in Map Function", error.message);
    }
  }

  return {
    getInputData: getInputData,
    map: map
  };
});