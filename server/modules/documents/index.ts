// Documents — module barrel (Bundle 27).
//
// Re-exports the contract types + pure helpers. No runtime side
// effects: importing the module does NOT connect to a DB, does NOT
// boot the Drizzle schema runtime, and does NOT bring in the repo
// or any route module.
//
// Dormancy invariant: scripts/qa-documents-dormant-module.mjs
// walks server/, shared/, client/ and fails CI if any non-test file
// imports from this module.

export * from "./contracts";
export {
  evaluateBillingReadinessFromRows,
  getPassingStatusesForDocType,
  isPassingStatusForDocType,
} from "./service";
