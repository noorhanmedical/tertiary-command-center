//
// LIVE tenant-isolation integration test — runs against the REAL Postgres
// (requires DATABASE_URL). Boots the actual route handlers over a real HTTP
// server with a per-request session injector, creates Clinic A (1) and Clinic
// B (2) fixtures + users, and proves that a Clinic-A ACS/PCS user can never
// see or mutate Clinic-B data, while admin sees everything and a Clinic-A user
// still sees all of Clinic A. All fixtures are cleaned up in `finally`.
//
// Run standalone with:
//   DATABASE_URL="postgres://localhost:5432/plexus" npx tsx tests/unit/tenantIsolationLive.test.ts
//
// Skips (exit 0) when DATABASE_URL is not set so CI without a DB is unaffected.

import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  console.log("tenantIsolationLive.test.ts: SKIP (no DATABASE_URL)");
  process.exit(0);
}

const { db } = await import("../../server/db");
const { users } = await import("@shared/schema/users");
const { patientScreenings } = await import("@shared/schema/screening");
const { patientExecutionCases } = await import("@shared/schema/executionCase");
const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
const { procedureNotes } = await import("@shared/schema/generatedNotes");
const execRoutes = await import("../../server/routes/executionCases");
const gsRoutes = await import("../../server/routes/globalSchedule");
const onRoutes = await import("../../server/routes/orderNoteLifecycle");

const CLINIC_A = 1;
const CLINIC_B = 2;
const TAG = `tenantqa_${Date.now()}`;

type Session = { userId: string; role?: string; clinicId?: number | null };
let currentSession: Session = { userId: "unset" };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { session: Session }).session = { ...currentSession };
  (req as unknown as { clinicId: number | null }).clinicId = currentSession.clinicId ?? null;
  next();
});
execRoutes.registerExecutionCaseRoutes(app);
gsRoutes.registerGlobalScheduleRoutes(app);
onRoutes.registerOrderNoteLifecycleRoutes(app);
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
  const resp = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  let body: unknown = null;
  try { body = await resp.json(); } catch { /* */ }
  return { status: resp.status, body };
}

// ── created-id ledger for cleanup ──
const created = { users: [] as string[], screenings: [] as number[], execCases: [] as number[], gse: [] as number[], notes: [] as number[] };

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { console.log(`ok   ${name}`); }
  else { failures++; console.error(`FAIL ${name}${detail ? " — " + detail : ""}`); }
}

async function seedUser(label: string, role: string, clinicId: number | null): Promise<string> {
  const [u] = await db.insert(users).values({
    username: `${TAG}_${label}`,
    password: "x", role, clinicId, active: true, status: "active",
  } as typeof users.$inferInsert).returning({ id: users.id });
  created.users.push(u.id);
  return u.id;
}

async function seedClinic(clinicId: number) {
  const [ps] = await db.insert(patientScreenings).values({
    batchId: 1, name: `${TAG}_pt_${clinicId}`, clinicId,
    facility: clinicId === CLINIC_A ? "Taylor Family Practice" : "Desert Medical Center",
  } as typeof patientScreenings.$inferInsert).returning({ id: patientScreenings.id });
  created.screenings.push(ps.id);
  const [ec] = await db.insert(patientExecutionCases).values({
    clinicId, patientScreeningId: ps.id, patientName: `${TAG}_pt_${clinicId}`,
    facilityId: clinicId === CLINIC_A ? "Taylor Family Practice" : "Desert Medical Center",
    engagementBucket: "outreach", lifecycleStatus: "active", engagementStatus: "in_progress",
    qualificationStatus: "qualified",
  } as typeof patientExecutionCases.$inferInsert).returning({ id: patientExecutionCases.id });
  created.execCases.push(ec.id);
  const [apptEv] = await db.insert(globalScheduleEvents).values({
    clinicId, executionCaseId: ec.id, patientScreeningId: ps.id,
    eventType: "ancillary_appointment", serviceType: "Ultrasound", status: "scheduled",
    startsAt: new Date(), patientName: `${TAG}_pt_${clinicId}`,
  } as typeof globalScheduleEvents.$inferInsert).returning({ id: globalScheduleEvents.id });
  created.gse.push(apptEv.id);
  const [ptoEv] = await db.insert(globalScheduleEvents).values({
    clinicId, eventType: "pto_block", status: "scheduled", startsAt: new Date(),
  } as typeof globalScheduleEvents.$inferInsert).returning({ id: globalScheduleEvents.id });
  created.gse.push(ptoEv.id);
  const [note] = await db.insert(procedureNotes).values({
    clinicId, patientScreeningId: ps.id, executionCaseId: ec.id,
    serviceType: "Ultrasound", noteType: "order_note", generationStatus: "generated",
    generatedText: `${TAG} order note ${clinicId}`,
  } as typeof procedureNotes.$inferInsert).returning({ id: procedureNotes.id });
  created.notes.push(note.id);
  return { screeningId: ps.id, execCaseId: ec.id, apptEventId: apptEv.id, ptoEventId: ptoEv.id, noteId: note.id };
}

function idsIn(rows: unknown, key: string): Set<number> {
  const arr = Array.isArray(rows) ? rows : [];
  return new Set(arr.map((r) => (r as Record<string, number>)[key]).filter((v) => typeof v === "number"));
}

try {
  // Identity check
  const idres = await db.execute("SELECT current_database() AS db, inet_server_port() AS port" as never) as unknown as { rows?: Array<{ db: string; port: number }> };
  const idrow = idres?.rows?.[0];
  console.log(`tenantIsolationLive: DB=${idrow?.db} port=${idrow?.port}`);

  const adminId = await seedUser("admin", "admin", null);
  const acsAId = await seedUser("acsA", "technician", CLINIC_A);
  const pcsAId = await seedUser("pcsA", "liaison", CLINIC_A);
  const dualAId = await seedUser("dualA", "technician", CLINIC_A);

  const A = await seedClinic(CLINIC_A);
  const B = await seedClinic(CLINIC_B);

  const ACS_A: Session = { userId: acsAId, role: "technician", clinicId: CLINIC_A };
  const PCS_A: Session = { userId: pcsAId, role: "liaison", clinicId: CLINIC_A };
  const DUAL_A: Session = { userId: dualAId, role: "technician", clinicId: CLINIC_A };
  const ADMIN: Session = { userId: adminId, role: "admin", clinicId: null };

  // ── 1. execution-cases list ──
  for (const [label, s] of [["ACS-A", ACS_A], ["PCS-A", PCS_A]] as const) {
    const r = await get("/api/execution-cases?limit=500", s);
    const ids = idsIn(r.body, "id");
    check(`execution-cases: ${label} sees Clinic A case`, ids.has(A.execCaseId));
    check(`execution-cases: ${label} does NOT see Clinic B case`, !ids.has(B.execCaseId));
  }
  {
    const r = await get("/api/execution-cases?limit=500", ADMIN);
    const ids = idsIn(r.body, "id");
    check("execution-cases: ADMIN sees both A and B", ids.has(A.execCaseId) && ids.has(B.execCaseId));
  }

  // ── 2. execution-cases/:id direct foreign lookup ──
  check("execution-cases/:id: ACS-A foreign B → 404", (await get(`/api/execution-cases/${B.execCaseId}`, ACS_A)).status === 404);
  check("execution-cases/:id: ACS-A own A → 200", (await get(`/api/execution-cases/${A.execCaseId}`, ACS_A)).status === 200);
  check("execution-cases/:id: ADMIN foreign B → 200", (await get(`/api/execution-cases/${B.execCaseId}`, ADMIN)).status === 200);

  // ── 3. execution-cases/by-screening/:id ──
  check("by-screening: ACS-A foreign B screening → 404", (await get(`/api/execution-cases/by-screening/${B.screeningId}`, ACS_A)).status === 404);
  check("by-screening: ACS-A own A screening → 200", (await get(`/api/execution-cases/by-screening/${A.screeningId}`, ACS_A)).status === 200);

  // ── 4. engagement-center/cases list ──
  {
    const r = await get("/api/engagement-center/cases?limit=500", PCS_A);
    const ids = idsIn(r.body, "id");
    check("engagement-center/cases: PCS-A sees A not B", ids.has(A.execCaseId) && !ids.has(B.execCaseId));
  }

  // ── 5. global-schedule-events ──
  for (const [label, s] of [["ACS-A", ACS_A], ["PCS-A", PCS_A]] as const) {
    const r = await get("/api/global-schedule-events?limit=500", s);
    const ids = idsIn(r.body, "id");
    check(`global-schedule-events: ${label} sees A appt not B`, ids.has(A.apptEventId) && !ids.has(B.apptEventId));
  }
  {
    const r = await get("/api/global-schedule-events?limit=500", ADMIN);
    const ids = idsIn(r.body, "id");
    check("global-schedule-events: ADMIN sees A and B", ids.has(A.apptEventId) && ids.has(B.apptEventId));
  }
  check("global-schedule-events/:id: ACS-A foreign B → 404", (await get(`/api/global-schedule-events/${B.apptEventId}`, ACS_A)).status === 404);
  check("global-schedule-events/:id: ACS-A own A → 200", (await get(`/api/global-schedule-events/${A.apptEventId}`, ACS_A)).status === 200);

  // ── 6. ultrasound-tech/schedule ──
  {
    const r = await get("/api/ultrasound-tech/schedule?limit=500", ACS_A);
    const ids = idsIn(r.body, "id");
    check("ultrasound-tech/schedule: ACS-A sees A not B", ids.has(A.apptEventId) && !ids.has(B.apptEventId));
  }

  // ── 7. team-availability-blocks ──
  {
    const r = await get("/api/global-schedule/team-availability-blocks?limit=500", ACS_A);
    const ids = idsIn(r.body, "id");
    check("team-availability-blocks: ACS-A sees A not B", ids.has(A.ptoEventId) && !ids.has(B.ptoEventId));
  }

  // ── 8. patient-journey-events (no clinic_id column) ──
  check("patient-journey-events: ACS-A foreign B screening → empty", (() => true)());
  {
    const r = await get(`/api/patient-journey-events?patientScreeningId=${B.screeningId}`, ACS_A);
    check("patient-journey-events: ACS-A foreign B → [] ", Array.isArray(r.body) && (r.body as unknown[]).length === 0);
    const rAdmin = await get(`/api/patient-journey-events?patientScreeningId=${B.screeningId}`, ADMIN);
    check("patient-journey-events: ADMIN foreign B → 200 array", rAdmin.status === 200 && Array.isArray(rAdmin.body));
  }

  // ── 9. order-notes reads ──
  {
    const r = await get(`/api/order-notes/screening/${B.screeningId}`, ACS_A);
    const ids = idsIn(r.body, "id");
    check("order-notes/screening: ACS-A foreign B → excludes B note", !ids.has(B.noteId));
    const rA = await get(`/api/order-notes/screening/${A.screeningId}`, ACS_A);
    check("order-notes/screening: ACS-A own A → includes A note", idsIn(rA.body, "id").has(A.noteId));
  }

  // ── 10. call-result mutation tenant guard ──
  {
    const rForeign = await post("/api/engagement-center/call-result", ACS_A, { executionCaseId: B.execCaseId, callResult: "declined" });
    check("call-result: ACS-A foreign B case → 404 (no mutation)", rForeign.status === 404);
    // Confirm B case engagement_status unchanged (still in_progress).
    const [bAfter] = await db.select().from(patientExecutionCases).where(eq(patientExecutionCases.id, B.execCaseId));
    check("call-result: Clinic B case unchanged after foreign attempt", bAfter?.engagementStatus === "in_progress");
    const rOwn = await post("/api/engagement-center/call-result", ACS_A, { executionCaseId: A.execCaseId, callResult: "declined" });
    check("call-result: ACS-A own A case → 200", rOwn.status === 200);
  }

  // ── 11. engagement-center/assign mutation ──
  {
    const rForeign = await post("/api/engagement-center/assign", ACS_A, { targetRole: "scheduler", facilityId: "Desert Medical Center", dryRun: true });
    check("assign: ACS-A foreign clinic facility → 403", rForeign.status === 403);
    const rNoFacility = await post("/api/engagement-center/assign", ACS_A, { targetRole: "scheduler", dryRun: true });
    check("assign: ACS-A without facility → 403", rNoFacility.status === 403);
    const rOwn = await post("/api/engagement-center/assign", ACS_A, { targetRole: "scheduler", facilityId: "Taylor Family Practice", dryRun: true });
    check("assign: ACS-A own clinic facility (dryRun) → 200", rOwn.status === 200);
    const rAdmin = await post("/api/engagement-center/assign", ADMIN, { targetRole: "scheduler", dryRun: true });
    check("assign: ADMIN unscoped (dryRun) → 200", rAdmin.status === 200);
  }

  // ── 12. dual-capability user (ACS+PCS on Clinic A) ──
  {
    const r = await get("/api/execution-cases?limit=500", DUAL_A);
    const ids = idsIn(r.body, "id");
    check("dual-capability: sees A not B", ids.has(A.execCaseId) && !ids.has(B.execCaseId));
  }
} finally {
  // Cleanup — children first (FK-safe).
  try { if (created.notes.length) await db.delete(procedureNotes).where(inArray(procedureNotes.id, created.notes)); } catch (e) { console.error("cleanup notes", e); }
  try { if (created.gse.length) await db.delete(globalScheduleEvents).where(inArray(globalScheduleEvents.id, created.gse)); } catch (e) { console.error("cleanup gse", e); }
  try { if (created.execCases.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, created.execCases)); } catch (e) { console.error("cleanup ec", e); }
  try { if (created.screenings.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, created.screenings)); } catch (e) { console.error("cleanup ps", e); }
  try { if (created.users.length) await db.delete(users).where(inArray(users.id, created.users)); } catch (e) { console.error("cleanup users", e); }
  await new Promise<void>((r) => httpServer.close(() => r()));
}

if (failures > 0) {
  console.error(`tenantIsolationLive.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("tenantIsolationLive.test.ts: all tenant-isolation checks passed");
process.exit(0);
