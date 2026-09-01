// Acceptance runner — Order Note AI standard, ALL services.
//
// Invokes the REAL path (canonical evidence assembly → OpenAI Responses API
// generation → deterministic compliance validation → 5-section render) for a
// set of existing development-DB cases and prints, per case: case info, the
// evidence actually used, the COMPLETE generated Order Note, AI/audit info, and
// automated acceptance checks. Also computes a cross-case near-duplicate
// similarity flag (advisory only). Contains NO hardcoded clinical narratives.
//
// The OpenAI key is read ONLY from the environment (AI_INTEGRATIONS_OPENAI_API_KEY
// or OPENAI_API_KEY). If absent, the runner STOPS honestly with
// OPENAI_API_KEY_NOT_CONFIGURED and generates nothing.
//
// Usage:
//   DATABASE_URL=... AI_INTEGRATIONS_OPENAI_API_KEY=... \
//   ORDER_NOTE_AI_MODEL=gpt-5.6-sol ORDER_NOTE_AI_REASONING_EFFORT=medium \
//   npx tsx script/acceptanceOrderNoteAi.ts [caseId ...]

import { assembleOrderNoteEvidenceBundle, orderNoteEvidenceBundleFingerprint, type OrderNoteEvidenceBundle } from "../server/services/ancillaryDocuments/orderNoteEvidenceBundle";
import { validateOrderNoteNarrative, complianceFeedback } from "../server/services/ancillaryDocuments/orderNoteComplianceValidator";
import { renderAiOrderNoteBody } from "../server/services/ancillaryDocuments/orderNoteBody";
// NOTE: the OpenAI narrative module (which constructs the OpenAI client at load
// and requires a key) is imported DYNAMICALLY inside main(), AFTER the key
// check — so a missing key yields OPENAI_API_KEY_NOT_CONFIGURED, not a crash.
type GenerateFn = (bundle: OrderNoteEvidenceBundle, opts?: { correctiveFeedback?: string }) => Promise<{ narrative: { clinicalHistoryIndication: string; assessmentMedicalNecessity: string }; modelUsed: string; reasoningEffort: string; promptVersion: string; rawResponse: string }>;

const DEFAULT_CASES: Array<{ id: number; label: string }> = [
  { id: 31, label: "BrainWave" },
  { id: 6, label: "VitalWave" },
  { id: 3, label: "Echocardiogram TTE" },
  { id: 2, label: "Bilateral Carotid Duplex" },
  { id: 5, label: "Lower Extremity Arterial Doppler" },
  { id: 10, label: "Lower Extremity Venous Duplex" },
  { id: 12, label: "Renal Artery Doppler" },
];
const CLINIC_ID = Number(process.env.ACCEPT_CLINIC_ID || "1");
const MAX_RETRIES = 2;

function hasKey(): boolean {
  return !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
}
function jaccard(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

type GenOutcome =
  | { ok: true; narrative: { clinicalHistoryIndication: string; assessmentMedicalNecessity: string }; model: string; effort: string; promptVersion: string; raw: string; retryCount: number; validation: ReturnType<typeof validateOrderNoteNarrative> }
  | { ok: false; reason: string; retryCount: number; lastFailures?: string[] };

async function generateValidated(bundle: OrderNoteEvidenceBundle, generateFn: GenerateFn): Promise<GenOutcome> {
  let feedback: string | undefined;
  let lastFailures: string[] = [];
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let r;
    try {
      r = await generateFn(bundle, feedback ? { correctiveFeedback: feedback } : undefined);
    } catch (e: any) {
      return { ok: false, reason: `openai_error: ${String(e?.message ?? e).slice(0, 160)}`, retryCount: attempt };
    }
    const v = validateOrderNoteNarrative(r.narrative, bundle);
    if (v.passed) return { ok: true, narrative: r.narrative, model: r.modelUsed, effort: r.reasoningEffort, promptVersion: r.promptVersion, raw: r.rawResponse, retryCount: attempt, validation: v };
    lastFailures = v.failures.map((f) => `${f.code}: ${f.message}`);
    feedback = complianceFeedback(v.failures);
  }
  return { ok: false, reason: "compliance_failed_after_retries", retryCount: MAX_RETRIES, lastFailures };
}

function sampleList(arr: Array<{ displayText: string }>, n = 6): string {
  if (!arr.length) return "    (none)";
  return arr.slice(0, n).map((f) => `    • ${f.displayText}`).join("\n") + (arr.length > n ? `\n    … (+${arr.length - n} more)` : "");
}

function autoChecks(bundle: OrderNoteEvidenceBundle, rendered: { text: string }, narrative: { clinicalHistoryIndication: string; assessmentMedicalNecessity: string }, v: ReturnType<typeof validateOrderNoteNarrative>): Array<{ name: string; pass: boolean; detail?: string }> {
  const codes = new Set(v.failures.map((f) => f.code));
  const fullText = rendered.text;
  const firstName = bundle.patient.name.split(/\s+/)[0];
  const orderedInPlan = bundle.orderedComponents.every((c) => fullText.includes(c.label));
  return [
    { name: "patient name present", pass: !codes.has("patient_name_absent") && fullText.includes(firstName) },
    { name: "service label present", pass: fullText.includes(bundle.serviceLabel) },
    { name: "ordered components reflected in ORDER/PLAN", pass: orderedInPlan },
    { name: "no unordered component discussed", pass: !codes.has("unordered_component") },
    { name: "no ICD-10 (full note)", pass: !/\b[A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/.test(fullText) },
    { name: "no CPT (full note)", pass: !/\b\d{5}\b/.test(fullText) },
    { name: "no procedure-completion language", pass: !codes.has("completion_language") },
    { name: "no invented results", pass: !codes.has("results_language") },
    { name: "no invented signature", pass: !codes.has("signature_fabrication") },
    { name: "patient-reported certainty preserved", pass: !codes.has("certainty_upgrade") },
    { name: "prior-imaging claims traceable", pass: !codes.has("imaging_untraceable") },
    { name: "lab claims traceable", pass: !codes.has("lab_untraceable") },
    { name: "vital claims traceable", pass: !codes.has("vital_untraceable") },
    { name: "History vs Assessment not duplicative", pass: !codes.has("section_duplication") },
    { name: "not generic boilerplate", pass: !codes.has("generic_boilerplate") },
  ];
}

async function main() {
  console.log("================ ORDER NOTE AI ACCEPTANCE RUNNER ================");
  if (!hasKey()) {
    console.log("OPENAI_API_KEY_NOT_CONFIGURED");
    console.log("Set AI_INTEGRATIONS_OPENAI_API_KEY (or OPENAI_API_KEY) to run. No output generated (no fake notes).");
    process.exit(0);
  }
  // Safe to import now that a key is present.
  const { generateOrderNoteNarrative, orderNoteAiModel, orderNoteAiReasoningEffort } =
    await import("../server/services/ancillaryDocuments/orderNoteNarrativeAi");
  console.log(`model=${orderNoteAiModel()} reasoningEffort=${orderNoteAiReasoningEffort()} clinic=${CLINIC_ID}`);

  const argIds = process.argv.slice(2).map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const cases = argIds.length ? argIds.map((id) => ({ id, label: `case ${id}` })) : DEFAULT_CASES;

  const assessments: Array<{ id: number; patient: string; text: string }> = [];

  for (const c of cases) {
    console.log(`\n\n################################################################`);
    console.log(`# CASE ${c.id} — ${c.label}`);
    console.log(`################################################################`);
    const bundle = await assembleOrderNoteEvidenceBundle({ clinicId: CLINIC_ID, ancillaryCaseId: c.id });
    if (!bundle) { console.log("  (no bundle — case not found / cross-clinic)"); continue; }
    const bundleFp = orderNoteEvidenceBundleFingerprint(bundle);

    console.log(`\n== CASE INFORMATION ==`);
    console.log(`  Patient: ${bundle.patient.name}   Age: ${bundle.patient.age ?? "?"}`);
    console.log(`  Ancillary Case ID: ${c.id}   Clinic: ${bundle.patient.clinicName ?? CLINIC_ID}`);
    console.log(`  Service: ${bundle.service} (${bundle.serviceLabel})`);
    console.log(`  Ordered components: ${bundle.orderedComponents.map((x) => x.label).join("; ")}`);

    console.log(`\n== EVIDENCE SUMMARY ==`);
    console.log(`  DX used:\n${sampleList(bundle.diagnoses)}`);
    console.log(`  HX used:\n${sampleList(bundle.history)}`);
    console.log(`  RX/medications used:\n${sampleList(bundle.medications)}`);
    console.log(`  Labs used:\n${sampleList(bundle.labs)}`);
    console.log(`  Vitals used:\n${sampleList(bundle.vitals)}`);
    console.log(`  Prior imaging used:\n${sampleList(bundle.priorImaging)}`);
    console.log(`  Clinical encounters used:\n${sampleList(bundle.clinicalNotes)}`);
    console.log(`  Clinician findings used:\n${sampleList(bundle.clinicianFindings)}`);
    console.log(`  Structured screening used: ${bundle.structuredScreening ? `${bundle.structuredScreening.findings.length} positive(s), version ${bundle.structuredScreening.version}` : "(none — non-BW/VW)"}`);
    console.log(`  Qualification evidence: factors=[${bundle.qualification.factors.join("; ")}]`);

    const gen = await generateValidated(bundle, generateOrderNoteNarrative as GenerateFn);
    if (!gen.ok) {
      console.log(`\n== GENERATED ORDER NOTE ==`);
      console.log(`  GENERATION STATUS: FAILED (${gen.reason})`);
      if (gen.lastFailures?.length) console.log(`  compliance failures:\n    - ${gen.lastFailures.join("\n    - ")}`);
      console.log(`  (fail-closed: no note persisted, not routed for signature)`);
      continue;
    }
    const rendered = renderAiOrderNoteBody(bundle, gen.narrative);
    assessments.push({ id: c.id, patient: bundle.patient.name, text: gen.narrative.assessmentMedicalNecessity });

    console.log(`\n== GENERATED ORDER NOTE (complete, as persisted) ==\n`);
    console.log(rendered.text);

    console.log(`\n== AI / AUDIT INFORMATION ==`);
    console.log(`  Model actually used: ${gen.model}`);
    console.log(`  Reasoning effort: ${gen.effort}`);
    console.log(`  Prompt version: ${gen.promptVersion}`);
    console.log(`  Evidence bundle fingerprint: ${bundleFp}`);
    console.log(`  Order Note evidence fingerprint: ${bundleFp}`);
    console.log(`  Compliance validation: ${gen.validation.passed ? "PASSED" : "FAILED"}`);
    console.log(`  Retry count: ${gen.retryCount}`);
    console.log(`  Generation status: generated`);

    console.log(`\n== AUTOMATED ACCEPTANCE CHECKS ==`);
    let allPass = true;
    for (const chk of autoChecks(bundle, rendered, gen.narrative, gen.validation)) {
      if (!chk.pass) allPass = false;
      console.log(`  [${chk.pass ? "PASS" : "FAIL"}] ${chk.name}${chk.detail ? ` — ${chk.detail}` : ""}`);
    }
    console.log(`  => ${allPass ? "ALL CHECKS PASSED" : "ONE OR MORE CHECKS FAILED"}`);
  }

  // Cross-case near-duplicate flag (advisory only — NOT a clinical-quality score).
  console.log(`\n\n== CROSS-CASE UNIQUENESS (advisory) ==`);
  if (assessments.length < 2) {
    console.log("  (need >=2 generated notes to compare)");
  } else {
    const THRESH = 0.7;
    let flagged = 0;
    for (let i = 0; i < assessments.length; i++) {
      for (let j = i + 1; j < assessments.length; j++) {
        const sim = jaccard(assessments[i].text, assessments[j].text);
        const mark = sim >= THRESH ? "  <== SUSPICIOUS NEAR-DUPLICATE (review)" : "";
        if (sim >= THRESH) flagged++;
        console.log(`  case ${assessments[i].id} vs case ${assessments[j].id}: similarity=${sim.toFixed(2)}${mark}`);
      }
    }
    console.log(`  ${flagged} pair(s) flagged for human review (advisory only; not a quality judgment).`);
  }
  console.log(`\n================ END ================`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("RUNNER ERROR:", e?.message ?? e); process.exit(1); });
