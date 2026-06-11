// Ancillary read-model scaffold (Phase 1 Segment F Batch 2).
//
// Pure, dependency-injected accessor that surfaces a single patient's
// ancillary track snapshot. DORMANT in Phase 1 — no route imports it
// and no background job triggers it. Designed so a future approved
// batch can plug an existing storage helper in via the deps seam.
//
// Contract: docs/architecture/phase-1-ancillary-boundary-contract.md

export type AncillaryDocumentSummary = {
  kind: "report" | "order_note" | "post_procedure_note" | "billing_document" | "informed_consent" | "screening_form";
  present: boolean;
  latestAt: string | null;
};

export type AncillaryReadModelSnapshot = {
  patientScreeningId: number;
  appointment: {
    id: number | null;
    facility: string | null;
    procedureStatus: string | null;
    startsAt: string | null;
  };
  documents: AncillaryDocumentSummary[];
  blockers: Array<{ kind: string; reason: string }>;
};

export type AncillaryReadModelDeps = {
  loadAppointment(patientScreeningId: number): Promise<AncillaryReadModelSnapshot["appointment"] | null>;
  loadDocuments(patientScreeningId: number): Promise<AncillaryDocumentSummary[]>;
};

export function isAncillaryReadModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.USE_ANCILLARY_READ_MODEL;
  return v === "1" || v === "true" || v === "yes";
}

const REQUIRED_KINDS: AncillaryDocumentSummary["kind"][] = [
  "report",
  "order_note",
  "post_procedure_note",
];

export async function getAncillarySnapshot(
  patientScreeningId: number,
  deps: AncillaryReadModelDeps,
): Promise<AncillaryReadModelSnapshot> {
  const appointment = (await deps.loadAppointment(patientScreeningId)) ?? {
    id: null,
    facility: null,
    procedureStatus: null,
    startsAt: null,
  };
  const documents = await deps.loadDocuments(patientScreeningId);
  const blockers: AncillaryReadModelSnapshot["blockers"] = [];
  for (const k of REQUIRED_KINDS) {
    const row = documents.find((d) => d.kind === k);
    if (!row || !row.present) blockers.push({ kind: k, reason: "missing" });
  }
  return {
    patientScreeningId,
    appointment,
    documents,
    blockers,
  };
}
