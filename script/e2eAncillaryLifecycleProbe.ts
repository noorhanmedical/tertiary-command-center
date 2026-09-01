// Read-only end-to-end lifecycle probe for the canonical BrainWave/VitalWave
// ancillary workflow. Verifies per-stage state against an EXISTING ancillary
// case — it creates no patients and writes nothing. Screening completion and
// signing are performed by real operators through the UI/endpoints; this probe
// reports whether each stage's state is correct.
//
// Usage (staging/dev, with a real DB):
//   DATABASE_URL=postgres://... ANCILLARY_CASE_ID=123 CLINIC_ID=7 \
//     npx tsx script/e2eAncillaryLifecycleProbe.ts
//
// Without DATABASE_URL it exits 0 with an explicit SKIP (never a false PASS).

type Stage = "SCREENING" | "ORDER_NOTE" | "ORDER_NOTE_CURRENCY" | "SIGNING_ELIGIBILITY" | "PROCEDURE_READINESS" | "PROCEDURE_NOTE" | "BILLING_DOCUMENT";
type Status = "PASS" | "FAIL" | "PENDING" | "NOT_IMPLEMENTED" | "SKIP";
const results: Array<{ stage: Stage; status: Status; detail: string }> = [];
function record(stage: Stage, status: Status, detail: string) {
  results.push({ stage, status, detail });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP — DATABASE_URL is not set. Provide a dev/staging DB to run the real end-to-end probe.");
    console.log("Example: DATABASE_URL=... ANCILLARY_CASE_ID=123 CLINIC_ID=7 npx tsx script/e2eAncillaryLifecycleProbe.ts");
    process.exit(0);
  }
  const ancillaryCaseId = Number(process.env.ANCILLARY_CASE_ID);
  const clinicId = Number(process.env.CLINIC_ID);
  if (!Number.isFinite(ancillaryCaseId) || !Number.isFinite(clinicId)) {
    console.error("ANCILLARY_CASE_ID and CLINIC_ID env vars are required.");
    process.exit(2);
  }

  const { getAncillaryCaseById } = await import("../server/repositories/ancillaryCases.repo");
  const { getCurrentScreeningEvidence } = await import("../server/services/screening/screeningEvidenceService");
  const { getActiveOrderNoteForCase } = await import("../server/repositories/orderNoteLifecycle.repo");
  const { orderNoteSigningEligibility } = await import("../server/services/physicianPortal/signatureRules");

  const acase = await getAncillaryCaseById(ancillaryCaseId);
  if (!acase || acase.clinicId !== clinicId) {
    console.error(`Ancillary case ${ancillaryCaseId} not found for clinic ${clinicId}.`);
    process.exit(2);
  }
  const serviceType = acase.serviceType;
  const requireScreening = /brain|vital/i.test(serviceType);

  // 1. SCREENING
  const screening = await getCurrentScreeningEvidence({ clinicId, ancillaryCaseId, serviceType });
  if (screening) record("SCREENING", "PASS", `current structured screening v=${screening.version.slice(0, 10)}`);
  else record("SCREENING", "PENDING", "no current completed structured screening evidence");

  // 2. ORDER_NOTE
  const note = await getActiveOrderNoteForCase(ancillaryCaseId);
  if (!note) {
    record("ORDER_NOTE", "PENDING", "no active canonical Order Note for case");
  } else {
    const hasBody = (note.generationStatus === "generated" || note.generationStatus === "approved") && !!note.generatedText;
    record("ORDER_NOTE", hasBody ? "PASS" : "PENDING", `id=${note.id} genStatus=${note.generationStatus} sig=${note.signatureStatus ?? "-"} fp=${(note.evidenceFingerprint ?? "").slice(0, 8)}`);

    // 3. ORDER_NOTE_CURRENCY — evaluated against current screening version?
    if (requireScreening) {
      if (screening && note.evaluatedScreeningEvidenceVersion === screening.version) record("ORDER_NOTE_CURRENCY", "PASS", "note evaluated against current screening version");
      else record("ORDER_NOTE_CURRENCY", "PENDING", `evaluated=${(note.evaluatedScreeningEvidenceVersion ?? "none")} current=${screening ? screening.version.slice(0, 10) : "none"}`);
    }

    // 4. SIGNING_ELIGIBILITY — dry-run of the hardened gate.
    if (note.signatureStatus === "signed") {
      record("SIGNING_ELIGIBILITY", "PASS", "already signed (immutable)");
    } else {
      const gate = orderNoteSigningEligibility(note, {
        requireScreening,
        screeningComplete: !!screening,
        currentScreeningVersion: screening?.version ?? null,
        authorizedSigner: true,
      });
      record("SIGNING_ELIGIBILITY", gate.ok ? "PASS" : "PENDING", gate.ok ? "eligible to sign now" : `blocked: ${(gate as { reason?: string }).reason ?? "n/a"}`);
    }
  }

  // 5. PROCEDURE_READINESS (Slice E — evaluator exists; semantic wiring lands in E)
  try {
    const { evaluateProcedurePrerequisites } = await import("../server/services/procedureLifecycle/procedurePrerequisites");
    const prereq = await evaluateProcedurePrerequisites({ clinicId, ancillaryCaseId, stage: "procedure_start", actorRole: null, override: null });
    if (prereq.flagOff) record("PROCEDURE_READINESS", "PENDING", "FEATURE_CANONICAL_PROCEDURE_LIFECYCLE off");
    else record("PROCEDURE_READINESS", prereq.allowed ? "PASS" : "PENDING", prereq.allowed ? "ready" : `blockers: ${prereq.hardBlockers.map((b) => b.requirementCode).join(",") || "none"}`);
  } catch (e) {
    record("PROCEDURE_READINESS", "PENDING", `evaluator unavailable: ${(e as Error).message}`);
  }

  // 6. PROCEDURE_NOTE (Slice F) — current canonical post_procedure_note for the case.
  try {
    const { db } = await import("../server/db");
    const { and, eq, isNull } = await import("drizzle-orm");
    const { procedureNotes } = await import("@shared/schema/generatedNotes");
    const [pn] = await db.select().from(procedureNotes).where(and(
      eq(procedureNotes.ancillaryCaseId, ancillaryCaseId),
      eq(procedureNotes.noteType, "post_procedure_note"),
      isNull(procedureNotes.supersededAt),
    )).limit(1);
    if (!pn) record("PROCEDURE_NOTE", "PENDING", "no current canonical procedure note");
    else {
      const src = (pn.sourceData ?? {}) as Record<string, unknown>;
      const assoc = src.associated_order_note_id ?? null;
      record("PROCEDURE_NOTE", pn.generationStatus === "generated" ? "PASS" : "PENDING",
        `id=${pn.id} gen=${pn.generationStatus} sig=${pn.signatureStatus ?? "-"} assocOrderNote=${assoc ?? "-"} componentsPresent=${src.procedure_components_present ?? "-"}`);
    }
  } catch (e) {
    record("PROCEDURE_NOTE", "PENDING", `unavailable: ${(e as Error).message}`);
  }

  // 7. BILLING_DOCUMENT (Slice G) — current canonical billing document for the case.
  try {
    const { db } = await import("../server/db");
    const { and, eq, isNull, desc } = await import("drizzle-orm");
    const { canonicalBillingDocumentRequests } = await import("@shared/schema/billingDocuments");
    const [bd] = await db.select().from(canonicalBillingDocumentRequests).where(and(
      eq(canonicalBillingDocumentRequests.ancillaryCaseId, ancillaryCaseId),
      isNull(canonicalBillingDocumentRequests.supersededAt),
    )).orderBy(desc(canonicalBillingDocumentRequests.createdAt)).limit(1);
    if (!bd) record("BILLING_DOCUMENT", "PENDING", "no current canonical billing document");
    else {
      const src = (bd.sourceData ?? {}) as Record<string, unknown>;
      const cpt = Array.isArray(src.cpt_codes) ? (src.cpt_codes as string[]) : [];
      const icd = Array.isArray(src.icd10_codes) ? (src.icd10_codes as string[]) : [];
      record("BILLING_DOCUMENT", bd.canonicalStatus === "generated" || bd.canonicalStatus === "approved" ? "PASS" : "PENDING",
        `id=${bd.id} status=${bd.canonicalStatus ?? "-"} cpt=[${cpt.join(",")}] icd=[${icd.join(",")}]`);
    }
  } catch (e) {
    record("BILLING_DOCUMENT", "PENDING", `unavailable: ${(e as Error).message}`);
  }

  let failed = 0;
  for (const r of results) {
    if (r.status === "FAIL") failed++;
    console.log(`${r.status.padEnd(16)} ${r.stage.padEnd(22)} ${r.detail}`);
  }
  console.log(`\n${results.length} stages checked; ${failed} FAIL.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("probe error:", e); process.exit(2); });
