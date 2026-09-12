// Integration test for the canonical patient write boundary. Synthetic only
// (is_test / ZZCANON prefix), cleaned up at the end.
//   npx tsx --env-file=.env script/testCanonicalPatient.ts

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import {
  createCanonicalPatient,
  updateCanonicalPatient,
  deriveClinicIdFromFacility,
} from "../server/services/canonicalPatient/canonicalPatientService";

const FACILITY = "Taylor Family Practice";
let pass = 0, fail = 0;
function check(cond: boolean, msg: string) { if (cond) { pass++; console.log("PASS", msg); } else { fail++; console.log("FAIL", msg); } }

// No userId (avoids the users FK); username-only audit is allowed.
const fakeReq = { session: { username: "zz_canon" } } as never;

async function main() {
  const { clinicId } = await deriveClinicIdFromFacility(FACILITY);
  check(clinicId != null, `facility "${FACILITY}" derives clinicId (got ${clinicId})`);

  const batch = await storage.createScreeningBatch({
    name: `ZZCANON batch ${Date.now()}`, facility: FACILITY, scheduleDate: new Date().toISOString().slice(0, 10),
    clinicId: clinicId ?? undefined, status: "draft", importKind: "full", isTest: true,
  } as never);

  const draftA = { name: "ZZCANON Alice", dob: "1958-05-14", phoneNumber: "2025550001", mrn: "ZZC-1", facility: FACILITY };

  // 1) manual create
  const c1 = await createCanonicalPatient({ draft: draftA, provenance: { sourceType: "manual", clinicId, facility: FACILITY, batchId: batch.id }, batchId: batch.id, req: fakeReq });
  check(c1.status === "created" && !!c1.patient, "manual create succeeds");
  const aliceId = c1.patient!.id;
  check((c1.patient as { sourceType?: string }).sourceType === "manual", "provenance sourceType=manual stamped");
  check(c1.patient!.clinicId === clinicId, "clinicId derived from facility on the row");

  // 2) duplicate blocked (same name+dob+phone)
  const c2 = await createCanonicalPatient({ draft: { ...draftA, mrn: "ZZC-DIFF" }, provenance: { sourceType: "manual", clinicId, facility: FACILITY, batchId: batch.id }, batchId: batch.id });
  check(c2.status === "duplicate_blocked" && c2.duplicate?.screeningId === aliceId, "same identity is blocked as duplicate (points at Alice)");

  // 3) force create-as-new
  const c3 = await createCanonicalPatient({ draft: { ...draftA, mrn: "ZZC-DIFF" }, provenance: { sourceType: "manual", clinicId, facility: FACILITY, batchId: batch.id }, batchId: batch.id, force: true });
  check(c3.status === "created", "force=true bypasses duplicate block (create-as-new)");

  // 4) source-equivalence: a 'bulk_import' patient then a 'plexus_iq' create for the
  //    SAME identity resolves to the existing one (converges regardless of source).
  const bulk = await createCanonicalPatient({ draft: { name: "ZZCANON Carol", dob: "1970-07-07", phoneNumber: "2025550007", facility: FACILITY }, provenance: { sourceType: "bulk_import", clinicId, facility: FACILITY, batchId: batch.id }, batchId: batch.id });
  check(bulk.status === "created", "bulk_import create succeeds");
  const iq = await createCanonicalPatient({ draft: { name: "ZZCANON Carol", dob: "1970-07-07", phoneNumber: "2025550007", facility: FACILITY }, provenance: { sourceType: "plexus_iq", clinicId, facility: FACILITY, batchId: batch.id }, batchId: batch.id });
  check(iq.status === "duplicate_blocked" && iq.duplicate?.screeningId === bulk.patient!.id, "plexus_iq create for same person converges to the bulk-created patient (no parallel identity)");

  // 5) non-identity edit → updated, audited
  const u1 = await updateCanonicalPatient({ screeningId: aliceId, updates: { insurance: "Aetna" }, req: fakeReq });
  check(u1.status === "updated", "non-identity edit updates");

  // 6) MRN collision: create B with a distinct mrn+dob, then edit Alice's mrn+dob to match B → collision
  const bPat = await createCanonicalPatient({ draft: { name: "ZZCANON Bob", dob: "1961-03-03", mrn: "ZZC-B", phoneNumber: "2025550002", facility: FACILITY }, provenance: { sourceType: "manual", clinicId, facility: FACILITY, batchId: batch.id }, batchId: batch.id });
  check(bPat.status === "created", "second patient (Bob) created");
  const collide = await updateCanonicalPatient({ screeningId: aliceId, updates: { mrn: "ZZC-B", dob: "1961-03-03" }, req: fakeReq });
  check(collide.status === "identity_collision" && collide.collision?.screeningId === bPat.patient!.id, "editing Alice's MRN+DOB to Bob's is blocked as identity collision");

  // force override on edit
  const forced = await updateCanonicalPatient({ screeningId: aliceId, updates: { mrn: "ZZC-B", dob: "1961-03-03" }, force: true, req: fakeReq });
  check(forced.status === "updated", "force=true overrides collision");

  // 7) audit rows written for create + update
  const auditRes = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE username='zz_canon' AND entity_type='patient'`);
  const auditN = Number((auditRes as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
  check(auditN >= 3, `patient create/update audited (${auditN} rows)`);

  // ── cleanup ──────────────────────────────────────────────────────────────
  await db.execute(sql`DELETE FROM patient_screenings WHERE is_test=true AND name LIKE 'ZZCANON%'`);
  await db.execute(sql`DELETE FROM screening_batches WHERE is_test=true AND name LIKE 'ZZCANON%'`);
  await db.execute(sql`DELETE FROM audit_log WHERE username='zz_canon'`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
