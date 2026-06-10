# Labs / imaging / notes extraction contract

**Status:** Docs-only (Bundle 43). No extraction code. No NLP model. No live data.
**Date:** 2026-06-10.
**Scope:** Pin the rules every extraction step in the EMR-data pipeline must obey when turning raw vendor payloads into `ClinicalEvidence` rows. Sit between Bundle 39 (adapter interface; what the adapter delivers) and Bundle 38 (Clinical Evidence Store; what consumers read).
**Cross-references:**
- `emr-integration-clinical-evidence-qualification-contract.md` (Bundle 37 §6, §7, §8).
- `clinical-evidence-store-contract.md` (Bundle 38 §2, §3).
- `emr-adapter-interface-design.md` (Bundle 39 §2.7, §2.8, §2.9).
- `icd-suggestion-safety-contract.md` (Bundle 40 §3-§7 — downstream consumer of extractions).
- `tests/fixtures/ancillaryQualificationEvidence.fixture.ts` (Bundle 41) and `tests/fixtures/patientDirectoryEmrSourceLink.fixture.ts` (Bundle 42).
- `pdf-protection-contract.md`, `billing-invoice-hard-stop-map.md`, `do-not-touch.md`.

This document ships zero extraction code. It pins the contract every future extraction PR must satisfy.

---

## 1. Where extraction lives in the stack

```
EMR adapter → raw payload tier → EXTRACTION PIPELINE → Clinical Evidence Store → engines → review → commits
```

Extraction is the only writer to the Clinical Evidence Store. Adapters write only to the raw payload tier. Engines read from the store. The boundary is one-directional.

A single raw payload (a FHIR resource, an HL7 segment, a PDF attachment, a vendor-native document) MAY produce zero or many `ClinicalEvidence` rows; the extraction pipeline encodes the mapping.

---

## 2. Labs extraction

Inputs: a `LabResult` envelope from the adapter (Bundle 39 §2.7).
Output: a `LabResult` row in the store (Bundle 38 §2.3) + zero or more downstream `ClinicalEvidence` rows of `kind: "lab_result"` that summarise the result for review surfaces.

Rules:

- LOINC mapping is **best-effort**. When a vendor does not supply a LOINC code, the extraction MAY apply a vendor-table mapping IF one exists with high confidence; otherwise it persists the row with `loincCode: null` and `vendorTestName` only.
- The vendor's reference range is preserved verbatim. If the vendor omits a range, the extraction MUST NOT substitute a generic range — the row is persisted with `referenceRangeLow: null`, `referenceRangeHigh: null`.
- The `abnormalFlag` enum (Bundle 38 §2.3) is derived from the vendor's interpretation flag where available. When the vendor omits an interpretation, the extraction MAY compute one ONLY when both `value` and reference range are present and parseable — otherwise the flag is `unknown`.
- `collectedAt` / `resultedAt` MUST both be persisted. When the vendor omits one of the two, the extraction copies the other into both slots and records the inference in the source reference.

---

## 3. Abnormal result handling

- Critical-high / critical-low flagging triggers a *companion* `ClinicalEvidence` row with `kind: "lab_result"` and `confidence.band: "high"` so downstream engines see the abnormal result without recomputing.
- The extraction MUST NOT trigger any clinician alert, scheduling action, or messaging from inside the pipeline. Alerting is downstream of review.
- A single critical-out-of-range value does NOT supersede the routine `LabResult` row; both coexist. The companion row carries a pointer to the routine row in its source reference.

---

## 4. Trend detection

- Trend computation happens at **read time**, not at extraction time. The extraction does NOT precompute trend columns.
- The companion `ClinicalEvidence` rows for abnormal results MAY carry a `trend_hint` value in their `metadata` (one of `rising`, `falling`, `stable`, `oscillating`, `single_value`) but this hint is advisory only.
- Engines compute trends from the routine `LabResult` series at query time. Adding a precomputed trend table is out of scope for this contract — a future PR may add one with its own design doc.

---

## 5. Imaging report extraction

Inputs: an `ImagingReport` envelope from the adapter (Bundle 39 §2.8).
Output: an `ImagingReport` row in the store (Bundle 38 §2.4) + zero or more downstream `ClinicalEvidence` rows of `kind: "imaging_impression"` or `kind: "imaging_finding"`.

Rules:

- The `impression` field is **mandatory**. If the vendor's report has no impression section, the extraction persists the imaging row with `impression: ""` (empty string, not null) and records the gap in the source reference's extraction metadata.
- The `findings` and `impression` sections are persisted as SEPARATE columns. An extraction that merges them is non-compliant.
- The extraction MAY emit an `imaging_impression` evidence row whose `summary` is the impression text; the source span MUST be the impression section, not the full document.
- Multi-modality reports (a single document covering CT + MRI of the same body region) produce ONE `ImagingReport` row per modality. The extraction splits as required; an extraction that conflates modalities is non-compliant.

---

## 6. Impression vs findings distinction

The architecture explicitly distinguishes:

- **`findings`** — descriptive observations made during interpretation.
- **`impression`** — synthesised clinical conclusion.

Engines read the `impression` for primary qualification logic. Findings are secondary and inform when impression is absent or ambiguous. The extraction MUST NOT substitute findings for impression and MUST NOT fabricate an impression from findings.

When the vendor uses non-standard headers (`Conclusion`, `Diagnosis`, `Summary`), the extraction MAY map them to `impression` IF the vendor's documentation supports the mapping. Otherwise the section goes into `findings` with a metadata note.

---

## 7. Notes / document NLP extraction

Inputs: a `ClinicalDocument` envelope from the adapter (Bundle 39 §2.6).
Output: zero or more `ClinicalEvidence` rows whose `kind` matches the NLP extractor's output.

Rules:

- Every NLP-derived evidence row MUST carry `sourceReference.extractedSnippet` — the document span (start + end offsets) the row was extracted from (Bundle 38 §2.6).
- The NLP layer MUST distinguish:
  - **Active conditions** (asserted as currently present).
  - **Historical conditions** (asserted as past).
  - **Suspected conditions** (asserted with uncertainty markers).
  - **Ruled-out conditions** (asserted as negated or excluded).
  - **Copied-forward conditions** (verbatim repetition across N+ consecutive notes — see §10).
- The NLP layer MUST treat `negationDetected: true` for any phrase whose semantic scope includes a negation cue (`no`, `denies`, `negative for`, `without`, etc.).
- Multi-sentence assertions that span a section boundary MAY be extracted as one row, but the span MUST cover the full assertion.

---

## 8. Abnormal note extractions

Some note assertions function as `kind: "imaging_finding"` or `kind: "vital"` even when sourced from a visit note. The extraction's `kind` is determined by the assertion's semantic axis, NOT by the document type. A visit note that says "BP 180/95 in clinic today" produces a `vital` evidence row with a `note_extraction` provenance tag in `sourceReference.extractionMethod`.

---

## 9. Negation handling

- Negation is detected at extraction time by the NLP layer. The extraction MUST NOT downgrade confidence based on negation; instead, it sets `negationDetected: true` AND emits the row with the assertion sense reversed.
- Example: "no chest pain" produces an extracted condition with `condition: chest_pain`, `negationDetected: true`, `conditionStatus: ruled_out`. Downstream engines treat this as evidence AGAINST chest pain, not as evidence FOR it.

---

## 10. Copied-forward handling

- The NLP layer MAY use a sliding-window heuristic across consecutive notes from the same author / specialty: an assertion repeated verbatim across N consecutive encounters is flagged as `copied_forward_unverified` (Bundle 38 §2.7).
- The threshold N is a configurable parameter (default `3`). The threshold is NOT changed inside this contract; a future PR may tune it with its own evidence.
- Engines treat copy-forward-only evidence per Bundle 40 §7 (caps `confidence.band` at `medium`).
- The extraction MUST surface the copy-forward chain (the list of source documents the assertion was copied from) in the row's `metadata.copyForwardChain`.

---

## 11. Stale evidence

- An evidence row is considered stale when:
  - `dateOfService` is older than the per-`kind` freshness window (the windows are pinned in a future per-kind table; this contract pins the principle).
  - The source document has been amended / superseded in the vendor system.
- Staleness is computed at read time; the extraction does NOT persist a staleness flag. The Bundle 38 store's read layer joins the staleness derivation.

---

## 12. Conflicting evidence

- The extraction emits each row independently. Conflict detection (Bundle 38 §2.10 `ConflictingEvidence`) is a *read-side* concern — two rows from different vendors that contradict each other are joined by a read query.
- The extraction MUST NOT silently reconcile contradictions. Both rows persist with full provenance.

---

## 13. Source references

Every evidence row the extraction produces carries:

- `sourceReference.vendor` (the adapter id).
- `sourceReference.vendorRecordId` (the source record id in the vendor system).
- `sourceReference.vendorRecordKind` (`fhir_resource`, `hl7_segment`, `vendor_native_document`, `pdf_attachment`, `manual_upload`).
- `sourceReference.rawPayloadPointer` (round-trip key into the raw payload tier).
- For NLP-derived rows: `sourceReference.extractedSnippet` (start + end offsets within the source document).
- `sourceReference.extractionMethod` (`vendor_native`, `nlp_v1`, `clinician_manual`, `admin_manual`, plus future versions).

A row without a complete source reference is non-compliant.

---

## 14. Evidence confidence

Each row's `confidence` (Bundle 38 §2.8) is computed at extraction time as:

- `vendor_native` extractions → default `high`.
- `nlp_v1` extractions → default `medium`, adjusted down to `low` when the snippet length is below a threshold, snippet contains hedge cues, or the NLP layer's internal score is below a band.
- `pdf_ocr_v1` extractions → default `medium`, adjusted down to `low` when OCR confidence is below threshold.
- `clinician_manual` and `admin_manual` extractions → default `high`; the reviewer's actor id and note hash are recorded.

The `rationale` string is mandatory; the `componentScores` map is optional but recommended.

---

## 15. Mapping into ICD suggestions

The extraction does NOT emit ICD suggestions directly. Instead:

- `ExtractedCondition` rows (Bundle 38 §2.7) feed the ICD Suggestion Engine (Bundle 40).
- The engine reads `extractedCondition.icd10Code` (the best-fit code) as a *hint*, never as a committed coding.
- The engine's full suggestion bundle (Bundle 40 §2) re-derives the candidate code(s) from the evidence; the extracted hint is one input among many.

The extraction's responsibility is the evidence shape. The engine's responsibility is the suggestion.

---

## 16. Mapping into ancillary qualification suggestions

Similarly:

- The Ancillary Qualification Engine (Bundle 37 §10) reads `ClinicalEvidence` rows of the relevant kinds for each ancillary's evidence categories (Bundle 37 §12 spells out the categories per BrainWave / VitalWave / Ultrasound / future).
- The extraction MUST NOT classify a row as belonging to a specific ancillary. Ancillary scoping is downstream.
- The Bundle 41 fixture (`ANCILLARY_QUALIFICATION_FIXTURE_BUNDLES`) pins the suggestion envelope; the extraction feeds it.

---

## 17. PHI envelope

- Snippet text and document body are PHI by definition. Logs at the extraction layer hash these (Bundle 8 PHI-safe logger).
- The audit row for each extraction is counts-only at the info level — the document id is logged, but never the document text.
- An extraction that includes raw snippet text in a non-audit log is non-compliant.

---

## 18. Stop conditions for any future extraction PR

A PR introducing or modifying an extractor MUST stop and ask if:

1. It would persist a row without a complete source reference (§13).
2. It would merge `findings` and `impression` columns (§5, §6).
3. It would substitute findings for impression or fabricate an impression (§6).
4. It would silently downgrade confidence on negation (§9).
5. It would silently reconcile two conflicting rows (§12).
6. It would write a precomputed trend column (§4).
7. It would log raw document text outside the audit boundary (§17).
8. It would write to the Clinical Evidence Store from a route handler instead of the extraction pipeline.
9. It would change the `ExtractedCondition.conditionStatus` enum without updating Bundle 38 §2.7.
10. It would commit an ICD, a qualification, or a billing entry from the extraction layer.
11. It would call an AI model that the architecture doc has not approved.
12. It would change the canonical reasoning blob writes on `patient_screenings.reasoning`.
13. It would flip a feature-flag default in production.

---

## 19. Non-promises

- No specific NLP model is chosen.
- No specific OCR vendor is chosen.
- No specific LOINC mapping table is locked.
- No specific freshness window per `kind` is locked.
- No copied-forward threshold beyond the default `3` is locked.
- No specific imaging-section header alias list is locked.

End of contract.
