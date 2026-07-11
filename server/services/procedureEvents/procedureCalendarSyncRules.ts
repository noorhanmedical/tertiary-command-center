// Pure decision rule for the procedure ↔ calendar mirror.
//
// The `procedure_complete` global-schedule mirror should be cleared when
// an update transitions the procedure AWAY from "complete" (reopened,
// no-show, cancelled, in_progress, not_started, etc.). This helper
// isolates that decision so the identity-scoping invariant is
// unit-testable without DATABASE_URL.
//
// The exact rule:
//   - The update touches procedureStatus (procedureStatus !== undefined)
//   - AND the new procedureStatus is not "complete"
//
// If procedureStatus is untouched, we do NOT infer a status change and
// leave the mirror alone. If procedureStatus is set to "complete", the
// mirror is (re)upserted elsewhere; we do not clear.

export type ProcedureUpdateShape = {
  procedureStatus?: string | null | undefined;
  [key: string]: unknown;
};

export function shouldClearProcedureCompleteMirror(
  updates: ProcedureUpdateShape,
): boolean {
  if (!("procedureStatus" in updates)) return false;
  if (updates.procedureStatus === undefined) return false;
  return updates.procedureStatus !== "complete";
}
