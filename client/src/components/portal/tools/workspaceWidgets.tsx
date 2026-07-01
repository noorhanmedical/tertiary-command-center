// Playground floating widgets + sticky notes (Task #655, #657).
//
// PERSISTED PER USER IN THE DATABASE. Widgets are stored in the
// `portal_widgets` table (scoped to the logged-in user) via a small CRUD
// endpoint, so sticky notes and their positions survive a page refresh AND
// sync across devices/browsers. The whole set is written back on every
// mutation (debounced), mirroring the previous localStorage semantics.
//
// Three widget types share one draggable-card system:
//   - sticky:   post-it note (editable text, six colors, collapsible)
//   - email:    quick launcher card → opens the full Email composer
//   - teamChat: quick draft card → clearly draft-only (no backend)
//
// Widgets can be created from the Sticky Notes tool (top-of-playground)
// or by dragging a tool tile from the dock onto the Playground surface.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, MessageSquare, StickyNote, X, ChevronDown, ChevronUp, GripVertical } from "lucide-react";

export type WidgetColor = "yellow" | "pink" | "blue" | "green" | "purple" | "gray";
export type PlaygroundWidgetType = "sticky" | "email" | "teamChat";

export type WidgetPatientContext = {
  patientScreeningId: number | null;
  name: string | null;
} | null;

export type PlaygroundWidget = {
  id: string;
  type: PlaygroundWidgetType;
  x: number;
  y: number;
  color: WidgetColor;
  text: string;
  collapsed: boolean;
  patientContext: WidgetPatientContext;
  /** Real logged-in username at creation time (attribution). */
  createdBy: string;
};

export const WIDGET_COLORS: { id: WidgetColor; label: string; swatch: string }[] = [
  { id: "yellow", label: "Yellow", swatch: "bg-amber-300" },
  { id: "pink", label: "Pink", swatch: "bg-pink-300" },
  { id: "blue", label: "Blue", swatch: "bg-sky-300" },
  { id: "green", label: "Green", swatch: "bg-emerald-300" },
  { id: "purple", label: "Purple", swatch: "bg-violet-300" },
  { id: "gray", label: "Gray", swatch: "bg-slate-300" },
];

const COLOR_BODY: Record<WidgetColor, string> = {
  yellow: "bg-amber-100 border-amber-300",
  pink: "bg-pink-100 border-pink-300",
  blue: "bg-sky-100 border-sky-300",
  green: "bg-emerald-100 border-emerald-300",
  purple: "bg-violet-100 border-violet-300",
  gray: "bg-slate-100 border-slate-300",
};

const COLOR_HEADER: Record<WidgetColor, string> = {
  yellow: "bg-amber-200/70",
  pink: "bg-pink-200/70",
  blue: "bg-sky-200/70",
  green: "bg-emerald-200/70",
  purple: "bg-violet-200/70",
  gray: "bg-slate-200/70",
};

// dataTransfer MIME used for dock → playground drag-and-drop.
export const WIDGET_DND_MIME = "application/x-plexus-widget";

let widgetSeq = 0;
function nextWidgetId() {
  widgetSeq += 1;
  return `w${Date.now()}_${widgetSeq}`;
}

const WIDGET_TYPES: PlaygroundWidgetType[] = ["sticky", "email", "teamChat"];

// Debounce window for write-through persistence. Sticky-note typing and
// drag-to-move fire rapidly, so we coalesce them into one PUT.
const PERSIST_DEBOUNCE_MS = 600;

// Defensive validation of a server payload — never trust the wire blindly.
function parseWidgetRows(rows: unknown): PlaygroundWidget[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (w): w is Record<string, unknown> =>
        !!w &&
        typeof (w as any).id === "string" &&
        WIDGET_TYPES.includes((w as any).type) &&
        typeof (w as any).x === "number" &&
        typeof (w as any).y === "number",
    )
    .map((w) => ({
      id: w.id as string,
      type: w.type as PlaygroundWidgetType,
      x: w.x as number,
      y: w.y as number,
      color: (w.color as WidgetColor) ?? "yellow",
      text: typeof w.text === "string" ? (w.text as string) : "",
      collapsed: Boolean(w.collapsed),
      patientContext: (w.patientContext as WidgetPatientContext) ?? null,
      createdBy: typeof w.createdBy === "string" ? (w.createdBy as string) : "",
    }));
}

/**
 * Reconcile local widget state with what the server returned once the initial
 * GET for a user key resolves. Pure so the hydration race can be unit-tested.
 *
 * - `wasDirty` (user mutated during the load window): merge the server set with
 *   the local set — local wins on id conflict — so neither existing DB widgets
 *   nor the just-made edits are lost, and persist the union.
 * - otherwise adopt the server set; on the very first bind with no server
 *   widgets, adopt any pre-auth ephemeral local widgets and persist them once.
 */
export function reconcileWidgetsOnHydration(opts: {
  serverWidgets: PlaygroundWidget[];
  localWidgets: PlaygroundWidget[];
  wasDirty: boolean;
  firstBind: boolean;
}): { nextState: PlaygroundWidget[]; toPersist: PlaygroundWidget[] | null } {
  const { serverWidgets, localWidgets, wasDirty, firstBind } = opts;
  if (wasDirty) {
    const byId = new Map(serverWidgets.map((w) => [w.id, w]));
    for (const w of localWidgets) byId.set(w.id, w);
    const nextState = Array.from(byId.values());
    return { nextState, toPersist: nextState };
  }
  if (serverWidgets.length > 0) return { nextState: serverWidgets, toPersist: null };
  if (firstBind && localWidgets.length > 0) {
    return { nextState: localWidgets, toPersist: localWidgets };
  }
  return { nextState: serverWidgets, toPersist: null };
}

/**
 * Decide what the key-binding effect should do for a given transition. Pure so
 * the logout→same-user-login sequence can be regression-tested without a DOM.
 *
 * - `unbind`: no key (logout). Caller must reset ALL per-key hydration refs so
 *   the next bind re-hydrates from the DB before writes are unblocked.
 * - `already-bound`: this key already hydrated/hydrating (a plain re-render);
 *   do nothing.
 * - `hydrate`: a new/rebound key; run the GET and block writes until it lands.
 *
 * The regression this guards: after `unbind` resets `loadedForKey` to null, a
 * later login as the SAME user must return `hydrate` (not `already-bound`), so
 * hydration is never skipped and the first PUT can't clobber the DB baseline.
 */
export type WidgetBindingDecision = "unbind" | "already-bound" | "hydrate";

export function decideWidgetBinding(
  nextKey: string | null,
  loadedForKey: string | null,
): WidgetBindingDecision {
  if (!nextKey) return "unbind";
  if (loadedForKey === nextKey) return "already-bound";
  return "hydrate";
}

/**
 * Playground widgets, persisted per user in the database.
 *
 * @param createdBy   Display name stamped on new widgets (attribution).
 * @param storageKey  Stable per-user key (the logged-in user id). When set,
 *                    widgets are loaded from and saved to the `portal_widgets`
 *                    table so they survive a refresh and sync across devices.
 *                    Until it resolves, widgets live in memory and are
 *                    persisted once the key is known.
 */
export function useWorkspaceWidgets(createdBy: string, storageKey?: string | null) {
  const [widgets, setWidgets] = useState<PlaygroundWidget[]>([]);
  const keyRef = useRef<string | null>(storageKey ?? null);
  const loadedForKey = useRef<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PlaygroundWidget[] | null>(null);
  // The key whose initial GET has completed. Until keyRef.current matches
  // this, we are "hydrating": local mutations are held (never written) so a
  // preload snapshot can't clobber existing server widgets, and they are
  // merged with the server set once the GET resolves.
  const hydratedRef = useRef<string | null>(null);
  // Set when the user mutates during the hydration window for the active key.
  const dirtyDuringHydrationRef = useRef(false);
  // Mirror of `widgets` so post-fetch reconciliation can read the latest local
  // state without depending on a stale render closure.
  const widgetsRef = useRef<PlaygroundWidget[]>([]);

  // Flush any queued write for the CURRENT session immediately (used on
  // unmount / navigate-away so an in-flight debounced edit isn't lost). The
  // write is attributed by the session cookie, so it is only ever called
  // while keyRef still matches the authenticated user.
  const flushPersist = useCallback((next: PlaygroundWidget[]) => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    pendingRef.current = null;
    fetch("/api/portal/widgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ widgets: next }),
      keepalive: true,
    }).catch(() => {
      /* best-effort; next mutation retries */
    });
  }, []);

  // Discard any queued write without sending it. Used on user-key swaps: the
  // session may already point at the NEW user, so flushing the outgoing user's
  // pending edits could misattribute them. We trade at most one debounce
  // window of unsaved edits for a hard no-cross-user-bleed guarantee.
  const discardPending = useCallback(() => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    pendingRef.current = null;
  }, []);

  // Bind to a user's server bucket. On every key change we resolve state FROM
  // the server (or empty) so one user's widgets can never bleed into another's.
  // The only carry-forward is the very first bind (null -> first key), which
  // adopts any pre-auth ephemeral widgets into that user's set.
  useEffect(() => {
    const key: string | null = storageKey ?? null;
    const prevKey = keyRef.current;
    const isSwitch = !!prevKey && prevKey !== key;
    if (isSwitch) {
      // On an actual user switch, drop the outgoing user's pending write rather
      // than flushing it under a possibly-changed session, and clear the
      // display immediately so the previous user's widgets never linger.
      discardPending();
      dirtyDuringHydrationRef.current = false;
      widgetsRef.current = [];
      setWidgets([]);
    }

    const decision = decideWidgetBinding(key, loadedForKey.current);
    if (decision === "unbind") {
      // Logout / unbind. Reset ALL per-key hydration state so the next login —
      // even as the SAME user (same storageKey) — re-runs the GET and blocks
      // writes until it lands. Without clearing loadedForKey the decision above
      // would return "already-bound" and skip hydration, and without clearing
      // hydratedRef the persist gate would treat writes as hydrated and let the
      // first PUT (full-set replace) clobber the DB baseline.
      discardPending();
      loadedForKey.current = null;
      hydratedRef.current = null;
      dirtyDuringHydrationRef.current = false;
      widgetsRef.current = [];
      setWidgets([]);
      keyRef.current = null;
      return;
    }
    if (decision === "already-bound") {
      keyRef.current = key;
      return;
    }
    const firstBind = loadedForKey.current === null;
    loadedForKey.current = key;
    keyRef.current = key;
    // Entering the hydration window for this key: block writes until GET lands.
    dirtyDuringHydrationRef.current = false;

    let cancelled = false;
    (async () => {
      // Fail CLOSED: we only ever hydrate (and thereby unblock writes) after a
      // SUCCESSFUL read. A transient GET failure must never be treated as an
      // empty server set — otherwise the next debounced PUT (a full-set
      // replace) would wipe the user's existing DB widgets. So we retry with
      // capped backoff and keep writes blocked (mutations are held as dirty)
      // until a read succeeds; the eventual reconcile merges any edits made
      // during the outage with the server set.
      let attempt = 0;
      while (!cancelled) {
        let loaded: PlaygroundWidget[] | null = null;
        try {
          const res = await fetch("/api/portal/widgets", { credentials: "include" });
          if (res.ok) loaded = parseWidgetRows(await res.json());
        } catch {
          loaded = null;
        }
        if (cancelled) return;

        if (loaded !== null) {
          const { nextState, toPersist } = reconcileWidgetsOnHydration({
            serverWidgets: loaded,
            localWidgets: widgetsRef.current,
            wasDirty: dirtyDuringHydrationRef.current,
            firstBind,
          });
          // Mark hydrated BEFORE flushing so the write path is unblocked.
          hydratedRef.current = key;
          widgetsRef.current = nextState;
          setWidgets(nextState);
          if (toPersist) flushPersist(toPersist);
          return;
        }

        // Read failed — back off and retry, leaving the key un-hydrated so
        // persist() stays blocked and cannot clobber the unknown baseline.
        attempt += 1;
        const delay = Math.min(10000, 500 * 2 ** Math.min(attempt, 5));
        await new Promise((r) => setTimeout(r, delay));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey, flushPersist, discardPending]);

  // Flush on unmount so an in-flight debounced edit isn't lost.
  useEffect(() => {
    return () => {
      if (keyRef.current && pendingRef.current) flushPersist(pendingRef.current);
    };
  }, [flushPersist]);

  // Debounced write-through persistence. No-op until we've bound to a user key.
  // While the active key is still hydrating, we record the intent (dirty +
  // pending) but do NOT write — the post-GET reconciliation persists the merge.
  const persist = useCallback((next: PlaygroundWidget[]) => {
    const k = keyRef.current;
    if (!k) return;
    pendingRef.current = next;
    if (hydratedRef.current !== k) {
      dirtyDuringHydrationRef.current = true;
      return;
    }
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      const widgetsToSave = pendingRef.current;
      pendingRef.current = null;
      if (!widgetsToSave) return;
      fetch("/api/portal/widgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ widgets: widgetsToSave }),
      }).catch(() => {
        /* best-effort; next mutation retries */
      });
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  const mutate = useCallback(
    (updater: (prev: PlaygroundWidget[]) => PlaygroundWidget[]) => {
      setWidgets((prev) => {
        const next = updater(prev);
        widgetsRef.current = next;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addWidget = useCallback(
    (input: {
      type: PlaygroundWidgetType;
      x?: number;
      y?: number;
      color?: WidgetColor;
      patientContext?: WidgetPatientContext;
    }) => {
      const id = nextWidgetId();
      mutate((prev) => {
        const stagger = prev.length % 6;
        const widget: PlaygroundWidget = {
          id,
          type: input.type,
          x: input.x ?? 24 + stagger * 18,
          y: input.y ?? 16 + stagger * 18,
          color: input.color ?? (input.type === "teamChat" ? "purple" : "yellow"),
          text: "",
          collapsed: false,
          patientContext: input.patientContext ?? null,
          createdBy,
        };
        return [...prev, widget];
      });
      return id;
    },
    [mutate, createdBy],
  );

  const updateWidget = useCallback(
    (id: string, patch: Partial<PlaygroundWidget>) => {
      mutate((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    },
    [mutate],
  );

  const removeWidget = useCallback(
    (id: string) => {
      mutate((prev) => prev.filter((w) => w.id !== id));
    },
    [mutate],
  );

  const clearWidgets = useCallback(() => mutate(() => []), [mutate]);

  return { widgets, addWidget, updateWidget, removeWidget, clearWidgets } as const;
}

function WidgetCard({
  widget,
  onMove,
  onUpdate,
  onRemove,
  onOpenEmail,
}: {
  widget: PlaygroundWidget;
  onMove: (id: string, x: number, y: number) => void;
  onUpdate: (id: string, patch: Partial<PlaygroundWidget>) => void;
  onRemove: (id: string) => void;
  onOpenEmail: (ctx: WidgetPatientContext) => void;
}) {
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: widget.x,
      originY: widget.y,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const nextX = Math.max(0, ds.originX + (e.clientX - ds.startX));
    const nextY = Math.max(0, ds.originY + (e.clientY - ds.startY));
    onMove(widget.id, nextX, nextY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragState.current = null;
  };

  const isSticky = widget.type === "sticky";
  const bodyTone = isSticky
    ? COLOR_BODY[widget.color]
    : widget.type === "teamChat"
      ? "bg-white border-violet-300"
      : "bg-white border-sky-300";
  const headerTone = isSticky
    ? COLOR_HEADER[widget.color]
    : widget.type === "teamChat"
      ? "bg-violet-100"
      : "bg-sky-100";

  const title =
    widget.type === "sticky" ? "Sticky Note" : widget.type === "email" ? "Email" : "Team Chat";
  const TitleIcon = widget.type === "sticky" ? StickyNote : widget.type === "email" ? Mail : MessageSquare;

  return (
    <div
      className={`pointer-events-auto absolute w-64 rounded-2xl border shadow-[0_18px_50px_rgba(15,23,42,0.22)] ${bodyTone}`}
      style={{ left: widget.x, top: widget.y }}
      data-testid={`playground-widget-${widget.id}`}
    >
      <div
        className={`flex cursor-grab touch-none items-center justify-between gap-1 rounded-t-2xl px-2 py-1.5 active:cursor-grabbing ${headerTone}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid={`playground-widget-drag-${widget.id}`}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
          <GripVertical className="h-3.5 w-3.5 text-slate-400" />
          <TitleIcon className="h-3.5 w-3.5" />
          {title}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="rounded-full p-1 text-slate-500 hover:bg-white/60"
            onClick={() => onUpdate(widget.id, { collapsed: !widget.collapsed })}
            aria-label={widget.collapsed ? "Expand" : "Collapse"}
            data-testid={`playground-widget-collapse-${widget.id}`}
          >
            {widget.collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className="rounded-full p-1 text-slate-500 hover:bg-white/60"
            onClick={() => onRemove(widget.id)}
            aria-label="Delete"
            data-testid={`playground-widget-delete-${widget.id}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!widget.collapsed && (
        <div className="p-2.5">
          {widget.patientContext?.name ? (
            <div className="mb-1.5 truncate text-[10px] font-medium text-slate-500">
              Re: {widget.patientContext.name}
            </div>
          ) : null}

          {widget.type === "sticky" ? (
            <>
              <textarea
                value={widget.text}
                onChange={(e) => onUpdate(widget.id, { text: e.target.value })}
                placeholder="Type a note…"
                className="min-h-[96px] w-full resize-none rounded-lg border-0 bg-white/40 p-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:bg-white/70"
                data-testid={`playground-widget-text-${widget.id}`}
              />
              <div className="mt-2 flex items-center gap-1">
                {WIDGET_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onUpdate(widget.id, { color: c.id })}
                    className={`h-4 w-4 rounded-full ${c.swatch} ${
                      widget.color === c.id ? "ring-2 ring-slate-500 ring-offset-1" : ""
                    }`}
                    aria-label={c.label}
                    title={c.label}
                    data-testid={`playground-widget-color-${widget.id}-${c.id}`}
                  />
                ))}
              </div>
            </>
          ) : widget.type === "email" ? (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">
                Quick launcher. Opens the full Email composer (real send) with this context.
              </p>
              <button
                type="button"
                onClick={() => onOpenEmail(widget.patientContext)}
                className="w-full rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
                data-testid={`playground-widget-open-email-${widget.id}`}
              >
                Open Email composer
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={widget.text}
                onChange={(e) => onUpdate(widget.id, { text: e.target.value })}
                placeholder="Draft a team message…"
                className="min-h-[80px] w-full resize-none rounded-lg border border-violet-200 bg-white p-2 text-xs text-slate-800 outline-none placeholder:text-slate-400"
                data-testid={`playground-widget-text-${widget.id}`}
              />
              <div className="rounded-lg bg-violet-50 px-2 py-1 text-[10px] text-violet-700">
                Draft only — team chat backend not connected. Nothing is sent.
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between text-[9px] text-slate-400">
            <span>By {widget.createdBy || "you"}</span>
            <span className="italic">Saved</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlaygroundWidgetLayer({
  widgets,
  onMove,
  onUpdate,
  onRemove,
  onOpenEmail,
}: {
  widgets: PlaygroundWidget[];
  onMove: (id: string, x: number, y: number) => void;
  onUpdate: (id: string, patch: Partial<PlaygroundWidget>) => void;
  onRemove: (id: string) => void;
  onOpenEmail: (ctx: WidgetPatientContext) => void;
}) {
  if (widgets.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-testid="playground-widget-layer">
      {widgets.map((w) => (
        <WidgetCard
          key={w.id}
          widget={w}
          onMove={onMove}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onOpenEmail={onOpenEmail}
        />
      ))}
    </div>
  );
}
