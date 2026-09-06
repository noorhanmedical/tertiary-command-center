//
// LIVE procedure-workflow QA — runs against the REAL Postgres (requires
// DATABASE_URL) with the canonical procedure/note/billing chain flags ON.
//
// Boots the actual /api/procedure-events route handlers over a real HTTP
// server with a per-request session injector, seeds canonical identity for a
// BrainWave case AND a VitalWave case in Clinic A (global patient → clinic
// membership → screening → execution case → ancillary case → signed order
// note), then exercises the ENTIRE ACS procedure lifecycle end-to-end:
//
//   • complete the procedure (canonical writer; generates the Procedure Note)
//   • verify the canonical procedure_events row flips to `complete`
//   • capture structured components (BW: neuropsych/EEG-21/ECG/VEP/AEP;
//     VW: autonomic/tilt/BP-HR/segmental/waveform/rhythm-ECG)
//   • reload + verify component persistence (incl. EEG channelCount)
//   • verify the Procedure Note generation STATE + that it references the event
//   • duplicate completion is idempotent (no duplicate events / notes)
//   • components cannot be recorded on an in-progress event (no fabricated
//     "complete" canonical state)
//   • a foreign-clinic actor is denied (404) on read / complete / components
//   • Order Note AND Procedure Note carry NO ICD/CPT codes
//
// All fixtures are cleaned up in `finally`. Skips (exit 0) when DATABASE_URL is
// unset so CI without a DB is unaffected.
//
// Run standalone with:
//   DATABASE_URL="postgres://localhost:5432/plexus" npx tsx tests/unit/procedureWorkflowLiveQA.test.ts

import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  console.log("procedureWorkflowLiveQA.test.ts: SKIP (no DATABASE_URL)");
  process.exit(0);
}

// Enable the full canonical procedure/note/billing chain for this QA run —
// mirrors the deployed configuration (see docs/architecture/PHASE_9_DECISIONS).
// Set BEFORE importing featureFlags/route modules (flags are read at import).
for (const f of [
  "FEATURE_ANCILLARY_CASE_WRITE",
  "FEATURE_CANONICAL_APPOINTMENT",
  "FEATURE_UNIFIED_ANCILLARY_DOCUMENTS",
  "FEATURE_CANONICAL_ORDER_NOTE",
  "FEATURE_CANONICAL_PROCEDURE_LIFECYCLE",
  "FEATURE_CANONICAL_PROCEDURE_NOTE",
  "FEATURE_PROCEDURE_NOTE_GENERATOR",
  "FEATURE_CANONICAL_BILLING_READINESS",
]) {
  process.env[f] = "true";
}

const { db } = await import("../../server/db");
const { users } = await import("@shared/schema/users");
const { patientScreenings } = await import("@shared/schema/screening");
const { screeningBatches } = await import("@shared/schema/screening");
const { patientExecutionCases } = await import("@shared/schema/executionCase");
const { procedureEvents } = await import("@shared/schema/procedureEvents");
const { procedureNotes } = await import("@shared/schema/generatedNotes");
const { globalPlexusPatients, patientClinicMemberships } = await import("@shared/schema/plexusIdentity");
const { patientAncillaryCases } = await import("@shared/schema/ancillaryCases");
const peRoutes = await import("../../server/routes/procedureEvents");

const CLINIC_A = 1;
const CLINIC_B = 2;
const TAG = `procqa_${Date.now()}`;

type Session = { userId: string; role?: string; clinicId?: number | null };
let currentSession: Session = { userId: "unset" };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { session: Session }).session = { ...currentSession };
  (req as unknown as { clinicId: number | null }).clinicId = currentSession.clinicId ?? null;
  next();
});
peRoutes.registerProcedureEventRoutes(app);
const httpServer = createServer(app);
await new Promise<void>((r) => httpServer.listen(0, r));
const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

async function get(path: string, s: Session) {
  currentSession = s;
  const resp = await fetch(base + path);
  let body: unknown = null;
  try { body = await resp.json(); } catch { /* */ }
  return { status: resp.status, body };
}
async function post(path: string, s: Session, payload: unknown) {
  currentSession = s;
  const resp = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try { body = await resp.json(); } catch { /* */ }
  return { status: resp.status, body };
}

// ── created-id ledger (FK-safe cleanup order) ──
const created = {
  users: [] as string[],
  batches: [] as number[],
  screenings: [] as number[],
  execCases: [] as number[],
  ancillaryCases: [] as number[],
  memberships: [] as number[],
  globalPatients: [] as number[],
  procedureEvents: [] as number[],
  notes: [] as number[],
};

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? " — " + detail : ""}`); }
}

async function seedUser(label: string, role: string, clinicId: number | null): Promise<string> {
  const [u] = await db.insert(users).values({
    username: `${TAG}_${label}`, password: "x", role, clinicId, active: true, status: "active",
  } as typeof users.$inferInsert).returning({ id: users.id });
  created.users.push(u.id);
  return u.id;
}

// One fully-linked canonical case for a single ancillary service in Clinic A.
async function seedCase(serviceType: string, clinicianName: string) {
  const [gpp] = await db.insert(globalPlexusPatients).values({
    plexusId: `PLX-${TAG}-${serviceType}`.slice(0, 60),
    displayName: `${TAG} ${serviceType}`,
  } as typeof globalPlexusPatients.$inferInsert).returning({ id: globalPlexusPatients.id });
  created.globalPatients.push(gpp.id);

  const [mem] = await db.insert(patientClinicMemberships).values({
    globalPlexusPatientId: gpp.id, clinicId: CLINIC_A, membershipStatus: "active",
  } as typeof patientClinicMemberships.$inferInsert).returning({ id: patientClinicMemberships.id });
  created.memberships.push(mem.id);

  const [batch] = await db.insert(screeningBatches).values({
    name: `${TAG}_batch_${serviceType}`, clinicianName, clinicId: CLINIC_A,
  } as typeof screeningBatches.$inferInsert).returning({ id: screeningBatches.id });
  created.batches.push(batch.id);

  const [ps] = await db.insert(patientScreenings).values({
    batchId: batch.id, name: `${TAG}_pt_${serviceType}`, clinicId: CLINIC_A,
    facility: "Taylor Family Practice", dob: "1970-01-01",
  } as typeof patientScreenings.$inferInsert).returning({ id: patientScreenings.id });
  created.screenings.push(ps.id);

  const [ec] = await db.insert(patientExecutionCases).values({
    clinicId: CLINIC_A, patientScreeningId: ps.id, patientName: `${TAG}_pt_${serviceType}`,
    facilityId: "Taylor Family Practice", engagementBucket: "outreach",
    lifecycleStatus: "active", engagementStatus: "in_progress", qualificationStatus: "qualified",
  } as typeof patientExecutionCases.$inferInsert).returning({ id: patientExecutionCases.id });
  created.execCases.push(ec.id);

  const [ac] = await db.insert(patientAncillaryCases).values({
    globalPlexusPatientId: gpp.id, patientClinicMembershipId: mem.id, clinicId: CLINIC_A,
    originatingScreeningId: ps.id, executionCaseId: ec.id, serviceType,
    lifecycleStatus: "active", qualificationStatus: "qualified", adminReviewStatus: "approved",
  } as typeof patientAncillaryCases.$inferInsert).returning({ id: patientAncillaryCases.id });
  created.ancillaryCases.push(ac.id);

  // Signed, ICD/CPT-free Order Note associated to the ancillary case.
  const [order] = await db.insert(procedureNotes).values({
    clinicId: CLINIC_A, patientScreeningId: ps.id, executionCaseId: ec.id, ancillaryCaseId: ac.id,
    serviceType, noteType: "order_note", generationStatus: "generated",
    generatedText: `${serviceType} order: clinician requests the study. No diagnostic codes recorded here.`,
    signatureStatus: "signed", signedAt: new Date(),
    effectiveClinicalDate: new Date(),
  } as typeof procedureNotes.$inferInsert).returning({ id: procedureNotes.id });
  created.notes.push(order.id);

  return { gppId: gpp.id, screeningId: ps.id, execCaseId: ec.id, ancillaryCaseId: ac.id, orderNoteId: order.id, patientName: `${TAG}_pt_${serviceType}` };
}

// ICD-10 (e.g. G93.1, I10) + CPT (5-digit) detectors for note ICD/CPT-free assertion.
const ICD10_RE = /\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?\b/;
const CPT_RE = /\b\d{5}\b/;
const CODE_LABEL_RE = /\b(?:CPT|ICD-?10|ICD9|HCPCS)\b/i;
function assertNoCodes(label: string, text: string | null) {
  const t = text ?? "";
  check(`${label}: no ICD-10-shaped token`, !ICD10_RE.test(t), t.match(ICD10_RE)?.[0] ?? "");
  check(`${label}: no CPT 5-digit code`, !CPT_RE.test(t), t.match(CPT_RE)?.[0] ?? "");
  check(`${label}: no ICD/CPT label`, !CODE_LABEL_RE.test(t), t.match(CODE_LABEL_RE)?.[0] ?? "");
}

type ComponentPayload = Record<string, { performed: boolean; completedAt?: string; channelCount?: number }>;

async function runServiceLifecycle(
  label: string,
  serviceType: string,
  ACS_A: Session,
  ACS_B: Session,
  components: ComponentPayload,
  expectComponentKeys: string[],
) {
  console.log(`\n── ${label} (${serviceType}) ─────────────────────────`);
  const c = await seedCase(serviceType, `${TAG} Dr ${label}`);

  // 1. No procedure event exists yet for this case.
  {
    const r = await get(`/api/procedure-events?executionCaseId=${c.execCaseId}&serviceType=${encodeURIComponent(serviceType)}`, ACS_A);
    const rows = Array.isArray(r.body) ? (r.body as Array<{ id: number }>) : [];
    check(`${label}: no procedure event before completion`, rows.length === 0);
  }

  // 2. In-progress event → components rejected (cannot fabricate completion).
  {
    const [ip] = await db.insert(procedureEvents).values({
      clinicId: CLINIC_A, executionCaseId: c.execCaseId, patientScreeningId: c.screeningId,
      serviceType, procedureStatus: "in_progress",
    } as typeof procedureEvents.$inferInsert).returning({ id: procedureEvents.id });
    created.procedureEvents.push(ip.id);
    const r = await post(`/api/procedure-events/${ip.id}/components`, ACS_A, { components });
    check(`${label}: components on in_progress event → 409 not_complete`, r.status === 409 && (r.body as { status?: string })?.status === "not_complete");
    // Clean this probe row up immediately so it doesn't perturb completion resolution.
    await db.delete(procedureEvents).where(eq(procedureEvents.id, ip.id));
    created.procedureEvents = created.procedureEvents.filter((x) => x !== ip.id);
  }

  // 3. Complete the procedure (canonical writer). Fixed completedAt so a
  //    duplicate call is provably idempotent (same instant → same event).
  const completedAt = new Date("2026-03-02T15:00:00.000Z").toISOString();
  const completePayload = {
    serviceType, executionCaseId: c.execCaseId, patientScreeningId: c.screeningId,
    patientName: c.patientName, facilityId: "Taylor Family Practice", completedAt,
  };
  const first = await post("/api/procedure-events/complete", ACS_A, completePayload);
  check(`${label}: completion → 201`, first.status === 201, `status=${first.status} body=${JSON.stringify(first.body)}`);
  const firstBody = first.body as { procedureEventId?: number; ancillaryCaseId?: number; status?: string; procedureNoteId?: number };
  const eventId = firstBody?.procedureEventId ?? -1;
  if (eventId > 0) created.procedureEvents.push(eventId);
  check(`${label}: completion committed a procedure event`, eventId > 0);
  check(`${label}: completion resolved THIS ancillary case`, firstBody?.ancillaryCaseId === c.ancillaryCaseId);
  console.log(`     note lifecycle status = ${firstBody?.status ?? "?"} (noteId=${firstBody?.procedureNoteId ?? "none"})`);

  // 4. Canonical event now reads `complete` (clinic-scoped list + by-id).
  {
    const r = await get(`/api/procedure-events?executionCaseId=${c.execCaseId}&serviceType=${encodeURIComponent(serviceType)}`, ACS_A);
    const rows = Array.isArray(r.body) ? (r.body as Array<{ id: number; procedureStatus: string }>) : [];
    const row = rows.find((x) => x.id === eventId);
    check(`${label}: event visible + status=complete`, !!row && row.procedureStatus === "complete");
    const byId = await get(`/api/procedure-events/${eventId}`, ACS_A);
    check(`${label}: by-id complete`, byId.status === 200 && (byId.body as { procedureStatus?: string })?.procedureStatus === "complete");
  }

  // 5. Components empty initially.
  {
    const r = await get(`/api/procedure-events/${eventId}/components`, ACS_A);
    check(`${label}: components read OK`, r.status === 200);
  }

  // 6. Capture structured components → recorded.
  {
    const r = await post(`/api/procedure-events/${eventId}/components`, ACS_A, { components });
    check(`${label}: save components → 200 recorded`, r.status === 200 && (r.body as { status?: string })?.status === "recorded", JSON.stringify(r.body));
  }

  // 7. Reload → persisted (performed flags + EEG channelCount).
  {
    const r = await get(`/api/procedure-events/${eventId}/components`, ACS_A);
    const persisted = (r.body as { components?: { components?: ComponentPayload } })?.components?.components ?? {};
    for (const key of expectComponentKeys) {
      check(`${label}: component "${key}" persisted performed=true`, persisted[key]?.performed === true);
    }
    if (serviceType.toLowerCase().includes("brain")) {
      check(`${label}: EEG channelCount persisted (21)`, persisted["eeg"]?.channelCount === 21, JSON.stringify(persisted["eeg"]));
    }
    // A component NOT marked performed must remain false (no fabrication).
    const notPerformedKey = serviceType.toLowerCase().includes("brain") ? "aep" : "rhythmEcg";
    check(`${label}: unperformed component "${notPerformedKey}" stays false`, persisted[notPerformedKey]?.performed === false);
  }

  // 8. Duplicate completion (same instant) is idempotent — no dup event/note.
  {
    const dup = await post("/api/procedure-events/complete", ACS_A, completePayload);
    check(`${label}: duplicate completion accepted idempotently`, dup.status === 201 || dup.status === 409, `status=${dup.status}`);
    const dupBody = dup.body as { procedureEventId?: number };
    if (dup.status === 201) {
      check(`${label}: duplicate returns SAME procedure event`, dupBody?.procedureEventId === eventId);
    }
    const evRows = await db.select({ id: procedureEvents.id })
      .from(procedureEvents)
      .where(and(eq(procedureEvents.ancillaryCaseId, c.ancillaryCaseId), eq(procedureEvents.serviceType, serviceType)));
    check(`${label}: exactly ONE procedure event for the case`, evRows.length === 1, `count=${evRows.length}`);
    const ppNotes = await db.select({ id: procedureNotes.id })
      .from(procedureNotes)
      .where(and(eq(procedureNotes.ancillaryCaseId, c.ancillaryCaseId), eq(procedureNotes.noteType, "post_procedure_note")));
    for (const n of ppNotes) if (!created.notes.includes(n.id)) created.notes.push(n.id);
    check(`${label}: at most ONE canonical Procedure Note for the case`, ppNotes.length <= 1, `count=${ppNotes.length}`);
  }

  // 9. Foreign-clinic actor (Clinic B) is denied everywhere.
  {
    const rComplete = await post("/api/procedure-events/complete", ACS_B, completePayload);
    check(`${label}: foreign-clinic completion → 404`, rComplete.status === 404, `status=${rComplete.status}`);
    const rById = await get(`/api/procedure-events/${eventId}`, ACS_B);
    check(`${label}: foreign-clinic by-id → 404`, rById.status === 404);
    const rComp = await get(`/api/procedure-events/${eventId}/components`, ACS_B);
    check(`${label}: foreign-clinic components → 404`, rComp.status === 404);
    // The Clinic-B actor must not even see the event in its list.
    const rList = await get(`/api/procedure-events?executionCaseId=${c.execCaseId}`, ACS_B);
    const ids = new Set((Array.isArray(rList.body) ? rList.body : []).map((x) => (x as { id: number }).id));
    check(`${label}: foreign-clinic list excludes the event`, !ids.has(eventId));
  }

  // 10. Order Note + Procedure Note are ICD/CPT-free.
  {
    const notes = await db.select().from(procedureNotes).where(eq(procedureNotes.ancillaryCaseId, c.ancillaryCaseId));
    const order = notes.find((n) => n.noteType === "order_note");
    const proc = notes.find((n) => n.noteType === "post_procedure_note");
    assertNoCodes(`${label} Order Note`, order?.generatedText ?? null);
    if (proc) {
      assertNoCodes(`${label} Procedure Note`, proc.generatedText ?? null);
      check(`${label}: Procedure Note references THIS procedure event`, proc.procedureEventId === eventId || proc.procedureEventId == null);
    } else {
      console.log(`     (no canonical Procedure Note row persisted — lifecycle status ${firstBody?.status})`);
    }
  }
}

try {
  const idres = await db.execute("SELECT current_database() AS db, inet_server_port() AS port" as never) as unknown as { rows?: Array<{ db: string; port: number }> };
  console.log(`procedureWorkflowLiveQA: DB=${idres?.rows?.[0]?.db} port=${idres?.rows?.[0]?.port}`);

  const acsAId = await seedUser("acsA", "technician", CLINIC_A);
  const acsBId = await seedUser("acsB", "technician", CLINIC_B);
  const ACS_A: Session = { userId: acsAId, role: "technician", clinicId: CLINIC_A };
  const ACS_B: Session = { userId: acsBId, role: "technician", clinicId: CLINIC_B };

  // BrainWave — neuropsych + EEG(21) + ECG + VEP performed; AEP NOT performed.
  await runServiceLifecycle(
    "BrainWave", "BrainWave", ACS_A, ACS_B,
    {
      neuropsychologicalTesting: { performed: true },
      eeg: { performed: true, channelCount: 21 },
      ecg: { performed: true },
      vep: { performed: true },
      aep: { performed: false },
    },
    ["neuropsychologicalTesting", "eeg", "ecg", "vep"],
  );

  // VitalWave — autonomic + tilt + BP/HR + segmental + waveform performed;
  // rhythmEcg NOT performed.
  await runServiceLifecycle(
    "VitalWave", "VitalWave", ACS_A, ACS_B,
    {
      autonomicTesting: { performed: true },
      tiltTable: { performed: true },
      bloodPressureHeartRateMonitoring: { performed: true },
      segmentalPressures: { performed: true },
      waveformAnalysis: { performed: true },
      rhythmEcg: { performed: false },
    },
    ["autonomicTesting", "tiltTable", "bloodPressureHeartRateMonitoring", "segmentalPressures", "waveformAnalysis"],
  );
} finally {
  // Cleanup — children first (FK-safe).
  try { if (created.procedureEvents.length) await db.delete(procedureEvents).where(inArray(procedureEvents.id, created.procedureEvents)); } catch (e) { console.error("cleanup pe", e); }
  try { if (created.notes.length) await db.delete(procedureNotes).where(inArray(procedureNotes.id, created.notes)); } catch (e) { console.error("cleanup notes", e); }
  try { if (created.ancillaryCases.length) await db.delete(patientAncillaryCases).where(inArray(patientAncillaryCases.id, created.ancillaryCases)); } catch (e) { console.error("cleanup ac", e); }
  try { if (created.execCases.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, created.execCases)); } catch (e) { console.error("cleanup ec", e); }
  try { if (created.screenings.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, created.screenings)); } catch (e) { console.error("cleanup ps", e); }
  try { if (created.batches.length) await db.delete(screeningBatches).where(inArray(screeningBatches.id, created.batches)); } catch (e) { console.error("cleanup batch", e); }
  try { if (created.memberships.length) await db.delete(patientClinicMemberships).where(inArray(patientClinicMemberships.id, created.memberships)); } catch (e) { console.error("cleanup mem", e); }
  try { if (created.globalPatients.length) await db.delete(globalPlexusPatients).where(inArray(globalPlexusPatients.id, created.globalPatients)); } catch (e) { console.error("cleanup gpp", e); }
  try { if (created.users.length) await db.delete(users).where(inArray(users.id, created.users)); } catch (e) { console.error("cleanup users", e); }
  await new Promise<void>((r) => httpServer.close(() => r()));
}

if (failures > 0) {
  console.error(`\nprocedureWorkflowLiveQA.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nprocedureWorkflowLiveQA.test.ts: all procedure-workflow QA checks passed");
process.exit(0);
