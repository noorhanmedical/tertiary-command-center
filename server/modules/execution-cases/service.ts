// Execution-case spine — read-only service (Batch 10 read-only foundation).
//
// Thin re-export over repo + state-machine. Future Batch 10b implements
// the transactional writer on top of these helpers; this batch ships
// only the read surface + legality check.

export {
  getExecutionCaseSnapshot,
  listExecutionCasesByAssignee,
  listExecutionCasesByPatientScreeningId,
} from "./repo";

export {
  checkTransitionLegality,
  requireLegalTransition,
} from "./state-machine";
