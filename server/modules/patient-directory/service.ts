// Patient Directory — read-only service layer.
//
// Re-exports the repo helpers as the public service surface. The two
// exports below are the future canonical entry points for "who is this
// patient?" queries. Today no route calls them; the module ships unwired.

export {
  getCanonicalPatientByScreeningId,
  listCanonicalPatients,
  computeCanonicalPatientId,
} from "./repo";
