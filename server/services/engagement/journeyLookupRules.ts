// Pure identity-scoping helper for the per-patient journey timeline.
//
// The per-patient call-history timeline endpoint scopes its journey-event
// lookup via journeyLookupFilter():
//   - name + DOB present  → identity-scoped { patientName, patientDob }
//                           (spans every execution case for that person)
//   - DOB missing/blank   → case-scoped   { executionCaseId }
//                           (never mixes patients)
//
// The critical invariant: two DIFFERENT patients who share the same
// name must NEVER fall back to a name-only lookup when DOB is absent,
// because that would merge their histories (a correctness bug AND a
// PHI cross-patient leak). We therefore require BOTH name and DOB to
// scope by identity; when DOB is missing we fall back to the unique
// execution-case id, which never mixes patients (at the cost of not
// spanning sibling cases for that one person).
//
// This file is intentionally pure (no DB / no drizzle imports) so the
// invariant can be regression-tested without DATABASE_URL — see
// tests/unit/journeyLookupScoping.test.ts.

export function journeyLookupFilter(args: {
  executionCaseId: number;
  patientName: string | null | undefined;
  patientDob: string | null | undefined;
}):
  | { patientName: string; patientDob: string }
  | { executionCaseId: number } {
  const name = args.patientName?.trim() || null;
  const dob = args.patientDob?.trim() || null;
  if (name && dob) return { patientName: name, patientDob: dob };
  return { executionCaseId: args.executionCaseId };
}
