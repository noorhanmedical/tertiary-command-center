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

import type { OrderNoteEvidenceBundle as AiOrderNoteEvidenceBundle } from "./orderNoteEvidenceBundle";
import type { OrderNoteNarrative } from "./orderNoteNarrativeAi";

export const ORDER_NOTE_AI_GENERATOR_VERSION = "order_note_ai_v1";

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
