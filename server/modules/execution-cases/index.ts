// Execution-case spine — barrel (Batch 10 read-only foundation).
//
// Intentionally NOT wired to any route in this batch. Future Batch 10b
// PR introduces the transactional writer + opt-in feature flag.

export * from "./contracts";
export {
  getExecutionCaseSnapshot,
  listExecutionCasesByAssignee,
  listExecutionCasesByPatientScreeningId,
  checkTransitionLegality,
  requireLegalTransition,
} from "./service";
