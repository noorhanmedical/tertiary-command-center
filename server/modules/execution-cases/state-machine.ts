// Execution-case state-machine matrix (Batch 10 read-only foundation).
//
// This module encodes the LEGAL transition table observed in the live
// codebase TODAY. It does not change behavior — `assertTransitionLegality`
// returns a discriminated outcome that callers can consult. Future Batch
// 10b writer wraps repo writes against this matrix; this batch only ships
// the catalogue + read-side legality check.
//
// All four enum vocabularies are intentionally `string` at the matrix
// boundary because the columns themselves are `text` in Postgres (see
// shared/schema/executionCase.ts:36-39). The matrix DOES carry the
// declared `as const` enum members from the schema, but tolerates
// historical drift gracefully.

import {
  ENGAGEMENT_BUCKETS,
  ENGAGEMENT_STATUSES,
  LIFECYCLE_STATUSES,
  QUALIFICATION_STATUSES,
} from "@shared/schema";
import type {
  ExecutionCaseTransitionLegality,
  ExecutionCaseTransitionRequest,
} from "./contracts";

const lifecycleTransitions = new Map<string, Set<string>>([
  ["active", new Set<string>(["active", "completed", "archived", "cancelled"])],
  ["completed", new Set<string>(["completed", "archived"])],
  ["cancelled", new Set<string>(["cancelled", "archived"])],
  ["archived", new Set<string>(["archived"])],
]);

const engagementTransitions = new Map<string, Set<string>>([
  [
    "new",
    new Set<string>(["new", "contacted", "scheduled", "not_reached"]),
  ],
  [
    "contacted",
    new Set<string>(["contacted", "scheduled", "not_reached", "completed"]),
  ],
  [
    "not_reached",
    new Set<string>(["not_reached", "contacted", "scheduled", "completed"]),
  ],
  [
    "scheduled",
    new Set<string>(["scheduled", "completed", "not_reached"]),
  ],
  ["completed", new Set<string>(["completed"])],
]);

const qualificationTransitions = new Map<string, Set<string>>([
  [
    "unscreened",
    new Set<string>([
      "unscreened",
      "qualified",
      "not_qualified",
      "pending_review",
    ]),
  ],
  [
    "pending_review",
    new Set<string>(["pending_review", "qualified", "not_qualified"]),
  ],
  ["qualified", new Set<string>(["qualified", "pending_review"])],
  ["not_qualified", new Set<string>(["not_qualified", "pending_review"])],
]);

// Bucket changes are administrative — qualification can flip a patient
// from visit→outreach or vice versa when their schedule changes. The
// matrix admits all pairs to reflect today's behavior; the design doc
// documents the intent.
const bucketTransitions = new Map<string, Set<string>>(
  ENGAGEMENT_BUCKETS.map((b) => [b, new Set<string>(ENGAGEMENT_BUCKETS)]),
);

function lookup(
  kind: ExecutionCaseTransitionRequest["kind"],
): Map<string, Set<string>> {
  switch (kind) {
    case "lifecycle":
      return lifecycleTransitions;
    case "engagement":
      return engagementTransitions;
    case "qualification":
      return qualificationTransitions;
    case "bucket":
      return bucketTransitions;
  }
}

/**
 * Returns `{ kind: "legal" }` when the requested transition is in the
 * matrix, otherwise an `{ kind: "illegal", reason }` outcome. Never throws.
 *
 * For consumers that prefer assertions, `requireLegalTransition` throws an
 * `Error` on illegality — provided for symmetry with the future writer.
 */
export function checkTransitionLegality(
  req: ExecutionCaseTransitionRequest,
): ExecutionCaseTransitionLegality {
  const table = lookup(req.kind);
  const fromKey = String(req.from ?? "");
  const toKey = String(req.to ?? "");
  if (!table.has(fromKey)) {
    // Tolerate historical-drift values — the column is text. The matrix
    // returns "legal" for any from-state it doesn't know AND a to-state
    // that's in the declared enum. This preserves today's permissive
    // behavior while flagging clear misuses (declared enum → unknown).
    if (!isDeclaredEnumValue(req.kind, toKey)) {
      return {
        kind: "illegal",
        reason: `Unknown target state "${toKey}" for ${req.kind}`,
      };
    }
    return { kind: "legal" };
  }
  const allowed = table.get(fromKey)!;
  if (!allowed.has(toKey)) {
    return {
      kind: "illegal",
      reason: `Transition ${req.kind}: ${fromKey} → ${toKey} is not in the matrix`,
    };
  }
  return { kind: "legal" };
}

function isDeclaredEnumValue(
  kind: ExecutionCaseTransitionRequest["kind"],
  value: string,
): boolean {
  switch (kind) {
    case "lifecycle":
      return (LIFECYCLE_STATUSES as readonly string[]).includes(value);
    case "engagement":
      return (ENGAGEMENT_STATUSES as readonly string[]).includes(value);
    case "qualification":
      return (QUALIFICATION_STATUSES as readonly string[]).includes(value);
    case "bucket":
      return (ENGAGEMENT_BUCKETS as readonly string[]).includes(value);
  }
}

export function requireLegalTransition(
  req: ExecutionCaseTransitionRequest,
): void {
  const outcome = checkTransitionLegality(req);
  if (outcome.kind === "illegal") {
    throw new Error(outcome.reason);
  }
}
