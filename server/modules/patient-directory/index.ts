// Patient Directory — barrel.
//
// Re-exports the public contract types and read-only service helpers.
// The module is intentionally NOT wired to any route in this batch
// (Batch 5). Future batches will introduce the patient_directory table
// and switch the helpers' backing store; the public signature stays the
// same.

export * from "./contracts";
export {
  getCanonicalPatientByScreeningId,
  listCanonicalPatients,
  computeCanonicalPatientId,
} from "./service";
