//
// Scenario G — Playground workspace session logout/user isolation (FAIL CLOSED).
//
// The Playground persists open workspace descriptors (which include patient
// names + screening/execution-case ids) to sessionStorage. sessionStorage
// survives an SPA logout in the same browser tab, so the persisted session is
// owner-scoped: patient PHI is restored ONLY when the session can be POSITIVELY
// attributed to the current authenticated owner. Every unproven case surfaces
// NO patient state.
//
//   §1  Owner restores their own session (positive match).
//   §2  A different user does NOT restore user A's session (and it is cleared).
//   §3  A legacy/unowned session (no ownerUserId) is NOT restored, and is cleared.
//   §4  Unknown current owner (auth resolving) restores nothing, but does NOT
//       clear — the resolved owner can still match afterward.
//   §5  clearSession() removes the persisted session.
//   §6  Malformed persisted JSON fails safe (null) and is cleared.
//   §7  Stale sessions (> 24h) are not restored.
//   §8  A restored session carries the correct PHI fields for the owner.
//
// Runnable via:
//   npx tsx tests/unit/playgroundSessionOwnerIsolation.test.ts

import assert from "node:assert";

// Minimal sessionStorage stub (node has no DOM). Installed BEFORE importing the
// module under test so its `sessionStorage` references resolve to this.
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  get size(): number { return this.m.size; }
}
const store = new MemoryStorage();
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = store;

const STORAGE_KEY = "plexus_playground_session";

const { saveSession, restoreSession, clearSession } = await import(
  "../../client/src/components/playground/sessionPersistence"
);

type WS = Parameters<typeof saveSession>[0];

function fakeWorkspace(id: string, patientScreeningId: number, title: string): WS[number] {
  return {
    id,
    type: "patient_ehr",
    title,
    patientId: null,
    patientScreeningId,
    executionCaseId: 8801,
    ancillaryCaseId: null,
    serviceEpisodeId: null,
    serviceKey: "BrainWave",
    documentId: null,
    appointmentId: null,
    taskId: null,
    conversationId: null,
    focusSection: null,
    focusObjectId: null,
    focusToken: 0,
    facilityId: null,
    pinned: false,
    dirty: false,
    createdAt: Date.now(),
    lastActivatedAt: Date.now(),
  } as WS[number];
}

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

const wsA = [fakeWorkspace("ws_a", 10231, "Mary Bowerman")];

// §1 — owner restores their own session.
check("§1 owner restores their own session", () => {
  clearSession();
  saveSession(wsA, "ws_a", "userA");
  const restored = restoreSession("userA");
  assert.ok(restored, "user A must restore their own session");
  assert.equal(restored!.workspaces.length, 1);
  assert.equal(restored!.workspaces[0].patientScreeningId, 10231);
  assert.equal(restored!.activeId, "ws_a");
});

// §2 — a different user cannot restore user A's session (and it is cleared).
check("§2 foreign user gets no restore + session cleared", () => {
  clearSession();
  saveSession(wsA, "ws_a", "userA");
  const restored = restoreSession("userB");
  assert.equal(restored, null, "user B must not restore user A's workspaces");
  // The foreign session is cleared, so even user A no longer restores it.
  assert.equal(store.getItem(STORAGE_KEY), null, "foreign session physically removed");
  assert.equal(restoreSession("userA"), null, "cleared session does not restore");
});

// §3 — legacy/unowned session (no ownerUserId) is NOT restored and is cleared.
check("§3 legacy/unowned session fails closed + cleared", () => {
  clearSession();
  // A pre-owner-scoping session written directly, with NO ownerUserId key.
  store.setItem(STORAGE_KEY, JSON.stringify({
    workspaces: [{
      id: "ws_legacy", type: "patient_ehr", title: "Legacy Patient",
      patientScreeningId: 55, pinned: false, createdAt: Date.now(),
    }],
    activeWorkspaceId: "ws_legacy",
    savedAt: Date.now(),
  }));
  const restored = restoreSession("userA");
  assert.equal(restored, null, "legacy/unowned patient state must not restore");
  assert.equal(store.getItem(STORAGE_KEY), null, "legacy session cleared (unattributable PHI)");
});

// §4 — unknown current owner restores nothing but does NOT clear.
check("§4 unknown current owner fails closed WITHOUT clearing", () => {
  clearSession();
  saveSession(wsA, "ws_a", "userA");
  assert.equal(restoreSession(null), null, "null owner must not restore PHI");
  assert.equal(restoreSession(undefined), null, "missing owner must not restore PHI");
  // Session preserved — the resolved owner can still legitimately claim it.
  assert.notEqual(store.getItem(STORAGE_KEY), null, "session preserved while owner unknown");
  assert.ok(restoreSession("userA"), "resolved owner still restores their own session");
});

// §5 — clearSession wipes the persisted session.
check("§5 clearSession wipes the session", () => {
  saveSession(wsA, "ws_a", "userA");
  clearSession();
  assert.equal(restoreSession("userA"), null, "cleared session must not restore");
});

// §6 — malformed persisted JSON fails safe and is cleared.
check("§6 malformed JSON fails safe + cleared", () => {
  store.setItem(STORAGE_KEY, "{not-valid-json");
  assert.equal(restoreSession("userA"), null, "malformed session must not throw or restore");
  assert.equal(store.getItem(STORAGE_KEY), null, "malformed junk cleared");
});

// §7 — stale sessions (> 24h) are not restored.
check("§7 stale session not restored", () => {
  clearSession();
  store.setItem(STORAGE_KEY, JSON.stringify({
    ownerUserId: "userA",
    workspaces: [{ id: "ws_old", type: "patient_ehr", title: "Old", patientScreeningId: 9, pinned: false, createdAt: 0 }],
    activeWorkspaceId: "ws_old",
    savedAt: Date.now() - (25 * 60 * 60 * 1000),
  }));
  assert.equal(restoreSession("userA"), null, "sessions older than 24h are not restored");
});

// §8 — restored session carries the correct PHI fields for the owner.
check("§8 owner-matched restore carries PHI fields", () => {
  clearSession();
  saveSession(wsA, "ws_a", "userA");
  const restored = restoreSession("userA");
  assert.ok(restored);
  const w = restored!.workspaces[0];
  assert.equal(w.executionCaseId, 8801, "executionCaseId preserved for owner");
  assert.equal(w.serviceKey, "BrainWave", "serviceKey preserved for owner");
  assert.equal(w.dirty, false, "restored tabs are never dirty");
});

if (failures > 0) {
  console.error(`playgroundSessionOwnerIsolation.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("playgroundSessionOwnerIsolation.test.ts: all tests passed");
