//
// Phase 5B — owner + execution-case scoped call-interaction draft persistence.
//
// In-progress disposition input (outcome / notes / callback) is persisted so it
// survives Phone↔Calendar switches, Atlas/history navigation, refetch, and a
// stale-claim rejection. It is keyed by BOTH the authenticated owner AND the
// execution case, so a different user can never read another user's PHI note
// and drafts never bleed across patients. Fail-closed without an owner.
//
//   §1  save + load round-trips for the same owner + case.
//   §2  a DIFFERENT owner cannot load owner A's draft (owner is part of the key).
//   §3  a DIFFERENT case cannot load owner A's draft for another case.
//   §4  a missing owner fails closed (save is a no-op, load returns null).
//   §5  an empty draft clears the key instead of storing a blank.
//   §6  clearCallDraft removes one owner+case draft.
//   §7  clearAllCallDrafts removes ALL draft keys (logout) but nothing else.
//   §8  malformed JSON loads null and is cleared.
//   §9  a stale draft (>24h) is not loaded.
//
// Run: npx tsx tests/unit/callDraftOwnerScoping.test.ts

import assert from "node:assert";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return Array.from(this.m.keys())[i] ?? null; }
  get length(): number { return this.m.size; }
}
const store = new MemoryStorage();
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = store;

const { saveCallDraft, loadCallDraft, clearCallDraft, clearAllCallDrafts } = await import(
  "../../client/src/components/playground/sessionPersistence"
);

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

const A = "userA";
const B = "userB";

// §1 — round-trip for the same owner + case.
check("§1 save + load round-trips (owner + case)", () => {
  store.clear();
  saveCallDraft(A, 100, { outcome: "callback", notes: "call back tomorrow", callbackAt: "2026-01-02T10:00" });
  const d = loadCallDraft(A, 100);
  assert.ok(d, "draft loads for the owner + case");
  assert.equal(d!.outcome, "callback");
  assert.equal(d!.notes, "call back tomorrow");
  assert.equal(d!.callbackAt, "2026-01-02T10:00");
});

// §2 — a different owner cannot read owner A's draft.
check("§2 different owner cannot read the draft", () => {
  store.clear();
  saveCallDraft(A, 100, { outcome: "reached", notes: "PHI note for A", callbackAt: null });
  assert.equal(loadCallDraft(B, 100), null, "owner B must not read owner A's draft for the same case");
});

// §3 — a different case cannot read owner A's draft for another case.
check("§3 different case does not leak", () => {
  store.clear();
  saveCallDraft(A, 100, { outcome: "reached", notes: "case 100 note", callbackAt: null });
  assert.equal(loadCallDraft(A, 101), null, "a different case must not read case 100's draft");
});

// §4 — missing owner fails closed (never persist / read PHI without an owner).
check("§4 missing owner fails closed", () => {
  store.clear();
  saveCallDraft(null, 100, { outcome: "reached", notes: "no owner", callbackAt: null });
  assert.equal(store.length, 0, "no draft is persisted without an owner");
  assert.equal(loadCallDraft(null, 100), null, "no draft loads without an owner");
});

// §5 — an empty draft clears rather than storing a blank.
check("§5 empty draft clears the key", () => {
  store.clear();
  saveCallDraft(A, 100, { outcome: "reached", notes: "x", callbackAt: null });
  assert.ok(loadCallDraft(A, 100), "draft exists");
  saveCallDraft(A, 100, { outcome: null, notes: "   ", callbackAt: null }); // empty → clears
  assert.equal(loadCallDraft(A, 100), null, "empty draft removed the key");
});

// §6 — clearCallDraft removes one owner+case draft.
check("§6 clearCallDraft removes the draft", () => {
  store.clear();
  saveCallDraft(A, 100, { outcome: "reached", notes: "note", callbackAt: null });
  clearCallDraft(A, 100);
  assert.equal(loadCallDraft(A, 100), null, "cleared draft does not load");
});

// §7 — clearAllCallDrafts removes ALL draft keys but nothing else.
check("§7 clearAllCallDrafts wipes only draft keys", () => {
  store.clear();
  saveCallDraft(A, 100, { outcome: "reached", notes: "a", callbackAt: null });
  saveCallDraft(B, 200, { outcome: "voicemail", notes: "b", callbackAt: null });
  store.setItem("plexus_playground_session", JSON.stringify({ ownerUserId: A, workspaces: [], activeWorkspaceId: null, savedAt: Date.now() }));
  clearAllCallDrafts();
  assert.equal(loadCallDraft(A, 100), null, "A's draft cleared on logout");
  assert.equal(loadCallDraft(B, 200), null, "B's draft cleared on logout");
  assert.notEqual(store.getItem("plexus_playground_session"), null, "non-draft keys are untouched");
});

// §8 — malformed JSON loads null and is cleared.
check("§8 malformed draft fails safe + cleared", () => {
  store.clear();
  store.setItem("plexus_call_draft:userA:100", "{not-json");
  assert.equal(loadCallDraft(A, 100), null, "malformed draft does not throw or load");
  assert.equal(store.getItem("plexus_call_draft:userA:100"), null, "malformed draft cleared");
});

// §9 — stale draft (>24h) is not loaded.
check("§9 stale draft not loaded", () => {
  store.clear();
  store.setItem(
    "plexus_call_draft:userA:100",
    JSON.stringify({ outcome: "reached", notes: "old", callbackAt: null, savedAt: Date.now() - 25 * 60 * 60 * 1000 }),
  );
  assert.equal(loadCallDraft(A, 100), null, "drafts older than 24h are not loaded");
});

if (failures > 0) {
  console.error(`callDraftOwnerScoping.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("callDraftOwnerScoping.test.ts: all tests passed");
