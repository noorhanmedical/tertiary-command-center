// Pre-document spine QA.
//
// Run with: npm run qa:pre-document-spine
//
// Verifies the patient-acquisition + qualification + engagement +
// scheduling spine — i.e. everything operational that happens BEFORE
// ancillary documents / billing readiness / invoicing. This is the
// boundary the user uses to decide whether the next batch should
// move into the document/billing pipeline.
//
// Skips cleanly when DATABASE_URL is missing. Never writes outside
// `isTest=true` rows.

if (!process.env.DATABASE_URL) {
  console.log(
    "[qa-pre-document-spine] DATABASE_URL missing — skipping.",
  );
  process.exit(0);
}

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
  // Parser contract — pure function; works in any environment but is
  // included here so a single QA run covers acquisition end-to-end.
  console.log("\n--- import parser contract ---");
  const {
    parsePlexusIqClinicalImport,
    normalizeClinicAlias,
  } = await import("../client/src/lib/plexusIqClinicalImportParser");
  const tabRow = [
    "Clinic", "Patient Name", "Patient Type", "Appointment Date", "Dx",
  ].join("\t");
  const dataRow = ["TFP", "QA Spine", "Visit", "2026-06-01", "HTN"].join("\t");
  const result = parsePlexusIqClinicalImport(`${tabRow}\n${dataRow}`, {});
  assert(result.format === "clinical-spreadsheet", "clinical format detected");
  assert(result.rows.length === 1, "row parsed");
  assert(result.rows[0].facility === "Taylor Family Practice", "TFP alias normalized");
  assert(result.rows[0].patientType === "visit", "Patient Type Visit honored");
  assert(normalizeClinicAlias("NWPG Spring") === "NWPG - Spring", "NWPG alias");

  // Engagement gate helper — covered by client-side imports.
  console.log("\n--- pdf packet contract ---");
  const { validateSameFacilityDatePacket, isPatientPdfEligible } = await import(
    "../client/src/lib/pdfPacketGrouping"
  );
  const okPacket = validateSameFacilityDatePacket(
    [
      { id: 1, name: "A", facility: "TFP" } as any,
      { id: 2, name: "B", facility: "TFP" } as any,
    ],
    null,
    "2026-06-01",
  );
  assert(okPacket.ok === true, "same-facility same-date packet ok");
  const mixed = validateSameFacilityDatePacket(
    [
      { id: 1, name: "A", facility: "TFP" } as any,
      { id: 2, name: "B", facility: "NWPG - Spring" } as any,
    ],
    null,
    "2026-06-01",
  );
  assert(mixed.ok === false, "mixed-facility packet rejected");
  assert(
    isPatientPdfEligible({ status: "completed" } as any) === true,
    "completed status is PDF-eligible",
  );
  assert(
    isPatientPdfEligible({ status: "draft" } as any) === false,
    "draft status is not PDF-eligible",
  );

  // Canonical DB reads — the spine the pre-document flow rests on.
  console.log("\n--- canonical reads ---");
  const dbMod = await import("../server/db");
  const schemaMod = await import("@shared/schema");
  const { db } = dbMod;
  const tableChecks: Array<[string, any]> = [
    ["screening_batches", schemaMod.screeningBatches],
    ["patient_screenings", schemaMod.patientScreenings],
    ["patient_execution_cases", schemaMod.patientExecutionCases],
    ["patient_journey_events", schemaMod.patientJourneyEvents],
    ["outreach_calls", schemaMod.outreachCalls],
    ["outreach_schedulers", schemaMod.outreachSchedulers],
    ["global_schedule_events", schemaMod.globalScheduleEvents],
    ["plexus_tasks", schemaMod.plexusTasks],
    ["patient_communications", schemaMod.patientCommunications],
    ["analysis_jobs", schemaMod.analysisJobs],
  ];
  for (const [name, table] of tableChecks) {
    if (!table) {
      assert(false, `${name}: schema export missing`);
      continue;
    }
    try {
      const rows = await db.select().from(table).limit(1);
      assert(Array.isArray(rows), `${name}: select returns array`);
    } catch (err) {
      assert(
        false,
        `${name}: select threw — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Engagement board read — verifies the canonical assignment surface
  // is queryable end-to-end.
  console.log("\n--- engagement board read ---");
  const storageMod = await import("../server/storage");
  const schedulers = await storageMod.storage.getOutreachSchedulers();
  assert(Array.isArray(schedulers), "outreach_schedulers list returns array");

  console.log(`\n=========================`);
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log(`=========================`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
