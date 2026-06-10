# Clinical Evidence Store — conceptual contract

**Status:** Docs-only (Bundle 38). No schema. No migration. No code.
**Date:** 2026-06-10.
**Scope:** Define the conceptual entities the Clinical Evidence Store holds and the invariants every future runtime PR adopting them must satisfy. Complements `emr-integration-clinical-evidence-qualification-contract.md` (Bundle 37, §5).
**Cross-references:**
- `emr-integration-clinical-evidence-qualification-contract.md` (Bundle 37).
- `emr-adapter-interface-design.md` (Bundle 39 — write side).
- `icd-suggestion-safety-contract.md` (Bundle 40 — read consumer).
- `labs-imaging-notes-extraction-contract.md` (Bundle 43 — extraction pipeline).
- `patient-directory-design.md` + `patient-directory-shadow-read-contract.md` (Bundles 5 + 20).
- `qualification-structure-cleanup-design.md` (Bundle 31).
- `pdf-protection-contract.md`, `do-not-touch.md`, `billing-invoice-hard-stop-map.md`.

This contract does NOT propose tables, columns, indexes, or runtime helpers. It pins the conceptual entity shapes a future Phase 17.4 schema PR (per Bundle 37 §17) must encode.

---

## 1. Position in the stack

```
EMR adapter → raw payload tier → extraction pipeline → Clinical Evidence Store → engines (ICD, qualification) → review → commits
```

The store sits between the raw payload tier (immutable per-vendor capture) and the suggestion engines. It is the ONLY tier the engines read from. The raw tier exists for audit and re-extraction, not for runtime queries.

---

## 2. Conceptual entities

Every entity carries the tenant + canonical patient id; both are mandatory and immutable per row.

### 2.1 `ClinicalEvidence`

The base unit. Every fact extracted from any EMR source is one `ClinicalEvidence` row.

Required fields (conceptual):

- `evidenceId` — opaque server-generated id.
- `tenantId` — multi-tenant isolation key.
- `canonicalPatientId` — Patient Directory id (Bundle 5).
- `kind` — one of: `condition`, `medication`, `allergy`, `lab_result`, `imaging_impression`, `imaging_finding`, `note_extraction`, `procedure_history`, `vital`, `appointment`, `referral`, `hospitalization`, `consent`, `other`.
- `summary` — short clinician-readable label (PHI-safe at the log layer; logged as a hash, not the text).
- `sourceReference` — see §2.6.
- `dateOfService` — ISO date or date-time; mandatory unless explicitly `unknown`.
- `confidence` — see §2.8.
- `reviewStatus` — see §2.9.
- `extractedAt` — when this row was added to the store.
- `supersededByEvidenceId` — null unless the row has been superseded (see §3.3).

`ClinicalEvidence` is append-only. Edits are conceptually supersedes, not updates.

### 2.2 `ClinicalDocument`

A normalised document slice. Used by Bundle 43's NLP extraction.

Required:

- `documentId`.
- `canonicalPatientId`.
- `tenantId`.
- `documentKind` — `visit_note`, `progress_note`, `discharge_summary`, `consult_note`, `pathology_report`, `imaging_report`, `outside_record`, `other`.
- `sections` — keyed map (`indication`, `technique`, `findings`, `impression`, `assessment_plan`, `subjective`, `objective`, etc.). Sections that did not parse cleanly are absent from the map; the original raw payload pointer carries the fallback.
- `dateOfService`.
- `authorProvider` — provider id + display name (PHI-safe at log layer).
- `sourceReference`.
- `extractionMethod` — `vendor_native_sections`, `nlp_segmentation_v1`, `pdf_ocr_v1`, etc.

A `ClinicalDocument` MAY emit zero or more `ClinicalEvidence` rows via §3.

### 2.3 `LabResult`

Required:

- `labResultId`.
- `canonicalPatientId`.
- `tenantId`.
- `loincCode` — nullable when no LOINC mapping exists.
- `vendorTestName`.
- `value` (string preserved verbatim; downstream interpreters parse).
- `unit`.
- `referenceRangeLow` / `referenceRangeHigh` (nullable).
- `abnormalFlag` — `normal`, `high`, `low`, `critical_high`, `critical_low`, `unknown`.
- `collectedAt`, `resultedAt`.
- `orderingProviderId`.
- `sourceReference`.

A trend / time-series is computed at read time from the `LabResult` rows; no precomputed trend table is added by this contract.

### 2.4 `ImagingReport`

Required:

- `imagingReportId`.
- `canonicalPatientId`.
- `tenantId`.
- `modality` — `ct`, `mri`, `xray`, `ultrasound`, `echo`, `nuclear`, `pet`, `other`.
- `bodyRegion`.
- `studyDate`.
- `indication`, `technique`, `findings`, `impression`, `comparison`, `recommendations` — each a string slice; the contract REQUIRES the `impression` field as a distinct slot per Bundle 43.
- `radiologistProviderId`.
- `sourceReference`.

The `impression` slice is the load-bearing input for downstream qualification.

### 2.5 `Encounter`

Required:

- `encounterId`.
- `canonicalPatientId`.
- `tenantId`.
- `encounterType` — `clinic_visit`, `telehealth`, `admission`, `er_visit`, `snf_stay`, `home_health_visit`, `hospice_admission`, `other`.
- `startAt`, `endAt`.
- `facilityId`.
- `attendingProviderId`.
- `principalDiagnosisCode` (nullable; ICD-10 string preserved verbatim).
- `sourceReference`.

### 2.6 `EvidenceSourceReference`

Embedded value type referenced from every entity above.

Required:

- `vendor` — adapter id (`epic`, `eclinicalworks`, `cerner_oracle`, `athena`, `nextgen`, `advancedmd`, `pcc`, `future_*`).
- `vendorRecordId` — the source record id in the vendor system.
- `vendorRecordKind` — `fhir_resource`, `hl7_segment`, `vendor_native_document`, `pdf_attachment`, `manual_upload`.
- `rawPayloadPointer` — opaque id into the raw payload tier; sufficient to round-trip to the original bytes for audit.
- `extractedSnippet` — for note extractions, the document span (start offset + end offset within the source document) that produced the evidence. Mandatory for NLP-derived rows.
- `extractionMethod` — `vendor_native`, `nlp_v1`, `clinician_manual`, `admin_manual`.

### 2.7 `ExtractedCondition`

Specialisation of `ClinicalEvidence` with `kind: "condition"`. Adds:

- `icd10Code` — best-fit code; nullable when no mapping exists.
- `conditionStatus` — `active`, `historical`, `resolved`, `ruled_out`, `suspected`, `copied_forward_unverified`.
- `negationDetected` — boolean (true when the source phrase was negated, e.g. "no chest pain").
- `lateralityHint`, `severityHint` — optional strings for downstream display.

### 2.8 `EvidenceConfidence`

Embedded value type carried by every `ClinicalEvidence`, `IcdSuggestion`, and `AncillaryQualificationSuggestion`.

Required:

- `band` — `low`, `medium`, `high`.
- `rationale` — short string explaining why the band was chosen (vendor-native vs NLP-derived vs OCR-derived; agreement across sources; recency).
- `componentScores` — optional named score map for engines that decompose confidence (e.g. `vendor`, `recency`, `agreement`).

### 2.9 `EvidenceReviewStatus`

Embedded value type carried by every `ClinicalEvidence` (and by every downstream suggestion).

Required:

- `status` — `unreviewed`, `clinician_accepted`, `clinician_rejected`, `admin_overridden`, `superseded`.
- `reviewerActorId` — populated for any status other than `unreviewed`.
- `reviewedAt`.
- `reviewerNote` — short PHI-aware free-text; logged as hash only.

### 2.10 `ConflictingEvidence`

Pointer entity (not stored as a row by itself; a derived view at read time). Conceptually:

- Two or more `ClinicalEvidence` rows that disagree on the same axis for the same patient (e.g. an active diabetes problem-list entry alongside an A1c result inconsistent with diabetes).
- A read-side query joins them with a `conflictKind` label.
- The Ancillary Qualification Engine MUST surface conflicts in its suggestion bundle's `exclusions` and `missingEvidence` fields.

### 2.11 `StaleEvidence`

A `ClinicalEvidence` row whose `dateOfService` is older than a per-`kind` freshness window OR whose source document has been amended/superseded in the vendor system. The store flags staleness derivedly; engines MUST treat stale evidence as `confidence.band` capped at `medium`.

### 2.12 `MissingEvidenceItem`

Not a stored entity. A derived list emitted by the suggestion engines per §11 of Bundle 37. Each entry names:

- The evidence kind expected.
- The reason it is missing (`not_present_in_store`, `present_but_stale`, `present_but_low_confidence`, `present_but_rejected`).
- A pointer to where it would normally be obtained.

---

## 3. Invariants

### 3.1 Append-only

No `ClinicalEvidence` row is ever mutated after insert. State changes (review, supersede) write a NEW row with `supersededByEvidenceId` pointing at the predecessor.

### 3.2 Provenance is mandatory

No `ClinicalEvidence` is admitted without a `sourceReference`. A row whose `vendor` is `clinician_manual` or `admin_manual` carries the reviewer's actor id in place of the vendor record id, but the reference itself is non-null.

### 3.3 Supersede semantics

A row is superseded when:

- The same vendor emits an amended version.
- A clinician reviewer rejects the row.
- A higher-confidence extraction supersedes a lower-confidence one.

`supersededByEvidenceId` is the only edge; cycles are forbidden.

### 3.4 PHI boundaries

- Row text fields (`summary`, `extractedSnippet`, `reviewerNote`) carry PHI by definition.
- Logs at the observability layer MUST hash these fields (Bundle 8 PHI-safe logger).
- Patient identifiers (`canonicalPatientId`, `vendorRecordId`) MAY appear in audit logs but NEVER in user-facing analytics or BI exports.
- Cross-tenant queries are forbidden at the persistence layer (enforced by the read repo when it lands).

### 3.5 Audit trail

Every write to the store produces an audit row that captures:

- The actor (system / vendor adapter / clinician / admin).
- The action (`insert`, `supersede`, `review_accept`, `review_reject`, `admin_override`).
- A pointer to the evidence id touched.
- A hash of the relevant text snippet for forensic comparison (PHI-safe).

Reads do NOT produce audit rows (they're too high-volume); the read layer's logger emits counts-only telemetry per Bundle 8.

### 3.6 Tenant isolation

The persistence layer rejects any query that does not carry a `tenantId`. The conceptual contract is: there is no "global" view of the store. Every helper, every join, every read takes a tenant scope.

### 3.7 Read-mostly

Engines read in batches keyed by canonical patient id. Per-fact mutation is rare and only via supersede. No engine writes to the store.

---

## 4. Read patterns the store must support

Conceptual queries (no SQL implied):

- "All evidence for canonical patient X within tenant T."
- "All evidence for canonical patient X of kind K within window W."
- "All lab results for canonical patient X with LOINC L."
- "Most recent imaging impression for canonical patient X of modality M and body region R."
- "All evidence for canonical patient X whose review status is `unreviewed` and whose extraction method is `nlp_v1`."

Plus the derived views in §2.10 (`ConflictingEvidence`) and §2.11 (`StaleEvidence`).

The future repo PR satisfies these query shapes; this contract pins which shapes the engines need.

---

## 5. Source traceability

Every evidence row exposes:

- `sourceReference.vendor` (which EMR).
- `sourceReference.vendorRecordId` (which vendor record).
- `sourceReference.vendorRecordKind` (FHIR resource / HL7 segment / PDF / manual).
- `sourceReference.rawPayloadPointer` (audit round-trip key).
- For NLP-derived rows, the document span (start + end offset within the source document) is mandatory.

A Plexus IQ aggregate read (Bundle 25) forwards these pointers byte-identical into the modal so a clinician reviewer can drill into the source without losing context.

---

## 6. Audit trail expectations

In addition to §3.5:

- The audit log retains rows for the regulatory horizon (out of scope here; pinned as a requirement).
- The Admin Review approval pipeline (Bundle 30) is the audit-of-record for any commit-side action. The Clinical Evidence Store's own audit is the *source-side* audit; the two are joined at read time by `evidenceId` + `patientScreeningId` pointers.

---

## 7. Stop conditions for the future runtime PR

A runtime PR adopting this contract MUST stop and ask if:

1. It would store any evidence row without a `sourceReference`.
2. It would mutate any row instead of supersede.
3. It would skip the tenant scope on any query.
4. It would emit raw PHI to a non-audit log.
5. It would add a write path callable from any engine (engines are read-only consumers).
6. It would add a migration before the §5 Patient Directory adoption (Phase 17.5 in Bundle 37 §17).
7. It would change the evidence row's `kind` enum without updating this contract.
8. It would couple two evidence rows other than via `supersededByEvidenceId`.
9. It would surface evidence on a UI without honouring §3.4 PHI rules.
10. It would log evidence text without the Bundle 8 hashing layer.

---

## 8. Non-promises

- No SQL schema implied.
- No vendor relationship implied.
- No storage cost / capacity planning.
- No retention policy specified (deferred to compliance + legal).
- No production rollout date.

End of contract.
