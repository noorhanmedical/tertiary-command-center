// API Integration Station — security policy + writeback readiness.
//
// PHASE 1 SCOPE: the policy here is the single source of truth the
// UI surfaces in the Security & Credentials and Writeback Readiness
// sections. Backend code in Phase 2 reads the same constants to
// enforce these rules at runtime.

import type { IntegrationCredentialPolicy } from "./integrationTypes";

export const INTEGRATION_CREDENTIAL_POLICY: IntegrationCredentialPolicy = {
  secretsServerSideOnly: true,
  vaultReferenceVisible: true,
  phiNeverLogged: true,
  tokensHaveTtl: true,
  credentialChangesAudited: true,
  writebackRequiresApproval: true,
};

// Hard rules surfaced verbatim in the Security & Credentials UI.
export const INTEGRATION_SECURITY_RULES: string[] = [
  "Client secrets are stored server-side in the credential vault. Never in localStorage. Never in source code. Never echoed back to the UI after save.",
  "The Connection Profile stores a vault reference (opaque pointer), not the secret itself. The UI shows a masked reference only.",
  "Tokens are stored in encrypted columns with explicit TTL. Refresh logic runs server-side under an advisory lock.",
  "PHI is never logged. Error messages strip patient identifiers before persisting.",
  "Audit log writes never include PHI.",
  "The Raw FHIR Viewer reads from the raw store with admin-only auth and audit-event logging on every read.",
  "The Secret Rotation flow writes a `Secret Rotated` audit event and never returns the new secret to the browser.",
];

// ─────────────────────────────────────────────────────────────────────────
// Writeback readiness
//
// Writeback is OFF until each prerequisite below is signed off per
// vendor + per scope. The UI renders this as a Phase 1 read-only
// checklist; Phase 2 turns it into a real gating state machine.
// ─────────────────────────────────────────────────────────────────────────

export interface WritebackReadinessRequirement {
  id: string;
  label: string;
  detail: string;
  satisfied: false; // Phase 1: nothing is satisfied yet by design.
}

export const WRITEBACK_READINESS_REQUIREMENTS: WritebackReadinessRequirement[] = [
  {
    id: "writeback-disabled",
    label: "Writeback is disabled by default",
    detail:
      "The UI does not expose any write actions in Phase 1. Backend writeback endpoints do not exist yet.",
    satisfied: false,
  },
  {
    id: "scopes-not-configured",
    label: "Write scopes are not configured on the vendor tenant",
    detail:
      "Vendor OAuth clients in Phase 1 are read-only. Write scopes require vendor approval per tenant.",
    satisfied: false,
  },
  {
    id: "vendor-approval-required",
    label: "Vendor approval required",
    detail:
      "Each vendor must approve write scopes per clinic / tenant before they are enabled.",
    satisfied: false,
  },
  {
    id: "clinical-safety-review",
    label: "Clinical safety review required",
    detail:
      "Writebacks touch the patient chart of record. A clinical safety review must sign off the payload contract per resource.",
    satisfied: false,
  },
  {
    id: "audit-idempotency",
    label: "Audit + idempotency required",
    detail:
      "Every writeback must persist an audit event before the network call, must be idempotent on retry, and must not produce duplicates under concurrent attempts.",
    satisfied: false,
  },
  {
    id: "conflict-handling",
    label: "Conflict handling required",
    detail:
      "Writeback must detect upstream version conflicts (FHIR `If-Match`) and surface them to operators instead of silently overwriting.",
    satisfied: false,
  },
];

export const WRITEBACK_FUTURE_CANDIDATES: { resource: string; note: string }[] = [
  { resource: "DocumentReference.write", note: "Push signed packets back to the EMR chart." },
  { resource: "ServiceRequest.write", note: "Create / update orders in the EMR." },
  { resource: "Observation.write", note: "Push completed observations (e.g., ABI results) back." },
  { resource: "Procedure.write", note: "Record performed procedures in the EMR." },
  { resource: "Encounter.write", note: "Reconcile our scheduled appointments back to the EMR calendar." },
  { resource: "Patient.write (strict controls only)", note: "Patient demographic updates are high-risk — strict controls + per-field allowlist required before enabling." },
];

// Phase 1 honest summary copy used by the UI and the architecture doc.
export const INTEGRATION_PHASE_1_SUMMARY =
  "API Integration Station is MVP foundation-ready for EMR integrations, with eClinicalWorks as the first vendor adapter. Live sync, PHI ingestion, credential vaulting, and writeback require backend Phase 2.";
