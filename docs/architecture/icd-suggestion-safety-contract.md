# ICD suggestion — safety contract

**Status:** Docs-only (Bundle 40). No engine code. No ICD commit. No live AI call. No model selection.
**Date:** 2026-06-10.
**Scope:** Pin the boundaries the ICD Suggestion Engine MUST respect so AI-suggested ICDs cannot reach billing, the active problem list, claims, or any committal surface without explicit human review.
**Cross-references:**
- `emr-integration-clinical-evidence-qualification-contract.md` (Bundle 37 §9 — engine posture).
- `clinical-evidence-store-contract.md` (Bundle 38 — input data).
- `labs-imaging-notes-extraction-contract.md` (Bundle 43 — evidence-to-ICD mapping rules).
- `admin-review-approval-commit-inventory.md` (Bundle 30 — commit surface).
- `qualification-structure-cleanup-design.md` (Bundle 31 §4 — regeneration boundary).
- `billing-invoice-hard-stop-map.md` (Bundle 29 §1 + §4 — money territory).
- `pdf-protection-contract.md` (PDF intentionally omits ICD codes).

This contract introduces zero runtime code. It establishes the rules every future engine PR, every regenerate path, and every reviewer-facing surface must obey.

---

## 1. Suggestion-only posture

The ICD Suggestion Engine is **suggestion-only**. It NEVER:

- Writes to `billing_records` or `billing_document_requests`.
- Writes to `invoices` or `projected_invoices`.
- Updates the patient's active problem list in any persistence layer.
- Writes a CPT or HCPCS code anywhere.
- Triggers a billing event, packet generation, or scheduling action.
- Calls `commitPatient`, `evaluateBillingReadinessForProcedure`, or any approval-pipeline route.
- Marks an ICD as confirmed on `patient_screenings.reasoning` outside the per-ancillary `adminReview:<id>` namespace.

Every suggestion is a structured payload consumed by a clinician or admin reviewer who decides whether to accept, reject, or defer.

---

## 2. Required components of every suggestion

Every suggestion bundle the engine emits MUST carry:

- `suggestionId` — opaque server-generated id.
- `canonicalPatientId` — Patient Directory id.
- `tenantId`.
- `candidateIcds[]` — one or more ICD-10 codes, each with:
  - `code` — the ICD-10-CM string.
  - `description` — vendor / canonical text label.
  - `chapter` / `category` — for downstream filtering.
- `supportingEvidence[]` — see §3.
- `missingEvidence[]` — see §4.
- `contradictingEvidence[]` — see §5.
- `historicityClassification` — see §6.
- `clinicalRationale` — short reviewer-facing natural-language explanation.
- `confidence` — band (`low` | `medium` | `high`) + componentScores per Bundle 38 §2.8.
- `modelMetadata`:
  - `modelId`, `modelVersion`.
  - `promptHash` (deterministic over the prompt template).
  - `evidenceFingerprint` (hash over the input evidence ids).
  - `generatedAt`.
- `reviewStatus` — `unreviewed`, `clinician_accepted`, `clinician_rejected`, `admin_overridden`, `superseded`.
- `humanApprovalRequired` — boolean. ALWAYS `true` at emit time.

A suggestion bundle without any of the above is non-compliant. The future engine PR fails its QA gate if it emits one.

---

## 3. Supporting evidence

Every supporting evidence entry MUST be an `EvidenceSourceReference` from Bundle 38 §2.6 — never a free-text fragment, never a rephrasing. The reviewer can drill back to the originating document.

The engine MAY summarise the evidence in a reviewer-facing string (`clinicalRationale`), but the structured `supportingEvidence[]` array is the source of truth.

---

## 4. Missing evidence

When the engine considered a piece of evidence and did NOT find it, the suggestion lists the gap explicitly. Each missing item names:

- `expectedEvidenceKind` (per Bundle 38 §2.1 `kind` enum or a labs-LOINC reference).
- `reasonMissing` — `not_present_in_store`, `present_but_stale`, `present_but_low_confidence`, `present_but_rejected`, `not_queryable_from_adapter`.
- `whereLooked` — pointer to the search the engine performed (window + adapter category).

This list is load-bearing for the reviewer. A diabetes suggestion that lacks A1c data, for example, surfaces the missing A1c here so the reviewer knows what evidence is unavailable.

---

## 5. Contradicting evidence

When the engine finds evidence that argues AGAINST the suggested ICD, the contradiction MUST appear in the suggestion bundle. Examples:

- A diabetes suggestion alongside a recent normal A1c.
- A CHF suggestion alongside a normal echocardiogram impression in the last 12 months.
- An anemia suggestion alongside a normal CBC trend.

`contradictingEvidence[]` is structured the same way as `supportingEvidence[]` — pointers, not rephrasings.

The presence of contradicting evidence does NOT block emission of the suggestion. It IS surfaced to the reviewer, and the engine MUST cap `confidence.band` at `medium` when any contradiction is present.

---

## 6. Historicity and active-vs-ruled-out

Every suggestion classifies the condition along three axes:

- `temporal` — `active` | `historical` | `resolved`.
- `certainty` — `suspected` | `confirmed` | `ruled_out`.
- `provenance` — `derived_from_problem_list` | `derived_from_diagnosis_history` | `derived_from_labs` | `derived_from_imaging_impression` | `derived_from_notes_nlp` | `derived_from_medication_use` | `derived_from_multiple`.

Mixed-axis combinations are allowed. `confidence.band` MUST be `low` when the combination is `suspected + ruled_out` or `historical + active`.

---

## 7. Copied-forward problem list caution

Vendor problem lists are notoriously copy-forwarded — clinicians frequently propagate a problem from a prior encounter without re-verifying. The engine MUST:

- Flag any evidence whose `ExtractedCondition.conditionStatus === "copied_forward_unverified"` (Bundle 38 §2.7).
- Treat copy-forward-only evidence as insufficient justification for a `confidence.band === "high"` suggestion. The cap is `medium` when no non-copy-forward evidence supports the suggestion.
- Surface the copy-forward warning in the `clinicalRationale` string.

---

## 8. No auto-commit to billing

Independent of any other rule, the engine MUST NOT call:

- Anything under `server/routes/billing*.ts`.
- Anything under `server/routes/invoices*.ts`.
- Anything under `server/repositories/billing*.repo.ts` from a write context.
- `evaluateBillingReadinessForProcedure` or any billing-readiness writer.
- The PDF / packet generator with an ICD payload.

The engine's surface is read-side suggestion emission. A separate, explicitly approved post-review PR ships the path from "reviewer accepted suggestion" → "ICD added to claim". This contract does NOT design that path.

---

## 9. Clinician / admin review boundary

A suggestion advances to a committal action ONLY when:

1. A clinician reviewer with the matching tenant + facility scope accepts it, OR
2. An admin reviewer overrides with a documented reason (the override is itself an audit row).

Both actions produce an append-only `ReviewDecision` (Bundle 38 §2.9). The Admin Review approval pipeline (Bundle 30) is the canonical commit surface for any state change downstream of the review.

---

## 10. Audit trail

Every suggestion bundle's full lifecycle is audited:

- Emit → audit row (`suggestion_emitted`).
- Accept → audit row (`suggestion_accepted`) referencing the suggestion id and the reviewer actor id.
- Reject → audit row (`suggestion_rejected`) with reviewer's note hash.
- Override → audit row (`suggestion_overridden`) with admin actor id and override-reason hash.
- Supersede → audit row (`suggestion_superseded`) with pointer to the new suggestion id.

No PHI is logged in any of the above; reviewer notes and rationales are hashed per Bundle 8.

---

## 11. PHI / RBAC boundaries

- The engine's output is a structured payload; it never returns raw clinical document text.
- Reviewer surfaces (the future Admin Review modal adoption) MAY render evidence text within the review context, but logs hash the text per Bundle 8.
- The engine respects the tenant + facility RBAC envelope (Bundle 37 §15). A suggestion never crosses tenants and never reaches a reviewer outside the patient's facility scope by default.
- Raw model output (LLM JSON, embeddings) is NEVER persisted user-facingly. Only the engine's structured suggestion lands in the store.

---

## 12. Examples — what the engine looks at, NOT what it commits

The following are illustrative. None of them describe a runtime commit; they describe what the engine reads to emit a suggestion bundle.

### 12.1 Diabetes (E11.x family)

- A1c trend (Bundle 38 §2.3).
- Fasting glucose trend.
- Active anti-diabetic medications (metformin, GLP-1s, insulin).
- Diagnosis history entries for E11.x.
- Problem list entries for diabetes (copy-forward flagged per §7).
- Counter-indicators: normal A1c < 5.7% in last 6 months without active treatment.

### 12.2 CKD (N18.x family)

- eGFR trend across consecutive measurements.
- Cystatin C if available.
- ACR / urine protein.
- Active CKD-related medications.
- Counter-indicators: single low eGFR followed by sustained recovery; acute-kidney-injury context.

### 12.3 CHF (I50.x family)

- Echocardiogram impression (EF threshold).
- BNP / NT-proBNP trend.
- Diuretic and heart-failure medication history.
- Hospitalisation history for CHF exacerbation.
- Counter-indicators: normal echo impression in the last 12 months without active treatment.

### 12.4 Anemia (D50–D64)

- Hb / Hct trend.
- MCV for classification axis.
- Iron studies / B12 / folate where available.
- Active iron / B12 / EPO supplementation.
- Counter-indicators: normalised Hb after supplementation without recurrence.

### 12.5 Malnutrition (E40–E46, R63.x)

- Albumin / prealbumin trend.
- BMI trend.
- Weight loss / appetite-loss notes from visit-note NLP.
- Counter-indicators: stable weight, normalising albumin.

### 12.6 COPD (J44.x)

- PFT / spirometry impression (FEV1 / FEV1/FVC).
- Inhaler / nebuliser medication history.
- Imaging impression (hyperinflation).
- Counter-indicators: asthma-only history with reversible obstruction.

### 12.7 Stroke (I63.x, I69.x for sequelae)

- Imaging impression (acute vs old infarct).
- Neurology consult notes.
- Anticoagulation history.
- Counter-indicators: imaging impression negative for infarct; symptoms ruled out as TIA only.

### 12.8 DVT / PAD (I82.x, I73.x)

- Duplex ultrasound impression.
- D-dimer trend.
- Anticoagulation history.
- Counter-indicators: normal duplex impression in last 30 days.

### 12.9 Infection (B95.x family, J18.x, N39.x, etc.)

- Culture results.
- Antibiotic course history.
- Inflammatory markers (CRP, ESR).
- Counter-indicators: resolved infection per discharge summary; no active antibiotic; normalised markers.

---

## 13. Stop conditions for any future engine PR

A PR introducing or modifying the engine MUST stop and ask if:

1. It would emit a suggestion without any of the §2 required fields.
2. It would auto-commit any suggestion.
3. It would call any billing / invoice / claim / packet / scheduling route.
4. It would mark the suggestion as accepted / approved without a `ReviewDecision`.
5. It would cap `confidence.band` lower than required by §5 (contradiction) or §7 (copy-forward only).
6. It would log raw PHI / raw model output / raw evidence text.
7. It would cross tenants.
8. It would skip audit emission for any lifecycle event.
9. It would render an ICD on a PDF / packet (`pdf-protection-contract.md` forbids).
10. It would change Admin Review approval/commit behavior (Bundle 30).
11. It would change canonical reasoning writes outside `reasoning.adminReview:<id>` (Bundle 31 §4).
12. It would flip a feature-flag default in production.

---

## 14. Non-promises

- No model is selected here.
- No prompt template is locked.
- No coding-rule fork (e.g. CMS-specific rules) is endorsed.
- No commitment that any specific ICD chapter is supported in any phase.
- No claim that the engine alone meets coder compliance standards. It is a reviewer-assist tool.

End of contract.
