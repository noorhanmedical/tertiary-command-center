// Canonical patient communications repository (built on outreach_calls, which
// migration 0063 extended with multi-channel/direction/service/staff fields).
// Reuses the existing call table — NO redundant call system.
//
// logCommunication is the single write path: it records the communication AND
// propagates operational state (execution-case attempt tracking, next action /
// callback, engagement status) and emits a canonical Plexus Story event, so a
// call is never just a passive log.

import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import { outreachCalls, type OutreachCall } from "@shared/schema/outreach";
import { patientExecutionCases, patientJourneyEvents } from "@shared/schema/executionCase";

export async function listCommunicationsForPatient(screeningId: number): Promise<OutreachCall[]> {
  return db.select().from(outreachCalls)
    .where(eq(outreachCalls.patientScreeningId, screeningId))
    .orderBy(desc(outreachCalls.startedAt), desc(outreachCalls.id));
}

export interface LogCommunicationInput {
  patientScreeningId: number;
  clinicId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  ancillaryCaseId?: number | null;
  serviceType?: string | null;
  channel: string;            // phone | sms | email | portal
  direction?: string;         // outbound | inbound
  destination?: string | null;
  schedulerUserId?: string | null;
  staffName?: string | null;
  staffRole?: string | null;
  outcome: string;
  notes?: string | null;
  disposition?: string | null;
  nextAction?: string | null;
  callbackAt?: Date | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  sourceSystem?: string | null;
  externalCallId?: string | null;
}

// Outcome → operational effect. Phone attempts increment attempt tracking;
// callback sets the next action; terminal outcomes update engagement status.
function engagementForOutcome(outcome: string): string | null {
  const o = outcome.toLowerCase();
  if (["reached", "connected", "scheduled"].includes(o)) return "contacted";
  if (["no_answer", "voicemail", "busy", "mailbox_full", "hung_up"].includes(o)) return "not_reached";
  if (["refused_dnc", "declined", "not_interested", "wrong_number", "moved", "deceased", "disconnected"].includes(o)) return "unable_to_reach";
  return null;
}

export async function logCommunication(input: LogCommunicationInput): Promise<OutreachCall> {
  const startedAt = input.startedAt ?? new Date();
  const channel = input.channel || "phone";
  const direction = input.direction || "outbound";

  // Attempt number: count prior outbound phone attempts for this patient + 1.
  let attemptNumber = 1;
  if (channel === "phone" && direction === "outbound") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outreachCalls)
      .where(and(
        eq(outreachCalls.patientScreeningId, input.patientScreeningId),
        eq(outreachCalls.channel, "phone"),
        eq(outreachCalls.direction, "outbound"),
      ));
    attemptNumber = Number(count ?? 0) + 1;
  }

  const [row] = await db.insert(outreachCalls).values({
    patientScreeningId: input.patientScreeningId,
    schedulerUserId: input.schedulerUserId ?? null,
    startedAt,
    outcome: input.outcome,
    notes: input.notes ?? null,
    callbackAt: input.callbackAt ?? null,
    attemptNumber,
    durationSeconds: input.durationSeconds ?? null,
    clinicId: input.clinicId ?? null,
    patientName: input.patientName ?? null,
    patientDob: input.patientDob ?? null,
    ancillaryCaseId: input.ancillaryCaseId ?? null,
    serviceType: input.serviceType ?? null,
    channel,
    direction,
    destination: input.destination ?? null,
    staffName: input.staffName ?? null,
    staffRole: input.staffRole ?? null,
    endedAt: input.endedAt ?? null,
    disposition: input.disposition ?? null,
    nextAction: input.nextAction ?? null,
    sourceSystem: input.sourceSystem ?? "plexus",
    externalCallId: input.externalCallId ?? null,
    updatedAt: new Date(),
  } as any).returning();

  // ── Propagate to operational state on the execution case ──────────────
  const [ec] = await db.select().from(patientExecutionCases)
    .where(eq(patientExecutionCases.patientScreeningId, input.patientScreeningId))
    .orderBy(desc(patientExecutionCases.id)).limit(1);
  if (ec) {
    const patch: Record<string, unknown> = {
      lastCallOutcome: input.outcome,
      lastAttemptAt: startedAt,
      updatedAt: new Date(),
    };
    if (channel === "phone" && direction === "outbound") {
      patch.callAttemptCount = (ec.callAttemptCount ?? 0) + 1;
    }
    if (input.callbackAt) patch.nextActionAt = input.callbackAt;
    const eng = engagementForOutcome(input.outcome);
    if (eng) patch.engagementStatus = eng;
    if (eng === "unable_to_reach") patch.unableToReachAt = startedAt;
    await db.update(patientExecutionCases).set(patch).where(eq(patientExecutionCases.id, ec.id));
  }

  // ── Emit Plexus Story event ───────────────────────────────────────────
  try {
    const channelLabel = channel.charAt(0).toUpperCase() + channel.slice(1);
    const svc = input.serviceType ? ` (${input.serviceType})` : "";
    await db.insert(patientJourneyEvents).values({
      patientName: input.patientName ?? "(patient)",
      patientDob: input.patientDob ?? null,
      patientScreeningId: input.patientScreeningId,
      executionCaseId: ec?.id ?? null,
      eventType: "communication_logged",
      eventSource: "communications",
      actorUserId: input.schedulerUserId ?? null,
      summary: `${direction === "inbound" ? "Inbound" : "Outbound"} ${channelLabel} · ${input.outcome.replace(/_/g, " ")}${svc}${input.notes ? ` — ${input.notes}` : ""}`,
      metadata: { outcome: input.outcome, channel, direction, ancillaryCaseId: input.ancillaryCaseId ?? null, nextAction: input.nextAction ?? null },
    } as any);
  } catch { /* never break the comm write on audit failure */ }

  return row;
}

/** Idempotent seed helper: clear the patient's communications + reset the
 *  execution-case attempt counters, so re-seeding re-derives cleanly. */
export async function resetCommunicationsForPatient(screeningId: number): Promise<void> {
  await db.delete(outreachCalls).where(eq(outreachCalls.patientScreeningId, screeningId));
  const [ec] = await db.select().from(patientExecutionCases)
    .where(eq(patientExecutionCases.patientScreeningId, screeningId))
    .orderBy(desc(patientExecutionCases.id)).limit(1);
  if (ec) {
    await db.update(patientExecutionCases)
      .set({ callAttemptCount: 0, lastCallOutcome: null, lastAttemptAt: null, nextActionAt: null, unableToReachAt: null })
      .where(eq(patientExecutionCases.id, ec.id));
  }
}
