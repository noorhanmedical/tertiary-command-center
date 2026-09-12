// Bounded FROZEN snapshot builders for call-list package members.
//
// ── PHI DUPLICATION REGISTER (correction 9 / 18) ────────────────────────────
// A package is an immutable historical record of what a manager delivered to an
// employee at one moment. To reproduce that delivery (roster summary,
// qualification summary, and the Clinician Atlas page) WITHOUT reading live
// state, a MINIMAL bounded subset of PHI is frozen into
// call_list_package_members. The FULL chart is never copied.
//
// Fields duplicated and why:
//   patient name            — roster identification (also a dedicated column)
//   DOB                     — patient identification on a clinical call list (col)
//   phone                   — the employee's outreach contact number (col)
//   age / sex / insurance / facility / email / time
//                           — roster demographics the Atlas header renders
//                             (buildPatientDemoBlock)
//   qualifyingTests         — which ancillaries were qualified (roster + Atlas)
//   reasoning (BOUNDED)     — ONLY the keys the Clinician Atlas renders per test
//                             (clinician_understanding, qualifying_factors,
//                             confidence, pearls). patient_talking_points and
//                             icd10_codes are intentionally EXCLUDED (not
//                             rendered on the Clinician Atlas).
//   Dx / Hx / Rx + previous tests
//                           — the Atlas "Chart Review" block (APPROVED). Only
//                             these specific fields the Atlas actually renders
//                             are frozen — never the full problem list, med
//                             list, labs, imaging, or notes.
//
// Everything here is PURE (types only from @shared/schema) so it is safe to
// import from client (Task 7 PDF builder) or server (Task 6 snapshot write) and
// is trivially unit-testable.

import type { PatientScreening } from "@shared/schema";

/** Reasoning keys the CLINICIAN Atlas renders (bounds the frozen copy). */
export type BoundedReasoning = {
  clinician_understanding?: string;
  qualifying_factors?: string[];
  confidence?: "high" | "medium" | "low";
  pearls?: string[];
};

/** Render-ready bounded subset consumed directly by buildClinicianPdfBody.
 *  Field names mirror PatientScreening so Task 7 can pass it straight through. */
export type AtlasPayloadSnapshot = {
  name: string;
  dob: string | null;
  age: number | null;
  gender: string | null;
  phoneNumber: string | null;
  email: string | null;
  insurance: string | null;
  facility: string | null;
  time: string | null;
  qualifyingTests: string[];
  reasoning: Record<string, BoundedReasoning>;
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
  previousTests: string | null;
  previousTestsDate: string | null;
};

/** Compact roster demographics (bounded). DOB + phone are dedicated columns. */
export type DemographicsSnapshot = {
  age: number | null;
  gender: string | null;
  insurance: string | null;
  facility: string | null;
  email: string | null;
  time: string | null;
};

/** Compact qualification summary for the roster / share-page qualification
 *  view: the qualified services + per-test confidence (never the full body). */
export type QualificationSummarySnapshot = {
  qualifyingTests: string[];
  confidenceByTest: Record<string, "high" | "medium" | "low">;
};

type PatientLike = Pick<
  PatientScreening,
  | "name"
  | "dob"
  | "age"
  | "gender"
  | "phoneNumber"
  | "email"
  | "insurance"
  | "facility"
  | "time"
  | "qualifyingTests"
  | "reasoning"
  | "diagnoses"
  | "history"
  | "medications"
  | "previousTests"
  | "previousTestsDate"
>;

/** Keep ONLY the reasoning keys the Clinician Atlas renders, and only for the
 *  patient's qualifying tests — bounding the frozen PHI to what's delivered. */
export function boundReasoning(
  reasoning: unknown,
  qualifyingTests: string[],
): Record<string, BoundedReasoning> {
  const out: Record<string, BoundedReasoning> = {};
  if (!reasoning || typeof reasoning !== "object") return out;
  const src = reasoning as Record<string, unknown>;
  for (const test of qualifyingTests) {
    const r = src[test];
    if (r == null) continue;
    if (typeof r === "string") {
      out[test] = { clinician_understanding: r };
      continue;
    }
    if (typeof r === "object") {
      const o = r as Record<string, unknown>;
      const bounded: BoundedReasoning = {};
      if (typeof o.clinician_understanding === "string") {
        bounded.clinician_understanding = o.clinician_understanding;
      }
      if (Array.isArray(o.qualifying_factors)) {
        bounded.qualifying_factors = (o.qualifying_factors as unknown[]).filter(
          (x): x is string => typeof x === "string",
        );
      }
      if (o.confidence === "high" || o.confidence === "medium" || o.confidence === "low") {
        bounded.confidence = o.confidence;
      }
      if (Array.isArray(o.pearls)) {
        bounded.pearls = (o.pearls as unknown[]).filter(
          (x): x is string => typeof x === "string",
        );
      }
      out[test] = bounded;
    }
  }
  return out;
}

export function buildDemographicsSnapshot(p: PatientLike): DemographicsSnapshot {
  return {
    age: p.age ?? null,
    gender: p.gender ?? null,
    insurance: p.insurance ?? null,
    facility: p.facility ?? null,
    email: p.email ?? null,
    time: p.time ?? null,
  };
}

export function buildQualificationSummary(p: PatientLike): QualificationSummarySnapshot {
  const tests = (p.qualifyingTests ?? []) as string[];
  const bounded = boundReasoning(p.reasoning, tests);
  const confidenceByTest: Record<string, "high" | "medium" | "low"> = {};
  for (const [test, r] of Object.entries(bounded)) {
    if (r.confidence) confidenceByTest[test] = r.confidence;
  }
  return { qualifyingTests: tests, confidenceByTest };
}

// ─── Roster summary (page 1 of the PDF + header summaryMetrics) ─────────────
import { getAncillaryCategory } from "@shared/ancillaryCategory";

export type RosterAncillaryMix = {
  brainwave: number;
  vitalwave: number;
  ultrasound: number;
  other: number;
};

export type RosterSummary = {
  total: number;
  ancillaryMix: RosterAncillaryMix;
  /** Call-status classification counts (never_called/lvm/no_answer/...). */
  statusMix: Record<string, number>;
};

/** Compute the per-package roster summary from frozen member snapshots. PURE.
 *  A patient counts once per ancillary category they carry. */
export function computeRosterSummary(
  members: Array<{
    servicesSnapshot?: string[] | null;
    cohortClassificationSnapshot?: string | null;
  }>,
): RosterSummary {
  const ancillaryMix: RosterAncillaryMix = {
    brainwave: 0,
    vitalwave: 0,
    ultrasound: 0,
    other: 0,
  };
  const statusMix: Record<string, number> = {};
  for (const m of members) {
    const cats = new Set((m.servicesSnapshot ?? []).map((s) => getAncillaryCategory(s)));
    if (cats.has("brainwave")) ancillaryMix.brainwave += 1;
    if (cats.has("vitalwave")) ancillaryMix.vitalwave += 1;
    if (cats.has("ultrasound")) ancillaryMix.ultrasound += 1;
    if (cats.has("other")) ancillaryMix.other += 1;
    const status = m.cohortClassificationSnapshot ?? "other";
    statusMix[status] = (statusMix[status] ?? 0) + 1;
  }
  return { total: members.length, ancillaryMix, statusMix };
}

export function buildAtlasPayloadSnapshot(p: PatientLike): AtlasPayloadSnapshot {
  const tests = (p.qualifyingTests ?? []) as string[];
  return {
    name: p.name,
    dob: p.dob ?? null,
    age: p.age ?? null,
    gender: p.gender ?? null,
    phoneNumber: p.phoneNumber ?? null,
    email: p.email ?? null,
    insurance: p.insurance ?? null,
    facility: p.facility ?? null,
    time: p.time ?? null,
    qualifyingTests: tests,
    reasoning: boundReasoning(p.reasoning, tests),
    diagnoses: p.diagnoses ?? null,
    history: p.history ?? null,
    medications: p.medications ?? null,
    previousTests: p.previousTests ?? null,
    previousTestsDate: p.previousTestsDate ?? null,
  };
}
