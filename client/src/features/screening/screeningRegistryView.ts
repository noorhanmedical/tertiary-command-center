// A0-UI — client render model derived from the SHARED A0 registry.
// Never duplicates question definitions; it only groups + labels them for the
// ACS/PCS screening form.

import {
  SCREENING_REGISTRY,
  SEVERITY_MEANINGS,
  FREQUENCY_MEANINGS,
  type Questionnaire,
  type ScreeningRegistryItem,
} from "@shared/schema/screeningEvidence";

export const SECTION_TITLES: Record<string, string> = {
  diagnosis_history: "Diagnosis / History — rate severity",
  symptoms: "Symptoms — rate how often",
  general: "General",
  medication: "Are you taking medication for…",
  recent_feelings: "Last week, have you been feeling…",
  ever_diagnosed: "Have you ever been diagnosed with…",
  recently_diagnosed: "Have you recently been diagnosed with…",
};

// Exact scale wording from the questionnaires (0 = explicit N/A).
export const SEVERITY_LABELS = ["N/A", "Slight", "Mild", "Moderate", "Severe", "Very Severe"];
export const FREQUENCY_LABELS = ["N/A", "Very Seldom", "Seldom", "Sometimes", "Often", "Very Often"];

const BW_SECTION_ORDER = ["diagnosis_history", "symptoms"];
const VW_SECTION_ORDER = ["general", "symptoms", "medication", "recent_feelings", "ever_diagnosed", "recently_diagnosed"];

export type ScreeningSection = { key: string; title: string; items: ScreeningRegistryItem[] };

export function sectionsFor(questionnaire: Questionnaire, version: string): ScreeningSection[] {
  const items = SCREENING_REGISTRY.filter((i) => i.questionnaire === questionnaire && i.questionnaireVersion === version);
  const order = questionnaire === "brainwave" ? BW_SECTION_ORDER : VW_SECTION_ORDER;
  const seen = new Map<string, ScreeningRegistryItem[]>();
  for (const it of items) {
    if (!seen.has(it.section)) seen.set(it.section, []);
    seen.get(it.section)!.push(it);
  }
  const orderedKeys = [...order.filter((k) => seen.has(k)), ...[...seen.keys()].filter((k) => !order.includes(k))];
  return orderedKeys.map((key) => ({ key, title: SECTION_TITLES[key] ?? key, items: seen.get(key)! }));
}

export function scaleMeaning(responseType: "severity_scale" | "frequency_scale", value: number): string {
  return responseType === "severity_scale" ? SEVERITY_MEANINGS[value] : FREQUENCY_MEANINGS[value];
}
export function scaleLabels(responseType: "severity_scale" | "frequency_scale"): string[] {
  return responseType === "severity_scale" ? SEVERITY_LABELS : FREQUENCY_LABELS;
}

export function requiredCount(questionnaire: Questionnaire, version: string): number {
  return SCREENING_REGISTRY.filter(
    (i) => i.questionnaire === questionnaire && i.questionnaireVersion === version && !i.control,
  ).length;
}
