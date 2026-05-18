// Final-wiring QA for Plexus IQ + Team Portal completion.
//
// Run with: npm run qa:plexus-final-wiring
//
// Verifies repository-level contracts without spinning up an HTTP
// server. Skips cleanly when DATABASE_URL is missing.

if (!process.env.DATABASE_URL) {
  console.log(
    "[qa-plexus-final-wiring] DATABASE_URL missing — skipping.",
  );
  process.exit(0);
}

import { validateSameFacilityDatePacket } from "../client/src/lib/pdfPacketGrouping";

let passes = 0;
let failures = 0;

function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  // ─── pdfPacketGrouping ────────────────────────────────────────────
  console.log("\n--- validateSameFacilityDatePacket contract ---");
  const samePacket = validateSameFacilityDatePacket(
    [
      { id: 1, facility: "Taylor Family Practice", name: "A" } as any,
      { id: 2, facility: "Taylor Family Practice", name: "B" } as any,
    ],
    null,
    "2026-05-19",
  );
  assert(samePacket.ok === true, "same facility+date → ok=true");
  if (samePacket.ok) {
    assert(samePacket.facility === "Taylor Family Practice", "facility set");
    assert(samePacket.scheduleDate === "2026-05-19", "scheduleDate set");
    assert(samePacket.patients.length === 2, "all patients carried through");
  }

  const mixedFacility = validateSameFacilityDatePacket(
    [
      { id: 1, facility: "Taylor Family Practice", name: "A" } as any,
      { id: 2, facility: "NWPG - Spring", name: "B" } as any,
    ],
    null,
    "2026-05-19",
  );
  assert(mixedFacility.ok === false, "mixed facility → ok=false");
  if (!mixedFacility.ok) {
    assert(/one facility/i.test(mixedFacility.reason), "reason mentions facility/date");
    assert(mixedFacility.groups.length === 2, "two facility groups surfaced");
  }

  const mixedDate = validateSameFacilityDatePacket(
    [
      { id: 1, facility: "Taylor Family Practice", name: "A" } as any,
      { id: 2, facility: "Taylor Family Practice", name: "B" } as any,
    ],
    "Taylor Family Practice",
    null,
  );
  assert(mixedDate.ok === false, "missing scheduleDate → ok=false");

  // ─── canonical execution-case + scheduler reads ───────────────────
  console.log("\n--- canonical engagement-assignment contract ---");
  const dbMod = await import("../server/db");
  const storageMod = await import("../server/storage");
  const schemaMod = await import("@shared/schema");
  const drizzleMod = await import("drizzle-orm");
  const { db } = dbMod;
  const { storage } = storageMod;
  const { patientExecutionCases } = schemaMod;
  const { desc } = drizzleMod;

  const allActive = await storage.getAllPatientScreenings();
  if (allActive.length === 0) {
    console.log("[qa] No active patient_screenings — skipping assignment checks.");
  } else {
    const target = allActive[0];
    const [execCase] = await db
      .select()
      .from(patientExecutionCases)
      .where(drizzleMod.eq(patientExecutionCases.patientScreeningId, target.id))
      .orderBy(desc(patientExecutionCases.id))
      .limit(1);
    assert(
      execCase === undefined || typeof execCase.id === "number",
      "execution case lookup returns row or undefined cleanly",
    );

    const schedulers = await storage.getOutreachSchedulers();
    assert(Array.isArray(schedulers), "outreach schedulers list returns an array");
    if (schedulers.length > 0) {
      assert(typeof schedulers[0].name === "string", "scheduler has a name");
      assert(typeof schedulers[0].facility === "string", "scheduler has a facility");
    }
  }

  // ─── patient_communications table presence ────────────────────────
  console.log("\n--- patient_communications presence ---");
  const { patientCommunications } = schemaMod;
  const sample = await db.select().from(patientCommunications).limit(1);
  assert(Array.isArray(sample), "patient_communications query returns array");

  console.log(`\n=========================`);
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log(`=========================`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
