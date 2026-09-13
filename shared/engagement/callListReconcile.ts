// PURE decision helpers for the resumable Engagement call-list CONFIRM flow.
//
// Extracted from callListConfirm so the retry/idempotency invariants are
// unit-testable without a DB. No imports, no side effects.
//
// INVARIANT (production hardening): for a confirmed distribution operation,
// EVERY expected team member (one with assigned patients) must eventually have
// EXACTLY ONE package. A crash that packaged only SOME members must be
// finishable on retry — never short-circuited after seeing "any package".

export type SurvivorClassification =
  | "survivor"
  | "clinic_conflict"
  | "ineligible_conflict";

/**
 * Decide whether one reviewed mapping entry survives to be assigned+packaged.
 *
 * Retry-safety: a case ALREADY assigned to its intended member by a prior
 * (interrupted) run of THIS confirm stays a `survivor` even if it would now
 * fail the callable gate — its canonical assignment already stands and only its
 * package needs completing. First-run (never-assigned) ineligible cases become
 * `ineligible_conflict` (excluded, never replaced). A case outside the caller's
 * authorized clinic set is a `clinic_conflict` (defense-in-depth tenant gate).
 */
export function classifyMappingEntry(args: {
  /** The case row exists (was loaded). */
  loadedExists: boolean;
  /** The case's clinicId (null when unknown). */
  caseClinicId: number | null;
  /** Authorized clinic ids; null = admin (no clinic narrowing). */
  allowedClinicIds: number[] | null;
  /** The case still passes the canonical callable gate right now. */
  eligible: boolean;
  /** The case's current owner (assignedTeamMemberId), null when unassigned. */
  assignedTeamMemberId: number | null;
  /** The member this entry maps the case to. */
  intendedTeamMemberId: number;
}): SurvivorClassification {
  if (!args.loadedExists) return "ineligible_conflict";

  // Clinic tenant gate (skipped for admin — allowedClinicIds null).
  if (args.allowedClinicIds !== null) {
    if (args.caseClinicId == null || !args.allowedClinicIds.includes(args.caseClinicId)) {
      return "clinic_conflict";
    }
  }

  // Already assigned to its intended member by a prior run → resume (survivor).
  if (args.assignedTeamMemberId === args.intendedTeamMemberId) return "survivor";

  return args.eligible ? "survivor" : "ineligible_conflict";
}

export type OperationStatus =
  | "fully_complete"
  | "assignment_complete_package_incomplete";

/**
 * Derive the operation completion state from the expected vs packaged member
 * sets. `fully_complete` iff every expected member ended with a package;
 * otherwise `assignment_complete_package_incomplete` (a retry finishes it).
 */
export function deriveOperationStatus(
  expectedMemberCount: number,
  packagedMemberCount: number,
): OperationStatus {
  return packagedMemberCount >= expectedMemberCount
    ? "fully_complete"
    : "assignment_complete_package_incomplete";
}

export type PackageReconcilePlan = {
  /** Member ids that still need a package created this run. */
  toCreate: number[];
  /** Member ids whose package already exists (reuse, don't recreate). */
  toReuse: number[];
};

/**
 * Reconcile the FULL expected member set against packages already created for
 * this operation. This is the resumable core: a partial prior run converges to
 * exactly one package per expected member.
 *
 * @param expectedMemberIds distinct members with assigned patients this confirm
 * @param existingMemberIds members that already have a package for the operation
 */
export function reconcilePackages(
  expectedMemberIds: number[],
  existingMemberIds: number[],
): PackageReconcilePlan {
  const existing = new Set(existingMemberIds);
  const toCreate: number[] = [];
  const toReuse: number[] = [];
  for (const id of expectedMemberIds) {
    if (existing.has(id)) toReuse.push(id);
    else toCreate.push(id);
  }
  return { toCreate, toReuse };
}
