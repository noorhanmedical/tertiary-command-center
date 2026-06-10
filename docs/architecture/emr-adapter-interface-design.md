# EMR adapter interface — design

**Status:** Docs-only (Bundle 39). No adapter code. No credentials. No OAuth implementation. No live API call.
**Date:** 2026-06-10.
**Scope:** Define the conceptual interface every per-vendor EMR adapter must implement so the rest of the platform sees one vendor-neutral facade. Sit between Bundle 37 (architecture contract) and the future Phase 17.2 adapter-skeleton PRs (Bundle 37 §17).
**Cross-references:**
- `emr-integration-clinical-evidence-qualification-contract.md` (Bundle 37 — §1 vendor list, §2 source categories, §14 vendor abstraction).
- `clinical-evidence-store-contract.md` (Bundle 38 — the store adapters feed).
- `labs-imaging-notes-extraction-contract.md` (Bundle 43 — the extraction layer downstream of adapters).
- `patient-directory-shadow-read-contract.md` (Bundle 20 — identity layer adapters feed).
- `aws-readiness-checklist.md` (Bundle 19 — env + secret handling).
- `do-not-touch.md`, `pdf-protection-contract.md`, `billing-invoice-hard-stop-map.md`.

This design ships zero code, zero credentials, zero environment variables. It pins what every adapter PR must satisfy and what it must NEVER do.

---

## 1. Supported vendors

Per Bundle 37 §1, the design must support at least:

- eClinicalWorks
- Epic (FHIR R4)
- Cerner / Oracle Health (FHIR R4 + legacy)
- Athena
- NextGen
- AdvancedMD
- PCC and skilled-nursing-facility (SNF) systems
- Hospice / home-health systems where available
- Future vendors (`future_*`)

A new vendor adapter is a new module under `server/modules/emr-adapters/<vendor>/` (path reserved; not created in this bundle). The dormancy invariant pattern from Bundle 23 / Bundle 27 / Bundle 34 applies once the skeletons exist.

---

## 2. Adapter responsibilities

Every adapter conceptually implements the following capabilities. The interface is defined in terms of what it returns, not how — vendors with different protocols (FHIR REST, HL7 v2, vendor-native SOAP, scraped CSV) must map onto the same outputs.

### 2.1 Authentication boundary

- The adapter never sees raw credentials.
- A separate **credential broker** (out of scope for this design) issues short-lived access tokens. The adapter calls a `credentials.acquire(tenantId, vendorContext)` boundary and receives a token-like object.
- Tokens are never logged. Tokens never appear on a response.
- The adapter MUST reject any code path that would persist a credential.

### 2.2 Tenant / clinic connection

- Every adapter call carries `tenantId` and `vendorContext` (clinic id, location id, vendor-specific routing).
- An adapter that mixes data across tenants is a HARD-STOP failure — this design forbids any code path that could.

### 2.3 Patient search

Inputs: a search predicate (name + DOB OR vendor MRN OR external patient id).
Outputs: a list of candidate vendor patient records with provenance pointers — never the canonical Patient Directory id. Identity resolution happens downstream (Bundle 20).

### 2.4 Patient demographics fetch

Inputs: a vendor patient record id + tenant scope.
Outputs: a normalised demographics envelope (Bundle 37 §2 demographics category). Raw payload pointer included.

### 2.5 Encounter fetch

Inputs: a vendor patient record id + optional window.
Outputs: a list of normalised `Encounter` envelopes (Bundle 38 §2.5). Each encounter carries the vendor record id and the raw payload pointer.

### 2.6 Note / document fetch

Inputs: a vendor patient record id + optional document kind filter + optional window.
Outputs: a list of `ClinicalDocument` envelopes (Bundle 38 §2.2). The adapter MUST preserve vendor-native section boundaries where available; downstream NLP fills the gaps.

### 2.7 Lab fetch

Inputs: a vendor patient record id + optional LOINC filter + optional window.
Outputs: `LabResult` envelopes (Bundle 38 §2.3). Vendor-supplied test names preserved verbatim alongside LOINC mappings where the adapter can supply them.

### 2.8 Imaging report fetch

Inputs: a vendor patient record id + optional modality / body region filter + optional window.
Outputs: `ImagingReport` envelopes (Bundle 38 §2.4). The `impression` slot is mandatory; an empty impression is acceptable only when the source report has no impression section (the adapter MUST not fabricate one).

### 2.9 Medication / problem / allergy fetch

Inputs: vendor patient record id + tenant scope.
Outputs: per-kind lists with vendor source references. Copy-forward signals preserved when the vendor exposes them.

### 2.10 Appointment / referral fetch

Inputs: vendor patient record id + optional window.
Outputs: appointment envelopes + referral envelopes. Read-only.

### 2.11 Source IDs

Every emitted entity carries:

- `vendor` (adapter id).
- `vendorRecordId`.
- `vendorRecordKind`.
- `rawPayloadPointer`.

(per Bundle 38 §2.6).

### 2.12 Sync watermark

The adapter holds a per-(tenantId, vendorPatientRecordId, category) high-water mark — the most recent server-side `updatedAt` seen during the last successful sync. Subsequent syncs ask for "changes since watermark"; full-refresh is a separate code path triggered only by an explicit operator action.

The watermark store is part of the adapter; downstream consumers do not query it.

### 2.13 Retry / backoff

- Network-level retries: exponential backoff, jittered, capped at a per-vendor maximum.
- 4xx responses are NOT retried (vendor said no).
- 5xx and timeouts are retried up to the cap.
- The adapter publishes a `lastErrorAt` and `consecutiveFailures` telemetry pair; the platform's job runner (Bundle 34) consumes them.

### 2.14 Audit trail

Every fetch the adapter issues writes ONE audit row to the audit log:

- `tenantId`, `vendor`, `category`, `vendorPatientRecordId`, `rowsFetched`, `durationMs`, `outcome` (`ok` / `skipped` / `failed`), `correlationId`.

No PHI is logged. `rowsFetched` is a count, not row content.

### 2.15 PHI-safe logging

Every adapter logger consumer uses the Bundle 8 PHI-safe logger contract. Specifically:

- Patient names, DOBs, MRNs — NEVER logged.
- Document text — NEVER logged.
- Vendor record ids — logged only inside the audit row, never in info / warn / error free-text.
- Error messages — caller-facing string only; never the vendor's raw response body.

---

## 3. Conceptual interface shape

The interface is described here in TypeScript-ish pseudo-code for clarity. The eventual implementation is NOT required to use exactly these names; the contract is on intent.

```
interface EmrAdapter {
  readonly vendor: AdapterId;
  readonly supportedCategories: ReadonlySet<EmrSourceCategory>;
  readonly supportsConsentFlags: boolean;

  searchPatients(tenant: TenantContext, predicate: PatientSearchPredicate):
    Promise<PatientSearchResult[]>;

  fetchDemographics(tenant: TenantContext, ref: VendorPatientRecordRef):
    Promise<DemographicsEnvelope>;

  fetchEncounters(tenant: TenantContext, ref: VendorPatientRecordRef, window?: DateWindow):
    Promise<EncounterEnvelope[]>;

  fetchDocuments(tenant: TenantContext, ref: VendorPatientRecordRef,
                 filter?: DocumentKindFilter, window?: DateWindow):
    Promise<ClinicalDocumentEnvelope[]>;

  fetchLabs(tenant: TenantContext, ref: VendorPatientRecordRef,
            filter?: LoincFilter, window?: DateWindow):
    Promise<LabResultEnvelope[]>;

  fetchImaging(tenant: TenantContext, ref: VendorPatientRecordRef,
               filter?: ModalityFilter, window?: DateWindow):
    Promise<ImagingReportEnvelope[]>;

  fetchMedications(tenant: TenantContext, ref: VendorPatientRecordRef):
    Promise<MedicationEnvelope[]>;

  fetchProblems(tenant: TenantContext, ref: VendorPatientRecordRef):
    Promise<ProblemEnvelope[]>;

  fetchAllergies(tenant: TenantContext, ref: VendorPatientRecordRef):
    Promise<AllergyEnvelope[]>;

  fetchAppointments(tenant: TenantContext, ref: VendorPatientRecordRef, window?: DateWindow):
    Promise<AppointmentEnvelope[]>;

  fetchReferrals(tenant: TenantContext, ref: VendorPatientRecordRef, window?: DateWindow):
    Promise<ReferralEnvelope[]>;

  readWatermark(tenant: TenantContext, ref: VendorPatientRecordRef, category: EmrSourceCategory):
    Promise<SyncWatermark | null>;

  writeWatermark(tenant: TenantContext, ref: VendorPatientRecordRef, category: EmrSourceCategory,
                 watermark: SyncWatermark): Promise<void>;
}
```

Capabilities a vendor does not support throw a typed `UnsupportedCapabilityError`. Downstream code MUST handle this case by recording the category as "not queryable from this adapter" rather than treating it as "no evidence found".

---

## 4. What adapters MUST NOT do

- MUST NOT make any HTTP call before the credential broker provides a token.
- MUST NOT cache credentials.
- MUST NOT log credentials, raw PHI text, or vendor response bodies.
- MUST NOT write to the Clinical Evidence Store. Ingestion is downstream.
- MUST NOT decide identity. Patient Directory resolves identity.
- MUST NOT call out to an AI model. AI extraction lives in the NLP layer downstream.
- MUST NOT call billing, claim, remittance, or invoice surfaces.
- MUST NOT trigger an outreach call, scheduling action, or packet generation.
- MUST NOT mutate any other adapter's state.
- MUST NOT cross tenants on any read or watermark write.

---

## 5. Vendor-neutral envelopes

Every envelope returned by an adapter is a Bundle 38 §2 entity shape PLUS a vendor source reference. The envelope is vendor-neutral by construction — downstream code never branches on `vendor`.

If a vendor field has no clean mapping (e.g. a custom "social history" subsection), it goes into the `vendorExtras` blob with a documented key. Engines MAY read `vendorExtras` for debugging but MUST NOT use it as the primary evidence source.

---

## 6. Phasing

Per Bundle 37 §17, adapters land DORMANT in Phase 17.2, behind `USE_EMR_ADAPTERS` (default OFF). The schemas they feed into (raw payload tier, Clinical Evidence Store) land in Phases 17.3 + 17.4. The first vendor activation is its own PR in Phase 17.10.

This design pins the contract so each phase's PR is a one-file additive change against a known interface.

---

## 7. Stop conditions for any future adapter PR

A PR introducing or modifying an adapter MUST stop and ask if:

1. It would make a live API call.
2. It would handle a credential outside the broker boundary (§2.1).
3. It would persist any token.
4. It would change `USE_EMR_ADAPTERS` default in any environment.
5. It would log any PHI / credential / vendor response body.
6. It would write to the Clinical Evidence Store, the Patient Directory, the billing surface, or the engagement assignment writes.
7. It would call an AI model or commit an ICD or qualify a patient.
8. It would cross tenants on any read.
9. It would shorten a retry / backoff window without an explicit risk write-up.
10. It would skip the audit trail row.
11. It would surface vendor branding on a UI (vendor name is a metadata tag, not a UI element).

---

## 8. Verification gates before any vendor activation

Per Bundle 37 §17 Phase 17.10:

1. Dormancy invariant green for the adapter module (mirrors Bundle 19's projection dormancy QA).
2. A no-DB fixture / parity test that exercises the adapter's envelope shapes against canned inputs.
3. A PHI-safe logger check (mirrors Bundle 14's shadow-read schema check) that asserts no banned identifier appears in the adapter file at source-text level.
4. A staging-window observation with `USE_EMR_ADAPTERS=1` on staging only, mirroring `operational-queue-staging-runbook.md`.
5. Rollback drill confirms `USE_EMR_ADAPTERS=0` returns the adapter to dormancy with no leftover state.

---

## 9. Non-promises

- No specific OAuth flow designed.
- No credential broker designed (its design is a separate PR).
- No vendor relationship implied.
- No production rollout date for any vendor.
- No commitment that any vendor ships in any particular order.
- No commitment to a specific transport protocol per vendor beyond what the vendor publishes.

End of design.
