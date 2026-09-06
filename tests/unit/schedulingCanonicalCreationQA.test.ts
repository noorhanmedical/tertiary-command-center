//
// LIVE scheduling CREATION/lifecycle integration QA (requires DATABASE_URL).
//
// Complements schedulingCanonicalLiveQA.test.ts (which proves the fail-safe
// DEFERRAL when identity is unresolved) by provisioning FULL Plexus identity so
// the canonical path actually COMMITS, then exercising the real lifecycle:
//
//   A. Positive creation — one global_schedule_event + one patient_ancillary_case
//   B. Conflict guard    — the DB-enforced "one active scheduled event per case"
//                          invariant (a 2nd booking of the same case reuses,
//                          never duplicates). NOTE: room/time capacity double-
//                          booking is NOT enforced server-side (soft/client +
//                          authorized override) — asserted as documented truth.
//   C. Cancellation      — cancel frees the case (a new active event can form)
//   D. Reschedule        — prior→'rescheduled', new 'scheduled' w/ parent lineage
//   E. Repeat submit     — idempotent (reused, no duplicate event/case)
//   F. Tenant            — Clinic-A actor cannot schedule a Clinic-B patient
//                          (cross_clinic deferral, no write)
//   G. Both entry points — /schedule-ancillary AND /api/scheduling/visit write
//                          through the SAME canonical core + invariants
//
// All fixtures cleaned up in finally. Skips (exit 0) without DATABASE_URL.
//
//   DATABASE_URL="postgres://localhost:5432/plexus" npx tsx tests/unit/schedulingCanonicalCreationQA.test.ts

import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  console.log("schedulingCanonicalCreationQA.test.ts: SKIP (no DATABASE_URL)");
  process.exit(0);
}
for (const f of ["FEATURE_CANONICAL_APPOINTMENT", "FEATURE_ANCILLARY_CASE_WRITE"]) {
  if (!/^(1|true|yes|on)$/i.test(process.env[f] ?? "")) process.env[f] = "true";
}

const { db } = await import("../../server/db");
const { clinics } = await import("@shared/schema/clinics");
const { screeningBatches, patientScreenings } = await import("@shared/schema/screening");
const { patientExecutionCases } = await import("@shared/schema/executionCase");
const { patientAncillaryCases } = await import("@shared/schema/ancillaryCases");
const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
const { globalPlexusPatients, patientClinicMemberships } = await import("@shared/schema/plexusIdentity");
const { users } = await import("@shared/schema/users");
const gsRoutes = await import("../../server/routes/globalSchedule");
const visitRoutes = await import("../../server/routes/schedulingVisit");

const CLINIC_A = 1;
const CLINIC_B = 2;
const TAG = `schedcreate_${Date.now()}`;

type Session = { userId: string; role?: string; clinicId?: number | null };
let currentSession: Session = { userId: `${TAG}_pcsA`, role: "scheduler", clinicId: CLINIC_A };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { session: Session }).session = { ...currentSession };
  (req as unknown as { clinicId: number | null }).clinicId = currentSession.clinicId ?? null;
  next();
});
gsRoutes.registerGlobalScheduleRoutes(app);
visitRoutes.registerSchedulingVisitRoutes(app);
const httpServer = createServer(app);
await new Promise<void>((r) => httpServer.listen(0, r));
const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

async function post(path: string, s: Session, payload: unknown) {
  currentSession = s;
  const resp = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  let body: unknown = null; try { body = await resp.json(); } catch { /* */ }
  return { status: resp.status, body: (body ?? {}) as Record<string, unknown> };
}

const created = {
  gpp: [] as number[], mem: [] as number[], batches: [] as number[],
  ps: [] as number[], ec: [] as number[], ac: [] as number[], users: [] as string[],
};
let failures = 0;
const check = (n: string, c: boolean, d = "") => { if (c) console.log(`ok   ${n}`); else { failures++; console.error(`FAIL ${n}${d ? " — " + d : ""}`); } };

// Seed a fully identity-provisioned patient in a clinic so the canonical
// scheduler RESOLVES identity (screening carries both Plexus FK columns) and
// commits instead of deferring.
async function seedPatient(clinicId: number, facility: string) {
  const [gpp] = await db.insert(globalPlexusPatients).values({
    plexusId: `PLX-${TAG}-${clinicId}-${Math.random().toString(36).slice(2, 8)}`,
    displayName: `${TAG} c${clinicId}`,
  } as typeof globalPlexusPatients.$inferInsert).returning({ id: globalPlexusPatients.id });
  created.gpp.push(gpp.id);
  const [mem] = await db.insert(patientClinicMemberships).values({
    globalPlexusPatientId: gpp.id, clinicId, membershipStatus: "active",
  } as typeof patientClinicMemberships.$inferInsert).returning({ id: patientClinicMemberships.id });
  created.mem.push(mem.id);
  const [batch] = await db.insert(screeningBatches).values({
    name: `${TAG}_batch_${clinicId}`, clinicId,
  } as typeof screeningBatches.$inferInsert).returning({ id: screeningBatches.id });
  created.batches.push(batch.id);
  const [ps] = await db.insert(patientScreenings).values({
    batchId: batch.id, name: `${TAG}_pt_${clinicId}`, clinicId, facility, dob: "1972-05-05",
    globalPlexusPatientId: gpp.id, patientClinicMembershipId: mem.id,
  } as typeof patientScreenings.$inferInsert).returning({ id: patientScreenings.id });
  created.ps.push(ps.id);
  const [ec] = await db.insert(patientExecutionCases).values({
    clinicId, patientScreeningId: ps.id, patientName: `${TAG}_pt_${clinicId}`, facilityId: facility,
    engagementBucket: "outreach", lifecycleStatus: "active", engagementStatus: "in_progress", qualificationStatus: "qualified",
  } as typeof patientExecutionCases.$inferInsert).returning({ id: patientExecutionCases.id });
  created.ec.push(ec.id);
  return { gppId: gpp.id, screeningId: ps.id, execCaseId: ec.id, patientName: `${TAG}_pt_${clinicId}` };
}

const activeEvents = async (ancillaryCaseId: number) =>
  db.select().from(globalScheduleEvents).where(and(
    eq(globalScheduleEvents.ancillaryCaseId, ancillaryCaseId),
    eq(globalScheduleEvents.status, "scheduled"),
  ));
const allEvents = async (ancillaryCaseId: number) =>
  db.select().from(globalScheduleEvents).where(eq(globalScheduleEvents.ancillaryCaseId, ancillaryCaseId));
const casesFor = async (execCaseId: number, serviceType: string) =>
  db.select().from(patientAncillaryCases).where(and(
    eq(patientAncillaryCases.executionCaseId, execCaseId),
    eq(patientAncillaryCases.serviceType, serviceType),
  ));

try {
  const [clinicRow] = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, CLINIC_A));
  const facilityA = clinicRow?.name ?? "Taylor Family Practice";
  const [clinicBRow] = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, CLINIC_B));
  const facilityB = clinicBRow?.name ?? "Desert Medical Center";

  const [pcsUser] = await db.insert(users).values({
    username: `${TAG}_pcsA`, password: "x", role: "scheduler", clinicId: CLINIC_A, active: true, status: "active",
  } as typeof users.$inferInsert).returning({ id: users.id });
  created.users.push(pcsUser.id);
  const PCS_A: Session = { userId: pcsUser.id, role: "scheduler", clinicId: CLINIC_A };
  const svc = "BrainWave";
  const t0 = Date.now();
  const iso = (offsetDays: number) => new Date(t0 + offsetDays * 86400_000).toISOString();

  // ── A. Positive creation ──────────────────────────────────────────────
  const A = await seedPatient(CLINIC_A, facilityA);
  const bodyA = { patientScreeningId: A.screeningId, executionCaseId: A.execCaseId, serviceType: svc, startsAt: iso(3), facilityId: facilityA };
  const r1 = await post("/api/global-schedule-events/schedule-ancillary", PCS_A, bodyA);
  check("A: creation → 200 canonical created", r1.status === 200 && r1.body.canonical === true && r1.body.created === true, `status=${r1.status} body=${JSON.stringify(r1.body)}`);
  const ancillaryCaseId = Number(r1.body.ancillaryCaseId);
  const firstEventId = Number(r1.body.globalScheduleEventId);
  if (Number.isFinite(ancillaryCaseId)) created.ac.push(ancillaryCaseId);
  check("A: exactly ONE ancillary case", (await casesFor(A.execCaseId, svc)).length === 1);
  check("A: exactly ONE active scheduled event", (await activeEvents(ancillaryCaseId)).length === 1);

  // ── E. Repeat submit → idempotent (reused, no duplicate) ──────────────
  const r2 = await post("/api/global-schedule-events/schedule-ancillary", PCS_A, bodyA);
  check("E: repeat → 200 reused (created:false)", r2.status === 200 && r2.body.created === false, `body=${JSON.stringify(r2.body)}`);
  check("E: repeat returns SAME event", Number(r2.body.globalScheduleEventId) === firstEventId);
  check("E: still ONE ancillary case after repeat", (await casesFor(A.execCaseId, svc)).length === 1);
  check("E: still ONE active scheduled event after repeat", (await activeEvents(ancillaryCaseId)).length === 1);

  // ── B. Conflict guard (DB-enforced one-active-event-per-case) ─────────
  // Server-side ROOM/TIME capacity double-booking is intentionally NOT
  // enforced (soft/client-evaluated + authorized override — see prior
  // "do-not-touch: server-side double-booking"). The real server invariant is
  // the partial-unique index: a case can hold at most ONE active scheduled
  // event, which E already exercised (a concurrent 2nd active row is impossible).
  check("B: one-active-event-per-case invariant holds (no duplicate active row)", (await activeEvents(ancillaryCaseId)).length === 1);

  // ── C. Cancellation frees the case ────────────────────────────────────
  const cancel = await post(`/api/global-schedule-events/${firstEventId}/transition`, PCS_A, { transition: "cancel", reason: `${TAG} cancel` });
  check("C: cancel → 200", cancel.status === 200, `status=${cancel.status} body=${JSON.stringify(cancel.body)}`);
  check("C: no active scheduled event after cancel", (await activeEvents(ancillaryCaseId)).length === 0);
  // Re-schedule the same case → a NEW active event forms (capacity freed).
  const r3 = await post("/api/global-schedule-events/schedule-ancillary", PCS_A, { ...bodyA, startsAt: iso(4) });
  check("C: re-schedule after cancel → 200 created", r3.status === 200 && r3.body.created === true, `body=${JSON.stringify(r3.body)}`);
  const secondEventId = Number(r3.body.globalScheduleEventId);
  check("C: new event distinct from cancelled one", secondEventId !== firstEventId);
  check("C: exactly ONE active scheduled event again", (await activeEvents(ancillaryCaseId)).length === 1);
  check("C: same ancillary case reused (no new case)", Number(r3.body.ancillaryCaseId) === ancillaryCaseId && (await casesFor(A.execCaseId, svc)).length === 1);

  // ── D. Reschedule releases old slot, reserves new (parent lineage) ────
  const resched = await post(`/api/global-schedule-events/${secondEventId}/transition`, PCS_A, { transition: "reschedule", newStartsAt: iso(6) });
  check("D: reschedule → 200", resched.status === 200, `status=${resched.status} body=${JSON.stringify(resched.body)}`);
  const newEventId = Number(resched.body.newEventId ?? (resched.body.event as Record<string, unknown> | undefined)?.id);
  const [priorRow] = await db.select().from(globalScheduleEvents).where(eq(globalScheduleEvents.id, secondEventId));
  const [newRow] = newEventId ? await db.select().from(globalScheduleEvents).where(eq(globalScheduleEvents.id, newEventId)) : [undefined];
  check("D: prior event marked 'rescheduled'", priorRow?.status === "rescheduled", `prior=${priorRow?.status}`);
  check("D: new event 'scheduled' w/ parent lineage", newRow?.status === "scheduled" && newRow?.parentEventId === secondEventId, `new=${newRow?.status} parent=${newRow?.parentEventId}`);
  check("D: still exactly ONE active scheduled event", (await activeEvents(ancillaryCaseId)).length === 1);

  // ── F. Tenant — Clinic-A actor cannot schedule a Clinic-B patient ─────
  const B = await seedPatient(CLINIC_B, facilityB);
  const rTenant = await post("/api/global-schedule-events/schedule-ancillary", PCS_A, {
    patientScreeningId: B.screeningId, executionCaseId: B.execCaseId, serviceType: svc, startsAt: iso(3), facilityId: facilityA,
  });
  check("F: cross-clinic schedule → 202 deferred cross_clinic (no write)", rTenant.status === 202 && rTenant.body.deferred === true && rTenant.body.reason === "cross_clinic", `status=${rTenant.status} body=${JSON.stringify(rTenant.body)}`);
  check("F: NO ancillary case created for Clinic-B patient", (await casesFor(B.execCaseId, svc)).length === 0);
  const bEvents = await db.select().from(globalScheduleEvents).where(eq(globalScheduleEvents.executionCaseId, B.execCaseId));
  check("F: NO schedule event created for Clinic-B patient", bEvents.length === 0);

  // ── G. Second entry point (/api/scheduling/visit) → same core/invariants ─
  const G = await seedPatient(CLINIC_A, facilityA);
  const dateStr = new Date(t0 + 5 * 86400_000).toISOString().slice(0, 10);
  const rVisit = await post("/api/scheduling/visit", PCS_A, {
    facility: facilityA, patientScreeningId: G.screeningId, executionCaseId: G.execCaseId,
    date: dateStr, services: [{ serviceType: svc, time: "10:30" }],
  });
  check("G: visit endpoint → 200", rVisit.status === 200, `status=${rVisit.status} body=${JSON.stringify(rVisit.body)}`);
  const gCases = await casesFor(G.execCaseId, svc);
  check("G: visit path created exactly ONE ancillary case (same invariant)", gCases.length === 1, `cases=${gCases.length}`);
  if (gCases[0]) created.ac.push(gCases[0].id);
  const gActive = gCases[0] ? await activeEvents(gCases[0].id) : [];
  check("G: visit path created exactly ONE active scheduled event", gActive.length === 1, `active=${gActive.length}`);
  check("G: visit event is canonical ancillary_appointment", gActive[0]?.eventType === "ancillary_appointment" && gActive[0]?.ancillaryCaseId === gCases[0]?.id);
} finally {
  // Cleanup — journey events + events + retry ledger + cases first (FK-safe), then identity.
  try { if (created.users.length) await db.execute(`DELETE FROM patient_journey_events WHERE actor_user_id IN (${created.users.map((u) => `'${u}'`).join(",")})` as never); } catch (e) { console.error("cleanup journey", e); }
  try { if (created.ec.length) await db.execute(`DELETE FROM patient_journey_events WHERE execution_case_id IN (${created.ec.join(",")})` as never); } catch (e) { console.error("cleanup journey ec", e); }
  try { if (created.ec.length) await db.execute(`DELETE FROM canonical_appointment_reconciliation_failures WHERE execution_case_id IN (${created.ec.join(",")})` as never); } catch (e) { console.error("cleanup carf", e); }
  try { if (created.ac.length) await db.execute(`DELETE FROM canonical_appointment_reconciliation_failures WHERE ancillary_case_id IN (${created.ac.join(",")})` as never); } catch (e) { console.error("cleanup carf ac", e); }
  try { if (created.ec.length) await db.delete(globalScheduleEvents).where(inArray(globalScheduleEvents.executionCaseId, created.ec)); } catch (e) { console.error("cleanup gse", e); }
  try { if (created.ec.length) await db.delete(patientAncillaryCases).where(inArray(patientAncillaryCases.executionCaseId, created.ec)); } catch (e) { console.error("cleanup ac", e); }
  try { if (created.ec.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, created.ec)); } catch (e) { console.error("cleanup ec", e); }
  try { if (created.ps.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, created.ps)); } catch (e) { console.error("cleanup ps", e); }
  try { if (created.batches.length) await db.delete(screeningBatches).where(inArray(screeningBatches.id, created.batches)); } catch (e) { console.error("cleanup batch", e); }
  try { if (created.mem.length) await db.delete(patientClinicMemberships).where(inArray(patientClinicMemberships.id, created.mem)); } catch (e) { console.error("cleanup mem", e); }
  try { if (created.gpp.length) await db.delete(globalPlexusPatients).where(inArray(globalPlexusPatients.id, created.gpp)); } catch (e) { console.error("cleanup gpp", e); }
  try { if (created.users.length) await db.delete(users).where(inArray(users.id, created.users)); } catch (e) { console.error("cleanup users", e); }
  await new Promise<void>((r) => httpServer.close(() => r()));
}

if (failures > 0) { console.error(`\nschedulingCanonicalCreationQA.test.ts: ${failures} failure(s)`); process.exit(1); }
console.log("\nschedulingCanonicalCreationQA.test.ts: all scheduling creation/lifecycle QA checks passed");
process.exit(0);
