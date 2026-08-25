// QA patient matrix (A–H) — lightweight canonical seeds that prove the Plexus
// EHR renders correctly for patients OTHER than TestGuy, across varied data
// shapes, using the SAME canonical code paths (no client-side special-casing).
// Run with `npm run seed:qa-matrix`. Requires DATABASE_URL.
//
// Each patient is a real patient_screenings row. Qualified patients are
// committed through the canonical execution-case repo (which also creates the
// per-service ancillary cases via syncAncillaryCasesFromScreening), exactly as
// a real committed patient would be — so serviceEpisodes / Admin Review / the
// Journey all project from canonical rows.
//
//   A  Qa Alice Minimal      — minimal MANUAL entry, not committed, no services
//   B  Qa Bob Fullscale      — full EHR-import scale (3 services + encounters)
//   C  Qa Carol Noqualify    — IQ ran, ZERO qualifying services
//   D  Qa Dave Onequalified  — exactly ONE qualifying service
//   E  Qa Erin Repeat        — one service + REPEATED prior-episode history
//   F  Qa Frank Match        — manual entry MATCHED to an EHR record (blended)
//   G  Qa Grace Perms        — standard multi-service patient for permission QA
//   H  Qa Henry Incomplete   — incomplete / IQ-failure problem data
//
// Idempotent: patients dedupe on (name, batchId); dependent rows use the
// delete-then-insert repo helpers so re-running never duplicates.

import { and, eq, desc, ilike, or } from "drizzle-orm";

const BATCH_NAME = "QA Matrix Batch";
const FACILITY = "QA Facility";

type Reasoning = Record<string, unknown>;
function reason(clinician: string, talking: string, factors: string[], confidence = "high"): Reasoning {
  return {
    clinician_understanding: clinician,
    patient_talking_points: talking,
    qualifying_factors: factors,
    confidence,
    icd10_codes: [],
    pearls: [],
    approvalRequired: false,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:qa-matrix] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { clinics } = await import("@shared/schema/clinics");
  const { screeningBatches, patientScreenings } = await import("@shared/schema/screening");
  const { patientTestHistory } = await import("@shared/schema/patientHistory");
  const { createOrUpdateExecutionCaseFromScreening } = await import("../server/repositories/executionCase.repo");
  const { resolveAndLinkPlexusIdentityForScreening } = await import("../server/services/plexusIdentity/screeningIntegration");
  const repo = await import("../server/repositories/clinicalData.repo");

  let exitCode = 0;
  try {
    // Resolve a clinic (default to id 1, matching the other seeds).
    const [clinic] = await db.select().from(clinics).orderBy(desc(clinics.id)).limit(1);
    const clinicId = clinic?.id ?? 1;

    // ── Batch (idempotent by name + isTest) ──────────────────────────────
    const [existingBatch] = await db.select().from(screeningBatches)
      .where(and(eq(screeningBatches.name, BATCH_NAME), eq(screeningBatches.isTest, true)))
      .orderBy(desc(screeningBatches.id)).limit(1);
    let batchId: number;
    if (existingBatch) {
      batchId = existingBatch.id;
    } else {
      const [created] = await db.insert(screeningBatches).values({
        clinicId, name: BATCH_NAME, facility: FACILITY, status: "draft", patientCount: 8, isTest: true,
      }).returning();
      batchId = created.id;
    }

    type Scenario = {
      key: string;
      name: string;
      fields: Record<string, unknown>;
      commit: boolean;
    };

    const now = new Date();
    const scenarios: Scenario[] = [
      {
        key: "A",
        name: "Qa Alice Minimal",
        commit: false,
        fields: {
          dob: "1955-04-12", gender: "Female", phoneNumber: "(602) 555-0201",
          insurance: "Medicare", patientType: "outreach", status: "pending",
          commitStatus: "Draft", qualifyingTests: [], reasoning: {},
        },
      },
      {
        key: "B",
        name: "Qa Bob Fullscale",
        commit: true,
        fields: {
          dob: "1948-09-30", gender: "Male", phoneNumber: "(602) 555-0202",
          email: "qa.bob@example.com", insurance: "Medicare", patientType: "visit",
          status: "completed",
          diagnoses: "Hypertension, Type 2 Diabetes Mellitus, Hyperlipidemia, Peripheral Neuropathy",
          medications: "Metformin, Lisinopril, Atorvastatin",
          qualifyingTests: ["BrainWave", "VitalWave", "Bilateral Carotid Duplex"],
          reasoning: {
            BrainWave: reason("T2DM with peripheral neuropathy.", "A quick, painless nerve check.", ["Type 2 diabetes", "Peripheral neuropathy"]),
            VitalWave: reason("Multiple CV risk factors.", "A simple circulation check.", ["Hypertension", "Hyperlipidemia"]),
            "Bilateral Carotid Duplex": reason("Vascular risk; stroke prevention.", "An ultrasound of the neck arteries.", ["Hypertension", "Hyperlipidemia"]),
          },
        },
      },
      {
        key: "C",
        name: "Qa Carol Noqualify",
        commit: true,
        fields: {
          dob: "1970-01-05", gender: "Female", phoneNumber: "(602) 555-0203",
          insurance: "PPO", patientType: "visit", status: "completed",
          diagnoses: "Seasonal allergies",
          qualifyingTests: [], reasoning: {},
          notes: "Plexus IQ analysis completed — no ancillary services qualified.",
        },
      },
      {
        key: "D",
        name: "Qa Dave Onequalified",
        commit: true,
        fields: {
          dob: "1962-11-22", gender: "Male", phoneNumber: "(602) 555-0204",
          insurance: "Medicare", patientType: "visit", status: "completed",
          diagnoses: "Hypertension, Hyperlipidemia",
          qualifyingTests: ["VitalWave"],
          reasoning: { VitalWave: reason("HTN + hyperlipidemia.", "A simple circulation and heart-rhythm check.", ["Hypertension", "Hyperlipidemia"]) },
        },
      },
      {
        key: "E",
        name: "Qa Erin Repeat",
        commit: true,
        fields: {
          dob: "1958-03-17", gender: "Female", phoneNumber: "(602) 555-0205",
          insurance: "Medicare", patientType: "visit", status: "completed",
          diagnoses: "Hypertension, Prior carotid disease",
          qualifyingTests: ["Bilateral Carotid Duplex"],
          reasoning: { "Bilateral Carotid Duplex": reason("Surveillance of known carotid disease.", "A follow-up ultrasound of the neck arteries.", ["Hypertension", "Prior carotid study"]) },
        },
      },
      {
        key: "F",
        name: "Qa Frank Match",
        commit: true,
        fields: {
          dob: "1965-07-08", gender: "Male", phoneNumber: "(602) 555-0206",
          email: "qa.frank@example.com", insurance: "Medicare Advantage", patientType: "visit",
          status: "completed",
          diagnoses: "Hypertension, Exertional dyspnea, CKD stage 3",
          medications: "Amlodipine, Furosemide",
          qualifyingTests: ["Echocardiogram TTE", "Renal Artery Doppler"],
          reasoning: {
            "Echocardiogram TTE": reason("HTN with exertional dyspnea.", "An ultrasound of your heart.", ["Hypertension", "Exertional dyspnea"]),
            "Renal Artery Doppler": reason("Resistant HTN with CKD.", "An ultrasound of kidney blood flow.", ["Resistant hypertension", "CKD stage 3"], "medium"),
          },
          notes: "Manual intake entry matched to an existing eClinicalWorks record; clinical data blended from the EHR.",
        },
      },
      {
        key: "G",
        name: "Qa Grace Perms",
        commit: true,
        fields: {
          dob: "1972-12-01", gender: "Female", phoneNumber: "(602) 555-0207",
          insurance: "PPO", patientType: "visit", status: "completed",
          diagnoses: "Type 2 Diabetes Mellitus, Peripheral Neuropathy, Migraine",
          medications: "Metformin, Gabapentin",
          qualifyingTests: ["VitalWave", "BrainWave"],
          reasoning: {
            VitalWave: reason("Diabetes with vascular risk.", "A simple circulation check.", ["Type 2 diabetes"]),
            BrainWave: reason("Diabetic neuropathy + migraine.", "A painless nerve/brain check.", ["Peripheral neuropathy", "Migraine"]),
          },
        },
      },
      {
        key: "H",
        name: "Qa Henry Incomplete",
        commit: false,
        fields: {
          dob: null, gender: null, phoneNumber: null, insurance: null,
          patientType: "outreach", status: "error",
          diagnoses: null, medications: null, qualifyingTests: null,
          reasoning: { __analysisFailure: { category: "insufficient_data", reason: "No qualifying clinical data found in the imported record.", failedAt: now.toISOString() } },
          notes: "Incomplete import — missing DOB / demographics; Plexus IQ analysis could not run.",
        },
      },
    ];

    const idByKey: Record<string, number> = {};

    for (const sc of scenarios) {
      const base = {
        clinicId, batchId, facility: FACILITY, name: sc.name,
        appointmentStatus: "pending" as const,
        isTest: true,
        ...(sc.commit ? { commitStatus: "Ready" as const, committedAt: now } : {}),
        ...sc.fields,
      };

      const [existing] = await db.select().from(patientScreenings)
        .where(and(eq(patientScreenings.name, sc.name), eq(patientScreenings.batchId, batchId)))
        .orderBy(desc(patientScreenings.id)).limit(1);

      let screening;
      if (existing) {
        const [updated] = await db.update(patientScreenings)
          .set(base as never).where(eq(patientScreenings.id, existing.id)).returning();
        screening = updated;
      } else {
        const [created] = await db.insert(patientScreenings)
          .values(base as never).returning();
        screening = created;
      }
      idByKey[sc.key] = screening.id;
      const sid = screening.id;

      // Identity linkage — the SAME orchestrator every server-side screening
      // insert runs. Creates/reuses global_plexus_patients + patient_clinic_
      // memberships and back-links the FKs, which canonical ancillary-case
      // creation requires. Idempotent (resolver reuses on definitive match).
      await resolveAndLinkPlexusIdentityForScreening({
        screeningId: sid,
        clinicId,
        sourceSystem: "qa_matrix_seed",
        demographics: {
          displayName: sc.name,
          dob: (screening.dob ?? null) as string | null,
          phone: (screening.phoneNumber ?? null) as string | null,
          email: (screening.email ?? null) as string | null,
        },
      });
      // Re-fetch so the execution-case repo sees the linked identity FKs.
      const [linkedRow] = await db.select().from(patientScreenings).where(eq(patientScreenings.id, sid)).limit(1);
      const effective = linkedRow ?? screening;
      const cbase = { clinicId, patientScreeningId: sid, patientName: sc.name, patientDob: effective.dob ?? null };

      // Commit qualified patients through the canonical execution-case repo
      // (also creates per-service ancillary cases via syncScreeningAncillaryCases).
      // Unqualified committed patients (C) get an execution case with zero cases.
      if (sc.commit) {
        const { executionCase } = await createOrUpdateExecutionCaseFromScreening(effective, null);
        void executionCase;
      }

      // ── Scenario-specific canonical clinical rows (kept lightweight) ────
      // Default: clear any prior domain rows so re-runs are clean.
      await repo.replaceEncounters(sid, []);
      await repo.replaceVitals(sid, []);
      await repo.replaceLabs(sid, []);
      await repo.replaceProviders(sid, []);
      await db.delete(patientTestHistory).where(eq(patientTestHistory.patientScreeningId, sid));

      if (sc.key === "B") {
        // Full-scale: enough encounters to exercise pagination (Load More) on a
        // non-TestGuy patient, plus a few vitals/labs/providers.
        const kinds = ["Progress Note", "Telephone Note", "Consult Note"];
        const encounters = Array.from({ length: 26 }, (_, i) => {
          const yr = 2026 - Math.floor(i / 12);
          const mo = String((i % 12) + 1).padStart(2, "0");
          return {
            ...cbase, title: `Follow-up visit ${i + 1}`, kind: kinds[i % kinds.length],
            category: "primary_care", occurredAt: `${yr}-${mo}-05`, provider: "Dr. QA Provider, MD",
            summary: "Routine chronic-disease follow-up.", noteBody: "SUBJECTIVE: Stable.\n\nPLAN: Continue regimen.",
            source: "eCW", sortOrder: i,
          };
        });
        await repo.replaceEncounters(sid, encounters as never);
        await repo.replaceVitals(sid, [
          { ...cbase, label: "Blood Pressure", value: "146/90", unit: "mmHg", measuredAt: "2026-06-05", source: "eCW", sortOrder: 0 },
          { ...cbase, label: "Heart Rate", value: "78", unit: "bpm", measuredAt: "2026-06-05", source: "eCW", sortOrder: 1 },
          { ...cbase, label: "BMI", value: "30.2", unit: "kg/m2", measuredAt: "2026-06-05", source: "eCW", sortOrder: 2 },
        ] as never);
        await repo.replaceLabs(sid, [
          { ...cbase, panel: "Hemoglobin A1c", name: "Hemoglobin A1c", value: "7.4", unit: "%", referenceRange: "4.0-5.6", collectedAt: "2026-06-05", flag: "high", source: "eCW", sortOrder: 0 },
          { ...cbase, panel: "Lipid Panel", name: "LDL Cholesterol", value: "138", unit: "mg/dL", referenceRange: "<100", collectedAt: "2026-06-05", flag: "high", source: "eCW", sortOrder: 1 },
        ] as never);
        await repo.replaceProviders(sid, [
          { ...cbase, name: "Dr. QA Provider, MD", role: "Primary Care (PCP)", facility: "QA Clinic", providerType: "pcp", source: "eCW", sortOrder: 0 },
        ] as never);
      }

      if (sc.key === "E") {
        // Repeated-service history: 3 prior Carotid episodes so the Journey
        // "Previous Tests" + Notes "Previous Episodes" render across episodes.
        const svc = "Bilateral Carotid Duplex";
        const priors = [
          { dos: "2024-11-20", seq: 3, res: "Stable mild bilateral plaque." },
          { dos: "2023-11-14", seq: 2, res: "No significant stenosis." },
          { dos: "2022-11-09", seq: 1, res: "Normal study." },
        ];
        await db.insert(patientTestHistory).values(priors.map((p) => ({
          clinicId, patientName: sc.name, dob: screening.dob ?? null,
          testName: svc, serviceType: svc, dateOfService: p.dos, episodeSequence: p.seq,
          insuranceType: "medicare", clinic: "QA Clinic", resultSummary: p.res,
          reportAvailable: true, patientScreeningId: sid,
        })) as never);
      }

      if (sc.key === "F") {
        // Manual→EHR match: a small EHR-synced clinical layer on the manual row.
        await repo.replaceProviders(sid, [
          { ...cbase, name: "Dr. QA Cardiology, MD", role: "Referring · Cardiology", facility: "QA Cardiology", providerType: "referring", source: "eCW", sortOrder: 0 },
          { ...cbase, name: "Dr. QA Provider, MD", role: "Primary Care (PCP)", facility: "QA Clinic", providerType: "pcp", source: "eCW", sortOrder: 1 },
        ] as never);
        await repo.replaceEncounters(sid, [
          { ...cbase, title: "Cardiology consultation", kind: "Consult Note", category: "specialist", occurredAt: "2026-05-12", provider: "Dr. QA Cardiology, MD", summary: "Exertional dyspnea; TTE recommended.", noteBody: "IMPRESSION: Hypertensive heart disease. Recommend echocardiogram.", source: "eCW", sortOrder: 0 },
        ] as never);
      }

      if (sc.key === "G") {
        // Sensitive data present so permission-gated sections (labs) are a
        // meaningful hide/show target for non-clinical roles.
        await repo.replaceLabs(sid, [
          { ...cbase, panel: "Hemoglobin A1c", name: "Hemoglobin A1c", value: "8.0", unit: "%", referenceRange: "4.0-5.6", collectedAt: "2026-05-01", flag: "high", source: "eCW", sortOrder: 0 },
          { ...cbase, panel: "CMP", name: "Glucose", value: "162", unit: "mg/dL", referenceRange: "70-99", collectedAt: "2026-05-01", flag: "high", source: "eCW", sortOrder: 1 },
        ] as never);
      }

      console.log(`  ${sc.key}  ${sc.name.padEnd(20)} screeningId=${sid} committed=${sc.commit}`);
    }

    console.log(`[seed:qa-matrix] OK — 8 QA patients seeded in batch ${batchId}`);
    console.log(`  ids: ${Object.entries(idByKey).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  } catch (err: any) {
    console.error("[seed:qa-matrix] failed:", err);
    exitCode = 1;
  } finally {
    try { await pool.end(); } catch { /* noop */ }
  }
  process.exit(exitCode);
}

main().catch((err) => { console.error("[seed:qa-matrix] unexpected failure:", err); process.exit(1); });
