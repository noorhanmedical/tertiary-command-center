# EMR integration + Clinical Evidence + Ancillary Qualification contract

**Status:** Docs-only (Bundle 37). No runtime code. No EMR API call. No credential read. No live data exchange.
**Date:** 2026-06-10.
**Scope:** Pin the architecture every future EMR-integration PR must conform to, so that future runtime work for Patient Directory adoption and Ancillary Qualification cleanup does not silently bake in a model that bypasses human review or that mixes raw EMR data with clinically actionable outputs.
**Cross-references:**
- `patient-directory-design.md` + `patient-directory-shadow-read-contract.md` (Bundles 5 + 20).
- `plexus-iq-read-model-contract.md` + `qualification-structure-cleanup-design.md` (Bundles 25 + 31).
- `admin-review-approval-commit-inventory.md` (Bundle 30 — approval pipeline steady state).
- `pdf-protection-contract.md` (PDF / packet protection).
- `billing-invoice-hard-stop-map.md` (money-territory enumeration).
- `do-not-touch.md` + `protected-flows.md`.

This contract introduces **zero new runtime code**. Every named module / store / engine is a conceptual entity. A future PR that proposes any of them MUST cite this contract by §-number in its description and respect the §16 review boundaries.

---

## 1. Multi-EMR API integration

The platform must support multiple EMR vendors over time. The integration architecture treats every vendor as a **plug-in adapter** behind a vendor-neutral facade. No code path may hard-code one EMR's quirks; vendor differences live in adapters, not in downstream consumers.

In-scope target EMR vendors (§14 names the adapter abstraction; specific vendor work is `emr-adapter-interface-design.md`, Bundle 39):

- eClinicalWorks
- Epic (FHIR R4)
- Cerner / Oracle Health (FHIR R4 + legacy)
- Athena
- NextGen
- AdvancedMD
- PCC and skilled-nursing-facility (SNF) systems
- Hospice / home-health systems where available
- Future vendors

No runtime PR may add an adapter without first satisfying the gates in `emr-adapter-interface-design.md`.

---

## 2. EMR source categories

Every adapter classifies what it returns into one of these source categories. Downstream consumers (Patient Directory, Clinical Evidence Store, Screening Engine) MUST treat the categories as the contract — never the raw vendor payload shape.

- **Demographics** — name, DOB, sex, race / ethnicity (where consented), preferred language, contact info.
- **MRN / external patient IDs** — the vendor's internal patient identifier + any cross-EMR identifier.
- **Encounters** — visits, admissions, telehealth sessions, hospitalisations, SNF stays, hospice admissions, home-health visits.
- **Visit notes** — H&P, clinic visit notes, follow-up notes.
- **Progress notes** — inpatient daily progress notes, SOAP notes.
- **Discharge summaries** — inpatient + SNF + hospice discharge.
- **Consult notes** — specialty consults, second opinions.
- **Medication lists** — active meds, historical meds, MAR (where available).
- **Allergy lists** — active allergies, severity, reaction.
- **Problem lists** — active conditions, resolved conditions, copied-forward problems flagged separately.
- **Diagnosis history** — date-stamped ICD codings from prior encounters.
- **Procedures** — completed procedures, CPT codes (read-only).
- **Vitals** — BP, HR, RR, SpO2, weight, height, BMI.
- **Labs** — chemistry, hematology, urinalysis, microbiology, anatomic pathology.
- **Imaging reports** — radiology + cardiology + neurology + ophthalmology + dermatology imaging.
- **Pathology reports** — anatomic + clinical pathology.
- **Orders** — open orders, completed orders, cancelled orders.
- **Documents** — uploaded PDFs, scanned outside records, external consult letters.
- **Insurance / payer data** — primary + secondary insurance, plan IDs, eligibility data (read-only; no claim writes).
- **Care team / provider attribution** — PCP, attending, consulting providers, care managers.
- **Appointments** — upcoming + historical appointments.
- **Referrals** — incoming + outgoing referrals.
- **Hospitalisations** — admission/discharge dates, principal diagnosis.
- **SNF / home-health / hospice records** — where available; read-only.

A category may be **unsupported** by a vendor (e.g. a small clinic's EMR may not surface pathology). Adapters MUST declare unsupported categories so the engine does not interpret absence as "no evidence" vs "not queryable".

---

## 3. Patient Directory as canonical identity layer

The Patient Directory (Batch 5 — design in `patient-directory-design.md`) is the **only** canonical identity layer. Every EMR adapter writes its raw demographics + MRN into a per-EMR ingestion staging area; the Patient Directory resolves identity across vendors and emits the canonical patient id consumed by everything downstream.

- No downstream engine (Screening, ICD Suggestion, Ancillary Qualification, Admin Review) may resolve identity from a raw EMR payload.
- All cross-EMR identity matching, deduplication, and merge-review go through Patient Directory.
- The Patient Directory shadow-read contract (Bundle 20) gates any future runtime cutover.

---

## 4. Raw EMR payloads vs normalized facts

Two distinct storage tiers, with a one-way arrow between them.

1. **Raw payload tier** — Per-EMR vendor JSON / FHIR resource / HL7 segment captured as received. Read-only after ingestion. Source of audit truth. Never queried by downstream engines.
2. **Normalized fact tier** — The Clinical Evidence Store (§5). Vendor-neutral schema; every fact carries provenance pointers back to the raw payload it was extracted from.

A downstream engine MUST NOT cross the boundary. The Screening Engine, ICD Suggestion Engine, and Ancillary Qualification Engine read only from the Clinical Evidence Store. The raw tier exists for audit, dispute resolution, and re-extraction.

---

## 5. Clinical Evidence Store

The Clinical Evidence Store holds normalized facts extracted from raw EMR payloads. Conceptual model lives in `clinical-evidence-store-contract.md` (Bundle 38).

Properties this contract pins:

- Read-mostly. Writes are via the ingestion pipeline only.
- Per-fact provenance: source EMR, source document/encounter id, date of service, author/provider, extraction method, extraction confidence.
- Per-fact review status: AI-extracted / clinician-verified / clinician-rejected / superseded.
- No PHI is logged outside the audit trail; counts only at observability layer.
- Multi-tenant isolation: every row carries a tenant id; queries cannot cross tenants.

---

## 6. Labs ingestion

Labs are a first-class evidence source. The ingestion pipeline normalises:

- LOINC code (where mappable from vendor codes).
- Test name (vendor-supplied string preserved alongside the LOINC mapping).
- Result value + unit.
- Reference range + abnormal flag (high / low / critical-high / critical-low).
- Date of service + result-released date.
- Ordering provider.

Trend detection (§7 of `labs-imaging-notes-extraction-contract.md`, Bundle 43) operates on the normalised lab series, not the raw vendor field shape.

---

## 7. Imaging / report ingestion

Imaging reports carry distinct sections that the ingestion pipeline preserves:

- Indication.
- Technique.
- Findings.
- **Impression** (load-bearing — distinguished from findings in extraction).
- Comparison.
- Recommendations.

The Notes/Document NLP (§8) MUST distinguish impressions from findings. Bundle 43 binds that distinction.

---

## 8. Notes / document NLP

The NLP layer extracts:

- Conditions (active vs historical vs ruled-out vs suspected).
- Symptoms.
- Procedures (planned vs performed).
- Medications (mentioned vs prescribed).
- Negation handling (`no chest pain` does NOT extract chest pain as an active condition).
- Copy-forward detection (problems carried verbatim across N+ consecutive notes flagged).
- Source span preservation: every extracted fact retains the snippet + offset + document id.

The NLP layer's output is evidence, not a verdict. Verdicts come from §9 + §10.

---

## 9. ICD Suggestion Engine

The ICD Suggestion Engine is **suggestion-only**. It NEVER commits an ICD to billing, NEVER updates the patient's active problem list, NEVER writes a claim line. Its full contract is `icd-suggestion-safety-contract.md` (Bundle 40).

Properties pinned here:

- Every suggestion bundles: candidate ICD-10 code(s), supporting evidence with source references, missing evidence, contradicting evidence, suspected/confirmed/ruled-out classification, clinical rationale string, confidence band, model id + prompt hash, review status (`unreviewed` | `accepted` | `rejected`).
- The engine has NO write authority over `billing_records`, `billing_documents`, `completed_billing_packages`, `invoices`, or `projected_invoices` (per `billing-invoice-hard-stop-map.md`).
- A clinician or admin reviewer must accept a suggestion before any downstream system treats it as a coded diagnosis.

---

## 10. Ancillary Qualification Engine

Same posture as §9 — suggestion-only.

- Inputs: the Clinical Evidence Store + the ICD suggestion outputs.
- Outputs: per-ancillary qualification suggestion bundles (see §11).
- Cannot commit to scheduling, packet generation, or billing.
- Cannot trigger an outreach call.
- Cannot update `patient_screenings.qualifyingTests` directly — that field is owned by the existing AI services + Admin Review approval pipeline (Bundle 30).

---

## 11. Suggested qualification output

Every qualification suggestion the engine emits MUST carry, for each ancillary considered:

- **`ancillary`** — name (`brainwave`, `vitalwave`, `ultrasound`, future entries).
- **`suggestedStatus`** — `qualified` | `not_qualified` | `needs_more_evidence` | `excluded`.
- **`supportingEvidence`** — array of evidence ids from the Clinical Evidence Store, each with source references.
- **`missingEvidence`** — enumerated list of evidence items the engine looked for but did not find.
- **`exclusions`** — contraindications + exclusionary findings (e.g. pacemaker contraindicates one of the ancillaries).
- **`sourceReferences`** — provenance pointers (encounter id, lab id, imaging report id, document span).
- **`confidence`** — band (`low` | `medium` | `high`) with rationale.
- **`reviewStatus`** — `unreviewed` | `clinician_accepted` | `clinician_rejected` | `admin_overridden`.
- **`humanApprovalRequired`** — boolean. Always `true` for any status that would otherwise cause a downstream action.

A suggestion MUST NOT propagate past `reviewStatus: "unreviewed"` to any committal surface (§17.5).

---

## 12. BrainWave / VitalWave / Ultrasound examples

The architecture explicitly anticipates these three ancillaries plus future entries.

- **BrainWave** — neurological ancillary. Evidence categories drawn from neurological exam findings in visit notes, neuro-imaging impression sections, gait / cognitive screening labs, sleep-study reports where available, contraindications (e.g. severe metal hardware contra to certain modalities).
- **VitalWave** — cardiopulmonary ancillary. Evidence categories drawn from BP / HR vitals trends, cardiac labs (BNP, troponin), echocardiogram impression, lifestyle / medication context.
- **Ultrasound** — multi-organ ancillary. Evidence categories drawn from imaging reports, lab markers per organ system, ICD history per organ system.
- **Future ancillaries** — placeholder anticipated by §11 (`future_*`). Adding a new ancillary requires updating §11 and §17.

Specific qualification rules per ancillary live in a future per-ancillary contract; this document pins the *envelope*.

---

## 13. Conceptual entities

The runtime architecture, in entity form (no schema columns named here — those are deferred to per-store contracts):

- `RawEmrPayload` — vendor JSON / FHIR / HL7 capture, immutable.
- `Patient` (canonical) — owned by Patient Directory.
- `EmrSourceLink` — bridge between a canonical patient and one or more EMR records (per vendor, per facility).
- `ClinicalEvidence` — the normalized fact (§5).
- `ClinicalDocument` — a normalised document slice with section breakdown.
- `LabResult` — normalised lab.
- `ImagingReport` — normalised imaging report with section breakdown.
- `Encounter` — normalised encounter.
- `ExtractedCondition` — output of NLP / vendor problem-list ingestion.
- `IcdSuggestion` — Bundle 40 contract.
- `AncillaryQualificationSuggestion` — §11 envelope.
- `ReviewActor` — clinician or admin who reviewed a suggestion.
- `ReviewDecision` — append-only audit record of accept / reject / override / supersede.

---

## 14. Vendor abstraction

Vendor-specific behavior is sealed inside adapters. The downstream architecture sees:

- A vendor-neutral `EmrAdapter` interface (Bundle 39).
- A vendor-neutral fact stream into the Clinical Evidence Store.
- A vendor-neutral identity emission into Patient Directory.

No client code, no Screening Engine code, no Admin Review code reads vendor names at runtime. Vendor name is a metadata tag on stored evidence (for provenance), never a branching axis in downstream logic.

---

## 15. Security / compliance

Cross-cutting rules:

- **PHI-safe logging** — Bundle 8 logger contract is mandatory. No EMR payload, no patient name, no DOB, no MRN, no document text in any non-audit log.
- **Audit trail** — every fact ingested, every suggestion emitted, every review decision is append-only.
- **Tenant isolation** — every read and every write carries the tenant id; cross-tenant queries are not possible from any engine.
- **Encryption** — raw payloads encrypted at rest. Out of scope to design here; pinned as a requirement.
- **Access control** — RBAC envelope from `team-portal-playground-wiring-contract.md` §21 extends to clinical evidence — clinicians see only their facility scope by default.
- **Consent boundaries** — no field beyond consented categories is ingested for any specific patient. Adapters report consent flags per-patient.

---

## 16. Review boundaries

The boundary between machine output and human action is explicit:

1. **AI extracts evidence.** Always allowed.
2. **AI suggests ICD codings.** Always allowed; never committed to billing without §16.5.
3. **AI suggests ancillary qualification.** Always allowed; never advances the patient to scheduling / billing without §16.5.
4. **AI flags conflicts / missing evidence.** Always allowed.
5. **A clinician or admin reviewer accepts a suggestion.** Required before any of the following: ICD commit, qualification commit, supporting-button enable, packet generation, scheduling trigger, billing event, revenue activity.
6. **Admin Review approval pipeline (Bundle 30)** stays the canonical commit surface. The aggregate read in `plexus-iq-read-model-contract.md` (Bundle 25) is the read-side complement.

Raw EMR data MUST NEVER directly trigger:

- Final qualification (`patient_screenings.qualifyingTests` write).
- Scheduling.
- Packet generation (`pdf-protection-contract.md`).
- Billing.
- ICD commit.
- Revenue / invoice activity.
- Outreach calls.
- Engagement Center assignment writes.

---

## 17. Future implementation phases

These are sequenced for a future planning cycle; this bundle ships none of them.

1. **Phase 17.1 — Conceptual contracts (this Bundle 37 + Bundles 38–44).** Pure docs + fixtures + invariant QA. No runtime.
2. **Phase 17.2 — EMR adapter skeleton.** One adapter file per target vendor as DORMANT modules behind a `USE_EMR_ADAPTERS` flag default OFF. No API calls.
3. **Phase 17.3 — Raw payload staging schema.** Migration + ingestion writer. Default-OFF.
4. **Phase 17.4 — Clinical Evidence Store schema + repo.** Migration + read-only repo helpers.
5. **Phase 17.5 — Patient Directory adoption of EMR source links.** Behind Bundle 20's shadow-read flag.
6. **Phase 17.6 — Labs / imaging / notes extraction stubs.** Read-only stubs with no model calls.
7. **Phase 17.7 — ICD Suggestion Engine v0.** Read-only suggestion endpoint; explicit no-commit guards.
8. **Phase 17.8 — Ancillary Qualification Engine v0.** Read-only suggestion endpoint; explicit no-commit guards.
9. **Phase 17.9 — Admin Review modal adoption of suggestions.** Modal renders suggestion bundles; reviewer accept/reject writes route through existing Admin Review pipeline (Bundle 30).
10. **Phase 17.10 — Per-vendor adapter activation.** One vendor at a time, behind per-vendor feature flags, with staging gates (mirrors `portal-cutover-readiness-checklist.md`).
11. **Phase 17.11 — Production cutover.** Separate PR per vendor. Each owns its own §7 staging-window evidence.

No date attached to any phase. Each phase is its own approved PR.

---

## 18. Stop conditions for any future runtime PR

A runtime PR adjacent to this architecture MUST stop and ask if:

1. It would call a live EMR API.
2. It would write or read OAuth credentials.
3. It would add a database migration.
4. It would change Patient Directory runtime behavior.
5. It would change qualification logic, supporting button behavior, or canonical reasoning writes.
6. It would commit an ICD code to billing.
7. It would auto-approve a qualification suggestion.
8. It would render an Admin Review surface without honouring §16.5.
9. It would flip a feature flag default in production.
10. It would surface raw EMR data on a UI without a review-status badge.
11. It would change PDF / packet generation.
12. It would emit a money calculation.
13. It would change an endpoint response shape.

---

## 19. Non-promises

- No EMR vendor relationship implied.
- No OAuth flow designed.
- No credential storage designed.
- No production rollout date.
- No commitment that any phase ships in any particular order — each is an independently approved future PR.
- No specific qualification rules per ancillary. Those live in per-ancillary contracts.

End of contract.
