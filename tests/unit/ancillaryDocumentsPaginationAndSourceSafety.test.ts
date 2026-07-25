// Phase 2E-B2 — keyset pagination + source-safe reconciliation/reference.
//
//   npx tsx tests/unit/ancillaryDocumentsPaginationAndSourceSafety.test.ts
//
// Uses a predicate-aware store fake that HONORS the SQL keyset (ordering,
// compound cursor, limit+1) and the reconciliation dedupe predicates, so
// pagination + source-specific dedupe are verified behaviorally.

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";

const projection = () => import("../../server/services/ancillaryDocuments/documentProjection");
const repo = () => import("../../server/repositories/ancillaryDocuments.repo");
const refWriter = () => import("../../server/services/ancillaryDocuments/documentReferenceWriter");

const T = (n: number) => new Date(2027, 5, 1, 10, 0, n); // vary by seconds

// ─── Predicate-aware store fake ───────────────────────────────────
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
  const trips = triples(cond);
  // Extract compound keyset (actual_created_at </=, id <) and evaluate it apart
  // from the plain AND conditions so the cursor OR is honored.
  let cursorTs: number | null = null, cursorId: number | null = null;
  const plain: Array<[string, string, unknown]> = [];
  for (const [c, o, v] of trips) {
    if (c === "actual_created_at" && o === "<") cursorTs = new Date(v as any).getTime();
    else if (c === "actual_created_at" && o === "=") { /* cursor tie arm */ }
    else if (c === "id" && o === "<") cursorId = Number(v);
    else plain.push([c, o, v]);
  }
  for (const [c, o, v] of plain) {
    const key = cm[c] ?? c;
    const rv = row[key];
    if (o === "=") { if (String(rv) !== String(v)) return false; }
    else if (o === "<>") { if (String(rv) === String(v)) return false; }
    else if (o === "is null") { if (rv != null) return false; }
    else if (o === "is not null") { if (rv == null) return false; }
    else if (o === "<") { if (!(rv < (v as any))) return false; }
  }
  if (cursorTs != null && cursorId != null) {
    const rt = (row.actualCreatedAt as Date).getTime();
    if (!(rt < cursorTs || (rt === cursorTs && row.id < cursorId))) return false;
  }
  return true;
}

type StoreFake = { db: any; store: Map<any, Row[]>; lastOrderBy: any[]; lastLimit: number | null; };
function buildStoreFake(store: Map<any, Row[]>): StoreFake {
  const ctrl: StoreFake = { db: null, store, lastOrderBy: [], lastLimit: null };
  const idc = new Map<any, number>();
  const nextId = (t: any) => { const n = (idc.get(t) ?? 9000) + 1; idc.set(t, n); return n; };
  const fake: any = {
    select() {
      let t: any = null, cond: any = null, order: any[] = [], lim: number | null = null;
      const chain: any = {
        from(x: any) { t = x; return chain; },
        leftJoin() { return chain; }, innerJoin() { return chain; },
        where(c: any) { cond = c; return chain; },
        orderBy(...a: any[]) { order = a; return chain; },
        groupBy() { return chain; }, $dynamic() { return chain; },
        limit(n: number) { lim = n; return Promise.resolve(result()); },
        then(res: any, rej: any) { Promise.resolve().then(result).then(res, rej); },
      };
      function result() {
        ctrl.lastOrderBy = order; ctrl.lastLimit = lim;
        let rows = (store.get(t) ?? []).filter((r) => rowMatches(r, t, cond));
        // Honor the deterministic keyset ordering the repo requests.
        if (order.length > 0) rows = rows.slice().sort((a, b) => (b.actualCreatedAt?.getTime?.() ?? 0) - (a.actualCreatedAt?.getTime?.() ?? 0) || b.id - a.id);
        if (lim != null) rows = rows.slice(0, lim);
        return rows.map((r) => ({ ...r }));
      }
      return chain;
    },
    insert(t: any) {
      return { values(v: Row) {
        const settle = () => { const row = { ...v, id: v.id ?? nextId(t) }; (store.get(t) ?? store.set(t, []).get(t)!).push(row); return Promise.resolve([{ ...row }]); };
        return { returning: settle, onConflictDoNothing() { return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; }, then: (r: any, j?: any) => settle().then(r, j) };
      } };
    },
    update(t: any) {
      return { set(v: Row) { let cond: any = null; return { where(c: any) { cond = c; const settle = () => { const rows = (store.get(t) ?? []).filter((r) => rowMatches(r, t, cond)); rows.forEach((r) => Object.assign(r, v)); return Promise.resolve(rows.map((r) => ({ ...r }))); }; return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; } }; } };
    },
    delete() { return { where() { return { returning: () => Promise.resolve([]), then: (r: any) => Promise.resolve([]).then(r) }; } }; },
    async transaction(fn: any) { return fn(fake); },
    execute: async () => ({ rows: [] }),
  };
  ctrl.db = fake;
  return ctrl;
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

async function tables() {
  const docs = await import("../../shared/schema/ancillaryDocuments");
  return { refs: docs.ancillaryDocumentReferences, fails: docs.ancillaryDocumentReconciliationFailures };
}
function refRow(over: Row = {}): Row {
  return { id: 1, clinicId: 1, ancillaryCaseId: 5, serviceType: "EchoWave", documentKind: "report", sourceSystem: "x", sourceTable: "case_document_readiness", sourceId: 100, documentStatus: "uploaded", effectiveClinicalDate: null, actualCreatedAt: T(0), signedAt: null, supersededAt: null, globalPlexusPatientId: 10, patientScreeningId: 77, executionCaseId: 900, metadata: {}, ...over };
}

// ═══════════════ (1) compound cursor includes ts + id ═════════════
async function t01_cursorEncoding() {
  const p = await projection();
  const c = { actualCreatedAt: T(30), id: 42 };
  const enc = p.encodeDocumentsCursor(c);
  assert.equal(typeof enc, "string");
  const dec = p.decodeDocumentsCursor(enc);
  assert.equal(dec.id, 42, "cursor carries the id");
  assert.equal(dec.actualCreatedAt.getTime(), T(30).getTime(), "cursor carries the timestamp");
}

// ═══════════════ (2/8/9) SQL ordering + limit+1 in the repo ═══════
async function t02_08_orderingAndLimitPlusOne() {
  const t = await tables();
  const r = await repo();
  const ctrl = buildStoreFake(new Map([[t.refs, Array.from({ length: 3 }, (_, i) => refRow({ id: i + 1, actualCreatedAt: T(i) }))]]));
  await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    r.searchClinicReferencesPage({ filters: { clinicId: 1 }, currentOnly: false, cursor: null, limit: 25 }));
  // (2) two order columns → actual_created_at then id.
  assert.equal(ctrl.lastOrderBy.length, 2, "orders by two columns");
  const orderCols = ctrl.lastOrderBy.map((o) => tokenize(o).find((tk) => tk.col)?.col);
  assert.deepEqual(orderCols, ["actual_created_at", "id"], "ordering is actual_created_at then id");
  // (8/9) limit is requested+1 (keyset probe), NOT a fixed 500 prefetch.
  assert.equal(ctrl.lastLimit, 26, "repo requests limit+1");
}

// ═══════════════ (3) tied timestamps page without duplication ═════
async function t03_tiedTimestamps() {
  const t = await tables();
  const p = await projection();
  // 5 rows, ALL the same timestamp → id is the only tiebreaker.
  const rows = Array.from({ length: 5 }, (_, i) => refRow({ id: i + 1, actualCreatedAt: T(0) }));
  const ctrl = buildStoreFake(new Map([[t.refs, rows]]));
  const seen: number[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 10; guard++) {
    const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
      p.getAncillaryDocumentsList({ clinicId: 1, limit: 2, cursor }));
    seen.push(...res.items.map((i) => i.ancillaryDocumentReferenceId));
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  assert.deepEqual(seen, [5, 4, 3, 2, 1], "tied timestamps traversed by id DESC, no dup/missing");
  assert.equal(new Set(seen).size, 5, "no duplicates");
}

// ═══════════════ (4) traverse beyond 500 rows ════════════════════
async function t04_beyond500() {
  const t = await tables();
  const p = await projection();
  const rows = Array.from({ length: 1200 }, (_, i) => refRow({ id: i + 1, actualCreatedAt: T(i % 60) }));
  const ctrl = buildStoreFake(new Map([[t.refs, rows]]));
  const seen = new Set<number>();
  let cursor: string | undefined; let pages = 0;
  for (let guard = 0; guard < 100; guard++) {
    const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
      p.getAncillaryDocumentsList({ clinicId: 1, limit: 200, cursor }));
    pages++;
    for (const it of res.items) {
      assert.ok(!seen.has(it.ancillaryDocumentReferenceId), "no row seen twice across pages");
      seen.add(it.ancillaryDocumentReferenceId);
    }
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  assert.equal(seen.size, 1200, "all 1200 rows traversed past the old 500 ceiling");
  assert.ok(pages >= 6, "actually paged multiple times");
}

// ═══════════════ (5) malformed cursor rejected ═══════════════════
async function t05_malformedCursor() {
  const p = await projection();
  assert.throws(() => p.decodeDocumentsCursor("%%%not-base64-json%%%"), /invalid_cursor/i);
  await assert.rejects(
    () => runWithStore(buildStoreFake(new Map()), { unifiedAncillaryDocuments: true }, async () =>
      p.getAncillaryDocumentsList({ clinicId: 1, cursor: "garbage" })),
    (e: any) => e?.code === "INVALID_CURSOR",
  );
}

// ═══════════════ (6) clinic scope stays applied with a cursor ════
async function t06_clinicScopeWithCursor() {
  const t = await tables();
  const p = await projection();
  const rows = [
    refRow({ id: 1, clinicId: 1, actualCreatedAt: T(3) }),
    refRow({ id: 2, clinicId: 2, actualCreatedAt: T(2) }), // other clinic
    refRow({ id: 3, clinicId: 1, actualCreatedAt: T(1) }),
  ];
  const ctrl = buildStoreFake(new Map([[t.refs, rows]]));
  const first = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    p.getAncillaryDocumentsList({ clinicId: 1, limit: 1 }));
  assert.equal(first.items[0].ancillaryDocumentReferenceId, 1);
  const second = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    p.getAncillaryDocumentsList({ clinicId: 1, limit: 5, cursor: first.nextCursor! }));
  const ids = second.items.map((i) => i.ancillaryDocumentReferenceId);
  assert.deepEqual(ids, [3], "cursor page stays within clinic 1 — never leaks clinic 2");
}

// ═══════════════ (7) includeHistory applied before pagination ════
async function t07_includeHistoryInSql() {
  const t = await tables();
  const p = await projection();
  const rows = [
    refRow({ id: 1, actualCreatedAt: T(3) }),
    refRow({ id: 2, actualCreatedAt: T(2), supersededAt: T(5) }), // history
    refRow({ id: 3, actualCreatedAt: T(1), documentStatus: "voided" }),
  ];
  const ctrl = buildStoreFake(new Map([[t.refs, rows]]));
  const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    p.getAncillaryDocumentsList({ clinicId: 1, includeHistory: false, limit: 50 }));
  assert.deepEqual(res.items.map((i) => i.ancillaryDocumentReferenceId), [1], "superseded + voided excluded in SQL");
}

// ═══════════════ (10) exact-source race returns the exact winner ═
async function t10_exactSourceRace() {
  const t = await tables();
  const r = await repo();
  // Insert throws unique violation; the EXACT source already exists → reused.
  const winner = refRow({ id: 500, sourceTable: "case_document_readiness", sourceId: 100, documentKind: "report" });
  const store = new Map<any, Row[]>([[t.refs, [winner]]]);
  const ctrl = buildStoreFake(store);
  const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    r.createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 100, documentStatus: "uploaded" }));
  assert.equal(res.outcome, "reused_exact_source_unchanged");
  if (res.outcome === "reused_exact_source_unchanged") assert.equal(res.existing.id, 500);
}

// ═══════════════ (11) different-source active-kind conflict ≠ reused ═
async function t11_activeKindConflictNotReused() {
  const t = await tables();
  const r = await repo();
  // An ACTIVE report of the SAME case but a DIFFERENT source already exists.
  const other = refRow({ id: 600, sourceTable: "case_document_readiness", sourceId: 999, documentKind: "report", supersededAt: null });
  const ctrl = buildStoreFake(new Map<any, Row[]>([[t.refs, [other]]]));
  const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    r.createReference({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 100, documentStatus: "uploaded" }));
  assert.equal(res.outcome, "active_kind_conflict", "different source is NEVER reused");
  if (res.outcome === "active_kind_conflict") {
    assert.equal(res.existing.id, 600, "surfaces the existing reference, never overwrites it");
    assert.equal(res.existing.sourceId, 999, "old source identity untouched");
  }
}

// ═══════════════ (12) writer: conflict → source-specific retry ═══
async function t12_writerConflictRetry() {
  const t = await tables();
  const w = await refWriter();
  const anc = await import("../../shared/schema/ancillaryCases");
  const caseRow = { id: 5, clinicId: 1, serviceType: "EchoWave", lifecycleStatus: "active", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20 };
  const other = refRow({ id: 600, sourceId: 999, documentKind: "report", supersededAt: null });
  const store = new Map<any, Row[]>([
    [(anc as any).patientAncillaryCases, [caseRow]],
    [t.refs, [other]],
    [t.fails, []],
  ]);
  const ctrl = buildStoreFake(store);
  const res = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    w.ensureAncillaryDocumentReference({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 100, serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 1, documentStatus: "uploaded", source: "x" }));
  assert.equal(res.status, "active_kind_conflict");
  // A source-specific retry row for the NEW source was recorded.
  const fails = store.get(t.fails)!;
  assert.equal(fails.length, 1, "one retry for the conflicting new source");
  assert.equal(fails[0].sourceId, 100, "retry keyed to the new source id");
}

// ═══════════════ (13/14) two source ids → two rows; own attempts ═
async function t13_14_sourceSpecificDedupe() {
  const t = await tables();
  const r = await repo();
  const store = new Map<any, Row[]>([[t.fails, []]]);
  const ctrl = buildStoreFake(store);
  await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () => {
    await r.recordAncillaryDocumentFailure({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 100, requestedAction: "link_report" });
    await r.recordAncillaryDocumentFailure({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 200, requestedAction: "link_report" });
    // (14) repeat source 100 → increments ONLY its own attempt count.
    await r.recordAncillaryDocumentFailure({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 100, requestedAction: "link_report" });
  });
  const fails = store.get(t.fails)!;
  assert.equal(fails.length, 2, "(13) two different source ids → two separate retry rows");
  const s100 = fails.find((f) => f.sourceId === 100)!;
  const s200 = fails.find((f) => f.sourceId === 200)!;
  assert.equal(s100.attemptCount, 2, "(14) repeat increments only source 100");
  assert.equal(s200.attemptCount, 1, "source 200 unaffected");
}

// ═══════════════ (15) different clinics never dedupe ═════════════
async function t15_clinicIsolation() {
  const t = await tables();
  const r = await repo();
  const store = new Map<any, Row[]>([[t.fails, []]]);
  const ctrl = buildStoreFake(store);
  await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () => {
    await r.recordAncillaryDocumentFailure({ clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 100, requestedAction: "link_report" });
    await r.recordAncillaryDocumentFailure({ clinicId: 2, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 100, requestedAction: "link_report" });
  });
  assert.equal(store.get(t.fails)!.length, 2, "clinic A and clinic B never dedupe together");
}

// ═══════════════ (16) exact resolution leaves siblings unresolved ═
async function t16_exactResolutionSiblings() {
  const t = await tables();
  const r = await repo();
  const store = new Map<any, Row[]>([[t.fails, [
    { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 100, requestedAction: "link_report", resolvedAt: null },
    { id: 2, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 200, requestedAction: "link_report", resolvedAt: null },
  ]]]);
  const ctrl = buildStoreFake(store);
  const ok = await runWithStore(ctrl, { unifiedAncillaryDocuments: true }, async () =>
    r.resolveAncillaryDocumentFailureById({ id: 1, clinicId: 1 }));
  assert.equal(ok, true);
  const fails = store.get(t.fails)!;
  assert.ok(fails.find((f) => f.id === 1)!.resolvedAt != null, "target resolved");
  assert.equal(fails.find((f) => f.id === 2)!.resolvedAt, null, "sibling source stays unresolved");
}

// ═══════════════ (17-20/32-35) download reference safety ═════════
async function t17_20_downloadSafety() {
  const dl = await import("../../server/services/ancillaryDocuments/downloadReference");
  // (18/32) The `documents:` route is NOT tenant-safe, so it is NOT in the
  // allowlist → resolves to null (never fabricated). No pointer is emitted.
  assert.equal(dl.resolveAuthorizedDownloadReference(refRow({ metadata: { download_reference: "documents:55" } }) as any), null);
  assert.deepEqual([...dl.AUTHORIZED_POINTER_PREFIXES], [], "no unsafe download pointer is emitted");
  assert.deepEqual(dl.emittedDownloadRoutes(), [], "no download route emitted until a tenant-safe one exists");
  // no fabricated sourceTable:sourceId when metadata carries no pointer.
  assert.equal(dl.resolveAuthorizedDownloadReference(refRow({ sourceTable: "procedure_notes", sourceId: 900, metadata: {} }) as any), null);
  // (19) unsafe/raw pointers rejected.
  for (const bad of ["s3://bucket/key.pdf", "http://evil.example/x", "/etc/passwd", "documents:abc", "documents:1;rm", "unknown_prefix:5"]) {
    assert.equal(dl.resolveAuthorizedDownloadReference(refRow({ metadata: { download_reference: bad } }) as any), null, `rejects ${bad}`);
  }
  // (20/35) missing/unknown pointer → null.
  assert.equal(dl.resolveAuthorizedDownloadReference(refRow({ metadata: {} }) as any), null);
  assert.equal(dl.resolveAuthorizedDownloadReference(refRow({ metadata: null }) as any), null);
  // (33/34) EVERY emitted route (currently none) must be registered + tenant-safe.
  // Assert the invariant: the emitted set is a subset of a known tenant-safe
  // allowlist. `/api/documents-library/:id/file` is NOT tenant-safe and MUST
  // NOT be emitted.
  for (const route of dl.emittedDownloadRoutes()) {
    assert.ok(!/documents-library/.test(route), "must not emit the non-tenant-safe documents-library route");
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) compound cursor includes timestamp + id", t01_cursorEncoding],
  ["(2/8/9) SQL ordering (createdAt,id) + limit+1, no 500 prefetch", t02_08_orderingAndLimitPlusOne],
  ["(3) tied timestamps page without duplication", t03_tiedTimestamps],
  ["(4) traverse beyond 500 rows", t04_beyond500],
  ["(5) malformed cursor rejected", t05_malformedCursor],
  ["(6) clinic scope stays applied with a cursor", t06_clinicScopeWithCursor],
  ["(7) includeHistory applied before pagination (SQL)", t07_includeHistoryInSql],
  ["(10) exact-source race returns the exact winner", t10_exactSourceRace],
  ["(11) different-source active-kind conflict ≠ reused", t11_activeKindConflictNotReused],
  ["(12) writer conflict → source-specific retry", t12_writerConflictRetry],
  ["(13/14) two source ids → two rows; own attempt counts", t13_14_sourceSpecificDedupe],
  ["(15) different clinics never dedupe", t15_clinicIsolation],
  ["(16) exact resolution leaves siblings unresolved", t16_exactResolutionSiblings],
  ["(17-20/32-35) download reference safety (no unsafe route emitted)", t17_20_downloadSafety],
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
