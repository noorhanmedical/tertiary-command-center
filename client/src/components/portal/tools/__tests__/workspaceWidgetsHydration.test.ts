// Team Portal widget hydration-race reconciliation test (Task #657).
//
// Runnable via:
//   npx tsx client/src/components/portal/tools/__tests__/workspaceWidgetsHydration.test.ts
//
// No DB. No app boot. No network. No PHI. Exercises the pure reconciliation
// that runs when the initial GET /api/portal/widgets resolves, covering the
// race where a user mutates widgets before the load completes.

import {
  decideWidgetBinding,
  reconcileWidgetsOnHydration,
  type PlaygroundWidget,
} from "../workspaceWidgets";

function widget(id: string, text = ""): PlaygroundWidget {
  return {
    id,
    type: "sticky",
    x: 0,
    y: 0,
    color: "yellow",
    text,
    collapsed: false,
    patientContext: null,
    createdBy: "tester",
  };
}

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function ids(ws: PlaygroundWidget[]): string {
  return ws.map((w) => w.id).sort().join(",");
}

// 1) Clean load, no local edits: adopt the server set, do not re-persist.
{
  const server = [widget("s1"), widget("s2")];
  const r = reconcileWidgetsOnHydration({
    serverWidgets: server,
    localWidgets: [],
    wasDirty: false,
    firstBind: false,
  });
  check(ids(r.nextState) === "s1,s2", "clean load should show server widgets");
  check(r.toPersist === null, "clean load should not re-persist");
}

// 2) THE RACE: existing DB widgets + a widget added before GET resolves.
//    Neither the existing nor the new widget may be lost, and the union is
//    persisted back.
{
  const server = [widget("s1"), widget("s2")];
  const local = [widget("new_local")]; // created during the load window
  const r = reconcileWidgetsOnHydration({
    serverWidgets: server,
    localWidgets: local,
    wasDirty: true,
    firstBind: false,
  });
  check(ids(r.nextState) === "new_local,s1,s2", "race: must keep server + new local widget");
  check(r.toPersist !== null && ids(r.toPersist) === "new_local,s1,s2", "race: must persist the union");
}

// 3) Dirty edit to an EXISTING widget during load: local wins on id conflict,
//    the other server widget is preserved.
{
  const server = [widget("s1", "server text"), widget("s2", "server two")];
  const local = [widget("s1", "edited locally")];
  const r = reconcileWidgetsOnHydration({
    serverWidgets: server,
    localWidgets: local,
    wasDirty: true,
    firstBind: false,
  });
  const s1 = r.nextState.find((w) => w.id === "s1");
  check(ids(r.nextState) === "s1,s2", "conflict: both widgets retained");
  check(s1?.text === "edited locally", "conflict: local edit wins for s1");
}

// 4) First bind with empty server: adopt pre-auth ephemeral local widgets and
//    persist them once.
{
  const local = [widget("pre1"), widget("pre2")];
  const r = reconcileWidgetsOnHydration({
    serverWidgets: [],
    localWidgets: local,
    wasDirty: false,
    firstBind: true,
  });
  check(ids(r.nextState) === "pre1,pre2", "first bind adopts ephemeral local widgets");
  check(r.toPersist !== null && ids(r.toPersist) === "pre1,pre2", "first bind persists adopted widgets");
}

// 5) Non-first bind, empty server, no dirty edits: end empty, no persist
//    (nothing to clobber).
{
  const r = reconcileWidgetsOnHydration({
    serverWidgets: [],
    localWidgets: [widget("stale")],
    wasDirty: false,
    firstBind: false,
  });
  check(r.nextState.length === 0, "non-first empty load resolves empty");
  check(r.toPersist === null, "non-first empty load does not persist");
}

// 6) GET-failure recovery: the hook keeps writes blocked while reads fail (so
//    nothing is ever persisted against an unknown baseline). When a read
//    finally succeeds, any widget the user added during the outage is recorded
//    as dirty, so reconcile merges it with the recovered server set instead of
//    wiping the pre-existing DB widgets.
{
  const server = [widget("existing_db_1"), widget("existing_db_2")];
  const local = [widget("added_during_outage")];
  const r = reconcileWidgetsOnHydration({
    serverWidgets: server, // only observed after the read finally succeeds
    localWidgets: local,
    wasDirty: true, // user mutated during the failed-read window
    firstBind: false,
  });
  check(
    ids(r.nextState) === "added_during_outage,existing_db_1,existing_db_2",
    "recovery: existing server widgets must survive a GET outage",
  );
  check(
    r.toPersist !== null &&
      ids(r.toPersist) === "added_during_outage,existing_db_1,existing_db_2",
    "recovery: persisted union must include the pre-existing server widgets",
  );
}

// 7) Binding decisions across a full session lifecycle, including the
//    logout→same-user-login regression: after unbind resets loadedForKey to
//    null, logging back in as the SAME user must re-hydrate (never skip GET),
//    otherwise the first PUT could clobber the DB baseline.
{
  // simulate the ref the effect maintains
  let loadedForKey: string | null = null;

  // initial login as user A -> must hydrate
  check(decideWidgetBinding("A", loadedForKey) === "hydrate", "first login hydrates");
  loadedForKey = "A"; // effect records the bound key

  // plain re-render, same key -> no-op
  check(
    decideWidgetBinding("A", loadedForKey) === "already-bound",
    "re-render on same key is a no-op",
  );

  // logout -> unbind (effect resets loadedForKey to null)
  check(decideWidgetBinding(null, loadedForKey) === "unbind", "logout unbinds");
  loadedForKey = null;

  // THE REGRESSION: login again as the SAME user must hydrate, not no-op
  check(
    decideWidgetBinding("A", loadedForKey) === "hydrate",
    "re-login as same user must re-hydrate, not skip GET",
  );
  loadedForKey = "A";

  // switch to a different user -> hydrate
  check(decideWidgetBinding("B", loadedForKey) === "hydrate", "user switch hydrates");
}

if (failures.length > 0) {
  console.error("FAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("workspaceWidgetsHydration: all checks passed");
