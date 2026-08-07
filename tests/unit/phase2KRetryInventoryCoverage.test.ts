// Phase 2K (K41) — executable retry-inventory coverage, verified against REPOSITORY SOURCE.
//
// The canonical retry inventory is not just a markdown file: this test drives it from the
// ACTUAL `ANCILLARY_DOCUMENT_FAILURE_ACTIONS` enum AND verifies every claim against the
// real source (fs), so a fictional file name or a mislabelled row can NEVER satisfy K41:
//   • every enum value has exactly one metadata row (1:1, no extras)
//   • every WIRED action names a writer FILE that exists and whose source enqueues the
//     exact action, AND a worker FILE that exists and whose source dispatches it
//   • every INTENTIONALLY_NOT_QUEUED action has writer=null AND worker=null AND is
//     provably skipped by the ancillary retry worker (documented deliberate skip)
//   • a worker-without-a-writer is NOT WIRED
//
//   npx tsx tests/unit/phase2KRetryInventoryCoverage.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ANCILLARY_DOCUMENT_FAILURE_ACTIONS } from "../../shared/schema/ancillaryDocuments";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RETRY_WORKER = "server/services/ancillaryDocuments/retryWorker.ts";
const BILLING_WORKER = "server/services/billingLifecycle/billingRetryHandlers.ts";
const src = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

type Status = "WIRED" | "INTENTIONALLY_NOT_QUEUED" | "REMOVED";
// writerFile/workerFile are REAL repo paths (or null). The test proves each file exists and
// its source contains the exact `"<action>"` literal (the enqueue site / dispatch branch /
// RETRY_ACTION union / recordBillingRefRetry(..., "<action>") indirection all embed it).
type Meta = { writerFile: string | null; workerFile: string | null; status: Status; reason?: string };

const RETRY_META: Record<string, Meta> = {
  // ── INTENTIONALLY_NOT_QUEUED: no writer records these into the ancillary ledger, and the
  // ancillary retry worker explicitly SKIPS them ("driven by their originating source path").
  // (The `refresh_projection` seen in canonicalAppointments/legacyProjection.ts belongs to the
  // SEPARATE canonical-appointment failure ledger via resolveCanonicalAppointmentFailure — it
  // is NOT recorded via recordAncillaryDocumentFailure, so within THIS system it is unwritten.)
  create_reference: { writerFile: null, workerFile: null, status: "INTENTIONALLY_NOT_QUEUED", reason: "Reserved reference-lifecycle verb; no recordAncillaryDocumentFailure site enqueues it and retryWorker deliberately skips it — reference creation is driven by the exact link_* actions." },
  refresh_projection: { writerFile: null, workerFile: null, status: "INTENTIONALLY_NOT_QUEUED", reason: "Reserved projection-refresh verb; not enqueued into the ancillary ledger (the canonical-appointment ledger uses it separately) and retryWorker deliberately skips it." },
  supersede_reference: { writerFile: null, workerFile: null, status: "INTENTIONALLY_NOT_QUEUED", reason: "Reserved reference-supersession verb; canonical supersession is driven by supersede_billing_document + the exact reference-durability helper. No recordAncillaryDocumentFailure writer; retryWorker deliberately skips it." },

  // ── WIRED: writer file enqueues the exact action; worker file dispatches it.
  link_order_note: { writerFile: "server/services/ancillaryDocuments/orderNoteService.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  link_order_note_evidence: { writerFile: "server/services/ancillaryDocuments/orderNoteService.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  link_report: { writerFile: "server/services/ancillaryDocuments/documentReferenceWriter.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  link_consent: { writerFile: "server/services/ancillaryDocuments/documentReferenceWriter.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  link_screening_form: { writerFile: "server/services/ancillaryDocuments/documentReferenceWriter.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  link_procedure_note: { writerFile: "server/services/procedureLifecycle/procedureNoteService.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  link_procedure_note_evidence: { writerFile: "server/services/procedureLifecycle/procedureNoteService.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  generate_procedure_note: { writerFile: "server/services/procedureLifecycle/procedureNoteGenerator.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  reconcile_procedure_note_lineage: { writerFile: "server/services/procedureLifecycle/procedureNoteLineage.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  void_procedure_note: { writerFile: "server/services/procedureLifecycle/procedureNoteLineage.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  sync_procedure_note_signature: { writerFile: "server/services/procedureLifecycle/procedureNoteGenerator.ts", workerFile: RETRY_WORKER, status: "WIRED" },
  evaluate_billing_readiness: { writerFile: "server/services/billingLifecycle/billingReadinessEvaluator.ts", workerFile: BILLING_WORKER, status: "WIRED" },
  generate_billing_document: { writerFile: "server/services/billingLifecycle/billingDocumentGenerator.ts", workerFile: BILLING_WORKER, status: "WIRED" },
  link_billing_document: { writerFile: "server/services/billingLifecycle/billingDocumentGenerator.ts", workerFile: BILLING_WORKER, status: "WIRED" },
  supersede_billing_document: { writerFile: "server/services/billingLifecycle/billingLifecycleOrchestration.ts", workerFile: BILLING_WORKER, status: "WIRED" },
  sync_billing_document_reference: { writerFile: "server/services/billingLifecycle/billingDocumentGenerator.ts", workerFile: BILLING_WORKER, status: "WIRED" },
};

const enumValues = [...ANCILLARY_DOCUMENT_FAILURE_ACTIONS];

async function run() {
  let failed = 0;
  const check = (name: string, fn: () => void) => { try { fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).message}`); } };

  check("every enum value has exactly one metadata row", () => {
    for (const a of enumValues) assert.ok(RETRY_META[a], `enum action '${a}' missing from RETRY_META`);
  });
  check("no metadata entry names a non-enum action; count === enum count", () => {
    for (const a of Object.keys(RETRY_META)) assert.ok(enumValues.includes(a as never), `RETRY_META names '${a}' which is not in the enum`);
    assert.equal(Object.keys(RETRY_META).length, enumValues.length, "metadata count === enum count");
  });
  check("every WIRED action: writer FILE exists + enqueues the exact action; worker FILE exists + dispatches it", () => {
    for (const a of enumValues) {
      const m = RETRY_META[a];
      if (m.status !== "WIRED") continue;
      assert.ok(m.writerFile && m.workerFile, `WIRED action '${a}' must name a writer AND worker file`);
      assert.ok(existsSync(resolve(ROOT, m.writerFile!)), `WIRED '${a}': writer file '${m.writerFile}' does not exist`);
      assert.ok(existsSync(resolve(ROOT, m.workerFile!)), `WIRED '${a}': worker file '${m.workerFile}' does not exist`);
      // The exact "<action>" literal must appear in BOTH the writer source (the
      // recordAncillaryDocumentFailure/recordBillingRefRetry enqueue site or the
      // RETRY_ACTION union) AND the worker source (the dispatch branch / action set).
      assert.ok(src(m.writerFile!).includes(`"${a}"`), `WIRED '${a}': writer '${m.writerFile}' source does not enqueue "${a}"`);
      assert.ok(src(m.workerFile!).includes(`"${a}"`), `WIRED '${a}': worker '${m.workerFile}' source does not dispatch "${a}"`);
    }
  });
  check("every INTENTIONALLY_NOT_QUEUED action: writer=null, worker=null, reason present, and deliberately skipped by the ancillary worker", () => {
    const workerSrc = src(RETRY_WORKER);
    for (const a of enumValues) {
      const m = RETRY_META[a];
      if (m.status !== "INTENTIONALLY_NOT_QUEUED") continue;
      assert.equal(m.writerFile, null, `INTENTIONALLY_NOT_QUEUED '${a}' must have writer=null (do not name a file)`);
      assert.equal(m.workerFile, null, `INTENTIONALLY_NOT_QUEUED '${a}' must have worker=null`);
      assert.ok(m.reason && m.reason.length > 20, `INTENTIONALLY_NOT_QUEUED '${a}' lacks a documented reason`);
      // The ancillary retry worker must document the deliberate skip (its no-automatic-retry comment names the action).
      assert.ok(workerSrc.includes(a), `INTENTIONALLY_NOT_QUEUED '${a}' is not documented as deliberately skipped in ${RETRY_WORKER}`);
      // And no recordAncillaryDocumentFailure worker branch dispatches it.
      assert.ok(!workerSrc.includes(`requestedAction === "${a}"`), `INTENTIONALLY_NOT_QUEUED '${a}' has a dispatch branch — it is actually handled`);
    }
  });
  check("no handled-but-unwritten action is labelled WIRED (a worker without a writer is not WIRED)", () => {
    for (const a of enumValues) {
      const m = RETRY_META[a];
      if (m.workerFile && !m.writerFile) assert.notEqual(m.status, "WIRED", `action '${a}' is handled but has no writer — cannot be WIRED`);
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
