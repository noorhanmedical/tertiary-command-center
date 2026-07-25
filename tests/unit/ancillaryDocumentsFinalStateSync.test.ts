// Phase 2E-B4 — exact retries + canonical document final-state sync.
//
//   npx tsx tests/unit/ancillaryDocumentsFinalStateSync.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const repo = () => import("../../server/repositories/ancillaryDocuments.repo");
const ancRepo = () => import("../../server/repositories/ancillaryCases.repo");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const orderNote = () => import("../../server/services/ancillaryDocuments/orderNoteService");
const signWf = () => import("../../server/services/physicianPortal/signatureWorkflow");
const routeMod = () => import("../../server/routes/executionCases");

// ─── Predicate-aware store fake (eq/isNull/lt honored; inArray ignored) ──
type Row = Record<string, any>;
function colKeyMap(table: any): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(table)) if (v && typeof v === "object" && typeof (v as any).name === "string") m[(v as any).name] = k;
  return m;
}
type Tok = { col?: string; op?: string; val?: unknown };
function tokenize(cond: any): Tok[] {
  const toks: Tok[] = [];
  (function walk(o: any, d = 0): void {
    if (d > 16 || o == null || typeof o !== "object") return;
    if (typeof o.name === "string" && o.table) toks.push({ col: o.name });
    else if ("value" in o && (o.encoder || o.type) && !Array.isArray(o.value)) toks.push({ val: o.value });
    else if (Array.isArray(o.value) && o.value.every((x: any) => typeof x === "string")) toks.push({ op: o.value.join("").trim() });
    if (Array.isArray(o.queryChunks)) o.queryChunks.forEach((c: any) => walk(c, d + 1));
    else if (Array.isArray(o)) o.forEach((c: any) => walk(c, d + 1));
  })(cond);
  return toks;
}
const CMP = new Set(["=", "<", ">", "<>", "is null", "is not null"]);
function triples(cond: any): Array<[string, string, unknown]> {
  const out: Array<[string, string, unknown]> = [];
  let col: string | null = null, op: string | null = null;
  for (const tk of tokenize(cond)) {
    if (tk.col !== undefined) { col = tk.col; op = null; }
    else if (tk.op !== undefined && CMP.has(tk.op)) {
      op = tk.op;
      if ((op === "is null" || op === "is not null") && col) { out.push([col, op, undefined]); col = null; op = null; }
    } else if (tk.val !== undefined && col && op) { out.push([col, op, tk.val]); col = null; op = null; }
  }
  return out;
}
function rowMatches(row: Row, table: any, cond: any): boolean {
  if (cond == null) return true;
  const cm = colKeyMap(table);
  for (const [c, o, v] of triples(cond)) {
    const key = cm[c] ?? c;
    const rv = row[key];
    if (o === "=") { if (String(rv) !== String(v)) return false; }
    else if (o === "<>") { if (String(rv) === String(v)) return false; }
    else if (o === "is null") { if (rv != null) return false; }
    else if (o === "is not null") { if (rv == null) return false; }
    else if (o === "<") { if (!(rv < (v as any))) return false; }
  }
  return true;
}
type StoreFake = { db: any; store: Map<any, Row[]>; calls: Array<{ op: string; table: any; payload?: any }>; failTable?: any };
function buildStoreFake(store: Map<any, Row[]>, opts: { failTable?: any; failCode?: string } = {}): StoreFake {
  const calls: Array<{ op: string; table: any; payload?: any }> = [];
  const idc = new Map<any, number>();
  const nextId = (t: any) => { const n = (idc.get(t) ?? 9000) + 1; idc.set(t, n); return n; };
  const ctrl: StoreFake = { db: null, store, calls, failTable: opts.failTable };
  const fail = () => Promise.reject(Object.assign(new Error("boom"), { code: opts.failCode ?? "08006" }));
  const fake: any = {
    select() {
      let t: any = null, cond: any = null;
      const chain: any = {
        from(x: any) { t = x; return chain; },
        leftJoin() { return chain; }, innerJoin() { return chain; },
        where(c: any) { cond = c; return chain; },
        orderBy() { return chain; }, groupBy() { return chain; }, $dynamic() { return chain; },
        limit() { return result(); },
        then(res: any, rej: any) { Promise.resolve().then(result).then(res, rej); },
      };
      function result() {
        if (ctrl.failTable != null && t === ctrl.failTable) return fail();
        calls.push({ op: "select", table: t });
        return Promise.resolve((store.get(t) ?? []).filter((r) => rowMatches(r, t, cond)).map((r) => ({ ...r })));
      }
      return chain;
    },
    insert(t: any) {
      return { values(v: Row) {
        const settle = () => { if (ctrl.failTable != null && t === ctrl.failTable) return fail(); calls.push({ op: "insert", table: t, payload: v }); const row = { ...v, id: v.id ?? nextId(t) }; (store.get(t) ?? store.set(t, []).get(t)!).push(row); return Promise.resolve([{ ...row }]); };
        return { returning: settle, onConflictDoNothing() { return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; }, then: (r: any, j?: any) => settle().then(r, j) };
      } };
    },
    update(t: any) {
      return { set(v: Row) { let cond: any = null; return { where(c: any) { cond = c; const settle = () => { if (ctrl.failTable != null && t === ctrl.failTable) return fail(); calls.push({ op: "update", table: t, payload: v }); const rows = (store.get(t) ?? []).filter((r) => rowMatches(r, t, cond)); rows.forEach((r) => Object.assign(r, v)); return Promise.resolve(rows.map((r) => ({ ...r }))); }; return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; } }; } };
    },
    delete() { return { where() { return { returning: () => Promise.resolve([]), then: (r: any) => Promise.resolve([]).then(r) }; } }; },
    async transaction(fn: any) { return fn(fake); },
    execute: async () => ({ rows: [] }),
  };
  ctrl.db = fake;
  return ctrl;
}
type Flags = { unifiedAncillaryDocuments?: boolean; canonicalOrderNote?: boolean; canonicalAppointment?: boolean };
async function runWithStore<T>(ctrl: StoreFake, flags: Flags, fn: () => Promise<T>): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;
  const savedDb: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) savedDb[k] = dbObj[k];
  const saved = { u: ff.unifiedAncillaryDocuments, c: ff.canonicalOrderNote, a: ff.canonicalAppointment };
  for (const k of Object.keys(savedDb)) dbObj[k] = ctrl.db[k];
  if (flags.unifiedAncillaryDocuments !== undefined) ff.unifiedAncillaryDocuments = flags.unifiedAncillaryDocuments;
  if (flags.canonicalOrderNote !== undefined) ff.canonicalOrderNote = flags.canonicalOrderNote;
  if (flags.canonicalAppointment !== undefined) ff.canonicalAppointment = flags.canonicalAppointment;
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v; ff.unifiedAncillaryDocuments = saved.u; ff.canonicalOrderNote = saved.c; ff.canonicalAppointment = saved.a; }
}
async function T() {
  const docs = await import("../../shared/schema/ancillaryDocuments");
  const cdr = await import("../../shared/schema/documentReadiness");
  const anc = await import("../../shared/schema/ancillaryCases");
  const gen = await import("../../shared/schema/generatedNotes");
  const gs = await import("../../shared/schema/globalSchedule");
  const adm = await import("../../shared/schema/adminReviewEvents");
  const exec = await import("../../shared/schema/executionCase");
  return { refs: docs.ancillaryDocumentReferences, fails: docs.ancillaryDocumentReconciliationFailures, cdr: cdr.caseDocumentReadiness, cases: anc.patientAncillaryCases, notes: gen.procedureNotes, gse: gs.globalScheduleEvents, adm: adm.ancillaryCaseAdminReviewEvents, journey: exec.patientJourneyEvents };
}
const NOW = new Date("2027-06-01T10:00:00Z");
const SRC_TS = new Date("2025-01-15T08:00:00Z"); // an OLD source timestamp
function refRow(o: Row = {}): Row { return { id: 42, clinicId: 1, ancillaryCaseId: 5, serviceType: "EchoWave", documentKind: "report", sourceSystem: "x", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "uploaded", effectiveClinicalDate: null, actualCreatedAt: NOW, signedAt: null, supersededAt: null, globalPlexusPatientId: 10, patientScreeningId: 77, executionCaseId: 900, metadata: {}, createdAt: NOW, updatedAt: NOW, ...o }; }
function caseRow(o: Row = {}): Row { return { id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved", lifecycleStatus: "active", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, openedAt: NOW, ...o }; }
function readinessRow(o: Row = {}): Row { return { id: 3001, clinicId: 1, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", documentType: "report", documentStatus: "uploaded", documentId: 555, completedAt: null, createdAt: SRC_TS, metadata: {}, ...o }; }
function noteRow(o: Row = {}): Row { return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", noteType: "order_note", generationStatus: "generated", generatedText: "body", signatureStatus: "needs_signature", signedAt: null, signedByUserId: null, supersededAt: null, adminReviewEventId: null, createdAt: SRC_TS, updatedAt: NOW, ...o }; }
function failRow(o: Row = {}): Row { return { id: 1, clinicId: 1, ancillaryCaseId: 5, patientScreeningId: 77, executionCaseId: 900, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, requestedAction: "link_report", resolvedAt: null, attemptCount: 1, ...o }; }
function evtRow(o: Row = {}): Row { return { id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, startsAt: NOW, endsAt: null, source: "x", metadata: {}, createdAt: NOW, updatedAt: NOW, ...o }; }
const RETRY = async (ctrl: StoreFake, failure: Row, flags: Flags = { unifiedAncillaryDocuments: true, canonicalOrderNote: true, canonicalAppointment: true }) => {
  const w = await worker(); return runWithStore(ctrl, flags, async () => w.retryAncillaryDocumentFailure(failure as any));
};
const FLAGS_ALL: Flags = { unifiedAncillaryDocuments: true, canonicalOrderNote: true, canonicalAppointment: true };

// ═══════════ (1/2) link_order_note exact resolution ══════════════
async function t01_02_orderNoteExactResolution() {
  const t = await T();
  // Two link_order_note failures for the SAME case; process id 1 only.
  const store = new Map<any, Row[]>([
    [t.cases, [caseRow()]], [t.gse, [evtRow()]], [t.adm, [{ id: 555, ancillaryCaseId: 5, newStatus: "approved", actualReviewedAt: NOW }]],
    [t.notes, []], [t.refs, []], [t.journey, []],
    [t.fails, [failRow({ id: 1, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: null, requestedAction: "link_order_note" }), failRow({ id: 2, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: null, requestedAction: "link_order_note" })]],
  ]);
  const ctrl = buildStoreFake(store);
  const out = await RETRY(ctrl, failRow({ id: 1, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: null, requestedAction: "link_order_note" }));
  assert.equal(out.status, "resolved");
  const fails = store.get(t.fails)!;
  assert.ok(fails.find((f) => f.id === 1)!.resolvedAt != null, "(1) exact failure resolved");
  assert.equal(fails.find((f) => f.id === 2)!.resolvedAt, null, "(2) sibling Order Note failure stays unresolved");
}

// ═══════════ (3/4/5) source-less discovery ═══════════════════════
async function sourceLessDiscovers(action: "link_report" | "link_consent" | "link_screening_form", docType: string, kind: string) {
  const t = await T();
  const store = new Map<any, Row[]>([
    [t.cases, [caseRow()]],
    [t.cdr, [readinessRow({ id: 4100, documentType: docType })]],
    [t.refs, []], [t.fails, [failRow({ id: 1, documentKind: kind, sourceTable: null, sourceId: null, requestedAction: action })]],
  ]);
  const ctrl = buildStoreFake(store);
  const out = await RETRY(ctrl, failRow({ id: 1, documentKind: kind, sourceTable: null, sourceId: null, requestedAction: action }));
  assert.equal(out.status, "resolved", `${action} source-less discovery resolves`);
  const refIns = store.get(t.refs)!;
  assert.equal(refIns.length, 1, "one reference created from the discovered source");
  assert.equal(refIns[0].sourceId, 4100, "discovered source id preserved");
  assert.equal(refIns[0].documentKind, kind);
}
async function t03_reportSourceLess() { await sourceLessDiscovers("link_report", "report", "report"); }
async function t04_consentSourceLess() { await sourceLessDiscovers("link_consent", "informed_consent", "consent"); }
async function t05_screeningSourceLess() { await sourceLessDiscovers("link_screening_form", "screening_form", "screening_form"); }

// ═══════════ (6/8) multiple sources → unresolved, no pick ════════
async function t06_08_multipleSources() {
  const t = await T();
  const store = new Map<any, Row[]>([
    [t.cases, [caseRow()]],
    [t.cdr, [readinessRow({ id: 4100 }), readinessRow({ id: 4200 })]], // two report sources, same identity+service
    [t.refs, []], [t.fails, [failRow({ id: 1, sourceTable: null, sourceId: null })]],
  ]);
  const ctrl = buildStoreFake(store);
  const out = await RETRY(ctrl, failRow({ id: 1, sourceTable: null, sourceId: null }));
  assert.equal(out.status, "still_deferred");
  assert.equal(out.message, "multiple_source_candidates");
  assert.equal(store.get(t.refs)!.length, 0, "(8) no first/newest selection — nothing linked");
  assert.equal(store.get(t.fails)!.find((f) => f.id === 1)!.resolvedAt, null);
}

// ═══════════ (7) zero sources → unresolved ═══════════════════════
async function t07_zeroSources() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.cases, [caseRow()]], [t.cdr, []], [t.refs, []], [t.fails, [failRow({ id: 1, sourceTable: null, sourceId: null })]]]);
  const ctrl = buildStoreFake(store);
  const out = await RETRY(ctrl, failRow({ id: 1, sourceTable: null, sourceId: null }));
  assert.equal(out.status, "source_not_found");
}

// ═══════════ (9) cross-clinic discovery denied ═══════════════════
async function t09_crossClinicDiscovery() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.cases, [caseRow({ clinicId: 2 })]], [t.cdr, [readinessRow({ id: 4100 })]], [t.refs, []], [t.fails, [failRow({ id: 1, clinicId: 1, sourceTable: null, sourceId: null })]]]);
  const ctrl = buildStoreFake(store);
  const out = await RETRY(ctrl, failRow({ id: 1, clinicId: 1, sourceTable: null, sourceId: null }));
  assert.equal(out.status, "cross_clinic_denied");
}

// ═══════════ (10/11/12) scheduler-portal one-active rule ═════════
async function t10_11_12_schedulerRule() {
  const { selectSingleActiveAncillaryCase } = await routeMod();
  // (10) exactly one active same-clinic case → attach.
  assert.deepEqual(selectSingleActiveAncillaryCase([{ id: 5, clinicId: 1, serviceType: "EchoWave" }], 1), { ancillaryCaseId: 5, serviceType: "EchoWave" });
  // (11) multiple active cases → null.
  assert.deepEqual(selectSingleActiveAncillaryCase([{ id: 5, clinicId: 1, serviceType: "EchoWave" }, { id: 6, clinicId: 1, serviceType: "BrainWave" }], 1), { ancillaryCaseId: null, serviceType: null });
  // (12) two SAME-service episodes → ambiguous → null.
  assert.deepEqual(selectSingleActiveAncillaryCase([{ id: 5, clinicId: 1, serviceType: "EchoWave" }, { id: 9, clinicId: 1, serviceType: "EchoWave" }], 1), { ancillaryCaseId: null, serviceType: null });
  // cross-clinic case is filtered out (so a lone same-clinic case still attaches).
  assert.deepEqual(selectSingleActiveAncillaryCase([{ id: 5, clinicId: 1, serviceType: "EchoWave" }, { id: 7, clinicId: 2, serviceType: "EchoWave" }], 1), { ancillaryCaseId: 5, serviceType: "EchoWave" });
}

// ═══════════ (13) batched, not per-row ═══════════════════════════
async function t13_batchedQuery() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.cases, [caseRow({ id: 5, executionCaseId: 900 }), caseRow({ id: 6, executionCaseId: 901 }), caseRow({ id: 7, executionCaseId: 902 })]]]);
  const ctrl = buildStoreFake(store);
  const map = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () => (await ancRepo()).listActiveAncillaryCasesByExecutionCaseIds([900, 901, 902]));
  assert.equal(ctrl.calls.filter((c) => c.op === "select" && c.table === t.cases).length, 1, "ONE batched query, never per row");
  assert.equal(map.get(900)![0].id, 5);
  assert.equal(map.get(901)![0].id, 6);
  assert.equal(map.get(902)![0].id, 7);
}

// ═══════════ (14) order note actualCreatedAt = note.created_at ═══
async function t14_orderNoteTimestamp() {
  const t = await T();
  let refPayload: Row | null = null;
  const store = new Map<any, Row[]>([
    [t.cases, [caseRow()]], [t.gse, [evtRow()]], [t.adm, [{ id: 555, ancillaryCaseId: 5, newStatus: "approved", actualReviewedAt: NOW }]],
    [t.notes, []], [t.refs, []], [t.journey, []], [t.fails, []],
  ]);
  const ctrl = buildStoreFake(store);
  // Capture the reference insert payload; inject the note's created_at (the
  // real DB default the fake lacks) so we can prove it flows into the reference.
  const origInsert = ctrl.db.insert;
  ctrl.db.insert = (tbl: any) => { const b = origInsert(tbl); const ov = b.values; b.values = (v: Row) => { if (tbl === t.refs) refPayload = v; if (tbl === t.notes && v.createdAt == null) v = { ...v, createdAt: SRC_TS }; return ov(v); }; return b; };
  await runWithStore(ctrl, FLAGS_ALL, async () => (await orderNote()).createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal((refPayload as any).actualCreatedAt.getTime(), SRC_TS.getTime(), "reference actualCreatedAt = procedure_notes.created_at");
}

// ═══════════ (15/16) readiness/retry actualCreatedAt = source ════
async function t15_16_readinessTimestamp() {
  const t = await T();
  // (16) source-bearing report retry → ref actualCreatedAt = readiness.createdAt.
  const store = new Map<any, Row[]>([[t.cases, [caseRow()]], [t.cdr, [readinessRow()]], [t.refs, []], [t.fails, [failRow({ id: 1 })]]]);
  const ctrl = buildStoreFake(store);
  await RETRY(ctrl, failRow({ id: 1 }));
  assert.equal(store.get(t.refs)![0].actualCreatedAt.getTime(), SRC_TS.getTime(), "retry preserves the source (readiness) timestamp");
  // (15) createReference honors the supplied source actualCreatedAt on insert.
  const t2 = await T();
  const store2 = new Map<any, Row[]>([[t2.refs, []]]);
  const ctrl2 = buildStoreFake(store2);
  await runWithStore(ctrl2, { unifiedAncillaryDocuments: true }, async () =>
    (await repo()).createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 9999, documentStatus: "uploaded", actualCreatedAt: SRC_TS }));
  assert.equal(store2.get(t2.refs)![0].actualCreatedAt.getTime(), SRC_TS.getTime(), "createReference writes the source timestamp");
}

// ═══════════ (17) backfill preserves old source timestamp ════════
async function t17_backfillTimestamp() {
  const src = readFileSync(join(ROOT, "script/backfillAncillaryDocuments.ts"), "utf8");
  // Behavioral mechanism (createReference honoring actualCreatedAt) is proven
  // in (15); assert the backfill FEEDS the ORIGINAL source timestamp, not run time.
  assert.ok(/actualCreatedAt:\s*r\.createdAt/.test(src), "readiness backfill passes source created_at");
  assert.ok(/actualCreatedAt:\s*n\.createdAt/.test(src), "order note backfill passes note created_at");
  assert.ok(!/actualCreatedAt:\s*new Date\(\)/.test(src), "backfill never uses run time for actualCreatedAt");
}

// ═══════════ (18/19/20) exact-source unchanged/updated/immutable ═
async function t18_19_20_exactSourceSync() {
  const t = await T();
  const r = await repo();
  // (18) identical fields → unchanged.
  let store = new Map<any, Row[]>([[t.refs, [refRow({ id: 42, documentStatus: "uploaded", actualCreatedAt: SRC_TS })]]]);
  let ctrl = buildStoreFake(store);
  let res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    r.createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "uploaded", actualCreatedAt: SRC_TS }));
  assert.equal(res.outcome, "reused_exact_source_unchanged");
  // (19) stale status → refreshed.
  store = new Map<any, Row[]>([[t.refs, [refRow({ id: 42, documentStatus: "pending_signature", signedAt: null, actualCreatedAt: SRC_TS })]]]);
  ctrl = buildStoreFake(store);
  res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    r.createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "signed", actualCreatedAt: SRC_TS }));
  assert.equal(res.outcome, "reused_exact_source_updated");
  const row = store.get(t.refs)![0];
  assert.equal(row.documentStatus, "signed", "stale status refreshed in place");
  // (20) immutable identity preserved.
  assert.equal(row.id, 42); assert.equal(row.clinicId, 1); assert.equal(row.ancillaryCaseId, 5);
  assert.equal(row.sourceTable, "case_document_readiness"); assert.equal(row.sourceId, 3001); assert.equal(row.documentKind, "report");
}

// ═══════════ (21) completed consent refreshes signedAt ═══════════
async function t21_consentSignedAt() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, [refRow({ id: 43, documentKind: "consent", documentStatus: "uploaded", signedAt: null, actualCreatedAt: SRC_TS })]]]);
  const ctrl = buildStoreFake(store);
  const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    (await repo()).createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "consent", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "completed", signedAt: NOW, actualCreatedAt: SRC_TS }));
  assert.equal(res.outcome, "reused_exact_source_updated");
  assert.equal(store.get(t.refs)![0].signedAt.getTime(), NOW.getTime(), "completed consent refreshes signedAt");
}

// ═══════════ (22) different-source conflict stays unresolved ═════
async function t22_conflictUnresolved() {
  const t = await T();
  const store = new Map<any, Row[]>([
    [t.cases, [caseRow()]], [t.cdr, [readinessRow()]],
    [t.refs, [refRow({ id: 600, sourceId: 999, supersededAt: null })]], // different active source
    [t.fails, [failRow({ id: 1 })]],
  ]);
  const ctrl = buildStoreFake(store);
  const out = await RETRY(ctrl, failRow({ id: 1 }));
  assert.equal(out.status, "active_kind_conflict");
  assert.equal(store.get(t.fails)!.find((f) => f.id === 1)!.resolvedAt, null);
}

// ═══════════ (23) Order Note signing syncs reference → signed ════
async function t23_signSync() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, [refRow({ id: 42, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900, documentStatus: "pending_signature", signedAt: null })]]]);
  const ctrl = buildStoreFake(store);
  await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: NOW }));
  const row = store.get(t.refs)![0];
  assert.equal(row.documentStatus, "signed");
  assert.equal(row.signedAt.getTime(), NOW.getTime());
}

// ═══════════ (24) return-for-correction → pending_signature ══════
async function t24_returnSync() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, [refRow({ id: 42, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900, documentStatus: "signed", signedAt: NOW })]]]);
  const ctrl = buildStoreFake(store);
  await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "pending_signature", signedAt: null }));
  const row = store.get(t.refs)![0];
  assert.equal(row.documentStatus, "pending_signature");
  assert.equal(row.signedAt, null, "signedAt follows the canonical note state, never fabricated");
}

// ═══════════ (25) signing survives reference-sync failure ════════
async function t25_signSurvivesSyncFailure() {
  const t = await T();
  const wf = await signWf();
  wf.setBillingReevalScheduler(() => {});
  try {
    const store = new Map<any, Row[]>([
      [t.notes, [noteRow({ id: 900, signatureStatus: "needs_signature" })]],
      [t.refs, [refRow({ id: 42, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900, documentStatus: "pending_signature" })]],
      [t.fails, []],
    ]);
    // Make the reference UPDATE fail (sync failure) — the note sign still commits.
    const ctrl = buildStoreFake(store, { failTable: t.refs });
    const r = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () => wf.signProcedureNote({ id: 900, clinicId: 1, authenticatedSignerUserId: "u1" }));
    assert.equal(r.ok, true, "signature transition remains successful despite sync failure");
  } finally { wf.setBillingReevalScheduler(null); }
}

// ═══════════ (26) sync failure creates exact PHI-free retry ══════
async function t26_syncFailureRetry() {
  const t = await T();
  // Reference read succeeds; the UPDATE fails → records a retry. Model by
  // failing ONLY on the update via a store whose refs update rejects.
  const store = new Map<any, Row[]>([
    [t.refs, [refRow({ id: 42, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900, documentStatus: "pending_signature" })]],
    [t.fails, []],
  ]);
  const ctrl = buildStoreFake(store);
  // Override refs update to reject while keeping refs select working.
  const origUpdate = ctrl.db.update;
  ctrl.db.update = (tbl: any) => { if (tbl === t.refs) return { set() { return { where() { return { returning: () => Promise.reject(Object.assign(new Error("boom"), { code: "08006" })), then: (_r: any, j: any) => Promise.reject(Object.assign(new Error("boom"), { code: "08006" })).catch(j) }; } }; } }; return origUpdate(tbl); };
  const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: NOW }));
  assert.equal(res.status, "sync_failed");
  if (res.status === "sync_failed") assert.equal(res.retryRecorded, true);
  const fails = store.get(t.fails)!;
  assert.equal(fails.length, 1, "exact retry recorded");
  assert.equal(fails[0].sourceId, 900, "retry keyed to the exact note source");
  const blob = JSON.stringify(fails[0]).toLowerCase();
  for (const phi of ["name", "dob", "mrn", "phone", "diagnosis"]) assert.ok(!blob.includes(phi), `retry row PHI-free: ${phi}`);
}

// ═══════════ (27) feature OFF → zero sync reads/writes ═══════════
async function t27_syncFlagOff() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, [refRow({ documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900 })]]]);
  const ctrl = buildStoreFake(store);
  const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: false }, async () =>
    (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: NOW }));
  assert.equal(res.status, "skipped_flag_off");
  assert.equal(ctrl.calls.length, 0, "flag OFF issues zero sync reads/writes");
}

// ═══════════ (28) missing migration reported truthfully ══════════
async function t28_syncMigrationMissing() {
  const t = await T();
  const store = new Map<any, Row[]>([[t.refs, []]]);
  const ctrl = buildStoreFake(store, { failTable: t.refs, failCode: "42P01" });
  const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    (await orderNote()).syncOrderNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: NOW }));
  assert.equal(res.status, "migration_missing", "missing migration reported truthfully, not swallowed");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1/2) link_order_note resolves only exact id; siblings unresolved", t01_02_orderNoteExactResolution],
  ["(3) source-less report retry finds one deterministic source", t03_reportSourceLess],
  ["(4) source-less consent retry finds one deterministic source", t04_consentSourceLess],
  ["(5) source-less screening-form retry finds one deterministic source", t05_screeningSourceLess],
  ["(6/8) multiple sources → unresolved, no first/newest", t06_08_multipleSources],
  ["(7) zero sources → unresolved", t07_zeroSources],
  ["(9) cross-clinic source discovery denied", t09_crossClinicDiscovery],
  ["(10/11/12) scheduler portal one-active-case rule + ambiguity", t10_11_12_schedulerRule],
  ["(13) ancillary cases batch-loaded, not per row", t13_batchedQuery],
  ["(14) order note actualCreatedAt = procedure_notes.created_at", t14_orderNoteTimestamp],
  ["(15/16) readiness/retry actualCreatedAt = source created_at", t15_16_readinessTimestamp],
  ["(17) backfill preserves old source timestamp", t17_backfillTimestamp],
  ["(18/19/20) exact-source unchanged/updated; immutable identity", t18_19_20_exactSourceSync],
  ["(21) completed consent refreshes signedAt", t21_consentSignedAt],
  ["(22) active different-source conflict stays unresolved", t22_conflictUnresolved],
  ["(23) Order Note signing syncs reference to signed", t23_signSync],
  ["(24) return-for-correction syncs reference to pending_signature", t24_returnSync],
  ["(25) signature success survives reference-sync failure", t25_signSurvivesSyncFailure],
  ["(26) sync failure creates exact PHI-free retry", t26_syncFailureRetry],
  ["(27) feature OFF → zero sync reads/writes", t27_syncFlagOff],
  ["(28) missing migration reported truthfully", t28_syncMigrationMissing],
];

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok  ${name}`); }
    catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); }
  }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}

run();
