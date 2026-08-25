// TestGuy Robot — canonical operational spine seed (notes + episodes + states).
// Run with `npm run seed:testguy-spine`. Requires DATABASE_URL.
//
// Makes TestGuy's seven ancillary services show DIFFERENT workflow states and
// populates the real canonical objects the Plexus Notes / Ancillary Journey
// render + open:
//   • Varies patient_ancillary_cases lifecycle/qualification/admin-review per service
//   • Seeds procedure_notes (order_note + post_procedure_note) with real
//     generated_text + varied signature states (Open shows the real note body)
//   • Seeds patient_test_history prior episodes (result summaries + report flags)
//     so "Previous Episodes / Previous Tests" render real prior performances
//
// Idempotent: deletes TestGuy's procedure_notes + linked test-history first.

import { eq, ilike, or, desc } from "drizzle-orm";

const NAME_VARIANTS = ["testguy robot", "test guy robot"];

type Sig = "signed" | "ready_to_sign" | "needs_signature";
type ServicePlan = {
  service: string;
  lifecycle: "new" | "active" | "on_hold" | "closed" | "cancelled" | "archived";
  qualification: "unscreened" | "qualified" | "not_qualified" | "pending_review";
  adminReview: "pending" | "approved" | "needs_info" | "rejected";
  orderNote?: { sig: Sig; date: string };
  procedureNote?: { sig: Sig; date: string };
  priors: Array<{ date: string; result: string; insurance: string }>;
};

const PLANS: ServicePlan[] = [
  {
    service: "BrainWave", lifecycle: "closed", qualification: "qualified", adminReview: "approved",
    orderNote: { sig: "signed", date: "2026-08-14" }, procedureNote: { sig: "signed", date: "2026-08-15" },
    priors: [
      { date: "2025-02-18", result: "Mild global slowing; no epileptiform activity.", insurance: "medicare" },
      { date: "2024-02-12", result: "Normal autonomic study.", insurance: "medicare" },
    ],
  },
  {
    service: "VitalWave", lifecycle: "active", qualification: "qualified", adminReview: "approved",
    orderNote: { sig: "signed", date: "2026-08-20" },
    priors: [
      { date: "2025-03-10", result: "Borderline ABI 0.92 on the right.", insurance: "medicare" },
      { date: "2024-03-05", result: "Normal autonomic indices.", insurance: "medicare" },
      { date: "2023-03-01", result: "Normal study.", insurance: "ppo" },
    ],
  },
  {
    service: "Bilateral Carotid Duplex", lifecycle: "active", qualification: "qualified", adminReview: "approved",
    orderNote: { sig: "signed", date: "2026-08-18" },
    priors: [
      { date: "2025-11-12", result: "Mild bilateral plaque; no significant stenosis.", insurance: "ppo" },
      { date: "2024-11-20", result: "Stable mild bilateral plaque.", insurance: "ppo" },
      { date: "2023-11-14", result: "No significant stenosis.", insurance: "ppo" },
    ],
  },
  {
    service: "Echocardiogram TTE", lifecycle: "active", qualification: "qualified", adminReview: "approved",
    orderNote: { sig: "ready_to_sign", date: "2026-08-22" },
    priors: [
      { date: "2025-08-25", result: "Normal LV systolic function; EF 60-65%; mild LVH.", insurance: "ppo" },
    ],
  },
  {
    service: "Renal Artery Doppler", lifecycle: "new", qualification: "pending_review", adminReview: "pending",
    priors: [],
  },
  {
    service: "Lower Extremity Arterial Doppler", lifecycle: "active", qualification: "qualified", adminReview: "approved",
    orderNote: { sig: "signed", date: "2026-08-19" },
    priors: [
      { date: "2025-09-19", result: "Moderate PAD; reduced distal flow on the left.", insurance: "ppo" },
      { date: "2024-09-15", result: "Mild PAD.", insurance: "ppo" },
    ],
  },
  {
    service: "Lower Extremity Venous Duplex", lifecycle: "active", qualification: "qualified", adminReview: "approved",
    orderNote: { sig: "needs_signature", date: "2026-08-24" },
    priors: [
      { date: "2025-10-06", result: "No evidence of DVT; competent valves.", insurance: "ppo" },
      { date: "2024-10-02", result: "No DVT.", insurance: "ppo" },
    ],
  },
];

function orderNoteText(service: string): string {
  return [
    `ANCILLARY ORDER NOTE — ${service}`,
    ``,
    `Ordering provider: Dr. Ali Imran, MD (Internal Medicine)`,
    `Indication: Clinical qualification confirmed via Plexus IQ review of the patient's diagnoses, medications, and prior results.`,
    ``,
    `The patient meets criteria for ${service}. Medical necessity is supported by the documented problem list and supporting clinical findings. Order reviewed and approved by admin.`,
    ``,
    `Instructions: Schedule ${service}; complete pre-test screening; verify insurance eligibility prior to date of service.`,
  ].join("\n");
}

function procedureNoteText(service: string): string {
  return [
    `POST-PROCEDURE NOTE — ${service}`,
    ``,
    `Performed by: Plexus Imaging Center`,
    `Interpreting clinician: Dr. Ali Imran, MD`,
    ``,
    `Procedure completed without complication. Findings documented in the final report. Results reviewed with the ordering provider and incorporated into the care plan.`,
    ``,
    `Impression: See attached report. Follow-up per protocol.`,
  ].join("\n");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:testguy-spine] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases } = await import("@shared/schema/executionCase");
  const { patientAncillaryCases } = await import("@shared/schema/ancillaryCases");
  const { procedureNotes } = await import("@shared/schema/generatedNotes");
  const { patientTestHistory } = await import("@shared/schema/patientHistory");
  const { ancillaryCaseAdminReviewEvents } = await import("@shared/schema/adminReviewEvents");
  const { inArray } = await import("drizzle-orm");

  let exitCode = 0;
  try {
    const [screening] = await db
      .select()
      .from(patientScreenings)
      .where(or(...NAME_VARIANTS.map((n) => ilike(patientScreenings.name, n))))
      .orderBy(desc(patientScreenings.id))
      .limit(1);

    if (!screening) {
      console.error("[seed:testguy-spine] no TestGuy Robot screening found");
      await pool.end();
      process.exit(1);
    }
    const screeningId = screening.id;

    const [execCase] = await db
      .select()
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.patientScreeningId, screeningId))
      .orderBy(desc(patientExecutionCases.id))
      .limit(1);
    const executionCaseId = execCase?.id ?? null;

    const cases = await db
      .select()
      .from(patientAncillaryCases)
      .where(eq(patientAncillaryCases.originatingScreeningId, screeningId));
    const caseByService = new Map(cases.map((c) => [c.serviceType, c]));

    console.log(`[seed:testguy-spine] screening id=${screeningId} execCase=${executionCaseId} ancillaryCases=${cases.length}`);

    // Idempotency: clear prior procedure_notes + linked test-history + review events.
    await db.delete(procedureNotes).where(eq(procedureNotes.patientScreeningId, screeningId));
    await db.delete(patientTestHistory).where(eq(patientTestHistory.patientScreeningId, screeningId));
    const caseIds = cases.map((c) => c.id);
    if (caseIds.length > 0) {
      await db.delete(ancillaryCaseAdminReviewEvents).where(inArray(ancillaryCaseAdminReviewEvents.ancillaryCaseId, caseIds));
    }

    let notesInserted = 0;
    let priorsInserted = 0;

    for (const plan of PLANS) {
      const ac = caseByService.get(plan.service) ?? null;

      // 1) Vary ancillary case state
      if (ac) {
        await db.update(patientAncillaryCases)
          .set({
            lifecycleStatus: plan.lifecycle,
            qualificationStatus: plan.qualification,
            adminReviewStatus: plan.adminReview,
            clinicallyCompletedAt: plan.procedureNote ? new Date(`${plan.procedureNote.date}T12:00:00Z`) : null,
            closedAt: plan.lifecycle === "closed" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(patientAncillaryCases.id, ac.id));

        // Consistent historical review event for approved services so the
        // Admin Review timeline shows real history (pending -> approved) that
        // agrees with the current case status.
        if (plan.adminReview === "approved") {
          await db.insert(ancillaryCaseAdminReviewEvents).values({
            ancillaryCaseId: ac.id,
            serviceType: plan.service,
            previousStatus: "pending",
            newStatus: "approved",
            reviewerUserId: null,
            reviewerRole: "plexus_internal_clinical_reviewer",
            effectiveClinicalDate: plan.orderNote?.date ?? null,
            rationale: "Clinical qualification confirmed; medical necessity met.",
            evidenceSnapshot: { serviceType: plan.service, seeded: true } as any,
            source: "manual",
          } as any);
        }
      }

      // 2) Order note (real content + signature state)
      if (plan.orderNote) {
        await db.insert(procedureNotes).values({
          clinicId: screening.clinicId ?? null,
          executionCaseId,
          patientScreeningId: screeningId,
          serviceType: plan.service,
          noteType: "order_note",
          generationStatus: "generated",
          generatedText: orderNoteText(plan.service),
          generatedByAi: true,
          sourceData: {},
          signatureStatus: plan.orderNote.sig,
          signedAt: plan.orderNote.sig === "signed" ? new Date(`${plan.orderNote.date}T16:42:00Z`) : null,
          ancillaryCaseId: ac?.id ?? null,
          effectiveClinicalDate: new Date(`${plan.orderNote.date}T12:00:00Z`),
        } as any);
        notesInserted++;
      }

      // 3) Procedure note (completed services)
      if (plan.procedureNote) {
        await db.insert(procedureNotes).values({
          clinicId: screening.clinicId ?? null,
          executionCaseId,
          patientScreeningId: screeningId,
          serviceType: plan.service,
          noteType: "post_procedure_note",
          generationStatus: "generated",
          generatedText: procedureNoteText(plan.service),
          generatedByAi: true,
          sourceData: {},
          signatureStatus: plan.procedureNote.sig,
          signedAt: plan.procedureNote.sig === "signed" ? new Date(`${plan.procedureNote.date}T17:10:00Z`) : null,
          ancillaryCaseId: ac?.id ?? null,
          effectiveClinicalDate: new Date(`${plan.procedureNote.date}T12:00:00Z`),
        } as any);
        notesInserted++;
      }

      // 4) Prior episodes (patient_test_history)
      let seq = plan.priors.length;
      for (const p of plan.priors) {
        await db.insert(patientTestHistory).values({
          clinicId: screening.clinicId ?? null,
          patientName: screening.name,
          dob: screening.dob ?? null,
          testName: plan.service,
          dateOfService: p.date,
          insuranceType: p.insurance,
          clinic: screening.facility ?? "NWPG",
          notes: null,
          serviceType: plan.service,
          episodeSequence: seq--,
          resultSummary: p.result,
          reportAvailable: true,
          patientScreeningId: screeningId,
          executionCaseId,
        } as any);
        priorsInserted++;
      }

      console.log(`  ${plan.service}: state=${plan.lifecycle}/${plan.qualification}/${plan.adminReview} orderNote=${plan.orderNote?.sig ?? "-"} procNote=${plan.procedureNote?.sig ?? "-"} priors=${plan.priors.length}`);
    }

    console.log("");
    console.log(`[seed:testguy-spine] OK — notes=${notesInserted} priorEpisodes=${priorsInserted}`);
  } catch (err: any) {
    console.error("[seed:testguy-spine] failed:", err);
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
  console.error("[seed:testguy-spine] unexpected failure:", err);
  process.exit(1);
});
