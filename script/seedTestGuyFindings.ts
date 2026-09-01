// TestGuy Robot — canonical Plexus Data Signals seed.
// Run with `npm run seed:testguy-findings`. Requires DATABASE_URL.
//
// Seeds plexus_clinical_findings for the TestGuy Robot screening so the
// Plexus Data Signals section renders REAL AI-found clinical findings (with
// provenance) instead of the reasoning-derived fallback. Idempotent: deletes
// existing findings for the screening then re-inserts.

import { eq, ilike, or } from "drizzle-orm";

const NAME_VARIANTS = ["testguy robot", "test guy robot"];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:testguy-findings] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { plexusClinicalFindings } = await import("@shared/schema/plexusClinicalFindings");

  let exitCode = 0;
  try {
    const screenings = await db
      .select()
      .from(patientScreenings)
      .where(or(...NAME_VARIANTS.map((n) => ilike(patientScreenings.name, n))));

    if (screenings.length === 0) {
      console.error("[seed:testguy-findings] no TestGuy Robot screening found — nothing to seed");
      await pool.end();
      process.exit(1);
    }

    for (const s of screenings) {
      const base = { clinicId: s.clinicId ?? null, patientScreeningId: s.id, facilityId: s.facility ?? null, aiModel: "plexus-iq-v3" };

      // Idempotent: clear prior findings for this screening.
      await db.delete(plexusClinicalFindings).where(eq(plexusClinicalFindings.patientScreeningId, s.id));

      const findings = [
        { findingType: "diagnosis", displayName: "Type 2 diabetes mellitus with neuropathy", suggestedIcd10: "E11.42", sourceType: "diagnosis", sourceDate: "2026-06-10", sourceExcerpt: "Reports numbness/tingling both feet; monofilament exam reduced bilaterally.", confidence: "high", reviewStatus: "confirmed" },
        { findingType: "diagnosis", displayName: "Essential (primary) hypertension", suggestedIcd10: "I10", sourceType: "diagnosis", sourceDate: "2026-06-10", sourceExcerpt: "BP 148/92 despite lisinopril + amlodipine.", confidence: "high", reviewStatus: "confirmed" },
        { findingType: "diagnosis", displayName: "Hyperlipidemia, unspecified", suggestedIcd10: "E78.5", sourceType: "lab", sourceDate: "2026-06-10", sourceExcerpt: "LDL 142 mg/dL, total cholesterol 214 mg/dL.", confidence: "high", reviewStatus: "confirmed" },
        { findingType: "diagnosis", displayName: "Chronic kidney disease, stage 3", suggestedIcd10: "N18.3", sourceType: "lab", sourceDate: "2025-06-08", sourceExcerpt: "eGFR 58 mL/min, stable.", confidence: "medium", reviewStatus: "ai_found" },
        { findingType: "lab_abnormality", displayName: "Elevated Hemoglobin A1c (7.8%)", suggestedIcd10: null, sourceType: "lab", sourceDate: "2026-06-10", sourceValue: "7.8 %", sourceExcerpt: "A1c 7.8% (ref 4.0-5.6). Trend: 8.4 -> 8.1 -> 7.9 -> 7.5 -> 7.8.", confidence: "high", reviewStatus: "confirmed" },
        { findingType: "lab_abnormality", displayName: "Elevated LDL cholesterol (142 mg/dL)", suggestedIcd10: null, sourceType: "lab", sourceDate: "2026-06-10", sourceValue: "142 mg/dL", sourceExcerpt: "LDL 142 mg/dL (goal <100).", confidence: "high", reviewStatus: "ai_found" },
        { findingType: "lab_abnormality", displayName: "Reduced eGFR (58 mL/min)", suggestedIcd10: null, sourceType: "lab", sourceDate: "2026-06-10", sourceValue: "58 mL/min", sourceExcerpt: "eGFR 58 (ref >=60); creatinine 1.3 mg/dL.", confidence: "medium", reviewStatus: "ai_found" },
        { findingType: "imaging_finding", displayName: "Mild concentric LVH on echocardiogram", suggestedIcd10: "I51.7", sourceType: "imaging", sourceDate: "2025-08-25", sourceExcerpt: "TTE: EF 55%, mild concentric LVH, trace MR.", confidence: "high", reviewStatus: "confirmed" },
        { findingType: "imaging_finding", displayName: "Bilateral carotid plaque, <50% stenosis", suggestedIcd10: "I65.29", sourceType: "imaging", sourceDate: "2025-11-12", sourceExcerpt: "Carotid duplex: <50% stenosis bilaterally, stable vs prior.", confidence: "high", reviewStatus: "confirmed" },
        { findingType: "imaging_finding", displayName: "Moderate peripheral arterial disease (left)", suggestedIcd10: "I73.9", sourceType: "imaging", sourceDate: "2025-09-19", sourceExcerpt: "LE arterial Doppler: moderate PAD, reduced distal flow on the left.", confidence: "medium", reviewStatus: "ai_found" },
        { findingType: "symptom", displayName: "Exertional dyspnea", suggestedIcd10: "R06.00", sourceType: "encounter", sourceDate: "2025-08-25", sourceExcerpt: "Cardiology consult for exertional dyspnea.", confidence: "medium", reviewStatus: "ai_found" },
        { findingType: "symptom", displayName: "Peripheral neuropathy (numbness/tingling)", suggestedIcd10: "G62.9", sourceType: "encounter", sourceDate: "2025-01-20", sourceExcerpt: "Neurology: distal sensory neuropathy, diabetic etiology.", confidence: "high", reviewStatus: "confirmed" },
        { findingType: "medication_signal", displayName: "Gabapentin therapy (neuropathic pain)", suggestedIcd10: null, sourceType: "medication", sourceDate: "2025-01-20", sourceValue: "Gabapentin 300 mg TID", sourceExcerpt: "Started gabapentin for diabetic neuropathy.", confidence: "high", reviewStatus: "ai_found" },
        { findingType: "history", displayName: "Former tobacco use", suggestedIcd10: "Z87.891", sourceType: "note", sourceDate: "2024-09-15", sourceExcerpt: "Former smoker; relevant to PAD risk.", confidence: "medium", reviewStatus: "ai_found" },
      ].map((f) => ({ ...base, ...f }));

      await db.insert(plexusClinicalFindings).values(findings as any);
      console.log(`[seed:testguy-findings] screening id=${s.id}: seeded ${findings.length} findings`);
    }

    console.log("[seed:testguy-findings] OK — Plexus Data Signals seeded");
  } catch (err: any) {
    console.error("[seed:testguy-findings] failed:", err);
    exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[seed:testguy-findings] unexpected failure:", err);
  process.exit(1);
});
