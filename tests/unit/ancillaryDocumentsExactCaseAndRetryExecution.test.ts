// Phase 2E-B3 — exact ancillary-case portal scoping + real reference retries.
//
//   npx tsx tests/unit/ancillaryDocumentsExactCaseAndRetryExecution.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const api = () => import("../../client/src/lib/ancillaryDocumentsApi");
const sel = () => import("../../client/src/components/portal/SelectedCaseOverview");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");

// ─── Predicate-aware store fake (eq/isNull/lt honored) ────────────
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
type StoreFake = { db: any; store: Map<any, Row[]>; calls: Array<{ op: string; table: any }> };
function buildStoreFake(store: Map<any, Row[]>): StoreFake {
  const calls: Array<{ op: string; table: any }> = [];
  const idc = new Map<any, number>();
  const nextId = (t: any) => { const n = (idc.get(t) ?? 9000) + 1; idc.set(t, n); return n; };
  const fake: any = {
    select() {
      let t: any = null, cond: any = null;
      const chain: any = {
        from(x: any) { t = x; return chain; },
        leftJoin() { return chain; }, innerJoin() { return chain; },
        where(c: any) { cond = c; return chain; },
        orderBy() { return chain; }, groupBy() { return chain; }, $dynamic() { return chain; },
        limit() { return Promise.resolve(result()); },
        then(res: any, rej: any) { Promise.resolve().then(result).then(res, rej); },
      };
      function result() { calls.push({ op: "select", table: t }); return (store.get(t) ?? []).filter((r) => rowMatches(r, t, cond)).map((r) => ({ ...r })); }
      return chain;
    },
    insert(t: any) {
      return { values(v: Row) {
        const settle = () => { calls.push({ op: "insert", table: t }); const row = { ...v, id: v.id ?? nextId(t) }; (store.get(t) ?? store.set(t, []).get(t)!).push(row); return Promise.resolve([{ ...row }]); };
        return { returning: settle, onConflictDoNothing() { return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; }, then: (r: any, j?: any) => settle().then(r, j) };
      } };
    },
    update(t: any) {
      return { set(v: Row) { let cond: any = null; return { where(c: any) { cond = c; const settle = () => { calls.push({ op: "update", table: t }); const rows = (store.get(t) ?? []).filter((r) => rowMatches(r, t, cond)); rows.forEach((r) => Object.assign(r, v)); return Promise.resolve(rows.map((r) => ({ ...r }))); }; return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; } }; } };
    },
    delete() { return { where() { return { returning: () => Promise.resolve([]), then: (r: any) => Promise.resolve([]).then(r) }; } }; },
    async transaction(fn: any) { return fn(fake); },
    execute: async () => ({ rows: [] }),
  };
  return { db: fake, store, calls };
}
type Flags = { unifiedAncillaryDocuments?: boolean; canonicalOrderNote?: boolean };
async function runWithStore<T>(ctrl: StoreFake, flags: Flags, fn: () => Promise<T>): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;
  const savedDb: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) savedDb[k] = dbObj[k];
  const saved = { u: ff.unifiedAncillaryDocuments, c: ff.canonicalOrderNote };
  for (const k of Object.keys(savedDb)) dbObj[k] = ctrl.db[k];
  if (flags.unifiedAncillaryDocuments !== undefined) ff.unifiedAncillaryDocuments = flags.unifiedAncillaryDocuments;
  if (flags.canonicalOrderNote !== undefined) ff.canonicalOrderNote = flags.canonicalOrderNote;
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v; ff.unifiedAncillaryDocuments = saved.u; ff.canonicalOrderNote = saved.c; }
}
async function schemaTables() {
  const docs = await import("../../shared/schema/ancillaryDocuments");
  const cdr = await import("../../shared/schema/documentReadiness");
  const anc = await import("../../shared/schema/ancillaryCases");
  return { refs: docs.ancillaryDocumentReferences, fails: docs.ancillaryDocumentReconciliationFailures, cdr: cdr.caseDocumentReadiness, cases: anc.patientAncillaryCases };
}
const NOW = new Date("2027-06-01T10:00:00Z");
function readinessRow(over: Row = {}): Row {
  return { id: 3001, clinicId: 1, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", documentType: "report", documentStatus: "uploaded", documentId: 555, completedAt: null, createdAt: NOW, metadata: {}, ...over };
}
function caseRow(over: Row = {}): Row {
  return { id: 5, clinicId: 1, serviceType: "EchoWave", lifecycleStatus: "active", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, openedAt: NOW, ...over };
}
function failureRow(over: Row = {}): Row {
  return { id: 1, clinicId: 1, ancillaryCaseId: null, patientScreeningId: 77, executionCaseId: 900, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, requestedAction: "link_report", sourceSystem: "x", resolvedAt: null, attemptCount: 1, ...over };
}
async function retry(ctrl: StoreFake, failure: Row, flags: Flags = { unifiedAncillaryDocuments: true, canonicalOrderNote: true }) {
  const w = await worker();
  return runWithStore(ctrl, flags, async () => w.retryAncillaryDocumentFailure(failure as any));
}

// ═══════════════ CLIENT: exact ancillary-case scoping ════════════
// ─── (1) SelectedCaseOverview requests by ancillaryCaseId ────────
async function c01_exactCaseParams() {
  const { selectedCaseDocParams } = await sel();
  const { buildAncillaryDocumentsQuery } = await api();
  const { hasExactCase, params } = selectedCaseDocParams({ ancillaryCaseId: 5, serviceType: "EchoWave" });
  assert.equal(hasExactCase, true);
  assert.equal(params.ancillaryCaseId, 5);
  assert.equal(params.patientScreeningId, undefined, "never scoped by screening");
  assert.equal(params.includeHistory, false);
  const url = buildAncillaryDocumentsQuery(params);
  assert.ok(url.includes("ancillaryCaseId=5"), "server request is scoped to the exact case");
  assert.ok(!url.includes("patientScreeningId"), "no screening-wide request");
}

// ─── (2) missing ancillaryCaseId → no request ────────────────────
async function c02_missingCaseNoRequest() {
  const { selectedCaseDocParams } = await sel();
  const { hasExactCase, params } = selectedCaseDocParams({ ancillaryCaseId: null, serviceType: "EchoWave" });
  assert.equal(hasExactCase, false, "no exact case → query disabled → zero canonical requests");
  assert.equal(params.ancillaryCaseId, undefined);
  assert.equal(params.patientScreeningId, undefined, "never falls back to a screening-wide request");
}

// ─── (3/4/5) case A ≠ case B; services + episodes stay separate ──
async function c03_05_caseSeparation() {
  const { selectedCaseDocParams } = await sel();
  const { buildAncillaryDocumentsQuery } = await api();
  const urlA = buildAncillaryDocumentsQuery(selectedCaseDocParams({ ancillaryCaseId: 5, serviceType: "BrainWave" }).params);
  const urlB = buildAncillaryDocumentsQuery(selectedCaseDocParams({ ancillaryCaseId: 6, serviceType: "Ultrasound" }).params);
  // (3) Case A requests only case 5; Case B only case 6 — server filters by id.
  assert.ok(urlA.includes("ancillaryCaseId=5") && !urlA.includes("ancillaryCaseId=6"));
  assert.ok(urlB.includes("ancillaryCaseId=6") && !urlB.includes("ancillaryCaseId=5"));
  // (4) Different services under one screening → distinct case ids, no mixing.
  assert.notEqual(urlA, urlB);
  // (5) Two SAME-service episodes → distinct case ids → distinct requests.
  const ep1 = buildAncillaryDocumentsQuery(selectedCaseDocParams({ ancillaryCaseId: 5, serviceType: "EchoWave" }).params);
  const ep2 = buildAncillaryDocumentsQuery(selectedCaseDocParams({ ancillaryCaseId: 9, serviceType: "EchoWave" }).params);
  assert.notEqual(ep1, ep2, "two episodes of the same service remain separate");
  assert.ok(ep1.includes("ancillaryCaseId=5") && ep2.includes("ancillaryCaseId=9"));
}

// ─── (6/7) presentation-only; one wrapper query ──────────────────
async function c06_07_presentationOnly() {
  const caseOverview = readFileSync(join(ROOT, "client/src/components/portal/CaseOverview.tsx"), "utf8");
  assert.ok(!/useAncillaryDocuments|fetchAncillaryDocuments/.test(caseOverview), "(6) CaseOverview performs zero canonical requests");
  const wrapper = readFileSync(join(ROOT, "client/src/components/portal/SelectedCaseOverview.tsx"), "utf8");
  assert.equal((wrapper.match(/useAncillaryDocuments\(/g) ?? []).length, 1, "(7) selected-case wrapper performs at most one query");
  // The wrapper scopes by the exact ancillaryCaseId, never patientScreeningId.
  assert.ok(/selectedCaseDocParams/.test(wrapper) && !/patientScreeningId:\s*screeningId/.test(wrapper), "wrapper is exact-case scoped");
}

// ─── (8) dead batch-summary code removed ─────────────────────────
async function c08_deadBatchRemoved() {
  const proj = await import("../../server/services/ancillaryDocuments/documentProjection");
  const repo = await import("../../server/repositories/ancillaryDocuments.repo");
  assert.equal((proj as any).getAncillaryDocumentsSummaryForScreenings, undefined, "unused batch summary service removed");
  assert.equal((repo as any).listCurrentReferencesForScreenings, undefined, "unused batch repo query removed");
}

// ═══════════════ SERVER: real reference retries ═══════════════════
// ─── (9/10) link_report create + exact-source reuse resolve ──────
async function r09_10_reportRetry() {
  const t = await schemaTables();
  // (9) create: readiness source + one active case, no existing reference.
  let store = new Map<any, Row[]>([[t.cdr, [readinessRow()]], [t.cases, [caseRow()]], [t.refs, []], [t.fails, [failureRow({ id: 1 })]]]);
  let ctrl = buildStoreFake(store);
  let out = await retry(ctrl, failureRow({ id: 1 }));
  assert.equal(out.status, "resolved");
  const refIns = store.get(t.refs)!;
  assert.equal(refIns.length, 1, "exact reference created");
  assert.equal(refIns[0].sourceId, 3001);
  assert.equal(refIns[0].documentKind, "report");
  assert.ok(store.get(t.fails)!.find((f) => f.id === 1)!.resolvedAt != null, "exact failure resolved");
  // (10) exact-source reuse: reference already exists for this exact source.
  const existing = { id: 42, clinicId: 1, ancillaryCaseId: 5, sourceTable: "case_document_readiness", sourceId: 3001, documentKind: "report", supersededAt: null, documentStatus: "uploaded" };
  store = new Map<any, Row[]>([[t.cdr, [readinessRow()]], [t.cases, [caseRow()]], [t.refs, [existing]], [t.fails, [failureRow({ id: 2 })]]]);
  ctrl = buildStoreFake(store);
  out = await retry(ctrl, failureRow({ id: 2 }));
  assert.equal(out.status, "resolved");
  assert.equal(store.get(t.refs)!.length, 1, "reuse — no duplicate reference");
  assert.ok(store.get(t.fails)!.find((f) => f.id === 2)!.resolvedAt != null);
}

// ─── (11) link_consent → consent reference ───────────────────────
async function r11_consentRetry() {
  const t = await schemaTables();
  const store = new Map<any, Row[]>([
    [t.cdr, [readinessRow({ id: 3002, documentType: "informed_consent", documentStatus: "completed", completedAt: NOW })]],
    [t.cases, [caseRow()]], [t.refs, []], [t.fails, [failureRow({ id: 1, documentKind: "consent", sourceId: 3002, requestedAction: "link_consent" })]],
  ]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1, documentKind: "consent", sourceId: 3002, requestedAction: "link_consent" }));
  assert.equal(out.status, "resolved");
  assert.equal(store.get(t.refs)![0].documentKind, "consent");
}

// ─── (12) link_screening_form → screening_form reference ─────────
async function r12_screeningFormRetry() {
  const t = await schemaTables();
  const store = new Map<any, Row[]>([
    [t.cdr, [readinessRow({ id: 3003, documentType: "screening_form" })]],
    [t.cases, [caseRow()]], [t.refs, []], [t.fails, [failureRow({ id: 1, documentKind: "screening_form", sourceId: 3003, requestedAction: "link_screening_form" })]],
  ]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1, documentKind: "screening_form", sourceId: 3003, requestedAction: "link_screening_form" }));
  assert.equal(out.status, "resolved");
  assert.equal(store.get(t.refs)![0].documentKind, "screening_form");
}

// ─── (13/22) two sources separate; resolve only the exact id ─────
async function r13_22_separateSources() {
  const t = await schemaTables();
  const store = new Map<any, Row[]>([
    [t.cdr, [readinessRow({ id: 3001 }), readinessRow({ id: 3002 })]],
    [t.cases, [caseRow()]], [t.refs, []],
    [t.fails, [failureRow({ id: 1, sourceId: 3001 }), failureRow({ id: 2, sourceId: 3002 })]],
  ]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1, sourceId: 3001 }));
  assert.equal(out.status, "resolved");
  const fails = store.get(t.fails)!;
  assert.ok(fails.find((f) => f.id === 1)!.resolvedAt != null, "target source resolved");
  assert.equal(fails.find((f) => f.id === 2)!.resolvedAt, null, "sibling source stays unresolved");
}

// ─── (14) active-kind conflict remains unresolved ────────────────
async function r14_activeKindConflict() {
  const t = await schemaTables();
  // A DIFFERENT active report source already holds the case slot.
  const other = { id: 42, clinicId: 1, ancillaryCaseId: 5, sourceTable: "case_document_readiness", sourceId: 999, documentKind: "report", supersededAt: null, documentStatus: "uploaded" };
  const store = new Map<any, Row[]>([[t.cdr, [readinessRow()]], [t.cases, [caseRow()]], [t.refs, [other]], [t.fails, [failureRow({ id: 1 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1 }));
  assert.equal(out.status, "active_kind_conflict");
  assert.equal(store.get(t.fails)!.find((f) => f.id === 1)!.resolvedAt, null, "conflict keeps failure unresolved");
}

// ─── (15) cross-clinic source denied ─────────────────────────────
async function r15_crossClinic() {
  const t = await schemaTables();
  const store = new Map<any, Row[]>([[t.cdr, [readinessRow({ clinicId: 2 })]], [t.cases, [caseRow()]], [t.refs, []], [t.fails, [failureRow({ id: 1, clinicId: 1 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1, clinicId: 1 }));
  assert.equal(out.status, "cross_clinic_denied");
  assert.equal(store.get(t.refs)!.length, 0, "no reference created across clinics");
  assert.equal(store.get(t.fails)!.find((f) => f.id === 1)!.resolvedAt, null);
}

// ─── (16) wrong document type rejected ───────────────────────────
async function r16_wrongType() {
  const t = await schemaTables();
  // link_report but the source is a screening_form.
  const store = new Map<any, Row[]>([[t.cdr, [readinessRow({ documentType: "screening_form" })]], [t.cases, [caseRow()]], [t.refs, []], [t.fails, [failureRow({ id: 1 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1 }));
  assert.equal(out.status, "source_type_mismatch");
}

// ─── (17) wrong service rejected ─────────────────────────────────
async function r17_wrongService() {
  const t = await schemaTables();
  // Source is EchoWave, but the only active case is a different service.
  const store = new Map<any, Row[]>([[t.cdr, [readinessRow({ serviceType: "EchoWave" })]], [t.cases, [caseRow({ serviceType: "BrainWave" })]], [t.refs, []], [t.fails, [failureRow({ id: 1 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1 }));
  assert.equal(out.status, "service_mismatch");
  assert.equal(store.get(t.fails)!.find((f) => f.id === 1)!.resolvedAt, null);
}

// ─── (18) wrong ancillary case rejected ──────────────────────────
async function r18_wrongCase() {
  const t = await schemaTables();
  // The failure names case 6, but the source resolves to case 5.
  const store = new Map<any, Row[]>([[t.cdr, [readinessRow()]], [t.cases, [caseRow({ id: 5 })]], [t.refs, []], [t.fails, [failureRow({ id: 1, ancillaryCaseId: 6 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1, ancillaryCaseId: 6 }));
  assert.equal(out.status, "case_mismatch");
}

// ─── (19) missing source remains unresolved ──────────────────────
async function r19_missingSource() {
  const t = await schemaTables();
  const store = new Map<any, Row[]>([[t.cdr, []], [t.cases, [caseRow()]], [t.refs, []], [t.fails, [failureRow({ id: 1 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1 }));
  assert.equal(out.status, "source_not_found");
  assert.equal(store.get(t.fails)!.find((f) => f.id === 1)!.resolvedAt, null);
}

// ─── (20/21) ambiguity unresolved; later deterministic resolves ──
async function r20_21_ambiguityThenResolve() {
  const t = await schemaTables();
  // (20) TWO active EchoWave cases → ambiguous → unresolved.
  let store = new Map<any, Row[]>([[t.cdr, [readinessRow()]], [t.cases, [caseRow({ id: 5 }), caseRow({ id: 6 })]], [t.refs, []], [t.fails, [failureRow({ id: 1 })]]]);
  let ctrl = buildStoreFake(store);
  let out = await retry(ctrl, failureRow({ id: 1 }));
  assert.equal(out.status, "still_deferred");
  assert.equal(store.get(t.fails)!.find((f) => f.id === 1)!.resolvedAt, null, "ambiguity stays unresolved");
  // (21) later exactly ONE case exists → deterministic link succeeds.
  store = new Map<any, Row[]>([[t.cdr, [readinessRow()]], [t.cases, [caseRow({ id: 5 })]], [t.refs, []], [t.fails, [failureRow({ id: 2 })]]]);
  ctrl = buildStoreFake(store);
  out = await retry(ctrl, failureRow({ id: 2 }));
  assert.equal(out.status, "resolved");
}

// ─── (23) feature OFF → zero source/retry reads/writes ───────────
async function r23_flagOff() {
  const t = await schemaTables();
  const store = new Map<any, Row[]>([[t.cdr, [readinessRow()]], [t.cases, [caseRow()]], [t.refs, []], [t.fails, [failureRow({ id: 1 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1 }), { unifiedAncillaryDocuments: false });
  assert.equal(out.status, "skipped");
  assert.equal(ctrl.calls.length, 0, "feature OFF issues zero reads/writes");
}

// ─── (24) no PHI in retry outcome/metadata ───────────────────────
async function r24_noPhi() {
  const t = await schemaTables();
  const store = new Map<any, Row[]>([[t.cdr, [readinessRow()]], [t.cases, [caseRow()]], [t.refs, []], [t.fails, [failureRow({ id: 1 })]]]);
  const ctrl = buildStoreFake(store);
  const out = await retry(ctrl, failureRow({ id: 1 }));
  for (const k of Object.keys(out)) {
    assert.ok(["failureId", "requestedAction", "status", "message"].includes(k), `unexpected/PHI outcome key ${k}`);
  }
  const blob = JSON.stringify(out).toLowerCase();
  for (const phi of ["name", "dob", "mrn", "phone", "insurance", "diagnosis"]) {
    assert.ok(!blob.includes(phi), `no PHI token '${phi}' in retry outcome`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) SelectedCaseOverview requests by ancillaryCaseId", c01_exactCaseParams],
  ["(2) missing ancillaryCaseId → zero canonical requests", c02_missingCaseNoRequest],
  ["(3/4/5) case A≠B; services + episodes stay separate", c03_05_caseSeparation],
  ["(6/7) CaseOverview zero requests; wrapper ≤1 query", c06_07_presentationOnly],
  ["(8) dead batch-summary code removed", c08_deadBatchRemoved],
  ["(9/10) link_report create + exact-source reuse resolve", r09_10_reportRetry],
  ["(11) link_consent → consent reference", r11_consentRetry],
  ["(12) link_screening_form → screening_form reference", r12_screeningFormRetry],
  ["(13/22) two sources separate; resolve only exact id", r13_22_separateSources],
  ["(14) active-kind conflict remains unresolved", r14_activeKindConflict],
  ["(15) cross-clinic source denied", r15_crossClinic],
  ["(16) wrong document type rejected", r16_wrongType],
  ["(17) wrong service rejected", r17_wrongService],
  ["(18) wrong ancillary case rejected", r18_wrongCase],
  ["(19) missing source remains unresolved", r19_missingSource],
  ["(20/21) ambiguity unresolved; later deterministic resolves", r20_21_ambiguityThenResolve],
  ["(23) feature OFF → zero source/retry reads/writes", r23_flagOff],
  ["(24) no PHI in retry outcome/metadata", r24_noPhi],
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
