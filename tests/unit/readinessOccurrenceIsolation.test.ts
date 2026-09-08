//
// LIVE readiness-occurrence-isolation test (requires DATABASE_URL). Proves the
// P0 fix (migration 0081 + occurrence-aware writers/readers): two occurrences
// of the SAME service on ONE execution case have INDEPENDENT readiness, and
// BrainWave vs VitalWave never collide. Exercises the real persistence
// (createCaseDocumentReadiness with ancillary_case_id) AND the real read
// resolver (buildAncillaryReadinessSummaries). Self-cleaning in `finally`.
//
//   npx tsx tests/unit/readinessOccurrenceIsolation.test.ts
// Skips (exit 0) without DATABASE_URL.

import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  console.log("readinessOccurrenceIsolation.test.ts: SKIP (no DATABASE_URL)");
  process.exit(0);
}

const { db } = await import("../../server/db");
const { globalPlexusPatients, patientClinicMemberships } = await import("@shared/schema/plexusIdentity");
const { patientScreenings } = await import("@shared/schema/screening");
const { patientExecutionCases } = await import("@shared/schema/executionCase");
const { patientAncillaryCases } = await import("@shared/schema/ancillaryCases");
const { caseDocumentReadiness } = await import("@shared/schema/documentReadiness");
const { createCaseDocumentReadiness } = await import("../../server/repositories/documentReadiness.repo");
const { buildAncillaryReadinessSummaries } = await import("../../server/services/ancillary/ancillaryReadinessSummary");

const CLINIC = 1;
const TAG = `rdyocc_${Date.now()}`;
const created = { gpp: [] as number[], pcm: [] as number[], ps: [] as number[], ec: [] as number[], ac: [] as number[], cdr: [] as number[] };

let failures = 0;
const check = (name: string, cond: boolean) => { if (cond) console.log(`ok   ${name}`); else { failures++; console.error(`FAIL ${name}`); } };

async function summaryFor(rowId: string, ecId: number, acId: number, serviceType: string) {
  const m = await buildAncillaryReadinessSummaries([
    { id: rowId, executionCaseId: ecId, ancillaryCaseId: acId, patientScreeningId: null, serviceType, scheduledDate: null },
  ]);
  return m.get(rowId)!;
}

try {
  const [gpp] = await db.insert(globalPlexusPatients).values({ plexusId: `${TAG}_P` } as typeof globalPlexusPatients.$inferInsert).returning({ id: globalPlexusPatients.id });
  created.gpp.push(gpp.id);
  const [pcm] = await db.insert(patientClinicMemberships).values({ globalPlexusPatientId: gpp.id, clinicId: CLINIC } as typeof patientClinicMemberships.$inferInsert).returning({ id: patientClinicMemberships.id });
  created.pcm.push(pcm.id);
  const [ps] = await db.insert(patientScreenings).values({ batchId: 1, name: `${TAG}_pt`, clinicId: CLINIC, facility: "Taylor Family Practice" } as typeof patientScreenings.$inferInsert).returning({ id: patientScreenings.id });
  created.ps.push(ps.id);
  const [ec] = await db.insert(patientExecutionCases).values({
    clinicId: CLINIC, patientScreeningId: ps.id, patientName: `${TAG}_pt`, facilityId: "Taylor Family Practice",
    engagementBucket: "outreach", lifecycleStatus: "active", engagementStatus: "in_progress", qualificationStatus: "qualified",
  } as typeof patientExecutionCases.$inferInsert).returning({ id: patientExecutionCases.id });
  created.ec.push(ec.id);

  // Two BrainWave occurrences (A, B) + one VitalWave (C) on the SAME exec case.
  const mkCase = async (serviceType: string, seq: number) => {
    const [ac] = await db.insert(patientAncillaryCases).values({
      globalPlexusPatientId: gpp.id, patientClinicMembershipId: pcm.id, clinicId: CLINIC,
      serviceType, episodeSequence: seq, executionCaseId: ec.id, originatingScreeningId: ps.id,
    } as typeof patientAncillaryCases.$inferInsert).returning({ id: patientAncillaryCases.id });
    created.ac.push(ac.id);
    return ac.id;
  };
  const occA = await mkCase("BrainWave", 1);
  const occB = await mkCase("BrainWave", 2);
  const occC = await mkCase("VitalWave", 1);

  const writeReadiness = async (acId: number, serviceType: string, documentType: string, status: string) => {
    const row = await createCaseDocumentReadiness({
      executionCaseId: ec.id, ancillaryCaseId: acId, patientScreeningId: ps.id, clinicId: CLINIC,
      patientName: `${TAG}_pt`, facilityId: "Taylor Family Practice",
      serviceType, documentType, documentStatus: status, completedAt: new Date(),
    } as never);
    created.cdr.push((row as { id: number }).id);
  };

  // Complete occurrence A: screening_form + report.
  await writeReadiness(occA, "BrainWave", "screening_form", "completed");
  await writeReadiness(occA, "BrainWave", "report", "uploaded");

  let sA = await summaryFor("A", ec.id, occA, "BrainWave");
  let sB = await summaryFor("B", ec.id, occB, "BrainWave");
  const sC = await summaryFor("C", ec.id, occC, "VitalWave");

  check("occ A screening complete", sA.screeningForm === "complete");
  check("occ A report complete", sA.report === "complete");
  check("occ B screening ISOLATED (missing)", sB.screeningForm === "missing");
  check("occ B report ISOLATED (missing)", sB.report === "missing");
  check("VitalWave occ C screening ISOLATED (missing)", sC.screeningForm === "missing");
  check("VitalWave occ C report ISOLATED (missing)", sC.report === "missing");

  // Now complete occurrence B; occurrence A must remain unchanged.
  await writeReadiness(occB, "BrainWave", "screening_form", "completed");
  await writeReadiness(occB, "BrainWave", "report", "uploaded");

  sA = await summaryFor("A", ec.id, occA, "BrainWave");
  sB = await summaryFor("B", ec.id, occB, "BrainWave");
  check("occ B now complete (screening)", sB.screeningForm === "complete");
  check("occ B now complete (report)", sB.report === "complete");
  check("occ A STILL complete after B (screening)", sA.screeningForm === "complete");
  check("occ A STILL complete after B (report)", sA.report === "complete");

  // Distinct persisted rows per occurrence (no collapse).
  const rows = await db.select().from(caseDocumentReadiness).where(inArray(caseDocumentReadiness.ancillaryCaseId, [occA, occB]));
  const aRows = rows.filter((r) => r.ancillaryCaseId === occA).length;
  const bRows = rows.filter((r) => r.ancillaryCaseId === occB).length;
  check("occ A has its own persisted rows (2)", aRows === 2);
  check("occ B has its own persisted rows (2)", bRows === 2);
} finally {
  try { if (created.cdr.length) await db.delete(caseDocumentReadiness).where(inArray(caseDocumentReadiness.id, created.cdr)); } catch (e) { console.error("cleanup cdr", e); }
  try { if (created.ac.length) await db.delete(patientAncillaryCases).where(inArray(patientAncillaryCases.id, created.ac)); } catch (e) { console.error("cleanup ac", e); }
  try { if (created.ec.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, created.ec)); } catch (e) { console.error("cleanup ec", e); }
  try { if (created.ps.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, created.ps)); } catch (e) { console.error("cleanup ps", e); }
  try { if (created.pcm.length) await db.delete(patientClinicMemberships).where(inArray(patientClinicMemberships.id, created.pcm)); } catch (e) { console.error("cleanup pcm", e); }
  try { if (created.gpp.length) await db.delete(globalPlexusPatients).where(inArray(globalPlexusPatients.id, created.gpp)); } catch (e) { console.error("cleanup gpp", e); }
}

if (failures > 0) {
  console.error(`readinessOccurrenceIsolation.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("readinessOccurrenceIsolation.test.ts: all occurrence-isolation checks passed");
process.exit(0);
