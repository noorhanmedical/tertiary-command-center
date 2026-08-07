// Phase 2K (K41) — executable retry-inventory coverage.
//
// The canonical retry inventory is not just a markdown file: this test drives it from
// the ACTUAL `ANCILLARY_DOCUMENT_FAILURE_ACTIONS` enum so no action can be silently
// dropped, mislabelled WIRED without a writer, or handled-but-unwritten. Every enum
// value has exactly one metadata row; every WIRED action names a writer; every
// INTENTIONALLY_NOT_QUEUED action documents why.
//
//   npx tsx tests/unit/phase2KRetryInventoryCoverage.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { ANCILLARY_DOCUMENT_FAILURE_ACTIONS } from "../../shared/schema/ancillaryDocuments";

type Status = "WIRED" | "INTENTIONALLY_NOT_QUEUED" | "REMOVED";
type Meta = { writer: string | null; worker: string | null; status: Status; reason?: string };

// Traced from `rg` over server/ (writer = the `recordAncillaryDocumentFailure({... requestedAction })`
// site or the `RETRY_ACTION[kind]`/`recordBillingRefRetry(..., action)` indirection;
// worker = the `retryWorker` / `billingRetryHandlers` dispatch branch).
const RETRY_META: Record<string, Meta> = {
  create_reference: { writer: null, worker: null, status: "INTENTIONALLY_NOT_QUEUED", reason: "Enum-reserved reference-lifecycle verb; no active writer enqueues it and no worker dispatches it — reference creation is driven by the exact link_* actions (link_report/link_procedure_note/link_billing_document)." },
  refresh_projection: { writer: "server/services/ancillaryDocuments/legacyProjection.ts", worker: null, status: "INTENTIONALLY_NOT_QUEUED", reason: "Legacy projection-refresh verb; not dispatched by a canonical retry worker (superseded by the exact link_*/generate_* canonical paths)." },
  link_order_note: { writer: "server/services/procedureLifecycle/orderNoteOrchestration.ts", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  link_report: { writer: "server/services/ancillaryDocuments/documentReferenceWriter.ts (RETRY_ACTION[kind])", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  link_consent: { writer: "server/services/ancillaryDocuments/documentReferenceWriter.ts (RETRY_ACTION[kind])", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  link_screening_form: { writer: "server/services/ancillaryDocuments/documentReferenceWriter.ts (RETRY_ACTION[kind])", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  supersede_reference: { writer: null, worker: null, status: "INTENTIONALLY_NOT_QUEUED", reason: "Enum-reserved reference-supersession verb; the canonical supersession path uses supersede_billing_document + the exact reference-durability helper. No active writer/worker." },
  link_order_note_evidence: { writer: "server/services/procedureLifecycle/orderNoteService.ts", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  link_procedure_note: { writer: "server/services/procedureLifecycle/procedureNoteLineage.ts + procedureNoteService.ts", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  link_procedure_note_evidence: { writer: "server/services/procedureLifecycle/procedureNoteService.ts", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  generate_procedure_note: { writer: "server/services/procedureLifecycle/procedureNoteGenerator.ts", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  reconcile_procedure_note_lineage: { writer: "server/services/procedureLifecycle/procedureNoteLineage.ts", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  void_procedure_note: { writer: "server/services/procedureLifecycle/procedureNoteLineage.ts", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  sync_procedure_note_signature: { writer: "server/services/procedureLifecycle/procedureNoteService.ts + procedureNoteGenerator.ts", worker: "server/services/ancillaryDocuments/retryWorker.ts", status: "WIRED" },
  evaluate_billing_readiness: { writer: "server/services/billingLifecycle/billingLifecycleOrchestration.ts + billingReadinessEvaluator.ts", worker: "server/services/billingLifecycle/billingRetryHandlers.ts", status: "WIRED" },
  generate_billing_document: { writer: "server/services/billingLifecycle/billingLifecycleOrchestration.ts", worker: "server/services/billingLifecycle/billingRetryHandlers.ts", status: "WIRED" },
  link_billing_document: { writer: "server/services/billingLifecycle/billingDocumentGenerator.ts (recordBillingRefRetry)", worker: "server/services/billingLifecycle/billingRetryHandlers.ts", status: "WIRED" },
  supersede_billing_document: { writer: "server/services/billingLifecycle/billingLifecycleOrchestration.ts", worker: "server/services/billingLifecycle/billingRetryHandlers.ts", status: "WIRED" },
  sync_billing_document_reference: { writer: "server/services/billingLifecycle/billingDocumentGenerator.ts (recordBillingRefRetry)", worker: "server/services/billingLifecycle/billingRetryHandlers.ts", status: "WIRED" },
};

const enumValues = [...ANCILLARY_DOCUMENT_FAILURE_ACTIONS];

async function run() {
  let failed = 0;
  const check = (name: string, fn: () => void) => { try { fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).message}`); } };

  check("every enum value has exactly one metadata row", () => {
    for (const a of enumValues) assert.ok(RETRY_META[a], `enum action '${a}' missing from RETRY_META`);
  });
  check("no metadata entry names a non-enum action", () => {
    for (const a of Object.keys(RETRY_META)) assert.ok(enumValues.includes(a as never), `RETRY_META names '${a}' which is not in the enum`);
    assert.equal(Object.keys(RETRY_META).length, enumValues.length, "metadata count === enum count");
  });
  check("every WIRED action names a writer AND a worker", () => {
    for (const a of enumValues) {
      const m = RETRY_META[a];
      if (m.status === "WIRED") { assert.ok(m.writer, `WIRED action '${a}' has no writer`); assert.ok(m.worker, `WIRED action '${a}' has no worker`); }
    }
  });
  check("every INTENTIONALLY_NOT_QUEUED action documents a reason", () => {
    for (const a of enumValues) {
      const m = RETRY_META[a];
      if (m.status === "INTENTIONALLY_NOT_QUEUED") assert.ok(m.reason && m.reason.length > 20, `INTENTIONALLY_NOT_QUEUED action '${a}' lacks a documented reason`);
    }
  });
  check("no handled-but-unwritten action is labelled WIRED (a worker without a writer is not WIRED)", () => {
    for (const a of enumValues) {
      const m = RETRY_META[a];
      if (m.worker && !m.writer) assert.notEqual(m.status, "WIRED", `action '${a}' is handled but has no writer — cannot be WIRED`);
    }
  });
  check("no REMOVED action remains in the live enum", () => {
    for (const a of enumValues) assert.notEqual(RETRY_META[a].status, "REMOVED", `enum still contains a REMOVED action '${a}'`);
  });

  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  const wired = enumValues.filter((a) => RETRY_META[a].status === "WIRED").length;
  const notQueued = enumValues.filter((a) => RETRY_META[a].status === "INTENTIONALLY_NOT_QUEUED").length;
  console.log(`\nAll 6 tests passed`);
  console.log(`K41 retry enum coverage: ${enumValues.length}/${enumValues.length} (WIRED=${wired}, INTENTIONALLY_NOT_QUEUED=${notQueued})`);
}
run();
