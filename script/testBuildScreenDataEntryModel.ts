// Read/model QA for the refined Build screen data-entry surface.
//
// Run with `npm run test:build-screen-data-entry-model`. Requires
// DATABASE_URL.
//
// Asserts that the existing patient_screenings field shape can carry the
// refined Build-screen data entry without a schema change:
//   1. Patient Name / DOB / Insurance / Phone round-trip via
//      storage.updatePatientScreening.
//   2. Dx (diagnoses) / Hx (history) / Rx (medications) round-trip.
//   3. Structured "Previous Tests" rows serialize into the existing
//      patient_screenings.previousTests text field, the most-recent date
//      lands in patient_screenings.previousTestsDate, and the round-trip
//      is parseable back into the same structured row set.
//   4. Build-screen data entry alone does NOT create execution cases or
//      scheduler_assigned journey events (commit_status stays Draft so
//      the canonical spine is untouched until Final Schedule handoff).
//
// Real patients are never modified — scope is the seeded TestVisit
// Patient (is_test=true) reset to Draft for the duration of this test.

import { and, count, eq } from "drizzle-orm";

const TEST_VISIT_NAME = "TestVisit Patient";
const TEST_VISIT_DOB = "02/02/1950";

type Assertion = { name: string; pass: boolean; detail: string };

function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${symbol}  ${name} — ${detail}`);
}

function ymdToMdy(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

type StructuredRow = {
  testType: string;
  date: string; // YYYY-MM-DD
  source: "Plexus" | "HGA" | "Other";
  notes?: string;
};

function serializeRows(rows: StructuredRow[]): string {
  return rows
    .map((r) => {
      const base = `${r.testType} on ${ymdToMdy(r.date)} (${r.source})`;
      return r.notes && r.notes.trim() ? `${base} — ${r.notes.trim()}` : base;
    })
    .join("; ");
}

function parseRows(text: string): StructuredRow[] {
  const out: StructuredRow[] = [];
  for (const seg of (text || "").split(/\s*;\s*/).filter(Boolean)) {
    const m = /^(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*\(\s*(Plexus|HGA|Other)\s*\)(?:\s*[—\-]\s*(.+))?$/.exec(
      seg,
    );
    if (!m) continue;
    const mdyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(m[2]);
    if (!mdyMatch) continue;
    const ymd = `${mdyMatch[3]}-${mdyMatch[1].padStart(2, "0")}-${mdyMatch[2].padStart(2, "0")}`;
    out.push({
      testType: m[1].trim(),
      date: ymd,
      source: m[3] as StructuredRow["source"],
      notes: (m[4] || "").trim() || undefined,
    });
  }
  return out;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:build-screen-data-entry-model] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { storage } = await import("../server/storage");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import(
    "@shared/schema/executionCase"
  );

  const assertions: Assertion[] = [];
  let exitCode = 0;

  let priorPatient: any = null;

  try {
    const [seed] = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, TEST_VISIT_NAME),
          eq(patientScreenings.dob, TEST_VISIT_DOB),
          eq(patientScreenings.isTest, true),
        ),
      )
      .limit(1);
    if (!seed) {
      console.error(
        "[test:build-screen-data-entry-model] seed missing — run `npm run seed:visit-flow` first",
      );
      process.exit(1);
    }
    priorPatient = seed;
    const psid = seed.id;
    console.log(`[test:build-screen-data-entry-model] psid=${psid}`);

    async function ecCount(): Promise<number> {
      const rows = await db
        .select({ n: count() })
        .from(patientExecutionCases)
        .where(eq(patientExecutionCases.patientScreeningId, psid));
      return rows[0]?.n ?? 0;
    }

    async function schedulerAssignedCount(): Promise<number> {
      const rows = await db
        .select({ n: count() })
        .from(patientJourneyEvents)
        .where(
          and(
            eq(patientJourneyEvents.patientScreeningId, psid),
            eq(patientJourneyEvents.eventType, "scheduler_assigned"),
          ),
        );
      return rows[0]?.n ?? 0;
    }

    const ecBefore = await ecCount();
    const saBefore = await schedulerAssignedCount();
    console.log(`[before] ec=${ecBefore} scheduler_assigned=${saBefore}`);

    // ── 1. Patient Name / DOB / Insurance / Phone round-trip ─────────────
    const newName = "TestVisit Patient";
    const newDob = "02/02/1950";
    const newInsurance = "PPO";
    const newPhone = "555-0100";
    await storage.updatePatientScreening(psid, {
      name: newName,
      dob: newDob,
      insurance: newInsurance,
      phoneNumber: newPhone,
    });
    let refreshed = await storage.getPatientScreening(psid);
    record(
      assertions,
      "1 · Patient Name round-trips",
      refreshed?.name === newName,
      `name=${refreshed?.name ?? "null"}`,
    );
    record(
      assertions,
      "2 · DOB round-trips",
      refreshed?.dob === newDob,
      `dob=${refreshed?.dob ?? "null"}`,
    );
    record(
      assertions,
      "3 · Insurance round-trips",
      refreshed?.insurance === newInsurance,
      `insurance=${refreshed?.insurance ?? "null"}`,
    );
    record(
      assertions,
      "4 · Phone round-trips",
      refreshed?.phoneNumber === newPhone,
      `phoneNumber=${refreshed?.phoneNumber ?? "null"}`,
    );

    // ── 2. Dx / Hx / Rx round-trip ───────────────────────────────────────
    const newDx = "HTN, DM2, HLD";
    const newHx = "CAD, CVA";
    const newRx = "Metformin, Lisinopril";
    await storage.updatePatientScreening(psid, {
      diagnoses: newDx,
      history: newHx,
      medications: newRx,
    });
    refreshed = await storage.getPatientScreening(psid);
    record(
      assertions,
      "5 · Dx round-trips",
      refreshed?.diagnoses === newDx,
      `diagnoses=${refreshed?.diagnoses ?? "null"}`,
    );
    record(
      assertions,
      "6 · Hx round-trips",
      refreshed?.history === newHx,
      `history=${refreshed?.history ?? "null"}`,
    );
    record(
      assertions,
      "7 · Rx round-trips",
      refreshed?.medications === newRx,
      `medications=${refreshed?.medications ?? "null"}`,
    );

    // ── 3. Structured Previous Tests serialize/round-trip ────────────────
    const structured: StructuredRow[] = [
      { testType: "BrainWave", date: "2024-04-01", source: "Plexus" },
      { testType: "Echocardiogram", date: "2023-06-15", source: "HGA", notes: "Normal study" },
      { testType: "Carotid Duplex", date: "2023-01-20", source: "Other" },
    ];
    const serialized = serializeRows(structured);
    const expectedLatest = "2024-04-01";
    await storage.updatePatientScreening(psid, {
      previousTests: serialized,
      previousTestsDate: expectedLatest,
      noPreviousTests: false,
    });
    refreshed = await storage.getPatientScreening(psid);
    record(
      assertions,
      "8 · Previous Tests serialized text round-trips through previousTests field",
      refreshed?.previousTests === serialized,
      `previousTests length=${refreshed?.previousTests?.length ?? 0}`,
    );
    record(
      assertions,
      "9 · Most-recent previousTestsDate stored",
      refreshed?.previousTestsDate === expectedLatest,
      `previousTestsDate=${refreshed?.previousTestsDate ?? "null"} expected=${expectedLatest}`,
    );

    const reparsed = parseRows(refreshed?.previousTests || "");
    const sameCount = reparsed.length === structured.length;
    const sameContent =
      sameCount &&
      structured.every((s, i) => {
        const r = reparsed[i];
        return (
          r &&
          r.testType === s.testType &&
          r.date === s.date &&
          r.source === s.source &&
          (r.notes ?? "") === (s.notes ?? "")
        );
      });
    record(
      assertions,
      "10 · Serialized text re-parses into the same structured row set",
      sameContent,
      `parsedCount=${reparsed.length} expectedCount=${structured.length}`,
    );

    // ── 4. Build-screen entry must not create canonical spine rows ───────
    const ecAfter = await ecCount();
    const saAfter = await schedulerAssignedCount();
    record(
      assertions,
      "11 · Build entry does NOT add execution_case rows",
      ecAfter === ecBefore,
      `before=${ecBefore} after=${ecAfter}`,
    );
    record(
      assertions,
      "12 · Build entry does NOT add scheduler_assigned journey events",
      saAfter === saBefore,
      `before=${saBefore} after=${saAfter}`,
    );

    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  patientScreeningId           = ${psid}`);
    console.log(`  previousTests rows after run = ${reparsed.length}`);
    console.log(`  previousTestsDate            = ${refreshed?.previousTestsDate ?? "null"}`);
    console.log(`  ec count b/after             = ${ecBefore}/${ecAfter}`);
    console.log(`  scheduler_assigned b/after   = ${saBefore}/${saAfter}`);
    console.log(`  assertions                   = passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:build-screen-data-entry-model] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:build-screen-data-entry-model] OK");
    }
  } catch (err: any) {
    console.error("[test:build-screen-data-entry-model] unexpected failure:", err);
    exitCode = 1;
  } finally {
    // Best-effort restore of the seed fields the test mutated so a
    // subsequent qa:canonical-visual-state run sees the original shape.
    if (priorPatient) {
      try {
        const { storage } = await import("../server/storage");
        await storage.updatePatientScreening(priorPatient.id, {
          name: priorPatient.name,
          dob: priorPatient.dob,
          insurance: priorPatient.insurance ?? null,
          phoneNumber: priorPatient.phoneNumber ?? null,
          diagnoses: priorPatient.diagnoses ?? null,
          history: priorPatient.history ?? null,
          medications: priorPatient.medications ?? null,
          previousTests: priorPatient.previousTests ?? null,
          previousTestsDate: priorPatient.previousTestsDate ?? null,
          noPreviousTests: priorPatient.noPreviousTests ?? false,
        });
      } catch (restoreErr: any) {
        console.error(
          "[test:build-screen-data-entry-model] seed restore failed (non-fatal):",
          restoreErr.message,
        );
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 750));
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main();
