// TestGuy Robot — canonical profile seed (demographics + qualification
// reasoning + insurance + appointments). Run with `npm run seed:testguy-profile`.
//
// This moves the last of the previously client-injected (demoPatientData) data
// into canonical DB rows so TestGuy travels the SAME code paths as any patient:
//   • patient_screenings: gender/phone/email + reasoning JSON (7 services)
//   • insurance_eligibility_reviews: primary Medicare + AARP Medigap
//   • ancillary_appointments: BrainWave completed, Carotid scheduled
// Idempotent.

import { eq, ilike, or, desc } from "drizzle-orm";

const NAME_VARIANTS = ["testguy robot", "test guy robot"];

// Canonical qualification reasoning (patient_screenings.reasoning jsonb),
// keyed by service name. Shape = testReasoningSchema (snake_case).
const REASONING: Record<string, unknown> = {
  "BrainWave": {
    clinician_understanding: "Type 2 diabetes with peripheral neuropathy and migraine history. Autonomic/neurocognitive testing evaluates small-fiber involvement and cerebrovascular contribution.",
    patient_talking_points: "This quick, painless test checks how your nerves and brain are working so we can catch problems early.",
    confidence: "high", qualifying_factors: ["Type 2 diabetes mellitus", "Peripheral neuropathy", "Migraine", "Gabapentin therapy"],
    icd10_codes: ["E11.42", "G62.9", "G43.909"], pearls: ["Painless — no needles.", "Checks nerve and brain function in one visit."], approvalRequired: false,
  },
  "VitalWave": {
    clinician_understanding: "Multiple cardiovascular risk factors (HTN, hyperlipidemia, diabetes, obesity) support autonomic + ABI assessment for early CV/PAD disease.",
    patient_talking_points: "This test looks at your circulation and heart-related nerve signals. Simple and helps protect your heart.",
    confidence: "high", qualifying_factors: ["Hypertension", "Hyperlipidemia", "Type 2 diabetes", "Obesity (BMI 31.4)"],
    icd10_codes: ["I10", "E78.5", "E11.9", "E66.9"], pearls: ["Quick circulation and heart-rhythm check.", "No fasting, no needles."], approvalRequired: false,
  },
  "Bilateral Carotid Duplex": {
    clinician_understanding: "HTN, hyperlipidemia and diabetes with prior borderline carotid findings warrant surveillance carotid duplex for stenosis progression + stroke risk.",
    patient_talking_points: "An ultrasound of the neck arteries that supply the brain — no needles — to help lower stroke risk.",
    confidence: "high", qualifying_factors: ["Hypertension", "Hyperlipidemia", "Prior carotid study <50% stenosis"],
    icd10_codes: ["I10", "E78.5", "I65.29"], pearls: ["Ultrasound of the neck arteries.", "Helps prevent stroke."], approvalRequired: false,
  },
  "Echocardiogram TTE": {
    clinician_understanding: "Hypertension with mild LVH on prior echo and exertional dyspnea supports TTE to evaluate cardiac structure and function.",
    patient_talking_points: "An ultrasound of your heart showing pumping strength and valves — important given your blood pressure.",
    confidence: "high", qualifying_factors: ["Hypertension", "Prior mild LVH", "Exertional dyspnea"],
    icd10_codes: ["I10", "I51.7", "R06.00"], pearls: ["Ultrasound picture of your heart.", "No radiation, no needles."], approvalRequired: false,
  },
  "Renal Artery Doppler": {
    clinician_understanding: "Resistant hypertension with CKD stage 3 (eGFR 58) raises concern for renovascular disease; renal duplex evaluates renal perfusion.",
    patient_talking_points: "Because your blood pressure is hard to control and kidney numbers are down, this ultrasound checks blood flow to your kidneys.",
    confidence: "medium", qualifying_factors: ["Resistant hypertension", "CKD stage 3", "eGFR 58"],
    icd10_codes: ["I10", "N18.3"], pearls: ["Ultrasound of kidney blood flow.", "Looks for treatable BP causes."], approvalRequired: false,
  },
  "Lower Extremity Arterial Doppler": {
    clinician_understanding: "Diabetes with neuropathy, tobacco history and claudication-type leg pain support LE arterial duplex for PAD.",
    patient_talking_points: "Your leg pain and diabetes make it worth checking the arteries in your legs for narrowing.",
    confidence: "high", qualifying_factors: ["Type 2 diabetes", "Peripheral neuropathy", "Claudication", "Former smoker"],
    icd10_codes: ["E11.51", "I73.9", "G62.9"], pearls: ["Checks leg artery circulation.", "Helps protect against wounds."], approvalRequired: false,
  },
  "Lower Extremity Venous Duplex": {
    clinician_understanding: "Bilateral LE edema with varicose veins supports venous duplex to evaluate insufficiency and rule out DVT.",
    patient_talking_points: "This ultrasound checks the veins in your legs for clots or poor drainage to explain the swelling.",
    confidence: "medium", qualifying_factors: ["Bilateral leg edema", "Varicose veins", "Venous insufficiency"],
    icd10_codes: ["I87.2", "I83.90", "R60.0"], pearls: ["Checks leg veins for clots.", "Safe, painless ultrasound."], approvalRequired: false,
  },
};

async function main() {
  if (!process.env.DATABASE_URL) { console.error("[seed:profile] DATABASE_URL not set"); process.exit(1); }
  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { insuranceEligibilityReviews } = await import("@shared/schema/insuranceEligibility");
  const { ancillaryAppointments } = await import("@shared/schema/appointments");
  const { patientReferenceData } = await import("@shared/schema/patientHistory");

  let exitCode = 0;
  try {
    const [s] = await db.select().from(patientScreenings)
      .where(or(...NAME_VARIANTS.map((n) => ilike(patientScreenings.name, n))))
      .orderBy(desc(patientScreenings.id)).limit(1);
    if (!s) { console.error("[seed:profile] no TestGuy screening"); await pool.end(); process.exit(1); }

    // 1) Canonical demographics + reasoning on the screening row.
    await db.update(patientScreenings).set({
      gender: "Male",
      phoneNumber: "(602) 555-0142",
      email: "testguy.robot@example.com",
      reasoning: REASONING as any,
    }).where(eq(patientScreenings.id, s.id));
    console.log("  ✓ screening demographics + reasoning (7 services)");

    // 2) Insurance eligibility reviews (idempotent).
    await db.delete(insuranceEligibilityReviews).where(eq(insuranceEligibilityReviews.patientScreeningId, s.id));
    await db.insert(insuranceEligibilityReviews).values([
      { clinicId: s.clinicId ?? null, patientScreeningId: s.id, patientName: s.name, patientDob: s.dob ?? null, facilityId: s.facility ?? null, insuranceName: "Medicare", insuranceType: "medicare", eligibilityStatus: "preferred", approvalStatus: "approved", priorityClass: "preferred", note: "Verified via eligibility check.", reviewedAt: new Date("2026-06-01T12:00:00Z") },
      { clinicId: s.clinicId ?? null, patientScreeningId: s.id, patientName: s.name, patientDob: s.dob ?? null, facilityId: s.facility ?? null, insuranceName: "AARP Medigap", insuranceType: "supplement", eligibilityStatus: "allowed", approvalStatus: "approved", priorityClass: "secondary", note: "Secondary coverage.", reviewedAt: new Date("2026-06-01T12:00:00Z") },
    ] as any);
    console.log("  ✓ insurance eligibility reviews (2)");

    // 3) Appointments (idempotent): BrainWave completed, Carotid scheduled.
    await db.delete(ancillaryAppointments).where(eq(ancillaryAppointments.patientScreeningId, s.id));
    await db.insert(ancillaryAppointments).values([
      { clinicId: s.clinicId ?? null, patientScreeningId: s.id, patientName: s.name, facility: "Plexus Neuro", scheduledDate: "2026-08-15", scheduledTime: "11:00", testType: "BrainWave", status: "completed" },
      { clinicId: s.clinicId ?? null, patientScreeningId: s.id, patientName: s.name, facility: "Plexus Imaging", scheduledDate: "2026-08-29", scheduledTime: "09:30", testType: "Bilateral Carotid Duplex", status: "scheduled" },
    ] as any);
    console.log("  ✓ ancillary appointments (BrainWave completed, Carotid scheduled)");

    // 4) Canonical problem list + medications (patient_reference_data, matched
    //    by name → DirectoryProfile.clinical → Diagnoses/Medications sections).
    const diagnoses = [
      "I10 · Essential (primary) hypertension",
      "E11.42 · Type 2 diabetes mellitus with neuropathy",
      "E78.5 · Hyperlipidemia, unspecified",
      "N18.3 · Chronic kidney disease, stage 3",
      "E66.9 · Obesity, unspecified",
      "I73.9 · Peripheral vascular disease",
      "G43.909 · Migraine, unspecified",
    ].join("\n");
    const medications = [
      "Metformin 1000 mg BID",
      "Lisinopril 20 mg daily",
      "Atorvastatin 40 mg nightly",
      "Amlodipine 5 mg daily",
      "Gabapentin 300 mg TID",
      "Aspirin 81 mg daily",
    ].join("\n");
    const [existingRef] = await db.select().from(patientReferenceData)
      .where(ilike(patientReferenceData.patientName, s.name)).limit(1);
    if (existingRef) {
      await db.update(patientReferenceData).set({ diagnoses, medications, gender: "Male", age: "60", insurance: s.insurance ?? "Medicare" }).where(eq(patientReferenceData.id, existingRef.id));
    } else {
      await db.insert(patientReferenceData).values({ clinicId: s.clinicId ?? null, patientName: s.name, diagnoses, medications, gender: "Male", age: "60", insurance: s.insurance ?? "Medicare" } as any);
    }
    console.log("  ✓ patient_reference_data (diagnoses + medications)");

    console.log("[seed:profile] OK — canonical profile seeded for screening", s.id);
  } catch (err: any) {
    console.error("[seed:profile] failed:", err);
    exitCode = 1;
  } finally {
    try { await pool.end(); } catch { /* noop */ }
  }
  process.exit(exitCode);
}

main().catch((err) => { console.error("[seed:profile] unexpected failure:", err); process.exit(1); });
