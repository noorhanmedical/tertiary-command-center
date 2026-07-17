// Team Portal widget hydration-race reconciliation tests.
//
// Run via:
//   npx vitest run
//
// No DB. No app boot. No network. No PHI. Exercises the pure reconciliation
// that runs when the initial GET /api/portal/widgets resolves, covering the
// race where a user mutates widgets before the load completes.

import { describe, expect, it } from "vitest";
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

function ids(ws: PlaygroundWidget[]): string {
  return ws.map((w) => w.id).sort().join(",");
}

describe("reconcileWidgetsOnHydration", () => {
  it("clean load with no local edits adopts the server set without re-persisting", () => {
    const server = [widget("s1"), widget("s2")];
    const r = reconcileWidgetsOnHydration({
      serverWidgets: server,
      localWidgets: [],
      wasDirty: false,
      firstBind: false,
    });
    expect(ids(r.nextState)).toBe("s1,s2");
    expect(r.toPersist).toBeNull();
  });

  it("THE RACE: keeps server widgets plus a widget added before GET resolved, and persists the union", () => {
    const server = [widget("s1"), widget("s2")];
    const local = [widget("new_local")]; // created during the load window
    const r = reconcileWidgetsOnHydration({
      serverWidgets: server,
      localWidgets: local,
      wasDirty: true,
      firstBind: false,
    });
    expect(ids(r.nextState)).toBe("new_local,s1,s2");
    expect(r.toPersist).not.toBeNull();
    expect(ids(r.toPersist!)).toBe("new_local,s1,s2");
  });

  it("dirty edit to an existing widget during load: local wins on id conflict, other server widget preserved", () => {
    const server = [widget("s1", "server text"), widget("s2", "server two")];
    const local = [widget("s1", "edited locally")];
    const r = reconcileWidgetsOnHydration({
      serverWidgets: server,
      localWidgets: local,
      wasDirty: true,
      firstBind: false,
    });
    expect(ids(r.nextState)).toBe("s1,s2");
    expect(r.nextState.find((w) => w.id === "s1")?.text).toBe("edited locally");
  });

  it("first bind with empty server adopts pre-auth ephemeral local widgets and persists them once", () => {
    const local = [widget("pre1"), widget("pre2")];
    const r = reconcileWidgetsOnHydration({
      serverWidgets: [],
      localWidgets: local,
      wasDirty: false,
      firstBind: true,
    });
    expect(ids(r.nextState)).toBe("pre1,pre2");
    expect(r.toPersist).not.toBeNull();
    expect(ids(r.toPersist!)).toBe("pre1,pre2");
  });

  it("non-first bind, empty server, no dirty edits: resolves empty and does not persist", () => {
    const r = reconcileWidgetsOnHydration({
      serverWidgets: [],
      localWidgets: [widget("stale")],
      wasDirty: false,
      firstBind: false,
    });
    expect(r.nextState.length).toBe(0);
    expect(r.toPersist).toBeNull();
  });

  it("GET-failure recovery: widgets added during the outage merge with the recovered server set", () => {
    // The hook keeps writes blocked while reads fail (so nothing is ever
    // persisted against an unknown baseline). When a read finally succeeds,
    // any widget the user added during the outage is recorded as dirty, so
    // reconcile merges it with the recovered server set instead of wiping
    // the pre-existing DB widgets.
    const server = [widget("existing_db_1"), widget("existing_db_2")];
    const local = [widget("added_during_outage")];
    const r = reconcileWidgetsOnHydration({
      serverWidgets: server, // only observed after the read finally succeeds
      localWidgets: local,
      wasDirty: true, // user mutated during the failed-read window
      firstBind: false,
    });
    expect(ids(r.nextState)).toBe(
      "added_during_outage,existing_db_1,existing_db_2",
    );
    expect(r.toPersist).not.toBeNull();
    expect(ids(r.toPersist!)).toBe(
      "added_during_outage,existing_db_1,existing_db_2",
    );
  });
});

describe("decideWidgetBinding", () => {
  it("handles a full session lifecycle, including the logout→same-user-login regression", () => {
    // After unbind resets loadedForKey to null, logging back in as the SAME
    // user must re-hydrate (never skip GET), otherwise the first PUT could
    // clobber the DB baseline.

    // simulate the ref the effect maintains
    let loadedForKey: string | null = null;

    // initial login as user A -> must hydrate
    expect(decideWidgetBinding("A", loadedForKey)).toBe("hydrate");
    loadedForKey = "A"; // effect records the bound key

    // plain re-render, same key -> no-op
    expect(decideWidgetBinding("A", loadedForKey)).toBe("already-bound");

    // logout -> unbind (effect resets loadedForKey to null)
    expect(decideWidgetBinding(null, loadedForKey)).toBe("unbind");
    loadedForKey = null;

    // THE REGRESSION: login again as the SAME user must hydrate, not no-op
    expect(decideWidgetBinding("A", loadedForKey)).toBe("hydrate");
    loadedForKey = "A";

    // switch to a different user -> hydrate
    expect(decideWidgetBinding("B", loadedForKey)).toBe("hydrate");
  });
});
