// Slice G — canonical Billing Document CPT/ICD selection (pure).
//
// The Billing Document is the ONLY one of the three documents that carries
// ICD-10 / CPT. A CPT code is included ONLY when ALL of:
//   1. the component it represents was actually performed (procedure evidence),
//   2. the code is approved in canonical billing data for the exact case,
//   3. (implicitly) it maps to this service.
// ICD-10 comes only from approved case diagnoses. 93040 is de-duplicated.
// No code is ever invented.

import {
  serviceKeyForComponents,
  performedComponentKeys,
  type ProcedureComponents,
} from "./procedureComponents";

// CPT grouped by the component that must be performed to bill it.
export const BRAINWAVE_CPT_BY_COMPONENT: Record<string, string[]> = {
  neuropsychologicalTesting: ["96132", "96138", "96139"], // cognitive function
  eeg: ["95816", "95957"], // brain function / EEG
  ecg: ["93040"], // rhythm ECG
  vep: ["95930"], // visual processing
  aep: ["92653"], // auditory processing
};
export const VITALWAVE_CPT_BY_COMPONENT: Record<string, string[]> = {
  segmentalPressures: ["93923"], // peripheral arterial physiologic assessment
  autonomicTesting: ["95924"], // autonomic nervous system assessment
  rhythmEcg: ["93040"], // cardiac rhythm assessment
};

function cptMapFor(service: "brainwave" | "vitalwave"): Record<string, string[]> {
  return service === "brainwave" ? BRAINWAVE_CPT_BY_COMPONENT : VITALWAVE_CPT_BY_COMPONENT;
}

export type BillingCodeSelectionInput = {
  serviceType: string;
  components: ProcedureComponents | null;
  // Canonical approved codes for THIS exact case (from billing data). If null
  // or empty, nothing is billed (fail-closed) and a warning is emitted.
  approvedCptCodes: string[];
  approvedIcd10Codes: string[];
};

export type BillingCodeSelection = {
  cpt: string[]; // deduped; performed-component-supported ∩ approved
  icd10: string[]; // deduped; approved only
  componentSupportedCpt: string[]; // performed-component-supported (pre-approval)
  excludedNotApproved: string[]; // supported but not approved → excluded
  excludedNotPerformed: string[]; // approved but no performed component → excluded
  warnings: string[];
};

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

// ─── Approved-code resolution (pure) ────────────────────────────────
// The canonical approved CPT CATALOG for a service (BW/VW). This is the
// approved canonical billing data set; per-case specificity comes from the
// performed-component intersection in selectBillingDocumentCodes (a code is
// billed only when its component was actually performed). NOT invention.
export function approvedCptCatalogForService(serviceType: string): string[] {
  const key = serviceKeyForComponents(serviceType);
  if (!key) return [];
  const map = key === "brainwave" ? BRAINWAVE_CPT_BY_COMPONENT : VITALWAVE_CPT_BY_COMPONENT;
  return uniq(Object.values(map).flat());
}

// Approved, case-specific ICD-10 from the admin-approved qualification
// reasoning (patient_screenings.reasoning[<service test>].icd10_codes). Only
// what is actually approved for the case; never fabricated. ICD entries may be
// "I10" or "I10 – Essential Hypertension"; the leading code token is preserved
// as-is (Billing Document display is a downstream concern).
export function extractApprovedIcd10FromReasoning(reasoning: Record<string, unknown> | null | undefined, serviceType: string): string[] {
  if (!reasoning || typeof reasoning !== "object") return [];
  const s = (serviceType || "").toLowerCase();
  const key = Object.keys(reasoning).find((k) => {
    const kl = k.toLowerCase();
    return (s.includes("brain") && kl.includes("brain")) || (s.includes("vital") && kl.includes("vital")) || kl === s;
  });
  if (!key) return [];
  const r = reasoning[key] as Record<string, unknown> | undefined;
  const icd = r && typeof r === "object" ? (r as Record<string, unknown>)["icd10_codes"] : undefined;
  return Array.isArray(icd) ? uniq((icd as unknown[]).filter((x): x is string => typeof x === "string")) : [];
}

export function selectBillingDocumentCodes(input: BillingCodeSelectionInput): BillingCodeSelection {
  const warnings: string[] = [];
  const key = serviceKeyForComponents(input.serviceType);
  if (!key || !input.components) {
    return {
      cpt: [], icd10: uniq(input.approvedIcd10Codes), componentSupportedCpt: [],
      excludedNotApproved: [], excludedNotPerformed: uniq(input.approvedCptCodes),
      warnings: [key ? "no_component_evidence" : "unsupported_service"],
    };
  }

  const map = cptMapFor(key);
  const performed = new Set(performedComponentKeys(input.components));
  const componentSupportedCpt = uniq(
    Object.entries(map)
      .filter(([component]) => performed.has(component))
      .flatMap(([, codes]) => codes),
  );

  const approved = new Set(input.approvedCptCodes);
  const supportedSet = new Set(componentSupportedCpt);

  // Bill only performed-component-supported AND approved. Dedupe (e.g. 93040).
  const cpt = uniq(componentSupportedCpt.filter((c) => approved.has(c)));
  const excludedNotApproved = uniq(componentSupportedCpt.filter((c) => !approved.has(c)));
  const excludedNotPerformed = uniq(input.approvedCptCodes.filter((c) => !supportedSet.has(c)));

  if (input.approvedCptCodes.length === 0) warnings.push("no_approved_cpt_codes");
  if (cpt.length === 0) warnings.push("no_billable_cpt");

  return {
    cpt,
    icd10: uniq(input.approvedIcd10Codes),
    componentSupportedCpt,
    excludedNotApproved,
    excludedNotPerformed,
    warnings,
  };
}
