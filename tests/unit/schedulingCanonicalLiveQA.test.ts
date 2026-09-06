//
// LIVE scheduling integration QA (requires DATABASE_URL). Verifies the canonical
// scheduling write path's FAIL-SAFE + idempotency invariants that are reachable
// without full Plexus-identity provisioning:
//
//   • With the canonical flag ON but the patient's Plexus identity NOT
//     resolvable, the canonical orchestrator DEFERS (HTTP 202,
//     reason=identity_unavailable) and writes NOTHING — it never fabricates a
//     canonical global_schedule_event / patient_ancillary_case from unresolved
//     identity (fails safe).
//   • A repeat submission also writes nothing (no duplicate/garbage rows).
//   • Both public entry points (/schedule-ancillary and /api/scheduling/visit)
//     converge on the same scheduleAncillaryCore (verified statically in Phase
//     5D/5E — shared _scheduleAncillaryCore).
//
// NOT COVERED HERE (documented remaining P1 DB coverage): POSITIVE canonical
// creation (one event + one ancillary case), capacity-limit rejection, and
// reschedule capacity-release. Those require FULL Phase-2A Plexus identity
// provisioning (global patient ↔ external identifiers ↔ resolvable match) +
// resource-pool/capacity-config fixtures, which are out of scope for this test.
// The canonical path's safe-deferral proven here is exactly why an
// under-provisioned environment cannot silently create bad canonical schedule
// data.
//
//   npx tsx tests/unit/schedulingCanonicalLiveQA.test.ts
// Skips (exit 0) without DATABASE_URL.

import assert from "node:assert/strict";
import { eq, inArray, and } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  console.log("schedulingCanonicalLiveQA.test.ts: SKIP (no DATABASE_URL)");
  process.exit(0);
}
for (const f of ["FEATURE_CANONICAL_APPOINTMENT", "FEATURE_ANCILLARY_CASE_WRITE"]) {
  if (!/^(1|true|yes|on)$/i.test(process.env[f] ?? "")) process.env[f] = "true";
}

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const { db } = await import("../../server/db");
const { clinics } = await import("@shared/schema/clinics");
const { patientScreenings } = await import("@shared/schema/screening");
const { patientExecutionCases } = await import("@shared/schema/executionCase");
const { patientAncillaryCases } = await import("@shared/schema/ancillaryCases");
const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
const gsRoutes = await import("../../server/routes/globalSchedule");

const CLINIC = 1;
const TAG = `schedqa_${Date.now()}`;
type Session = { userId: string; role?: string; clinicId?: number | null };
const sess: Session = { userId: "admin", role: "admin", clinicId: CLINIC };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { session: Session }).session = { ...sess };
  (req as unknown as { clinicId: number | null }).clinicId = sess.clinicId ?? null;
  next();
});
gsRoutes.registerGlobalScheduleRoutes(app);
const httpServer = createServer(app);
await new Promise<void>((r) => httpServer.listen(0, r));
const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

async function post(path: string, payload: unknown) {
  const resp = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  let body: unknown = null; try { body = await resp.json(); } catch { /* */ }
  return { status: resp.status, body: body as Record<string, unknown> | null };
}

const created = { ps: [] as number[], ec: [] as number[] };
let failures = 0;
const check = (n: string, c: boolean, d = "") => { if (c) console.log(`ok   ${n}`); else { failures++; console.error(`FAIL ${n}${d ? " — " + d : ""}`); } };

try {
  const [clinicRow] = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, CLINIC));
  const facility = clinicRow?.name ?? "Taylor Family Practice";

  const [ps] = await db.insert(patientScreenings).values({ batchId: 1, name: `${TAG}_pt`, clinicId: CLINIC, facility } as typeof patientScreenings.$inferInsert).returning({ id: patientScreenings.id });
  created.ps.push(ps.id);
  const [ec] = await db.insert(patientExecutionCases).values({
    clinicId: CLINIC, patientScreeningId: ps.id, patientName: `${TAG}_pt`, facilityId: facility,
    engagementBucket: "outreach", lifecycleStatus: "active", engagementStatus: "in_progress", qualificationStatus: "qualified",
  } as typeof patientExecutionCases.$inferInsert).returning({ id: patientExecutionCases.id });
  created.ec.push(ec.id);

  const startsAt = new Date(Date.now() + 3 * 86400_000).toISOString();
  const bookBody = { executionCaseId: ec.id, patientScreeningId: ps.id, serviceType: "BrainWave", startsAt, facilityId: facility };

  const countEvents = async () =>
    (await db.select().from(globalScheduleEvents).where(and(eq(globalScheduleEvents.executionCaseId, ec.id), eq(globalScheduleEvents.serviceType, "BrainWave")))).length;
  const countCases = async () =>
    (await db.select().from(patientAncillaryCases).where(and(eq(patientAncillaryCases.executionCaseId, ec.id), eq(patientAncillaryCases.serviceType, "BrainWave")))).length;

  // Submit 1 — canonical flag ON, identity NOT provisioned → safe deferral.
  const r1 = await post("/api/global-schedule-events/schedule-ancillary", bookBody);
  check("canonical path handled (2xx)", r1.status >= 200 && r1.status < 300, `status=${r1.status}`);
  check("canonical deferred (did not fabricate from unresolved identity)", r1.body?.deferred === true && r1.body?.reason === "identity_unavailable", `body=${JSON.stringify(r1.body)}`);
  check("fail-safe: NO canonical event written", (await countEvents()) === 0);
  check("fail-safe: NO ancillary case written", (await countCases()) === 0);

  // Submit 2 — idempotent: still nothing written (no duplicate/garbage).
  await post("/api/global-schedule-events/schedule-ancillary", bookBody);
  check("idempotent: still NO event after repeat", (await countEvents()) === 0);
  check("idempotent: still NO ancillary case after repeat", (await countCases()) === 0);
} finally {
  try { await db.delete(globalScheduleEvents).where(inArray(globalScheduleEvents.executionCaseId, created.ec)); } catch (e) { console.error("cleanup gse", e); }
  try { await db.delete(patientAncillaryCases).where(inArray(patientAncillaryCases.executionCaseId, created.ec)); } catch (e) { console.error("cleanup ac", e); }
  try { if (created.ec.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, created.ec)); } catch (e) { console.error("cleanup ec", e); }
  try { if (created.ps.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, created.ps)); } catch (e) { console.error("cleanup ps", e); }
  await new Promise<void>((r) => httpServer.close(() => r()));
}

if (failures > 0) { console.error(`schedulingCanonicalLiveQA.test.ts: ${failures} failure(s)`); process.exit(1); }
console.log("schedulingCanonicalLiveQA.test.ts: all scheduling fail-safe/idempotency checks passed");
process.exit(0);
