// Playground floating widgets + sticky notes (Task #643).
//
// SESSION/LOCAL STATE ONLY. Widgets live in React state for the current
// session and are intentionally NOT persisted — no DB table, no endpoint.
// Every widget renders a visible "not saved" indicator so operators are
// never misled. The shape is serializable so a future pass can persist it.
//
// Three widget types share one draggable-card system:
//   - sticky:   post-it note (editable text, six colors, collapsible)
//   - email:    quick launcher card → opens the full Email composer
//   - teamChat: quick draft card → clearly draft-only (no backend)
//
// Widgets can be created from the Sticky Notes tool (top-of-playground)
// or by dragging a tool tile from the dock onto the Playground surface.

import { useCallback, useRef, useState } from "react";
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

export function useWorkspaceWidgets(createdBy: string) {
  const [widgets, setWidgets] = useState<PlaygroundWidget[]>([]);

  const addWidget = useCallback(
    (input: {
      type: PlaygroundWidgetType;
      x?: number;
      y?: number;
      color?: WidgetColor;
      patientContext?: WidgetPatientContext;
    }) => {
      const stagger = widgets.length % 6;
      const widget: PlaygroundWidget = {
        id: nextWidgetId(),
        type: input.type,
        x: input.x ?? 24 + stagger * 18,
        y: input.y ?? 16 + stagger * 18,
        color: input.color ?? (input.type === "teamChat" ? "purple" : "yellow"),
        text: "",
        collapsed: false,
        patientContext: input.patientContext ?? null,
        createdBy,
      };
      setWidgets((prev) => [...prev, widget]);
      return widget.id;
    },
    [widgets.length, createdBy],
  );

  const updateWidget = useCallback((id: string, patch: Partial<PlaygroundWidget>) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }, []);

  const removeWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const clearWidgets = useCallback(() => setWidgets([]), []);

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
            <span className="italic">Not saved</span>
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
