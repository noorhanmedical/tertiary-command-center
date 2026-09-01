// Phase 2E FINAL REVIEW — ownership, synchronization, and scheduler identity.
//
//   npx tsx tests/unit/phase2EFinalReview.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const repo = () => import("../../server/repositories/ancillaryDocuments.repo");
const ancRepo = () => import("../../server/repositories/ancillaryCases.repo");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const orderNote = () => import("../../server/services/ancillaryDocuments/orderNoteService");
const routeMod = () => import("../../server/routes/executionCases");

// ─── Predicate-aware store fake ───────────────────────────────────
type Row = Record<string, any>;
function colKeyMap(table: any): Record<string, string> { const m: Record<string, string> = {}; for (const [k, v] of Object.entries(table)) if (v && typeof v === "object" && typeof (v as any).name === "string") m[(v as any).name] = k; return m; }
type Tok = { col?: string; op?: string; val?: unknown };
function tokenize(cond: any): Tok[] { const toks: Tok[] = []; (function walk(o: any, d = 0): void { if (d > 16 || o == null || typeof o !== "object") return; if (typeof o.name === "string" && o.table) toks.push({ col: o.name }); else if ("value" in o && (o.encoder || o.type) && !Array.isArray(o.value)) toks.push({ val: o.value }); else if (Array.isArray(o.value) && o.value.every((x: any) => typeof x === "string")) toks.push({ op: o.value.join("").trim() }); if (Array.isArray(o.queryChunks)) o.queryChunks.forEach((c: any) => walk(c, d + 1)); else if (Array.isArray(o)) o.forEach((c: any) => walk(c, d + 1)); })(cond); return toks; }
const CMP = new Set(["=", "<", ">", "<>", "is null", "is not null"]);
function triples(cond: any): Array<[string, string, unknown]> { const out: Array<[string, string, unknown]> = []; let col: string | null = null, op: string | null = null; for (const tk of tokenize(cond)) { if (tk.col !== undefined) { col = tk.col; op = null; } else if (tk.op !== undefined && CMP.has(tk.op)) { op = tk.op; if ((op === "is null" || op === "is not null") && col) { out.push([col, op, undefined]); col = null; op = null; } } else if (tk.val !== undefined && col && op) { out.push([col, op, tk.val]); col = null; op = null; } } return out; }
function rowMatches(row: Row, table: any, cond: any): boolean { if (cond == null) return true; const cm = colKeyMap(table); for (const [c, o, v] of triples(cond)) { const key = cm[c] ?? c; const rv = row[key]; if (o === "=") { if (String(rv) !== String(v)) return false; } else if (o === "<>") { if (String(rv) === String(v)) return false; } else if (o === "is null") { if (rv != null) return false; } else if (o === "is not null") { if (rv == null) return false; } else if (o === "<") { if (!(rv < (v as any))) return false; } } return true; }
type StoreFake = { db: any; store: Map<any, Row[]>; calls: Array<{ op: string; table: any }>; failTable?: any };
function buildStoreFake(store: Map<any, Row[]>, opts: { failTable?: any; failCode?: string } = {}): StoreFake {
  const calls: Array<{ op: string; table: any }> = []; const idc = new Map<any, number>(); const nextId = (t: any) => { const n = (idc.get(t) ?? 9000) + 1; idc.set(t, n); return n; };
  const ctrl: StoreFake = { db: null, store, calls, failTable: opts.failTable };
  const fail = () => Promise.reject(Object.assign(new Error("boom"), { code: opts.failCode ?? "08006" }));
  const fake: any = {
    select() { let t: any = null, cond: any = null; const chain: any = { from(x: any) { t = x; return chain; }, leftJoin() { return chain; }, innerJoin() { return chain; }, where(c: any) { cond = c; return chain; }, orderBy() { return chain; }, groupBy() { return chain; }, $dynamic() { return chain; }, limit() { return result(); }, then(res: any, rej: any) { Promise.resolve().then(result).then(res, rej); } }; function result() { if (ctrl.failTable != null && t === ctrl.failTable) return fail(); calls.push({ op: "select", table: t }); return Promise.resolve((store.get(t) ?? []).filter((r) => rowMatches(r, t, cond)).map((r) => ({ ...r }))); } return chain; },
    insert(t: any) { return { values(v: Row) { const settle = () => { if (ctrl.failTable != null && t === ctrl.failTable) return fail(); calls.push({ op: "insert", table: t }); const row = { ...v, id: v.id ?? nextId(t) }; (store.get(t) ?? store.set(t, []).get(t)!).push(row); return Promise.resolve([{ ...row }]); }; return { returning: settle, onConflictDoNothing() { return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; }, then: (r: any, j?: any) => settle().then(r, j) }; } }; },
    update(t: any) { return { set(v: Row) { let cond: any = null; return { where(c: any) { cond = c; const settle = () => { if (ctrl.failTable != null && t === ctrl.failTable) return fail(); calls.push({ op: "update", table: t }); const rows = (store.get(t) ?? []).filter((r) => rowMatches(r, t, cond)); rows.forEach((r) => Object.assign(r, v)); return Promise.resolve(rows.map((r) => ({ ...r }))); }; return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; } }; } }; },
    delete() { return { where() { return { returning: () => Promise.resolve([]), then: (r: any) => Promise.resolve([]).then(r) }; } }; },
    async transaction(fn: any) { return fn(fake); }, execute: async () => ({ rows: [] }),
  };
  ctrl.db = fake; return ctrl;
}
type Flags = { unifiedAncillaryDocuments?: boolean; canonicalOrderNote?: boolean };
async function runWithStore<T>(ctrl: StoreFake, flags: Flags, fn: () => Promise<T>): Promise<T> {
  const dbMod = await import("../../server/db"); const flagMod = await import("../../server/lib/featureFlags");
  const dbObj = dbMod.db as unknown as Record<string, unknown>; const ff = flagMod.featureFlags as unknown as Record<string, boolean>;
  const savedDb: Record<string, unknown> = {}; for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) savedDb[k] = dbObj[k];
  const saved = { u: ff.unifiedAncillaryDocuments, c: ff.canonicalOrderNote };
  for (const k of Object.keys(savedDb)) dbObj[k] = ctrl.db[k];
  if (flags.unifiedAncillaryDocuments !== undefined) ff.unifiedAncillaryDocuments = flags.unifiedAncillaryDocuments;
  if (flags.canonicalOrderNote !== undefined) ff.canonicalOrderNote = flags.canonicalOrderNote;
  try { return await fn(); } finally { for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v; ff.unifiedAncillaryDocuments = saved.u; ff.canonicalOrderNote = saved.c; }
}
async function T() {
  const docs = await import("../../shared/schema/ancillaryDocuments"); const cdr = await import("../../shared/schema/documentReadiness"); const anc = await import("../../shared/schema/ancillaryCases");
  return { refs: docs.ancillaryDocumentReferences, fails: docs.ancillaryDocumentReconciliationFailures, cdr: cdr.caseDocumentReadiness, cases: anc.patientAncillaryCases, journey: (await import("../../shared/schema/executionCase")).patientJourneyEvents };
}
const NOW = new Date("2027-06-01T10:00:00Z"); const SRC = new Date("2025-01-15T08:00:00Z");
const BOTH: Flags = { unifiedAncillaryDocuments: true, canonicalOrderNote: true };
function caseRow(o: Row = {}): Row { return { id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved", lifecycleStatus: "active", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, openedAt: NOW, ...o }; }
function readiness(o: Row = {}): Row { return { id: 4100, clinicId: 1, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", documentType: "report", documentStatus: "uploaded", documentId: 555, completedAt: null, createdAt: SRC, metadata: {}, ...o }; }
function refRow(o: Row = {}): Row { return { id: 42, clinicId: 1, ancillaryCaseId: 5, serviceType: "EchoWave", documentKind: "report", sourceSystem: "x", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "uploaded", effectiveClinicalDate: null, actualCreatedAt: SRC, signedAt: null, supersededAt: null, globalPlexusPatientId: 10, patientScreeningId: 77, executionCaseId: 900, metadata: {}, ...o }; }
function failRow(o: Row = {}): Row { return { id: 1, clinicId: 1, ancillaryCaseId: 5, patientScreeningId: 77, executionCaseId: 900, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, requestedAction: "link_report", resolvedAt: null, attemptCount: 1, ...o }; }
const retry = async (ctrl: StoreFake, f: Row, flags: Flags = BOTH) => { const w = await worker(); return runWithStore(ctrl, flags, async () => w.retryAncillaryDocumentFailure(f as any)); };

// (1) source-less retry via ancillary-case EXECUTION identity
async function c01() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.cases, [caseRow({ executionCaseId: 900 })]], [t.cdr, [readiness({ id: 4100, executionCaseId: 900 })]], [t.refs, []], [t.fails, [failRow({ id: 1, sourceTable: null, sourceId: null, executionCaseId: null, patientScreeningId: null })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failRow({ id: 1, sourceTable: null, sourceId: null, executionCaseId: null, patientScreeningId: null }));
  assert.equal(out.status, "resolved");
  assert.equal(store.get(t.refs)![0].sourceId, 4100);
}
// (2) source-less retry via ancillary-case SCREENING identity
async function c02() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.cases, [caseRow({ executionCaseId: null, originatingScreeningId: 77 })]], [t.cdr, [readiness({ id: 4200, executionCaseId: null, patientScreeningId: 77 })]], [t.refs, []], [t.fails, [failRow({ id: 1, sourceTable: null, sourceId: null, executionCaseId: null, patientScreeningId: null })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failRow({ id: 1, sourceTable: null, sourceId: null, executionCaseId: null, patientScreeningId: null }));
  assert.equal(out.status, "resolved");
  assert.equal(store.get(t.refs)![0].sourceId, 4200);
}
// (3) readiness source WITHOUT documentId can still be indexed
async function c03() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.cases, [caseRow()]], [t.cdr, [readiness({ id: 3001, documentId: null })]], [t.refs, []], [t.fails, [failRow({ id: 1 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failRow({ id: 1 }));
  assert.equal(out.status, "resolved", "missing documentId does not block indexing");
  const ref = store.get(t.refs)![0];
  assert.equal((ref.metadata as any).download_reference, null, "downloadReference null when no documentId");
}
// (4) multiple sources never first/newest
async function c04() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.cases, [caseRow()]], [t.cdr, [readiness({ id: 4100 }), readiness({ id: 4200 })]], [t.refs, []], [t.fails, [failRow({ id: 1, sourceTable: null, sourceId: null })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failRow({ id: 1, sourceTable: null, sourceId: null }));
  assert.equal(out.message, "multiple_source_candidates");
  assert.equal(store.get(t.refs)!.length, 0, "no source auto-picked");
}
// (5) cross-clinic exact source not reported reused
async function c05() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, [refRow({ clinicId: 2 })]]]);
  const ctrl = buildStoreFake(store);
  const res = await runWithStore(ctrl, BOTH, async () => (await repo()).createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "signed" }));
  assert.equal(res.outcome, "source_clinic_conflict");
  assert.equal(store.get(t.refs)![0].documentStatus, "uploaded", "never updated");
}
// (6) wrong-case exact source not reported reused
async function c06() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, [refRow({ ancillaryCaseId: 6 })]]]);
  const ctrl = buildStoreFake(store);
  const res = await runWithStore(ctrl, BOTH, async () => (await repo()).createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "signed" }));
  assert.equal(res.outcome, "source_case_conflict");
}
// (7/8) exact-source update verifies affected-row count
async function c07_08() {
  const t = await T();
  // (7) one row → updated.
  let store = new Map<any, Row[]>([[t.refs, [refRow({ documentStatus: "pending_signature" })]]]);
  let ctrl = buildStoreFake(store);
  let res = await runWithStore(ctrl, BOTH, async () => (await repo()).createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "signed" }));
  assert.equal(res.outcome, "reused_exact_source_updated");
  // (8) zero-row update (concurrent change) → synchronization_conflict, not updated.
  store = new Map<any, Row[]>([[t.refs, [refRow({ documentStatus: "pending_signature" })]]]);
  ctrl = buildStoreFake(store);
  const origUpdate = ctrl.db.update;
  ctrl.db.update = (tbl: any) => { if (tbl === t.refs) return { set() { return { where() { return { returning: () => Promise.resolve([]), then: (r: any) => Promise.resolve([]).then(r) }; } }; } }; return origUpdate(tbl); };
  res = await runWithStore(ctrl, BOTH, async () => (await repo()).createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "signed" }));
  assert.equal(res.outcome, "synchronization_conflict", "zero-row sync is not reported updated");
}
// (9) missing order note reference creates exact retry
async function c09() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, []], [t.fails, []]]);
  const ctrl = buildStoreFake(store);
  const res = await runWithStore(ctrl, BOTH, async () => (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: NOW }));
  assert.equal(res.status, "no_reference");
  const fails = store.get(t.fails)!;
  assert.equal(fails.length, 1);
  assert.equal(fails[0].errorCode, "ORDER_NOTE_REFERENCE_MISSING_AFTER_SIGNATURE");
  assert.equal(fails[0].sourceId, 900);
}
// (10) signature sync requires BOTH flags
async function c10() {
  const t = await T();
  for (const flags of [{ unifiedAncillaryDocuments: true, canonicalOrderNote: false }, { unifiedAncillaryDocuments: false, canonicalOrderNote: true }]) {
    const store = new Map<any, Row[]>([[t.refs, [refRow({ documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900 })]]]);
    const ctrl = buildStoreFake(store);
    const res = await runWithStore(ctrl, flags, async () => (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: NOW }));
    assert.equal(res.status, "skipped_flag_off");
    assert.equal(ctrl.calls.length, 0, "either flag OFF → zero reads/writes");
  }
}
// (11) signature sync zero-row update creates retry
async function c11() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, [refRow({ documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900 })]], [t.fails, []]]);
  const ctrl = buildStoreFake(store);
  const origUpdate = ctrl.db.update;
  ctrl.db.update = (tbl: any) => { if (tbl === t.refs) return { set() { return { where() { return { returning: () => Promise.resolve([]), then: (r: any) => Promise.resolve([]).then(r) }; } }; } }; return origUpdate(tbl); };
  const res = await runWithStore(ctrl, BOTH, async () => (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: NOW }));
  assert.equal(res.status, "sync_failed");
  assert.equal(store.get(t.fails)!.length, 1, "zero-row update records reconciliation work");
}
// (12) cross-clinic signature reference never updated
async function c12() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, [refRow({ documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900, clinicId: 2, documentStatus: "pending_signature" })]], [t.journey, []]]);
  const ctrl = buildStoreFake(store);
  const res = await runWithStore(ctrl, BOTH, async () => (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: NOW }));
  assert.equal(res.status, "cross_clinic_denied");
  assert.equal(store.get(t.refs)![0].documentStatus, "pending_signature", "another clinic's reference is never updated");
  assert.equal(ctrl.calls.filter((c) => c.op === "update").length, 0, "no update issued");
}
// (13-16) service-aware scheduler matching
async function c13_16() {
  const { selectAncillaryCaseForRow } = await routeMod();
  // (13) service-specific row selects its unique matching case.
  assert.deepEqual(selectAncillaryCaseForRow({ clinicId: 1, selectedServices: ["EchoWave"] }, [{ id: 5, clinicId: 1, serviceType: "EchoWave" }, { id: 6, clinicId: 1, serviceType: "BrainWave" }]), { ancillaryCaseId: 5, serviceType: "EchoWave" });
  // (14) two same-service episodes → null.
  assert.deepEqual(selectAncillaryCaseForRow({ clinicId: 1, selectedServices: ["EchoWave"] }, [{ id: 5, clinicId: 1, serviceType: "EchoWave" }, { id: 9, clinicId: 1, serviceType: "EchoWave" }]), { ancillaryCaseId: null, serviceType: null });
  // (15) multi-service non-specific row → null (never infer from selectedServices[0]).
  assert.deepEqual(selectAncillaryCaseForRow({ clinicId: 1, selectedServices: ["EchoWave", "BrainWave"] }, [{ id: 5, clinicId: 1, serviceType: "EchoWave" }, { id: 6, clinicId: 1, serviceType: "BrainWave" }]), { ancillaryCaseId: null, serviceType: null });
  // (16) direct valid ancillaryCaseId preserved.
  assert.deepEqual(selectAncillaryCaseForRow({ clinicId: 1, ancillaryCaseId: 6 }, [{ id: 5, clinicId: 1, serviceType: "EchoWave" }, { id: 6, clinicId: 1, serviceType: "BrainWave" }]), { ancillaryCaseId: 6, serviceType: "BrainWave" });
  // direct INVALID id (not in active same-clinic set) → null.
  assert.deepEqual(selectAncillaryCaseForRow({ clinicId: 1, ancillaryCaseId: 99 }, [{ id: 5, clinicId: 1, serviceType: "EchoWave" }]), { ancillaryCaseId: null, serviceType: null });
}
// (17) batch ancillary-case lookup occurs once
async function c17() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.cases, [caseRow({ id: 5, executionCaseId: 900 }), caseRow({ id: 6, executionCaseId: 901 })]]]);
  const ctrl = buildStoreFake(store);
  await runWithStore(ctrl, BOTH, async () => (await ancRepo()).listActiveAncillaryCasesByExecutionCaseIds([900, 901]));
  assert.equal(ctrl.calls.filter((c) => c.op === "select" && c.table === t.cases).length, 1, "one batched query");
}
// (18) backend always emits ancillaryCaseId/serviceType keys
async function c18() {
  const { selectAncillaryCaseForRow } = await routeMod();
  const zero = selectAncillaryCaseForRow({ clinicId: 1 }, []);
  assert.ok("ancillaryCaseId" in zero && "serviceType" in zero, "keys always present, even when null");
  assert.equal(zero.ancillaryCaseId, null); assert.equal(zero.serviceType, null);
}
// (19) unexpected batch failure is NOT silently hidden
async function c19() {
  const t = await T();
  const ctrl = buildStoreFake(new Map<any, Row[]>([[t.cases, []]]), { failTable: t.cases, failCode: "08006" });
  await assert.rejects(
    () => runWithStore(ctrl, BOTH, async () => (await ancRepo()).listActiveAncillaryCasesByExecutionCaseIds([900])),
    "an unexpected repository error propagates (not swallowed into incomplete JSON)",
  );
  // The route no longer wraps the batch attach in a swallowing try/catch.
  const src = readFileSync(join(ROOT, "server/routes/executionCases.ts"), "utf8");
  assert.ok(!/listActiveAncillaryCasesByExecutionCaseIds[\s\S]{0,400}\} catch \{ \/\* Phase 2B/.test(src), "batch attach is not silently caught");
}
// (20) no Phase 2E retry worker uses broad resolution
async function c20() {
  const src = readFileSync(join(ROOT, "server/services/ancillaryDocuments/retryWorker.ts"), "utf8");
  assert.ok(!/resolveAncillaryDocumentFailure\(/.test(src), "worker must not call broad resolveAncillaryDocumentFailure");
  assert.ok(/resolveAncillaryDocumentFailureById\(/.test(src), "worker resolves by exact failure id");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) source-less retry via ancillary-case execution identity", c01],
  ["(2) source-less retry via ancillary-case screening identity", c02],
  ["(3) readiness source without documentId can still be indexed", c03],
  ["(4) multiple sources never first/newest", c04],
  ["(5) cross-clinic exact source not reused", c05],
  ["(6) wrong-case exact source not reused", c06],
  ["(7/8) exact-source update verifies affected-row count", c07_08],
  ["(9) missing Order Note reference creates exact retry", c09],
  ["(10) signature sync requires both flags", c10],
  ["(11) signature sync zero-row update creates retry", c11],
  ["(12) cross-clinic signature reference never updated", c12],
  ["(13-16) service-aware scheduler matching", c13_16],
  ["(17) batch ancillary-case lookup occurs once", c17],
  ["(18) backend always emits ancillaryCaseId/serviceType keys", c18],
  ["(19) unexpected batch failure not silently hidden", c19],
  ["(20) no retry worker uses broad resolution", c20],
];

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
