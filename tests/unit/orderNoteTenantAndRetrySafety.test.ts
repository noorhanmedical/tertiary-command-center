// Phase 2E-A4 — tenant-safe signing + durable, tenant-scoped evidence retry.
//
//   npx tsx tests/unit/orderNoteTenantAndRetrySafety.test.ts
//
// Uses a PREDICATE-AWARE in-memory fake db (honors id/clinic_id/case/source
// equality in WHERE clauses) so clinic isolation is verified behaviorally,
// not by source-text assertions. A second harness (canonicalHarness) drives
// the createOrReuseOrderNote path for ledger-failure surfacing + PHI checks.

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call,
} from "../support/canonicalHarness";

const signWf = () => import("../../server/services/physicianPortal/signatureWorkflow");
const notesRepo = () => import("../../server/repositories/generatedNotes.repo");
const physPortalRepo = () => import("../../server/repositories/physicianPortal.repo");
const orderNoteSvc = () => import("../../server/services/ancillaryDocuments/orderNoteService");
const retryWorker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const genSchema = () => import("../../shared/schema/generatedNotes");
const docsRepo = () => import("../../server/repositories/ancillaryDocuments.repo");

const START = new Date("2027-06-01T10:00:00Z");

// ─── Predicate-aware fake db ──────────────────────────────────────────────
type Row = Record<string, any>;
// Equality columns we actually enforce when filtering the store. Complex
// predicates (inArray / COALESCE / IS NULL) are intentionally not enforced —
// store rows are pre-shaped to satisfy them — so pairing never misfires.
const ENFORCED = new Set([
  "id", "clinic_id", "ancillary_case_id", "source_id", "source_table", "document_kind", "new_status", "note_type",
]);

function colKeyMap(table: any): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(table)) {
    if (v && typeof v === "object" && typeof (v as any).name === "string") m[(v as any).name] = k;
  }
  return m;
}
function extractEqs(cond: any): Array<[string, unknown]> {
  const flat: Array<{ col?: string; val?: unknown }> = [];
  (function walk(o: any, d = 0): void {
    if (d > 12 || o == null || typeof o !== "object") return;
    if (typeof o.name === "string" && o.table) flat.push({ col: o.name });
    else if ("value" in o && (o.encoder || o.type)) flat.push({ val: o.value });
    if (Array.isArray(o.queryChunks)) o.queryChunks.forEach((c: any) => walk(c, d + 1));
    else if (Array.isArray(o)) o.forEach((c: any) => walk(c, d + 1));
  })(cond);
  const out: Array<[string, unknown]> = [];
  for (let i = 0; i < flat.length - 1; i++) {
    if (flat[i].col !== undefined && flat[i + 1] && flat[i + 1].val !== undefined) {
      out.push([flat[i].col as string, flat[i + 1].val]); i++;
    }
  }
  return out;
}
// Columns the fake treats as an `IS NULL` predicate when they appear in a
// condition (the only IS NULL filters these queries use). Lets the retry
// ledger's `resolved_at IS NULL` guard be honored → idempotent resolution.
const NULL_GUARD_COLS = new Set(["resolved_at"]);
function collectCols(cond: any): Set<string> {
  const cols = new Set<string>();
  (function walk(o: any, d = 0): void {
    if (d > 12 || o == null || typeof o !== "object") return;
    if (typeof o.name === "string" && o.table) cols.add(o.name);
    if (Array.isArray(o.queryChunks)) o.queryChunks.forEach((c: any) => walk(c, d + 1));
    else if (Array.isArray(o)) o.forEach((c: any) => walk(c, d + 1));
  })(cond);
  return cols;
}
function rowMatches(row: Row, table: any, cond: any): boolean {
  if (cond == null) return true;
  const cm = colKeyMap(table);
  const eqs = extractEqs(cond);
  const eqCols = new Set(eqs.map(([c]) => c));
  for (const [col, val] of eqs) {
    if (!ENFORCED.has(col)) continue;
    const key = cm[col] ?? col;
    if (row[key] !== val) return false;
  }
  // Honor IS NULL guards (only when the column is not also an equality target).
  for (const col of collectCols(cond)) {
    if (NULL_GUARD_COLS.has(col) && !eqCols.has(col)) {
      const key = cm[col] ?? col;
      if (row[key] != null) return false;
    }
  }
  return true;
}

type StoreFake = {
  db: any;
  calls: Call[];
  store: Map<any, Row[]>;
  // Test hook: when set, the referenced-table update throws (simulates a
  // reference metadata write failure inside the retry transaction).
  failReferenceTable: any;
};

function buildStoreFake(store: Map<any, Row[]>, opts: { failReferenceTable?: any } = {}): StoreFake {
  const calls: Call[] = [];
  const idc = new Map<any, number>();
  const nextId = (t: any) => { const n = (idc.get(t) ?? 5000) + 1; idc.set(t, n); return n; };
  const ctrl: StoreFake = { db: null, calls, store, failReferenceTable: opts.failReferenceTable ?? null };
  const fake: any = {
    select() {
      let t: any = null; let cond: any = null;
      const chain: any = {
        from(x: any) { t = x; return chain; },
        leftJoin() { return chain; }, innerJoin() { return chain; },
        where(c: any) { cond = c; return chain; },
        orderBy() { return chain; }, groupBy() { return chain; }, $dynamic() { return chain; },
        limit() { return Promise.resolve(result()); },
        then(res: any, rej: any) { Promise.resolve().then(result).then(res, rej); },
      };
      function result() {
        calls.push({ op: "select", table: t });
        return (store.get(t) ?? []).filter((r) => rowMatches(r, t, cond)).map((r) => ({ ...r }));
      }
      return chain;
    },
    insert(t: any) {
      return {
        values(v: Row) {
          const settle = () => {
            calls.push({ op: "insert", table: t, payload: v });
            const row = { ...v, id: v.id ?? nextId(t) };
            if (!store.has(t)) store.set(t, []);
            store.get(t)!.push(row);
            return Promise.resolve([{ ...row }]);
          };
          return {
            returning: settle,
            onConflictDoNothing() { return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) }; },
            then: (r: any, j?: any) => settle().then(r, j),
          };
        },
      };
    },
    update(t: any) {
      return {
        set(v: Row) {
          let cond: any = null;
          return {
            where(c: any) {
              cond = c;
              calls.push({ op: "update", table: t, payload: v });
              const settle = () => {
                if (ctrl.failReferenceTable != null && t === ctrl.failReferenceTable) {
                  return Promise.reject(Object.assign(new Error("reference write boom"), { code: "08006" }));
                }
                const rows = (store.get(t) ?? []).filter((r) => rowMatches(r, t, cond));
                rows.forEach((r) => Object.assign(r, v));
                return Promise.resolve(rows.map((r) => ({ ...r })));
              };
              return { returning: settle, then: (r: any, j?: any) => settle().then(r, j) };
            },
          };
        },
      };
    },
    delete(t: any) {
      return { where() { calls.push({ op: "delete", table: t }); const s = () => Promise.resolve([]); return { returning: s, then: (r: any) => s().then(r) }; } };
    },
    async transaction(fn: any) {
      calls.push({ op: "transaction", table: null });
      const snap = new Map<any, Row[]>();
      for (const [k, v] of store) snap.set(k, v.map((r) => ({ ...r })));
      try { return await fn(fake); }
      catch (e) { store.clear(); for (const [k, v] of snap) store.set(k, v); throw e; }
    },
    execute: async () => ({ rows: [] }),
  };
  ctrl.db = fake;
  return ctrl;
}

type Flags = {
  canonicalAppointment?: boolean; ancillaryCaseWrite?: boolean; plexusIdentityWrite?: boolean;
  unifiedAncillaryDocuments?: boolean; canonicalOrderNote?: boolean;
};
async function runWithStore<T>(ctrl: StoreFake, flags: Flags, fn: (ctrl: StoreFake) => Promise<T>): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;
  const savedDb: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) savedDb[k] = dbObj[k];
  const savedFlags: Record<string, boolean> = {
    unifiedAncillaryDocuments: ff.unifiedAncillaryDocuments, canonicalOrderNote: ff.canonicalOrderNote,
    canonicalAppointment: ff.canonicalAppointment, ancillaryCaseWrite: ff.ancillaryCaseWrite, plexusIdentityWrite: ff.plexusIdentityWrite,
  };
  for (const k of Object.keys(savedDb)) dbObj[k] = ctrl.db[k];
  for (const [k, v] of Object.entries(flags)) if (v !== undefined) (ff as any)[k] = v;
  try { return await fn(ctrl); }
  finally {
    for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v;
    for (const [k, v] of Object.entries(savedFlags)) (ff as any)[k] = v;
  }
}

// ─── Store seed helpers ───────────────────────────────────────────────────
function noteRow(over: Row = {}): Row {
  return {
    id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77,
    serviceType: "EchoWave", noteType: "order_note", generationStatus: "generated",
    generatedText: "body", generatedByAi: false, sourceData: {}, errorMessage: null,
    signatureStatus: "needs_signature", signedAt: null, signedByUserId: null, returnReason: null,
    adminReviewEventId: null, supersededAt: null, supersedesNoteId: null,
    createdAt: START, updatedAt: START, ...over,
  };
}
function caseRow(over: Row = {}): Row {
  return { id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved", ...over };
}
function eventRow(over: Row = {}): Row {
  return { id: 555, ancillaryCaseId: 5, newStatus: "approved", actualReviewedAt: START, ...over };
}
function refRow(over: Row = {}): Row {
  return { id: 42, clinicId: 1, ancillaryCaseId: 5, sourceTable: "procedure_notes", sourceId: 900, documentKind: "order_note", metadata: {}, ...over };
}
function failureRow(over: Row = {}): Row {
  return { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "link_order_note_evidence", resolvedAt: null, attemptCount: 1, ...over };
}
async function seedTables() { return loadCanonicalTables(); }
function storeWith(t: any, seed: Record<string, Row[]>): Map<any, Row[]> {
  const m = new Map<any, Row[]>();
  for (const [k, rows] of Object.entries(seed)) m.set((t as any)[k], rows);
  return m;
}
const FLAGS_ON: Flags = { unifiedAncillaryDocuments: true, canonicalOrderNote: true };

// ═══════════════════ (1) load by id is clinic-scoped ═══════════════════════
async function t01_loadScoped() {
  const t = await seedTables();
  const { getProcedureNoteByIdForClinic } = await physPortalRepo();
  const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow({ id: 900, clinicId: 2 })] }));
  await runWithStore(ctrl, {}, async () => {
    const mine = await getProcedureNoteByIdForClinic({ id: 900, clinicId: 1 });
    assert.equal(mine, undefined, "clinic A cannot load clinic B's note by id");
    const theirs = await getProcedureNoteByIdForClinic({ id: 900, clinicId: 2 });
    assert.ok(theirs && theirs.id === 900, "owning clinic still loads it");
  });
}

// ═══════════════════ (2) cannot sign another clinic's note ═════════════════
async function t02_cannotSign() {
  const t = await seedTables();
  const wf = await signWf();
  wf.setBillingReevalScheduler(() => {});
  try {
    const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow({ clinicId: 2 })] }));
    await runWithStore(ctrl, {}, async () => {
      const r = await wf.signProcedureNote({ id: 900, clinicId: 1, authenticatedSignerUserId: "u1" });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, 404, "cross-clinic reads as not found");
      assert.equal(ctrl.store.get(t.procedureNotes)![0].signatureStatus, "needs_signature", "note untouched");
    });
  } finally { wf.setBillingReevalScheduler(null); }
}

// ═══════════════════ (3) cannot return another clinic's note ═══════════════
async function t03_cannotReturn() {
  const t = await seedTables();
  const wf = await signWf();
  const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow({ clinicId: 2 })] }));
  await runWithStore(ctrl, {}, async () => {
    const r = await wf.returnProcedureNoteForCorrection({ id: 900, clinicId: 1, reason: "fix" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 404);
    assert.equal(ctrl.store.get(t.procedureNotes)![0].signatureStatus, "needs_signature", "note untouched");
  });
}

// ═══════════════════ (4) bulk sign skips other-clinic ids ══════════════════
async function t04_bulkSkips() {
  const t = await seedTables();
  const wf = await signWf();
  wf.setBillingReevalScheduler(() => {});
  try {
    const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow({ id: 900, clinicId: 1 }), noteRow({ id: 901, clinicId: 2 })] }));
    const res = await runWithStore(ctrl, {}, async () => wf.bulkSignNotes([900, 901], 1, "u1"));
    assert.deepEqual(res.signed, [900], "only same-clinic note signed");
    assert.equal(res.skipped.length, 1);
    assert.equal(res.skipped[0].id, 901);
    const other = ctrl.store.get(t.procedureNotes)!.find((r) => r.id === 901)!;
    assert.equal(other.signatureStatus, "needs_signature", "other clinic note untouched");
  } finally { wf.setBillingReevalScheduler(null); }
}

// ═══════════════════ (5) list contains only this clinic's rows ═════════════
async function t05_listScoped() {
  const t = await seedTables();
  const wf = await signWf();
  const ctrl = buildStoreFake(storeWith(t, {
    procedureNotes: [noteRow({ id: 900, clinicId: 1, patientScreeningId: 77 }), noteRow({ id: 901, clinicId: 2, patientScreeningId: 88 })],
  }));
  const items = await runWithStore(ctrl, {}, async () => wf.listSignatureItems({ clinicId: 1 }));
  assert.equal(items.length, 1, "only the authenticated clinic's rows are listed");
  assert.equal(items[0].id, 900);
}

// ═══════════════════ (6) sign write requires id AND clinic id ══════════════
async function t06_writeScoped() {
  const t = await seedTables();
  const { signProcedureNoteRow } = await notesRepo();
  const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow({ id: 900, clinicId: 1 })] }));
  await runWithStore(ctrl, {}, async () => {
    const wrong = await signProcedureNoteRow({ id: 900, clinicId: 999, signedByUserId: "u1" });
    assert.equal(wrong, undefined, "wrong clinic matches zero rows → no write");
    assert.equal(ctrl.store.get(t.procedureNotes)![0].signatureStatus, "needs_signature", "note untouched by wrong-clinic write");
    const ok = await signProcedureNoteRow({ id: 900, clinicId: 1, signedByUserId: "u1" });
    assert.ok(ok && ok.id === 900, "correct clinic writes");
  });
}

// ═══════════════════ (7/8) server time + session signer ════════════════════
async function t07_08_serverTimeAndSigner() {
  const t = await seedTables();
  const { signProcedureNoteRow } = await notesRepo();
  const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow()] }));
  const before = Date.now();
  await runWithStore(ctrl, {}, async () => signProcedureNoteRow({ id: 900, clinicId: 1, signedByUserId: "session-user-9" }));
  const row = ctrl.store.get(t.procedureNotes)![0];
  assert.ok(row.signedAt instanceof Date && row.signedAt.getTime() >= before, "(7) signedAt = server time");
  assert.equal(row.signedByUserId, "session-user-9", "(8) signer = session user id");
  assert.equal(row.signatureStatus, "signed");
  assert.equal(row.generationStatus, "approved");
}

// ═══════════════════ (9) no command accepts caller signedAt ════════════════
async function t09_noCallerSignedAt() {
  const schema = await genSchema();
  // No exported shared schema/type carries signedAt for signing anymore.
  assert.equal((schema as any).procedureNoteSignatureUpdateSchema, undefined, "signature-update schema removed");
  // The signing command ignores an injected signedAt: server time wins.
  const t = await seedTables();
  const { signProcedureNoteRow } = await notesRepo();
  const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow()] }));
  const injected = new Date("2000-01-01T00:00:00Z");
  const before = Date.now();
  await runWithStore(ctrl, {}, async () => signProcedureNoteRow({ id: 900, clinicId: 1, signedByUserId: "u1", signedAt: injected } as any));
  const row = ctrl.store.get(t.procedureNotes)![0];
  assert.notEqual(row.signedAt.getTime(), injected.getTime(), "injected signedAt ignored");
  assert.ok(row.signedAt.getTime() >= before, "server time used");
}

// ═══════════════════ (10) no command accepts caller signedByUserId ═════════
async function t10_noCallerSigner() {
  const { insertProcedureNoteSchema } = await genSchema();
  const parsed = insertProcedureNoteSchema.parse({ serviceType: "EchoWave", noteType: "order_note", signedByUserId: "attacker", signedAt: START, signatureStatus: "signed" } as Record<string, unknown>) as Record<string, unknown>;
  for (const f of ["signedByUserId", "signedAt", "signatureStatus"]) {
    assert.ok(!(f in parsed), `general create schema strips ${f}`);
  }
}

// ═══════════════════ (11) signed note rejects every general update ═════════
async function t11_signedImmutable() {
  const t = await seedTables();
  const { updateGeneratedNote } = await notesRepo();
  const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow({ signatureStatus: "signed", signedAt: START })] }));
  await runWithStore(ctrl, {}, async () => {
    for (const patch of [{ generatedText: "x" }, { generationStatus: "pending" }, { clinicId: 9 }, { serviceType: "z" }, { returnReason: "r" }, { executionCaseId: 3 }]) {
      await assert.rejects(() => updateGeneratedNote(900, patch as never), /signed_note_immutable/i, `rejects ${Object.keys(patch)[0]}`);
    }
  });
  const row = ctrl.store.get(t.procedureNotes)![0];
  assert.equal(row.generationStatus, "generated", "no field changed");
  assert.equal(row.clinicId, 1);
}

// ═══════════════════ (12) return uses dedicated clinic-scoped transition ═══
async function t12_returnScoped() {
  const t = await seedTables();
  const wf = await signWf();
  const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow({ clinicId: 1 })] }));
  await runWithStore(ctrl, {}, async () => {
    const r = await wf.returnProcedureNoteForCorrection({ id: 900, clinicId: 1, reason: "  redo  " });
    assert.equal(r.ok, true);
  });
  const row = ctrl.store.get(t.procedureNotes)![0];
  assert.equal(row.signatureStatus, "returned_for_correction");
  assert.equal(row.returnReason, "redo");
  assert.equal(row.signedAt, null, "return never fabricates signing data");
  assert.equal(row.signedByUserId, null);
}

// ═══════════════════ (13) evidence retry validates case clinic ═════════════
async function t13_retryValidatesCaseClinic() {
  const t = await seedTables();
  const s = await orderNoteSvc();
  const ctrl = buildStoreFake(storeWith(t, {
    ancillaryCases: [caseRow({ id: 5, clinicId: 2 })], // case owned by clinic 2
    procedureNotes: [noteRow({ clinicId: 1 })],
    adminReviewEvents: [eventRow()],
  }));
  const r = await runWithStore(ctrl, FLAGS_ON, async () =>
    s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }));
  assert.equal(r.status, "cross_clinic_denied");
  assert.equal(countOps(ctrl.calls, "update", t.procedureNotes), 0, "no write on case-clinic mismatch");
}

// ═══════════════════ (14/17) validates note clinic; cannot update it ═══════
async function t14_17_retryValidatesNoteClinic() {
  const t = await seedTables();
  const s = await orderNoteSvc();
  const ctrl = buildStoreFake(storeWith(t, {
    ancillaryCases: [caseRow({ id: 5, clinicId: 1 })],
    procedureNotes: [noteRow({ clinicId: 2 })], // note owned by clinic 2
    adminReviewEvents: [eventRow()],
  }));
  const r = await runWithStore(ctrl, FLAGS_ON, async () =>
    s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }));
  assert.equal(r.status, "cross_clinic_denied");
  assert.equal(ctrl.store.get(t.procedureNotes)![0].adminReviewEventId, null, "(17) other clinic's note never linked");
}

// ═══════════════════ (15) validates note ancillaryCaseId ═══════════════════
async function t15_retryValidatesCaseId() {
  const t = await seedTables();
  const s = await orderNoteSvc();
  const ctrl = buildStoreFake(storeWith(t, {
    ancillaryCases: [caseRow({ id: 5, clinicId: 1 })],
    procedureNotes: [noteRow({ clinicId: 1, ancillaryCaseId: 6 })], // belongs to a different case
    adminReviewEvents: [eventRow()],
  }));
  const r = await runWithStore(ctrl, FLAGS_ON, async () =>
    s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }));
  assert.equal(r.status, "note_case_mismatch");
  assert.equal(ctrl.store.get(t.procedureNotes)![0].adminReviewEventId, null);
}

// ═══════════════════ (16) validates current order_note state ═══════════════
async function t16_retryValidatesState() {
  const t = await seedTables();
  const s = await orderNoteSvc();
  for (const bad of [{ supersededAt: START }, { noteType: "post_procedure_note" }]) {
    const ctrl = buildStoreFake(storeWith(t, {
      ancillaryCases: [caseRow({ id: 5, clinicId: 1 })],
      procedureNotes: [noteRow({ clinicId: 1, ...bad })],
      adminReviewEvents: [eventRow()],
    }));
    const r = await runWithStore(ctrl, FLAGS_ON, async () =>
      s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }));
    assert.equal(r.status, "note_case_mismatch", `rejects ${Object.keys(bad)[0]}`);
  }
}

// ═══════════════════ (18) cannot update another case's reference ═══════════
async function t18_retryValidatesReference() {
  const t = await seedTables();
  const s = await orderNoteSvc();
  const ctrl = buildStoreFake(storeWith(t, {
    ancillaryCases: [caseRow({ id: 5, clinicId: 1 })],
    procedureNotes: [noteRow({ clinicId: 1, ancillaryCaseId: 5 })],
    adminReviewEvents: [eventRow()],
    documentReferences: [refRow({ ancillaryCaseId: 6 })], // reference bound to a different case
  }));
  const r = await runWithStore(ctrl, FLAGS_ON, async () =>
    s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }));
  assert.equal(r.status, "reference_update_failed");
  assert.equal(ctrl.store.get(t.procedureNotes)![0].adminReviewEventId, null, "note not linked when reference is mismatched");
}

// ═══════════════════ (19) reference update failure leaves retry unresolved ═
async function t19_referenceFailureUnresolved() {
  const t = await seedTables();
  const worker = await retryWorker();
  const ctrl = buildStoreFake(storeWith(t, {
    ancillaryCases: [caseRow({ id: 5, clinicId: 1 })],
    procedureNotes: [noteRow({ clinicId: 1, ancillaryCaseId: 5 })],
    adminReviewEvents: [eventRow()],
    documentReferences: [refRow()], // valid ref, but its update will fail
    documentFailures: [failureRow({ id: 1 })],
  }), { failReferenceTable: t.documentReferences });
  const outcome = await runWithStore(ctrl, FLAGS_ON, async () => worker.retryAncillaryDocumentFailure(failureRow({ id: 1 }) as any));
  assert.equal(outcome.status, "still_deferred");
  assert.equal(outcome.message, "reference_update_failed");
  assert.equal(ctrl.store.get(t.documentFailures)![0].resolvedAt, null, "failure stays unresolved");
  // Transaction rolled back → note evidence not persisted either.
  assert.equal(ctrl.store.get(t.procedureNotes)![0].adminReviewEventId, null, "note link rolled back with reference failure");
}

// ═══════════════════ (20) resolves ONLY its exact failure id ═══════════════
async function t20_resolvesExactId() {
  const t = await seedTables();
  const worker = await retryWorker();
  const ctrl = buildStoreFake(storeWith(t, {
    ancillaryCases: [caseRow({ id: 5, clinicId: 1 })],
    procedureNotes: [noteRow({ clinicId: 1, ancillaryCaseId: 5 })],
    adminReviewEvents: [eventRow()],
    documentReferences: [refRow()],
    // Two unresolved rows sharing case + kind + action; only #1 is processed.
    documentFailures: [failureRow({ id: 1 }), failureRow({ id: 2 })],
  }));
  const outcome = await runWithStore(ctrl, FLAGS_ON, async () => worker.retryAncillaryDocumentFailure(failureRow({ id: 1 }) as any));
  assert.equal(outcome.status, "resolved");
  const rows = ctrl.store.get(t.documentFailures)!;
  assert.ok(rows.find((r) => r.id === 1)!.resolvedAt != null, "target failure resolved");
  assert.equal(rows.find((r) => r.id === 2)!.resolvedAt, null, "sibling failure left unresolved");
}

// ═══════════════════ (21) missing reference is not fabricated ══════════════
async function t21_missingReferenceNotFabricated() {
  const t = await seedTables();
  const s = await orderNoteSvc();
  const ctrl = buildStoreFake(storeWith(t, {
    ancillaryCases: [caseRow({ id: 5, clinicId: 1 })],
    procedureNotes: [noteRow({ clinicId: 1, ancillaryCaseId: 5 })],
    adminReviewEvents: [eventRow()],
    documentReferences: [], // none yet — a separate link_order_note retry is pending
  }));
  const r = await runWithStore(ctrl, FLAGS_ON, async () =>
    s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }));
  assert.equal(r.status, "linked", "note evidence linked safely without a reference");
  assert.equal(countOps(ctrl.calls, "insert", t.documentReferences), 0, "no reference fabricated");
  assert.equal(ctrl.store.get(t.procedureNotes)![0].adminReviewEventId, 555, "note evidence persisted");
}

// ═══════════════════ (22/23) ledger-write failure surfaced truthfully ══════
async function t22_23_ledgerFailureSurfaced() {
  const t = await loadCanonicalTables();
  const s = await orderNoteSvc();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active" }] }],
    [t.gse, { select: () => [{ id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, startsAt: START, endsAt: null, source: "x", metadata: {}, createdAt: START, updatedAt: START }] }],
    [t.adminReviewEvents, { select: () => [] }], // deferred — no immutable event
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...v, id: 900, signatureStatus: "needs_signature" }] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    // Ledger write FAILS.
    [t.documentFailures, { select: () => [], onInsert: () => { throw Object.assign(new Error("ledger down"), { code: "08006" }); } }],
  ]);
  const r = await runWithDb(spec, { canonicalOrderNote: true, unifiedAncillaryDocuments: true, canonicalAppointment: true }, async () =>
    s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "created");
  if (r.status === "created") {
    assert.equal(r.adminReviewEvidenceDeferred, true);
    assert.equal(r.adminReviewEvidenceRetryRecorded, false, "(23) retry NOT recorded flagged truthfully");
    assert.ok(r.warnings.includes("admin_review_evidence_retry_not_recorded"), "(22) truthful warning");
  }
}

// ═══════════════════ (24) both flags OFF → zero reads/writes ═══════════════
async function t24_flagsOffZeroIo() {
  const t = await seedTables();
  const s = await orderNoteSvc();
  for (const flags of [{ unifiedAncillaryDocuments: false, canonicalOrderNote: true }, { unifiedAncillaryDocuments: true, canonicalOrderNote: false }, { unifiedAncillaryDocuments: false, canonicalOrderNote: false }] as Flags[]) {
    const ctrl = buildStoreFake(storeWith(t, { ancillaryCases: [caseRow()], procedureNotes: [noteRow()], adminReviewEvents: [eventRow()] }));
    const r = await runWithStore(ctrl, flags, async () => s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }));
    assert.equal(r.status, "skipped_flag_off");
    assert.equal(ctrl.calls.length, 0, `zero io when ${JSON.stringify(flags)}`);
  }
}

// ═══════════════════ (25) retry is idempotent ══════════════════════════════
async function t25_idempotent() {
  const t = await seedTables();
  const s = await orderNoteSvc();
  const { resolveAncillaryDocumentFailureById } = await docsRepo();
  const ctrl = buildStoreFake(storeWith(t, {
    ancillaryCases: [caseRow({ id: 5, clinicId: 1 })],
    procedureNotes: [noteRow({ clinicId: 1, ancillaryCaseId: 5 })],
    adminReviewEvents: [eventRow()],
    documentReferences: [refRow()],
    documentFailures: [failureRow({ id: 1 })],
  }));
  await runWithStore(ctrl, FLAGS_ON, async () => {
    const a = await s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 });
    const b = await s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 });
    assert.equal(a.status, "linked");
    assert.equal(b.status, "linked", "re-linking is safe and stable");
    assert.equal(ctrl.store.get(t.procedureNotes)![0].adminReviewEventId, 555);
    const first = await resolveAncillaryDocumentFailureById({ id: 1, clinicId: 1 });
    const second = await resolveAncillaryDocumentFailureById({ id: 1, clinicId: 1 });
    assert.equal(first, true, "first resolve applies");
    assert.equal(second, false, "second resolve is a no-op (idempotent)");
  });
}

// ═══════════════════ (26) no PHI in retry/audit metadata ═══════════════════
async function t26_noPhi() {
  const t = await loadCanonicalTables();
  const s = await orderNoteSvc();
  const journey: Record<string, unknown>[] = [];
  let failurePayload: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active" }] }],
    [t.gse, { select: () => [{ id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, startsAt: START, endsAt: null, source: "x", metadata: {}, createdAt: START, updatedAt: START }] }],
    [t.adminReviewEvents, { select: () => [] }],
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...v, id: 900, signatureStatus: "needs_signature" }] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.journeyEvents, { onInsert: (v) => { journey.push(v); return []; } }],
    [t.documentFailures, { select: () => [], onInsert: (v) => { failurePayload = v; return [{ ...v, id: 1 }]; } }],
  ]);
  await runWithDb(spec, { canonicalOrderNote: true, unifiedAncillaryDocuments: true, canonicalAppointment: true }, async () =>
    s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.ok(journey.length >= 1);
  // Scan the metadata blobs (the free-form fields) + the failure ledger row.
  const blobs = journey.map((p) => JSON.stringify((p as any).metadata ?? {}))
    .concat(JSON.stringify(failurePayload ?? {}));
  for (const blob of blobs) {
    const low = blob.toLowerCase();
    for (const phi of ["\"name\"", "dob", "mrn", "phone", "insurance", "diagnosis", "medication", "reasoning"]) {
      assert.ok(!low.includes(phi), `no PHI token '${phi}' in retry/audit metadata`);
    }
  }
  // The audit sentinel is used, and no real patient name/dob is carried.
  for (const p of journey) {
    assert.equal((p as any).patientName, "[ancillary_document_audit]");
    assert.equal((p as any).patientDob, null);
  }
}

// ═══════════════════ (27) focused signing → no background DB leak ══════════
async function t27_noBackgroundLeak() {
  const t = await seedTables();
  const wf = await signWf();
  let scheduled = 0; let ran = 0;
  // Capture the side-effect but never run it → no async DB task escapes.
  wf.setBillingReevalScheduler((fn) => { scheduled++; void fn; });
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };
  try {
    const ctrl = buildStoreFake(storeWith(t, { procedureNotes: [noteRow()] }));
    const r = await runWithStore(ctrl, {}, async () => wf.signProcedureNote({ id: 900, clinicId: 1, authenticatedSignerUserId: "u1" }));
    assert.equal(r.ok, true);
  } finally {
    console.error = origErr;
    wf.setBillingReevalScheduler(null);
  }
  // Give any (wrongly) escaped microtask a tick to surface.
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(scheduled, 1, "billing re-eval routed through the injectable seam");
  assert.equal(ran, 0, "seam did not execute the side-effect");
  assert.ok(!errors.some((e) => e.includes("ECONNREFUSED")), "no background ECONNREFUSED log");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) load-by-id is clinic-scoped", t01_loadScoped],
  ["(2) cannot sign another clinic's note", t02_cannotSign],
  ["(3) cannot return another clinic's note", t03_cannotReturn],
  ["(4) bulk sign skips other-clinic ids", t04_bulkSkips],
  ["(5) signature list contains only this clinic's rows", t05_listScoped],
  ["(6) sign write requires id AND clinic id", t06_writeScoped],
  ["(7/8) signedAt=server time, signer=session user", t07_08_serverTimeAndSigner],
  ["(9) no command accepts caller-supplied signedAt", t09_noCallerSignedAt],
  ["(10) no command accepts caller-supplied signedByUserId", t10_noCallerSigner],
  ["(11) signed note rejects every general update", t11_signedImmutable],
  ["(12) return uses dedicated clinic-scoped transition", t12_returnScoped],
  ["(13) evidence retry validates case clinic", t13_retryValidatesCaseClinic],
  ["(14/17) evidence retry validates note clinic; cannot update it", t14_17_retryValidatesNoteClinic],
  ["(15) evidence retry validates note ancillaryCaseId", t15_retryValidatesCaseId],
  ["(16) evidence retry validates current order_note state", t16_retryValidatesState],
  ["(18) evidence retry cannot update another case's reference", t18_retryValidatesReference],
  ["(19) reference update failure leaves retry unresolved", t19_referenceFailureUnresolved],
  ["(20) successful retry resolves only its exact failure id", t20_resolvesExactId],
  ["(21) missing reference is not fabricated", t21_missingReferenceNotFabricated],
  ["(22/23) ledger-write failure surfaced truthfully", t22_23_ledgerFailureSurfaced],
  ["(24) both feature flags OFF → zero retry reads/writes", t24_flagsOffZeroIo],
  ["(25) retry is idempotent", t25_idempotent],
  ["(26) no PHI in retry/audit metadata", t26_noPhi],
  ["(27) focused signing → no background ECONNREFUSED", t27_noBackgroundLeak],
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
