// Slice A1 — deterministic, patient-specific Order Note body renderer.
//
// Pure (no DB, no AI). Renders a focused clinical/order note from the
// projected evidence. Preserves evidence certainty by source/class and
// contains NO ICD-10 or CPT codes anywhere (visible or hidden).

import type {
  OrderNoteEvidenceBundle,
  ProjectedFinding,
} from "./orderNoteProjection";
import { narratedFindings, projectScreeningFindings } from "./orderNoteProjection";

export const ORDER_NOTE_GENERATOR_VERSION = "order_note_body_v1";

export type OrderNoteSection = { heading: string; body: string };
export type RenderedOrderNote = { sections: OrderNoteSection[]; text: string };

function firstName(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || full;
}

function joinList(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}

// Certainty-preserving phrasing. Patient-reported evidence is never rendered
// as a diagnosis; chart/clinician evidence is rendered as documented.
function phraseReported(f: ProjectedFinding): string {
  if (f.evidenceClass === "patient_reported_medication_use") return `taking ${f.displayText}`;
  return f.displayText; // display text already encodes "a history of ..." where appropriate
}

function serviceClinicalObjectives(service: string): string[] {
  const s = service.toLowerCase();
  if (s.includes("brain")) {
    return [
      "Obtain objective neurocognitive measures of memory, attention, and executive function.",
      "Characterize neurophysiologic function via EEG/ECG and evoked-potential testing.",
      "Correlate objective findings with the patient's documented clinical presentation.",
    ];
  }
  if (s.includes("vital")) {
    return [
      "Objectively assess autonomic (parasympathetic and sympathetic) function, including positional responses.",
      "Evaluate peripheral arterial physiology and cardiac rhythm.",
      "Correlate objective findings with the patient's documented clinical presentation.",
    ];
  }
  return ["Obtain objective testing to characterize the patient's documented clinical presentation."];
}

export function renderOrderNoteBody(bundle: OrderNoteEvidenceBundle): RenderedOrderNote {
  const name = bundle.patient.name;
  const fname = firstName(name);
  const narrated = narratedFindings(projectScreeningFindings(bundle));
  const reported = narrated.map(phraseReported);
  const chart = bundle.chartDiagnoses;

  const sections: OrderNoteSection[] = [];

  // PATIENT INFORMATION
  const info: string[] = [`Patient: ${name}`];
  if (bundle.patient.dob) info.push(`DOB: ${bundle.patient.dob}`);
  if (bundle.patient.mrn) info.push(`MRN: ${bundle.patient.mrn}`);
  if (bundle.patient.plexusId) info.push(`Plexus ID: ${bundle.patient.plexusId}`);
  if (bundle.patient.clinicName) info.push(`Clinic: ${bundle.patient.clinicName}`);
  info.push(`Ordering Clinician: ${bundle.orderingClinician.name}`);
  if (bundle.orderingClinician.npi) info.push(`NPI: ${bundle.orderingClinician.npi}`);
  if (bundle.orderDate) info.push(`Order Date: ${bundle.orderDate}`);
  sections.push({ heading: "PATIENT INFORMATION", body: info.join("\n") });

  // REASON FOR EVALUATION
  const chartText = chart.length
    ? `${fname}'s clinical history also includes ${joinList(chart.map((c) => c.displayText))}.`
    : "";
  const reasonLead = reported.length
    ? `${name} is being evaluated in the context of documented clinical concerns. During ${serviceShort(bundle.service)} screening, ${fname} reports ${joinList(reported)}.`
    : `${name} is being evaluated in the context of documented clinical concerns.`;
  sections.push({
    heading: "REASON FOR EVALUATION",
    body: [reasonLead, chartText].filter(Boolean).join(" "),
  });

  // QUALIFYING CLINICAL CONDITIONS (plain language, no codes)
  const conditionLines: string[] = [];
  for (const c of chart) conditionLines.push(`• ${c.displayText} (documented)`);
  for (const f of narrated) conditionLines.push(`• ${capitalize(stripHistoryPrefix(f.displayText))} (reported)`);
  sections.push({
    heading: "QUALIFYING CLINICAL CONDITIONS",
    body: conditionLines.length ? conditionLines.join("\n") : "No qualifying conditions recorded.",
  });

  // ASSESSMENT
  const assessmentParts: string[] = [];
  if (reported.length) {
    assessmentParts.push(
      `${fname} has patient-specific concerns including ${joinList(narrated.map((f) => stripHistoryPrefix(f.displayText)))}.`,
    );
  }
  const corroborated = narrated.filter((f) => f.corroboratedByChart);
  if (corroborated.length) {
    assessmentParts.push(
      `These reported findings are considered alongside ${fname}'s documented clinical history and provide relevant context for objective evaluation.`,
    );
  } else if (chart.length) {
    assessmentParts.push(
      `These reported findings are considered alongside ${fname}'s documented clinical history.`,
    );
  }
  if (bundle.clinicianUnderstanding) assessmentParts.push(bundle.clinicianUnderstanding);
  sections.push({
    heading: "ASSESSMENT",
    body: assessmentParts.join(" ") || `${name} is being assessed for the ordered evaluation.`,
  });

  // MEDICAL NECESSITY / QUALIFICATION
  const necessity =
    `Based on ${name}'s documented clinical history and screening responses, ${bundle.serviceLabel} is clinically appropriate. ` +
    (reported.length
      ? `${firstName(name)}'s reported ${joinList(narrated.slice(0, 3).map((f) => stripHistoryPrefix(f.displayText)))} provide relevant indications for objective evaluation. `
      : "") +
    `The purpose of testing is to obtain objective information that can be correlated with ${firstName(name)}'s clinical presentation. No specific diagnosis or abnormal finding is presumed by this order.`;
  sections.push({ heading: "MEDICAL NECESSITY / QUALIFICATION", body: necessity });

  // PROCEDURE ORDERED
  sections.push({ heading: "PROCEDURE ORDERED", body: bundle.serviceLabel });

  // CLINICAL OBJECTIVES
  sections.push({
    heading: "CLINICAL OBJECTIVES",
    body: serviceClinicalObjectives(bundle.service).map((o) => `• ${o}`).join("\n"),
  });

  // ORDERING CLINICIAN ATTESTATION (unsigned until the physician signs)
  sections.push({
    heading: "ORDERING CLINICIAN ATTESTATION",
    body: [
      `I attest that the above evaluation is medically necessary for this patient based on the documented clinical information.`,
      `Ordering Clinician: ${bundle.orderingClinician.name}`,
      `Signature: __________________________`,
      `Date/Time: __________________________`,
    ].join("\n"),
  });

  const text = sections.map((s) => `${s.heading}\n${"-".repeat(s.heading.length)}\n${s.body}`).join("\n\n");
  return { sections, text };
}

function serviceShort(service: string): string {
  const s = service.toLowerCase();
  if (s.includes("brain")) return "BrainWave";
  if (s.includes("vital")) return "VitalWave";
  return service;
}
function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
function stripHistoryPrefix(s: string): string {
  return s.replace(/^a history of /i, "").replace(/^testing positive for /i, "positive COVID-19 test — ");
}


// ─── Order Note standard (AI narrative) — 5-section renderer ────────────────
// Deterministic assembly of PATIENT INFORMATION / ORDER-PLAN / ATTESTATION
// around the two AI-generated narrative sections. NO ICD/CPT. The AI sections
// are inserted verbatim (already compliance-validated upstream). Patient
// identifiers, service, ordered components, attestation, and signature fields
// are NEVER AI-generated.

import type { OrderNoteEvidenceBundle as AiOrderNoteEvidenceBundle, EvidenceFact } from "./orderNoteEvidenceBundle";
import type { OrderNoteNarrative } from "./orderNoteNarrativeAi";

export const ORDER_NOTE_AI_GENERATOR_VERSION = "order_note_ai_v1";

// ─── Canonical deterministic renderer (evidence-driven, all-service) ────────
// Renders a deterministic Order Note body from the SHARED canonical evidence
// bundle (the same bundle the AI path consumes). It is evidence-driven, NOT
// screening-gated and NOT coupled to service names for its evidence model:
// it selects the clinically relevant subset of whatever provenance-backed
// evidence exists and renders it, omitting anything absent. It NEVER fabricates
// findings and contains NO ICD/CPT.
//
// Selection principle: the assembler is comprehensive; this renderer is
// selective. It surfaces (a) documented diagnoses + history, (b) qualification
// reasoning for THIS service, (c) positive structured screening findings when
// present, and (d) a bounded set of the most relevant supporting objective
// evidence (abnormal/most-recent labs, recent vitals, final prior imaging,
// clinician findings, encounter summaries) — each rendered with its evidence
// class so certainty/provenance is preserved in the visible text.

export const ORDER_NOTE_DETERMINISTIC_GENERATOR_VERSION = "order_note_deterministic_v2";

// Per-section bounds so a rich chart does not dump into the note.
const DET_MAX_DX = 8;
const DET_MAX_HX = 6;
const DET_MAX_LABS = 5;
const DET_MAX_VITALS = 4;
const DET_MAX_IMAGING = 3;
const DET_MAX_FINDINGS = 5;
const DET_MAX_NOTES = 2;
const DET_MAX_MEDS = 8;

/** True when a lab fact is flagged abnormal (rendered preferentially). */
function isAbnormalLab(f: EvidenceFact): boolean {
  return /\[(?!normal)[^\]]+\]/i.test(f.displayText);
}

export function renderDeterministicOrderNoteBody(
  bundle: AiOrderNoteEvidenceBundle,
): RenderedOrderNote {
  const name = bundle.patient.name;
  const fname = firstName(name);
  const sections: OrderNoteSection[] = [];

  // PATIENT INFORMATION (deterministic).
  const info: string[] = [`Patient: ${name}`];
  if (bundle.patient.dob) info.push(`Date of Birth: ${bundle.patient.dob}`);
  if (bundle.patient.age != null) info.push(`Age: ${bundle.patient.age}`);
  if (bundle.patient.sex) info.push(`Sex: ${bundle.patient.sex}`);
  if (bundle.patient.plexusId) info.push(`Plexus ID: ${bundle.patient.plexusId}`);
  if (bundle.patient.clinicName) info.push(`Clinic: ${bundle.patient.clinicName}`);
  info.push(`Ordering Clinician: ${bundle.orderingClinician.name}`);
  if (bundle.orderingClinician.npi) info.push(`NPI: ${bundle.orderingClinician.npi}`);
  if (bundle.orderDate) info.push(`Order Date: ${bundle.orderDate}`);
  sections.push({ heading: "PATIENT INFORMATION", body: info.join("\n") });

  // CLINICAL HISTORY / INDICATION — documented diagnoses + history + the
  // qualification rationale for THIS service. Only evidence that exists.
  const dx = bundle.diagnoses.slice(0, DET_MAX_DX).map((f) => f.displayText);
  const hx = bundle.history.slice(0, DET_MAX_HX).map((f) => f.displayText);
  const indicationParts: string[] = [];
  if (dx.length) {
    indicationParts.push(
      `${name} carries documented ${dx.length === 1 ? "diagnosis" : "diagnoses"} of ${joinList(dx)}.`,
    );
  }
  if (hx.length) {
    indicationParts.push(`Relevant documented history includes ${joinList(hx)}.`);
  }
  if (bundle.qualification.factors.length) {
    indicationParts.push(
      `${bundle.serviceLabel} was identified as clinically indicated based on ${joinList(bundle.qualification.factors.slice(0, 6))}.`,
    );
  }
  if (bundle.qualification.clinicianUnderstanding) {
    indicationParts.push(bundle.qualification.clinicianUnderstanding.trim());
  }
  if (indicationParts.length === 0) {
    indicationParts.push(
      `${name} is being evaluated with ${bundle.serviceLabel} in the context of documented clinical concerns.`,
    );
  }
  sections.push({ heading: "CLINICAL HISTORY / INDICATION", body: indicationParts.join(" ") });

  // SUPPORTING CLINICAL EVIDENCE — bounded, clinically relevant objective
  // evidence, each line labeled by source class. Entire section omitted when
  // no such evidence exists (missing optional evidence never blocks the note).
  const supporting: string[] = [];
  // Positive structured screening findings (when present).
  const screeningFindings = bundle.structuredScreening?.findings ?? [];
  if (screeningFindings.length) {
    const items = screeningFindings.slice(0, 6).map((f) => f.displayText);
    supporting.push(
      `Structured ${bundle.structuredScreening!.questionnaire} screening — patient-reported: ${joinList(items)}.`,
    );
  }
  // Clinician-entered findings.
  for (const f of bundle.clinicianFindings.slice(0, DET_MAX_FINDINGS)) {
    supporting.push(`Clinician finding: ${f.displayText}.`);
  }
  // Labs — abnormal first, bounded.
  const labsSorted = [...bundle.labs].sort(
    (a, b) => (isAbnormalLab(a) ? 0 : 1) - (isAbnormalLab(b) ? 0 : 1),
  );
  for (const f of labsSorted.slice(0, DET_MAX_LABS)) {
    supporting.push(`Laboratory: ${f.displayText}.`);
  }
  // Vitals — most recent, bounded.
  for (const f of bundle.vitals.slice(0, DET_MAX_VITALS)) {
    supporting.push(`Vital sign: ${f.displayText}.`);
  }
  // Prior imaging / diagnostic results — attributed, bounded.
  for (const f of bundle.priorImaging.slice(0, DET_MAX_IMAGING)) {
    supporting.push(`Prior imaging/result: ${f.displayText}.`);
  }
  // Encounter/clinical-note summaries — bounded.
  for (const f of bundle.clinicalNotes.slice(0, DET_MAX_NOTES)) {
    supporting.push(`Clinical note: ${f.displayText}.`);
  }
  if (supporting.length) {
    sections.push({
      heading: "SUPPORTING CLINICAL EVIDENCE",
      body: supporting.map((s) => `• ${s}`).join("\n"),
    });
  }

  // MEDICATIONS (from chart) — context only, never converted to a diagnosis.
  const meds = bundle.medications.slice(0, DET_MAX_MEDS).map((f) => f.displayText);
  if (meds.length) {
    sections.push({
      heading: "MEDICATIONS (CHART)",
      body: joinList(meds) + ".",
    });
  }

  // MEDICAL NECESSITY — deterministic synthesis referencing ONLY the evidence
  // above; no invented findings, no presumed abnormal result.
  const necessityBits: string[] = [
    `Based on ${fname}'s documented clinical information, ${bundle.serviceLabel} is clinically appropriate to obtain objective diagnostic information relevant to the concerns above.`,
  ];
  if (dx.length || bundle.qualification.factors.length) {
    necessityBits.push(
      `The ordered study is expected to characterize the clinical questions raised by ${joinList([...dx, ...bundle.qualification.factors.slice(0, 3)].slice(0, 4))}.`,
    );
  }
  necessityBits.push(
    `No specific abnormal result or final diagnosis is presumed by this order; the study has not yet been performed.`,
  );
  sections.push({ heading: "MEDICAL NECESSITY / QUALIFICATION", body: necessityBits.join(" ") });

  // ORDER / PLAN — service + the canonical ordered components.
  const componentLines = bundle.orderedComponents.map((c) => `• ${c.label} — ${c.clinicalPurpose}`);
  sections.push({
    heading: "ORDER / PLAN",
    body: [
      bundle.serviceLabel,
      "",
      "Proceed with the clinically applicable ordered components per the approved protocol and the patient-specific indications above:",
      ...componentLines,
    ].join("\n"),
  });

  // ORDERING CLINICIAN ATTESTATION (unsigned until the physician signs).
  sections.push({
    heading: "ORDERING CLINICIAN ATTESTATION",
    body: [
      `I have reviewed ${name}'s available clinical history, qualification rationale, and supporting evidence. Based on the patient-specific indications documented above, I am ordering ${bundle.serviceLabel} and its clinically applicable components. This order is medically necessary based on the documented clinical information.`,
      `Ordering Clinician: ${bundle.orderingClinician.name}`,
      `Signature: __________________________`,
      `Date/Time: __________________________`,
    ].join("\n"),
  });

  const text = sections.map((s) => `${s.heading}\n${"-".repeat(s.heading.length)}\n${s.body}`).join("\n\n");
  return { sections, text };
}

export function renderAiOrderNoteBody(
  bundle: AiOrderNoteEvidenceBundle,
  narrative: OrderNoteNarrative,
): RenderedOrderNote {
  const sections: OrderNoteSection[] = [];

  // PATIENT INFORMATION (deterministic).
  const info: string[] = [`Patient: ${bundle.patient.name}`];
  if (bundle.patient.dob) info.push(`Date of Birth: ${bundle.patient.dob}`);
  if (bundle.patient.age != null) info.push(`Age: ${bundle.patient.age}`);
  if (bundle.patient.sex) info.push(`Sex: ${bundle.patient.sex}`);
  if (bundle.patient.plexusId) info.push(`Plexus ID: ${bundle.patient.plexusId}`);
  if (bundle.patient.clinicName) info.push(`Clinic: ${bundle.patient.clinicName}`);
  info.push(`Ordering Clinician: ${bundle.orderingClinician.name}`);
  if (bundle.orderingClinician.npi) info.push(`NPI: ${bundle.orderingClinician.npi}`);
  if (bundle.orderDate) info.push(`Order Date: ${bundle.orderDate}`);
  sections.push({ heading: "PATIENT INFORMATION", body: info.join("\n") });

  // CLINICAL HISTORY / INDICATION (AI).
  sections.push({ heading: "CLINICAL HISTORY / INDICATION", body: narrative.clinicalHistoryIndication.trim() });

  // ASSESSMENT / MEDICAL NECESSITY (AI).
  sections.push({ heading: "ASSESSMENT / MEDICAL NECESSITY", body: narrative.assessmentMedicalNecessity.trim() });

  // ORDER / PLAN (deterministic — service + the actual ordered components).
  const componentLines = bundle.orderedComponents.map((c) => `• ${c.label}`);
  const plan = [
    bundle.serviceLabel,
    "",
    "Proceed with the clinically applicable ordered components per the approved protocol and the patient-specific indications above:",
    ...componentLines,
    "",
    "No specific abnormal result or final diagnosis is presumed by this order.",
  ].join("\n");
  sections.push({ heading: "ORDER / PLAN", body: plan });

  // ORDERING CLINICIAN ATTESTATION (deterministic, unsigned).
  sections.push({
    heading: "ORDERING CLINICIAN ATTESTATION",
    body: [
      `I have reviewed ${bundle.patient.name}'s available clinical history and screening information. Based on the patient-specific indications documented above, I am ordering ${bundle.serviceLabel} and its clinically applicable components.`,
      `Ordering Clinician: ${bundle.orderingClinician.name}`,
      `Signature: __________________________`,
      `Date/Time: __________________________`,
    ].join("\n"),
  });

  const text = sections.map((s) => `${s.heading}\n${"-".repeat(s.heading.length)}\n${s.body}`).join("\n\n");
  return { sections, text };
}
