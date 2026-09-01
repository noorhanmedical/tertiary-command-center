// Slice A1 — deterministic Order Note evidence projection.
//
// Pure (no DB). Turns the assembled evidence bundle (chart-documented
// disorders + qualification reasoning + the FULL structured screening
// response set) into the clinically-relevant PROJECTED finding set that the
// physician-facing Order Note narrates.
//
// Policy (approved): there is NO universal >=3 numeric relevance threshold.
// ALL 1–5 BW responses and all `true` VW responses are positive
// patient-reported evidence and remain preserved in the screening record.
// Which positives are NARRATED is a deterministic, context-aware decision
// based on: service relevance (crosswalk), severity/frequency, chart/
// qualification corroboration, and concept clinical priority. Patient-reported
// findings are NEVER promoted into diagnoses; the crosswalk is corroboration
// only.

import {
  SCREENING_CONCEPT_CROSSWALK,
  screeningConceptDisplay,
  type ScreeningResponse,
} from "@shared/schema/screeningEvidence";

export type EvidenceSource = "chart_documented" | "clinician_entered" | "patient_reported";

export type ChartDiagnosis = {
  concept?: string;
  displayText: string;
  source: "chart_documented" | "clinician_entered";
};

export type OrderNoteEvidenceBundle = {
  service: string; // canonical serviceType, e.g. "BrainWave" | "VitalWave"
  serviceLabel: string; // e.g. "BrainWave – Comprehensive Assessment"
  patient: {
    name: string;
    dob?: string | null;
    mrn?: string | null;
    plexusId?: string | null;
    clinicName?: string | null;
  };
  orderingClinician: { name: string; npi?: string | null; id?: string | null };
  orderDate?: string | null;
  chartDiagnoses: ChartDiagnosis[];
  qualificationFactors: string[];
  clinicianUnderstanding?: string | null;
  screening: { questionnaire: string; version: string; responses: ScreeningResponse[] } | null;
};

export type ProjectedFinding = {
  concept: string;
  displayText: string;
  evidenceClass: string;
  source: EvidenceSource;
  value?: number | boolean;
  scale?: "severity" | "frequency";
  corroboratedByChart: boolean;
  // Deterministic reasons this finding was selected for narration.
  reasons: string[];
  // false ⇒ preserved as structured evidence but not prominently narrated.
  narrate: boolean;
};

// Concepts clinically important enough to narrate even at a low
// severity/frequency or a single checkbox. Deterministic, service-scoped.
const PRIORITY_CONCEPTS: Record<string, ReadonlySet<string>> = {
  BrainWave: new Set([
    "seizures", "epilepsy", "seizures_history", "epilepsy_history",
    "stroke", "stroke_history", "concussion_recent", "concussion_history",
    "hallucinations", "memory_difficulty", "dementia", "alzheimer",
    "parkinsons", "multiple_sclerosis", "delusions", "schizophrenia",
  ]),
  VitalWave: new Set([
    "syncope", "arrhythmia", "orthostatic_hypotension", "pvd", "chest_pain",
    "cardiomyopathy", "reduced_ejection_fraction", "atherosclerosis",
    "arteriosclerosis", "arterial_hardening", "chf", "myocardial_infarction",
    "angina",
  ]),
};

const HIGH_SCALE_CUTOFF = 3; // a CONTRIBUTING factor, never the sole rule.

function serviceKey(service: string): string {
  const s = service.toLowerCase();
  if (s.includes("brain")) return "BrainWave";
  if (s.includes("vital")) return "VitalWave";
  return service;
}

// Does the screening concept crosswalk to any chart-documented /
// qualification concept present in this bundle? (corroboration only)
function corroboration(concept: string, bundle: OrderNoteEvidenceBundle): boolean {
  const targets = SCREENING_CONCEPT_CROSSWALK[concept];
  if (!targets || targets.length === 0) return false;
  const chart = new Set([
    ...bundle.chartDiagnoses.map((d) => d.displayText.toLowerCase()),
    ...bundle.chartDiagnoses.map((d) => (d.concept ?? "").toLowerCase()),
    ...bundle.qualificationFactors.map((f) => f.toLowerCase()),
  ]);
  return targets.some((t) => chart.has(t.toLowerCase()));
}

function isPositive(r: ScreeningResponse): boolean {
  if (r.responseType === "boolean") return r.value === true;
  return typeof r.value === "number" && r.value >= 1; // 0 = explicit N/A
}

export function projectScreeningFindings(bundle: OrderNoteEvidenceBundle): ProjectedFinding[] {
  if (!bundle.screening) return [];
  const key = serviceKey(bundle.service);
  const priority = PRIORITY_CONCEPTS[key] ?? new Set<string>();

  // De-duplicate by concept, keeping the strongest evidence for narration
  // (highest scale value / any positive boolean) but preserving provenance.
  const byConcept = new Map<string, ProjectedFinding>();

  for (const r of bundle.screening.responses) {
    if (!isPositive(r)) continue;
    const scale = r.responseType === "severity_scale" ? "severity" : r.responseType === "frequency_scale" ? "frequency" : undefined;
    const corroborated = corroboration(r.concept, bundle);
    const reasons: string[] = [];
    if (SCREENING_CONCEPT_CROSSWALK[r.concept]) reasons.push("service_relevant");
    if (scale && typeof r.value === "number" && r.value >= HIGH_SCALE_CUTOFF) reasons.push("high_severity_or_frequency");
    if (corroborated) reasons.push("chart_corroborated");
    if (priority.has(r.concept)) reasons.push("concept_priority");

    const finding: ProjectedFinding = {
      concept: r.concept,
      displayText: screeningConceptDisplay(r.concept),
      evidenceClass: r.evidenceClass,
      source: "patient_reported",
      value: r.value,
      scale,
      corroboratedByChart: corroborated,
      reasons,
      narrate: reasons.length > 0,
    };

    const existing = byConcept.get(r.concept);
    if (!existing) {
      byConcept.set(r.concept, finding);
    } else {
      // Merge: keep the higher scale value; union reasons; OR the flags.
      const mergedValue =
        typeof existing.value === "number" && typeof finding.value === "number"
          ? Math.max(existing.value, finding.value)
          : existing.value ?? finding.value;
      byConcept.set(r.concept, {
        ...existing,
        value: mergedValue,
        corroboratedByChart: existing.corroboratedByChart || finding.corroboratedByChart,
        reasons: Array.from(new Set([...existing.reasons, ...finding.reasons])),
        narrate: existing.narrate || finding.narrate,
      });
    }
  }

  return [...byConcept.values()];
}

// The subset actually narrated in the Order Note (stable order: corroborated
// first, then by descending scale value, then concept for determinism).
export function narratedFindings(findings: ProjectedFinding[]): ProjectedFinding[] {
  return findings
    .filter((f) => f.narrate)
    .sort((a, b) => {
      if (a.corroboratedByChart !== b.corroboratedByChart) return a.corroboratedByChart ? -1 : 1;
      const av = typeof a.value === "number" ? a.value : a.value ? 5 : 0;
      const bv = typeof b.value === "number" ? b.value : b.value ? 5 : 0;
      if (av !== bv) return bv - av;
      return a.concept.localeCompare(b.concept);
    });
}
