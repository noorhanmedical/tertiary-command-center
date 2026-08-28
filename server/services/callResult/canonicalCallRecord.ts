// Canonical call-attempt record — the ONE durable record for every real PCS
// call attempt, regardless of originating surface (Right Rail / CallWorkspace /
// Engagement workflow / Outreach workflow).
//
// Call Results (server/services/engagement/callResultsService.ts) reads only
// `outreach_calls`, so a real attempt is visible there iff exactly one
// outreach_calls row exists for it. This service is the single place that
// creates that row, with idempotency keyed on `external_call_id`:
//
//   ONE real call attempt  →  ONE durable outreach_calls row
//
// Never zero for a real completed attempt; never two for the same attempt.
//
// IDEMPOTENCY: when the caller supplies `externalCallId` (a client-minted UUID
// or a phone-provider session id), a repeat submission of the SAME attempt
// resolves the existing row instead of inserting a duplicate. The DB backs this
// with a partial unique index (uq_outreach_calls_external_call_id). When no key
// is supplied (legacy callers), the service falls back to a plain insert — no
// behavior regression.
//
// SIDE-EFFECT SCOPE: this service owns ONLY the durable call record. It does
// NOT touch patient_execution_cases, patient_screenings.appointmentStatus,
// scheduler_assignments, journey events, triage, or tasks — those canonical
// side effects are applied independently by the caller (the engagement /
// outreach route via the recordCallResult executors). This keeps Item 2F
// intact: logging a call never mutates appointmentStatus on its own.

import { storage } from "../../storage";
import type { InsertOutreachCall, OutreachCall } from "@shared/schema/outreach";

export type CanonicalCallRecordInput = {
  patientScreeningId: number;
  outcome: string;
  attemptNumber: number;
  schedulerUserId?: string | null;
  callbackAt?: Date | null;
  notes?: string | null;
  durationSeconds?: number | null;
  serviceType?: string | null;
  ancillaryCaseId?: number | null;
  channel?: string;
  direction?: string;
  /**
   * Idempotency key. When present, a repeat submission of the same attempt
   * resolves the existing row instead of creating a duplicate. Stored in
   * outreach_calls.external_call_id.
   */
  externalCallId?: string | null;
  /**
   * Originating surface, recorded for AUDIT ONLY (outreach_calls.source_system).
   * It must NEVER change business semantics — an equivalent real call produces
   * the same durable record regardless of which surface created it.
   */
  sourceSurface?: string | null;
};

export type CanonicalCallRecordResult = {
  call: OutreachCall;
  /** false when an existing row was resolved via the idempotency key. */
  created: boolean;
};

/**
 * Resolve-or-create the ONE durable call-attempt record. Insert-only: never
 * mutates appointment/commit status (Item 2F). Use this for surfaces that own
 * their status side effects elsewhere (the engagement route), or when you want
 * pure record creation with idempotency.
 */
export async function ensureCanonicalCallRecord(
  input: CanonicalCallRecordInput,
): Promise<CanonicalCallRecordResult> {
  // Idempotency: if a key is supplied and a row already exists, return it.
  if (input.externalCallId) {
    const existing = await storage.findOutreachCallByExternalId(input.externalCallId);
    if (existing) return { call: existing, created: false };
  }

  const record: InsertOutreachCall = {
    patientScreeningId: input.patientScreeningId,
    outcome: input.outcome as InsertOutreachCall["outcome"],
    attemptNumber: input.attemptNumber,
    schedulerUserId: input.schedulerUserId ?? null,
    callbackAt: input.callbackAt ?? null,
    notes: input.notes ?? null,
    durationSeconds: input.durationSeconds ?? null,
    serviceType: input.serviceType ?? null,
    ancillaryCaseId: input.ancillaryCaseId ?? null,
    channel: input.channel ?? "phone",
    direction: input.direction ?? "outbound",
    externalCallId: input.externalCallId ?? null,
    sourceSystem: input.sourceSurface ?? "plexus",
  };

  try {
    const call = await storage.createOutreachCall(record);
    return { call, created: true };
  } catch (err) {
    // A concurrent insert with the same idempotency key can lose the race on
    // the partial unique index. Resolve the winner instead of failing — the
    // guarantee is exactly-one, not first-writer-wins.
    if (input.externalCallId && isUniqueViolation(err)) {
      const existing = await storage.findOutreachCallByExternalId(input.externalCallId);
      if (existing) return { call: existing, created: false };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres unique_violation = 23505.
  const code = (err as { code?: string })?.code;
  if (code === "23505") return true;
  const msg = (err as { message?: string })?.message ?? "";
  return /duplicate key value|unique constraint/i.test(msg);
}
