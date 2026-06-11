// Billing readiness aggregator V2 scaffold (Phase 1 Segment G Batch 2).
//
// DORMANT module. Pure, dependency-injected pipeline that computes
// the BillingReadinessSnapshot defined in the G1 contract from
// upstream ancillary + signing inputs. No db / drizzle / express
// coupling; no PHI; no money mutations.
//
// Contract: docs/architecture/phase-1-billing-readiness-boundary-contract.md

import { requiresPhysicianSignature } from "../ancillary/signingService";

export type BillingReadinessBlockerKind =
  | "missing_document"
  | "unsigned_document"
  | "procedure_not_complete"
  | "eligibility_unknown";

export type BillingReadinessBlocker = {
  kind: BillingReadinessBlockerKind;
  documentKind?: string;
  note?: string;
};

export type BillingReadinessStatus = "incomplete" | "blocked" | "ready" | "billed";

export type BillingReadinessSnapshot = {
  patientScreeningId: number;
  readinessStatus: BillingReadinessStatus;
  blockers: BillingReadinessBlocker[];
  lastEvaluatedAt: string;
};

export type DocumentInput = {
  kind: string;
  present: boolean;
  signingStatus?: "unsigned" | "pending" | "signed" | "declined" | "revoked";
};

export type BillingReadinessInputs = {
  patientScreeningId: number;
  procedureComplete: boolean;
  eligibilityKnown: boolean;
  documents: DocumentInput[];
  alreadyBilled: boolean;
  now: () => Date;
};

export function isBillingReadinessAggregatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.USE_BILLING_READINESS_AGGREGATOR_V2;
  return v === "1" || v === "true" || v === "yes";
}

const BILLING_REQUIRED_DOCS = ["report", "order_note", "post_procedure_note", "billing_document"];

export function computeBillingReadiness(inputs: BillingReadinessInputs): BillingReadinessSnapshot {
  const blockers: BillingReadinessBlocker[] = [];
  if (inputs.alreadyBilled) {
    return {
      patientScreeningId: inputs.patientScreeningId,
      readinessStatus: "billed",
      blockers: [],
      lastEvaluatedAt: inputs.now().toISOString(),
    };
  }
  if (!inputs.procedureComplete) {
    blockers.push({ kind: "procedure_not_complete" });
  }
  if (!inputs.eligibilityKnown) {
    blockers.push({ kind: "eligibility_unknown" });
  }
  for (const kind of BILLING_REQUIRED_DOCS) {
    const row = inputs.documents.find((d) => d.kind === kind);
    if (!row || !row.present) {
      blockers.push({ kind: "missing_document", documentKind: kind });
      continue;
    }
    if (requiresPhysicianSignature(kind) && row.signingStatus !== "signed") {
      blockers.push({ kind: "unsigned_document", documentKind: kind, note: row.signingStatus ?? "unsigned" });
    }
  }
  let status: BillingReadinessStatus;
  if (blockers.length === 0) status = "ready";
  else if (blockers.some((b) => b.kind === "procedure_not_complete" || b.kind === "eligibility_unknown"))
    status = "incomplete";
  else status = "blocked";
  return {
    patientScreeningId: inputs.patientScreeningId,
    readinessStatus: status,
    blockers,
    lastEvaluatedAt: inputs.now().toISOString(),
  };
}
