// Slice A1 — Order Note EVIDENCE fingerprint (pure canonical string).
//
// Distinct from the FULL screening evidence version (A0). This represents the
// clinical evidence actually PROJECTED into the physician-facing Order Note.
// Same projected evidence ⇒ same fingerprint ⇒ no new version. A material
// change in projected evidence ⇒ new fingerprint ⇒ unsigned note refresh /
// re-review. Excludes volatile/presentation-only data (timestamps, phrasing,
// order date).

import type { OrderNoteEvidenceBundle } from "./orderNoteProjection";
import { projectScreeningFindings, narratedFindings } from "./orderNoteProjection";

export function canonicalOrderNoteEvidenceString(bundle: OrderNoteEvidenceBundle): string {
  const narrated = narratedFindings(projectScreeningFindings(bundle))
    .map((f) => `${f.concept}|${f.source}|${typeof f.value === "boolean" ? (f.value ? "T" : "F") : f.value ?? ""}|${f.corroboratedByChart ? "C" : "-"}`)
    .sort();
  const chart = bundle.chartDiagnoses
    .map((d) => (d.concept ?? d.displayText).toLowerCase())
    .sort();
  const factors = [...bundle.qualificationFactors].map((s) => s.toLowerCase()).sort();
  return JSON.stringify({
    service: bundle.service,
    narrated,
    chart,
    factors,
    orderingClinicianId: bundle.orderingClinician.id ?? null,
  });
}
