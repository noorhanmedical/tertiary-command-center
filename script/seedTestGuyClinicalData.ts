// TestGuy Robot — canonical clinical reference data seed.
// Run with `npm run seed:testguy-clinical`. Requires DATABASE_URL.
//
// Populates the six canonical clinical domains (providers, allergies, labs,
// imaging, vitals, encounters) for the TestGuy Robot patient so the Patient
// EHR chart renders REAL DB-backed rows instead of the client-side demo
// enrichment. Resolves the patient by name (case-insensitive "testguy robot")
// and seeds every matching screening row, so whichever screening the chart
// loads by is populated. Idempotent — uses replace* (delete-then-insert per
// screening) so re-running never duplicates.

import { ilike, or } from "drizzle-orm";

const NAME_VARIANTS = ["testguy robot", "test guy robot"];

type LabRow = [name: string, value: string, unit: string, ref: string, flag: string];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:testguy-clinical] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const repo = await import("../server/repositories/clinicalData.repo");

  let exitCode = 0;
  try {
    const screenings = await db
      .select()
      .from(patientScreenings)
      .where(or(...NAME_VARIANTS.map((n) => ilike(patientScreenings.name, n))));

    if (screenings.length === 0) {
      console.error("[seed:testguy-clinical] no TestGuy Robot screening found — nothing to seed");
      await pool.end();
      process.exit(1);
    }

    for (const s of screenings) {
      const screeningId = s.id;
      const base = {
        clinicId: s.clinicId ?? null,
        patientScreeningId: screeningId,
        patientName: s.name,
        patientDob: s.dob ?? null,
      };
      console.log(`[seed:testguy-clinical] seeding screening id=${screeningId} (${s.name} dob=${s.dob})`);

      // ── Providers ──────────────────────────────────────────────────────
      const providers = [
        { name: "Sarah Chen, NP", role: "Primary Care (PCP)", facility: "eClinicalWorks PCP", providerType: "pcp" },
        { name: "Dr. Ali Imran, MD", role: "Ordering · Internal Medicine", facility: "Plexus Clinic", providerType: "ordering" },
        { name: "Dr. Ayman Alhadheri, MD", role: "Referring · Cardiology", facility: "Plexus Cardiology", providerType: "referring" },
        { name: "Dr. Ali Imran, MD", role: "Signing Clinician", facility: "Plexus Clinic", providerType: "signing" },
        { name: "Plexus Imaging Center", role: "Interpreting Entity", facility: "Phoenix, AZ", providerType: "interpreting" },
      ].map((p, i) => ({ ...base, ...p, source: "eCW", sortOrder: i }));
      const nProviders = await repo.replaceProviders(screeningId, providers as any);

      // ── Allergies ──────────────────────────────────────────────────────
      const allergies = [
        { substance: "Penicillin", reaction: "Hives", severity: "Moderate" },
        { substance: "Sulfa drugs", reaction: "Rash", severity: "Mild" },
        { substance: "Iodinated contrast", reaction: "Nausea", severity: "Mild" },
      ].map((a, i) => ({ ...base, ...a, source: "eCW", sortOrder: i }));
      const nAllergies = await repo.replaceAllergies(screeningId, allergies as any);

      // ── Labs (CBC / CMP / Lipid / A1c) ──────────────────────────────────
      const labs: any[] = [];
      let labOrder = 0;
      const pushPanel = (panel: string, date: string, arr: LabRow[]) => {
        for (const [name, value, unit, ref, flag] of arr) {
          labs.push({ ...base, panel, name, value, unit, referenceRange: ref, collectedAt: date, flag, source: "eCW", sortOrder: labOrder++ });
        }
      };
      const cbc: LabRow[] = [
        ["WBC", "6.8", "10^3/uL", "3.4-10.8", "normal"],
        ["RBC", "4.62", "10^6/uL", "4.14-5.80", "normal"],
        ["Hemoglobin", "13.9", "g/dL", "13.0-17.7", "normal"],
        ["Hematocrit", "41.2", "%", "37.5-51.0", "normal"],
        ["MCV", "89", "fL", "79-97", "normal"],
        ["MCH", "30.1", "pg", "26.6-33.0", "normal"],
        ["MCHC", "33.8", "g/dL", "31.5-35.7", "normal"],
        ["RDW", "13.5", "%", "11.6-15.4", "normal"],
        ["Platelets", "245", "10^3/uL", "150-379", "normal"],
        ["Neutrophils", "60", "%", "40-74", "normal"],
        ["Lymphocytes", "30", "%", "14-46", "normal"],
      ];
      const cmp: LabRow[] = [
        ["Glucose", "156", "mg/dL", "70-99", "high"],
        ["BUN", "22", "mg/dL", "7-25", "normal"],
        ["Creatinine", "1.3", "mg/dL", "0.6-1.3", "high"],
        ["eGFR", "58", "mL/min", ">=60", "low"],
        ["Sodium", "139", "mmol/L", "134-144", "normal"],
        ["Potassium", "4.4", "mmol/L", "3.5-5.2", "normal"],
        ["Chloride", "102", "mmol/L", "96-106", "normal"],
        ["CO2", "26", "mmol/L", "20-29", "normal"],
        ["Calcium", "9.4", "mg/dL", "8.7-10.2", "normal"],
        ["Total Protein", "7.1", "g/dL", "6.0-8.3", "normal"],
        ["Albumin", "4.2", "g/dL", "3.5-5.5", "normal"],
        ["Globulin", "2.9", "g/dL", "1.9-3.7", "normal"],
        ["Bilirubin, Total", "0.7", "mg/dL", "0.2-1.2", "normal"],
        ["Alk Phosphatase", "88", "U/L", "39-117", "normal"],
        ["AST", "26", "U/L", "0-40", "normal"],
        ["ALT", "30", "U/L", "0-44", "normal"],
      ];
      const lipid: LabRow[] = [
        ["Total Cholesterol", "214", "mg/dL", "<200", "high"],
        ["LDL Cholesterol", "142", "mg/dL", "<100", "high"],
        ["HDL Cholesterol", "44", "mg/dL", ">=40", "normal"],
        ["Triglycerides", "168", "mg/dL", "<150", "high"],
      ];
      pushPanel("CBC", "2026-06-10", cbc);
      pushPanel("CBC", "2026-01-15", cbc);
      pushPanel("CMP", "2026-06-10", cmp);
      pushPanel("CMP", "2026-01-15", cmp);
      pushPanel("Lipid Panel", "2026-06-10", lipid);
      pushPanel("Lipid Panel", "2025-06-02", lipid);
      const a1c: Array<[string, string]> = [
        ["2026-06-10", "7.8"], ["2025-12-05", "7.5"], ["2025-06-02", "7.9"], ["2024-12-01", "8.1"], ["2024-06-03", "8.4"],
      ];
      for (const [date, val] of a1c) {
        labs.push({ ...base, panel: "Hemoglobin A1c", name: "Hemoglobin A1c", value: val, unit: "%", referenceRange: "4.0-5.6", collectedAt: date, flag: "high", source: "eCW", sortOrder: labOrder++ });
      }
      const nLabs = await repo.replaceLabs(screeningId, labs);

      // ── Imaging ─────────────────────────────────────────────────────────
      const imaging = [
        { study: "Carotid Duplex Ultrasound", modality: "US", performedAt: "2025-11-12", status: "Final", impression: "<50% stenosis bilaterally. Stable vs prior.", reportAvailable: true, serviceType: "Bilateral Carotid Duplex" },
        { study: "Transthoracic Echocardiogram", modality: "US", performedAt: "2025-08-25", status: "Final", impression: "EF 55%. Mild concentric LVH. Trace MR.", reportAvailable: true, serviceType: "Echocardiogram TTE" },
        { study: "Chest X-ray, 2 views", modality: "XR", performedAt: "2026-05-01", status: "Final", impression: "Mild cardiomegaly. No acute infiltrate.", reportAvailable: true, serviceType: null },
        { study: "Renal Artery Duplex", modality: "US", performedAt: "2025-06-08", status: "Final", impression: "No hemodynamically significant renal artery stenosis.", reportAvailable: true, serviceType: "Renal Artery Doppler" },
        { study: "Lower Extremity Arterial Doppler", modality: "US", performedAt: "2025-09-19", status: "Final", impression: "Moderate PAD; reduced distal flow on the left.", reportAvailable: true, serviceType: "Lower Extremity Arterial Doppler" },
      ].map((im, i) => ({ ...base, ...im, source: "eCW", sortOrder: i }));
      const nImaging = await repo.replaceImaging(screeningId, imaging as any);

      // ── Vitals ──────────────────────────────────────────────────────────
      const visits: Array<{ date: string; bp: string; hr: string; rr: string; spo2: string; temp: string; wt: string; bmi: string }> = [
        { date: "2026-06-10", bp: "148/92", hr: "82", rr: "16", spo2: "97", temp: "98.6", wt: "210", bmi: "31.4" },
        { date: "2026-05-01", bp: "150/94", hr: "80", rr: "18", spo2: "96", temp: "98.4", wt: "211", bmi: "31.6" },
        { date: "2026-01-15", bp: "146/90", hr: "78", rr: "16", spo2: "98", temp: "98.5", wt: "213", bmi: "31.8" },
        { date: "2025-08-25", bp: "152/94", hr: "84", rr: "18", spo2: "96", temp: "98.7", wt: "215", bmi: "32.1" },
        { date: "2025-06-08", bp: "150/92", hr: "80", rr: "16", spo2: "97", temp: "98.5", wt: "214", bmi: "32.0" },
        { date: "2025-03-10", bp: "149/91", hr: "79", rr: "16", spo2: "97", temp: "98.6", wt: "216", bmi: "32.2" },
        { date: "2024-12-01", bp: "154/96", hr: "86", rr: "18", spo2: "95", temp: "98.8", wt: "218", bmi: "32.6" },
        { date: "2024-06-03", bp: "151/93", hr: "82", rr: "16", spo2: "97", temp: "98.5", wt: "217", bmi: "32.4" },
      ];
      const vitals: any[] = [];
      let vOrder = 0;
      for (const v of visits) {
        const set: Array<[string, string, string]> = [
          ["Blood Pressure", v.bp, "mmHg"],
          ["Heart Rate", v.hr, "bpm"],
          ["Resp Rate", v.rr, "/min"],
          ["SpO2", v.spo2, "%"],
          ["Temp", v.temp, "F"],
          ["Weight", v.wt, "lb"],
          ["BMI", v.bmi, "kg/m2"],
        ];
        for (const [label, value, unit] of set) {
          vitals.push({ ...base, label, value, unit, measuredAt: v.date, source: "eCW", sortOrder: vOrder++ });
        }
      }
      const nVitals = await repo.replaceVitals(screeningId, vitals);

      // ── Encounters ──────────────────────────────────────────────────────
      const baseEncounters = [
        { title: "Telephone encounter - leg swelling", kind: "Telephone Note", category: "telephone", occurredAt: "2026-07-01", provider: "Sarah Chen, NP", summary: "Patient called re: bilateral leg swelling. Advised elevation; venous duplex ordered.", noteBody: "SUBJECTIVE: Patient reports 1 week of bilateral lower-extremity swelling, worse at end of day, improves overnight. Denies chest pain, dyspnea, calf tenderness.\n\nASSESSMENT: Bilateral lower-extremity edema, likely venous insufficiency. Rule out DVT.\n\nPLAN: Ordered bilateral lower extremity venous duplex. Advised leg elevation and compression. Return precautions given.", tags: null },
        { title: "Follow-up: HTN & DM management", kind: "Progress Note", category: "primary_care", occurredAt: "2026-06-10", provider: "Dr. Ali Imran, MD", summary: "BP suboptimal at 148/92. A1c 7.8. Reinforced adherence; ordered ancillary surveillance.", noteBody: "SUBJECTIVE: Here for routine follow-up of hypertension and type 2 diabetes. Reports intermittent numbness/tingling in both feet. Adherent to medications.\n\nOBJECTIVE: BP 148/92, HR 82, BMI 31.4. A1c 7.8%. LDL 142.\n\nASSESSMENT: 1) Essential hypertension, suboptimally controlled. 2) T2DM with peripheral neuropathy. 3) Hyperlipidemia.\n\nPLAN: Reinforced medication adherence and lifestyle. Ordered ancillary surveillance testing (BrainWave, VitalWave, vascular studies). Continue current regimen; recheck 3 months.", tags: ["Used in Qualification"] },
        { title: "Chest X-ray review", kind: "Radiology Note", category: "specialist", occurredAt: "2026-05-01", provider: "Plexus Imaging", summary: "Mild cardiomegaly; no acute infiltrate. Recommend echocardiogram correlation.", noteBody: "INDICATION: Exertional dyspnea.\n\nFINDINGS: Mild cardiomegaly. Lungs clear without infiltrate or effusion. No acute osseous abnormality.\n\nIMPRESSION: Mild cardiomegaly. Recommend echocardiographic correlation.", tags: null },
        { title: "Annual physical exam", kind: "Progress Note", category: "primary_care", occurredAt: "2026-01-15", provider: "Sarah Chen, NP", summary: "Comprehensive exam. Labs ordered. Counseled on weight and diet. Vaccinations current.", noteBody: "SUBJECTIVE: Annual wellness visit. No acute complaints. Reviewed chronic conditions.\n\nOBJECTIVE: Comprehensive exam performed. BP 146/90, BMI 31.8.\n\nPLAN: Ordered CBC, CMP, lipid panel, A1c. Counseled on weight management and diet. Immunizations up to date.", tags: null },
        { title: "Cardiology consultation", kind: "Consult Note", category: "specialist", occurredAt: "2025-08-25", provider: "Dr. Ayman Alhadheri, MD", summary: "Exertional dyspnea. Echo shows mild LVH, EF 55%. Continue antihypertensives.", noteBody: "REASON FOR CONSULT: Exertional dyspnea, hypertension.\n\nFINDINGS: TTE shows EF 55%, mild concentric LVH, trace mitral regurgitation. No wall-motion abnormality.\n\nIMPRESSION: Hypertensive heart disease with mild LVH. Preserved systolic function.\n\nPLAN: Continue antihypertensives; optimize BP control. Consider stress testing if symptoms progress.", tags: ["Used in Qualification"] },
        { title: "Nephrology follow-up", kind: "Consult Note", category: "specialist", occurredAt: "2025-06-08", provider: "Dr. Ali Imran, MD", summary: "CKD stage 3 stable. eGFR 58. Renal duplex negative for stenosis. Continue ACE inhibitor.", noteBody: "SUBJECTIVE: Follow-up CKD stage 3. No new symptoms.\n\nOBJECTIVE: eGFR 58, stable. Renal artery duplex negative for significant stenosis.\n\nPLAN: Continue ACE inhibitor. Monitor renal function q3 months. Avoid nephrotoxins.", tags: null },
        { title: "Diabetes management visit", kind: "Progress Note", category: "primary_care", occurredAt: "2025-05-02", provider: "Sarah Chen, NP", summary: "A1c 7.9. Adjusted metformin. Reviewed foot care; neuropathy stable.", noteBody: "SUBJECTIVE: Diabetes follow-up. Reports stable neuropathy symptoms.\n\nOBJECTIVE: A1c 7.9%. Monofilament exam reduced sensation bilaterally.\n\nPLAN: Increased metformin. Reviewed diabetic foot care. Continue gabapentin.", tags: null },
        { title: "ED visit - chest pain", kind: "Hospital Note", category: "hospital", occurredAt: "2025-03-18", provider: "Valley Medical ED", summary: "Atypical chest pain. Troponin negative. Discharged with cardiology follow-up.", noteBody: "CHIEF COMPLAINT: Chest pain.\n\nED COURSE: Atypical chest pain. Serial troponins negative. ECG without acute ischemic changes. Pain resolved.\n\nDISPOSITION: Discharged home in stable condition with outpatient cardiology follow-up.", tags: null },
        { title: "Telephone encounter - med refill", kind: "Telephone Note", category: "telephone", occurredAt: "2025-02-11", provider: "Sarah Chen, NP", summary: "Refilled lisinopril and atorvastatin. No new complaints.", noteBody: "Patient called for medication refills. Refilled lisinopril 20mg and atorvastatin 40mg. No new complaints. No red-flag symptoms.", tags: null },
        { title: "Neurology consultation", kind: "Consult Note", category: "specialist", occurredAt: "2025-01-20", provider: "Dr. R. Patel, MD", summary: "Migraine with peripheral neuropathy. Started gabapentin. BrainWave testing discussed.", noteBody: "REASON FOR CONSULT: Headache and peripheral neuropathy.\n\nFINDINGS: History consistent with migraine. Distal sensory neuropathy on exam, consistent with diabetic etiology.\n\nPLAN: Started gabapentin 300mg TID. Discussed autonomic/neurocognitive (BrainWave) testing. Follow up 3 months.", tags: ["Used in Qualification"] },
        { title: "Annual wellness visit", kind: "Progress Note", category: "primary_care", occurredAt: "2024-12-01", provider: "Sarah Chen, NP", summary: "Wellness visit. BP elevated. Lifestyle counseling. Labs ordered.", noteBody: "SUBJECTIVE: Medicare annual wellness visit. No acute complaints.\n\nOBJECTIVE: BP 154/96, BMI 32.6.\n\nPLAN: Lifestyle counseling. Ordered fasting labs. Reinforced home BP monitoring.", tags: null },
        { title: "Podiatry - diabetic foot exam", kind: "Consult Note", category: "specialist", occurredAt: "2024-09-15", provider: "Dr. L. Nguyen, DPM", summary: "Diabetic foot screen. Reduced sensation bilaterally. PAD workup recommended.", noteBody: "REASON: Diabetic foot screening.\n\nFINDINGS: Reduced protective sensation bilaterally. Diminished distal pulses on the left. Skin intact.\n\nPLAN: Recommend lower-extremity arterial workup. Diabetic footwear. Routine foot surveillance.", tags: null },
        { title: "Follow-up: hypertension", kind: "Progress Note", category: "primary_care", occurredAt: "2024-06-03", provider: "Sarah Chen, NP", summary: "BP 151/93. Added amlodipine. Discussed cardiovascular risk.", noteBody: "SUBJECTIVE: Hypertension follow-up.\n\nOBJECTIVE: BP 151/93 despite lisinopril.\n\nPLAN: Added amlodipine 5mg daily. Discussed cardiovascular risk reduction. Recheck 4 weeks.", tags: null },
        { title: "Telephone encounter - lab results", kind: "Telephone Note", category: "telephone", occurredAt: "2024-03-22", provider: "Sarah Chen, NP", summary: "Reviewed elevated LDL and A1c. Reinforced statin adherence.", noteBody: "Called patient to review labs: LDL 142, A1c 8.4%. Reinforced statin and metformin adherence. Discussed diet. Recheck in 3 months.", tags: null },
        { title: "Hospital discharge summary", kind: "Hospital Note", category: "hospital", occurredAt: "2024-02-05", provider: "Valley Medical", summary: "Admitted for hypertensive urgency. BP controlled on discharge. Outpatient follow-up arranged.", noteBody: "ADMISSION: Hypertensive urgency (BP 210/115).\n\nHOSPITAL COURSE: BP controlled with IV then oral agents. No end-organ damage. Ruled out for ACS.\n\nDISCHARGE: BP 148/88. Continue home regimen. Outpatient PCP follow-up in 1 week.", tags: null },
      ];
      // Scale generator: additional routine canonical encounters across years so
      // pagination / Load More / search / filter are exercised at real scale.
      const encGenProviders = ["Sarah Chen, NP", "Dr. Ali Imran, MD", "Dr. Ayman Alhadheri, MD", "Dr. R. Patel, MD", "Dr. L. Nguyen, DPM"];
      const encGenTemplates = [
        { title: "Routine follow-up", kind: "Progress Note", category: "primary_care", summary: "Chronic disease follow-up; medications reconciled.", body: "SUBJECTIVE: Routine follow-up. No acute complaints.\n\nOBJECTIVE: Vitals reviewed. Medications reconciled.\n\nPLAN: Continue current regimen; routine surveillance." },
        { title: "Telephone encounter", kind: "Telephone Note", category: "telephone", summary: "Phone check-in; no red-flag symptoms.", body: "Patient called with a routine question. No red-flag symptoms. Guidance provided; return precautions reviewed." },
        { title: "Lab results review", kind: "Progress Note", category: "primary_care", summary: "Reviewed interval labs; reinforced adherence.", body: "Reviewed interval laboratory results with the patient. Values stable. Reinforced medication and lifestyle adherence." },
        { title: "Medication refill", kind: "Telephone Note", category: "telephone", summary: "Refilled chronic medications.", body: "Chronic medications refilled. No new complaints. No interactions identified." },
        { title: "Specialist follow-up", kind: "Consult Note", category: "specialist", summary: "Interval specialist follow-up; stable.", body: "Interval follow-up. Condition stable. Continue current management. Follow up as scheduled." },
      ];
      const genEnc: any[] = [];
      let gi = 0;
      for (let year = 2019; year <= 2026; year++) {
        const months = year === 2026 ? [1, 2, 3, 4] : [1, 3, 5, 7, 9, 11, 12];
        for (const m of months) {
          for (let k = 0; k < 2; k++) {
            const t = encGenTemplates[gi % encGenTemplates.length];
            const day = 3 + ((gi * 7) % 24);
            const date = `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            genEnc.push({ title: t.title, kind: t.kind, category: t.category, occurredAt: date, provider: encGenProviders[gi % encGenProviders.length], summary: t.summary, noteBody: t.body, tags: null });
            gi++;
          }
        }
      }
      const encounters = [...baseEncounters, ...genEnc]
        .sort((a, b) => (b.occurredAt || "").localeCompare(a.occurredAt || ""))
        .map((e, i) => ({ ...base, ...e, source: "eCW", sortOrder: i }));
      const nEncounters = await repo.replaceEncounters(screeningId, encounters as any);

      console.log(`  providers=${nProviders} allergies=${nAllergies} labs=${nLabs} imaging=${nImaging} vitals=${nVitals} encounters=${nEncounters}`);
    }

    console.log("");
    console.log("[seed:testguy-clinical] OK — clinical reference domains seeded");
  } catch (err: any) {
    console.error("[seed:testguy-clinical] failed:", err);
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
  console.error("[seed:testguy-clinical] unexpected failure:", err);
  process.exit(1);
});
