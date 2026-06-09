// Typed journey-event writer (Batch 12b).
//
// CANONICAL audit-timeline writer for patient_journey_events.
//
// Design:
//   - Accepts an InputType whose `eventType` field is typed against the
//     PATIENT_JOURNEY_EVENT_TYPES discriminated union, so the TypeScript
//     compiler catches typos at call sites.
//   - Delegates the actual INSERT to the existing repo function
//     `appendPatientJourneyEvent` so DB-level semantics (including the
//     `.returning()` row shape) stay byte-identical to today.
//   - Throws on DB error. Each existing call site already wraps with the
//     best-effort try/catch behavior it wants; this writer does not
//     introduce or remove any error swallowing.
//   - Logs PHI-safely: only non-PHI identifiers + the unknown-eventType
//     literal land in console.warn output. Never patient name, DOB,
//     summary text, or metadata bodies.
//
// Migration scope (Batch 12b): only the 3 lowest-risk, already-tested
// call sites are migrated in the introducing PR — see the wiring map
// `docs/architecture/canonical-workflow-wiring-map.md` §16 for the
// program-wide migration order.

import {
  PATIENT_JOURNEY_EVENT_TYPES,
  type PatientJourneyEventType,
} from "@shared/contracts/journeyEvents";
import { appendPatientJourneyEvent } from "../../repositories/executionCase.repo";
import type { PatientJourneyEvent } from "@shared/schema";

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(PATIENT_JOURNEY_EVENT_TYPES);

export type AppendJourneyEventInput = {
  eventType: PatientJourneyEventType;
  eventSource: string;
  patientName: string;
  patientDob?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  actorUserId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
};

export async function appendJourneyEvent(
  input: AppendJourneyEventInput,
): Promise<PatientJourneyEvent> {
  if (!KNOWN_EVENT_TYPES.has(input.eventType)) {
    // PHI-safe: only the typed-catalogue literal + event-source string
    // are logged. Never patient name, DOB, or metadata body.
    console.warn(
      "[appendJourneyEvent] eventType not in typed catalogue:",
      { eventType: input.eventType, eventSource: input.eventSource },
    );
  }
  return appendPatientJourneyEvent({
    patientName: input.patientName,
    patientDob: input.patientDob ?? undefined,
    patientScreeningId: input.patientScreeningId ?? undefined,
    executionCaseId: input.executionCaseId ?? undefined,
    eventType: input.eventType,
    eventSource: input.eventSource,
    actorUserId: input.actorUserId ?? undefined,
    summary: input.summary,
    metadata: input.metadata ?? undefined,
  });
}
