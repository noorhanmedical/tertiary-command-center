// Playground Tab Bar — tab strip for open workspaces.
//
// Each tab: icon + title + dirty indicator + pin marker + close button.
// Right-click (or the ⋯ affordance) opens tab management: Pin/Unpin, Close,
// Close Others, Close All. Dirty workspaces route through the Save/Discard/
// Cancel dialog before closing (bulk closes skip dirty tabs and keep them open).
// Horizontal scroll on overflow keeps 10–15 tabs usable without crushing labels.

import { useRef, useState } from "react";
import { X, Pin, PinOff, XCircle, Copy } from "lucide-react";
import { usePlayground } from "./PlaygroundWorkspaceProvider";
import { getWorkspaceDefinition } from "./registry";
import { DirtyCloseDialog, type DirtyCloseAction } from "./DirtyCloseDialog";
import { useSketchCanvas } from "./sketch/useSketchCanvas";
import { sketchOptions, stableSeed, SKETCH_COLORS } from "./sketch/sketchTokens";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { PlaygroundWorkspace } from "./types";

// Rough colored-pencil underline for the active tab (§13). Cheap, stable seed.
function TabUnderline({ seedId }: { seedId: string }) {
  const seed = stableSeed(`tab-underline:${seedId}`);
  const { containerRef, canvasRef } = useSketchCanvas({
    seed,
    draw: (rc, _ctx, size, s) => {
      const y = size.height - 2;
      rc.line(3, y, size.width - 3, y, {
        ...sketchOptions("structural", "blue", { strokeWidth: 2 }),
        seed: s,
      });
    },
  });
  return (
    <span ref={containerRef} className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5">
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
    </span>
  );
}

// Rough graphite outline for an individual paper tab (§4). Stable seed.
function TabOutline({ seedId, active }: { seedId: string; active: boolean }) {
  const seed = stableSeed(`tab-outline:${seedId}`);
  const { containerRef, canvasRef } = useSketchCanvas({
    seed,
    deps: [active],
    draw: (rc, _ctx, size, s) => {
      const w = size.width, h = size.height, inset = 1.5, r = 6;
      const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
      const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
      const d = [
        `M ${x0 + rr} ${y0}`, `L ${x1 - rr} ${y0}`, `Q ${x1} ${y0} ${x1} ${y0 + rr}`,
        `L ${x1} ${y1 - rr}`, `Q ${x1} ${y1} ${x1 - rr} ${y1}`, `L ${x0 + rr} ${y1}`,
        `Q ${x0} ${y1} ${x0} ${y1 - rr}`, `L ${x0} ${y0 + rr}`, `Q ${x0} ${y0} ${x0 + rr} ${y0}`, "Z",
      ].join(" ");
      rc.path(d, {
        ...sketchOptions("structural", active ? "graphite" : "graphiteLight", {
          strokeWidth: active ? 1.7 : 1.2,
        }),
        seed: s,
      });
    },
  });
  return (
    <span ref={containerRef} className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
    </span>
  );
}

// The canonical Playground tab. EVERY workspace tab — Home included — renders
// through this one component so the tab strip has a single SketchUI language.
function SketchTab({
  workspace,
  isActive,
  onClose,
}: {
  workspace: PlaygroundWorkspace;
  isActive: boolean;
  onClose: (ws: PlaygroundWorkspace) => void;
}) {
  const { focusWorkspace, pinWorkspace, closeOtherWorkspaces, closeAllWorkspaces } = usePlayground();
  const def = getWorkspaceDefinition(workspace.type);
  const Icon = workspace.icon ?? def?.icon ?? null;
  const isHome = workspace.type === "playground_home";

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(workspace);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={isActive}
          onClick={() => focusWorkspace(workspace.id)}
          className={[
            "group relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs cursor-pointer transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)]",
            isActive
              ? "text-slate-900 font-semibold"
              : "text-slate-500 hover:text-slate-700",
          ].join(" ")}
          style={{ backgroundColor: isActive ? SKETCH_COLORS.paper : "transparent" }}
          data-testid={`playground-tab-${workspace.id}`}
          title={workspace.subtitle ? `${workspace.title} — ${workspace.subtitle}` : workspace.title}
        >
          {/* Individual rough paper outline (§4) + active colored-pencil underline (§13). */}
          <TabOutline seedId={workspace.id} active={isActive} />
          {isActive && <TabUnderline seedId={workspace.id} />}
          {Icon && <Icon className="relative h-3.5 w-3.5 shrink-0" />}
          <span className="relative max-w-[140px] truncate">{workspace.title}</span>
          {workspace.dirty && (
            // Pencil dirty mark, not a corporate red badge (§48).
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: SKETCH_COLORS.gold }}
              title="Unsaved changes"
              data-testid={`playground-tab-dirty-${workspace.id}`}
            />
          )}
          {workspace.pinned && (
            <Pin className="h-3 w-3 shrink-0 text-slate-400" aria-label="Pinned" />
          )}
          {!isHome && (
            <button
              type="button"
              onClick={handleClose}
              className="relative z-10 ml-0.5 h-4 w-4 rounded flex items-center justify-center text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-700 hover:bg-slate-900/[0.06] transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)]"
              aria-label={`Close ${workspace.title}`}
              data-testid={`playground-tab-close-${workspace.id}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-48 border text-slate-800"
        style={{ backgroundColor: SKETCH_COLORS.paper, borderColor: "rgba(31,41,55,0.5)", borderRadius: "10px 12px 9px 11px" }}
        data-testid={`playground-tab-menu-${workspace.id}`}
      >
        <ContextMenuItem
          onSelect={() => pinWorkspace(workspace.id, !workspace.pinned)}
          data-testid={`playground-tab-pin-${workspace.id}`}
        >
          {workspace.pinned ? (
            <><PinOff className="mr-2 h-3.5 w-3.5" /> Unpin</>
          ) : (
            <><Pin className="mr-2 h-3.5 w-3.5" /> Pin</>
          )}
        </ContextMenuItem>
        {!isHome && (
          <ContextMenuItem
            onSelect={() => onClose(workspace)}
            data-testid={`playground-tab-menu-close-${workspace.id}`}
          >
            <X className="mr-2 h-3.5 w-3.5" /> Close
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => closeOtherWorkspaces(workspace.id)}
          data-testid={`playground-tab-close-others-${workspace.id}`}
        >
          <Copy className="mr-2 h-3.5 w-3.5" /> Close Others
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => closeAllWorkspaces()}
          data-testid={`playground-tab-close-all-${workspace.id}`}
        >
          <XCircle className="mr-2 h-3.5 w-3.5" /> Close All
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function PlaygroundTabBar() {
  const {
    workspaces, activeWorkspaceId, closeWorkspace, setDirty, saveWorkspace,
  } = usePlayground();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dirtyCloseTarget, setDirtyCloseTarget] = useState<PlaygroundWorkspace | null>(null);
  const [saving, setSaving] = useState(false);

  const handleCloseRequest = (ws: PlaygroundWorkspace) => {
    if (ws.dirty) {
      setDirtyCloseTarget(ws);
    } else {
      closeWorkspace(ws.id);
    }
  };

  const handleDirtyAction = async (action: DirtyCloseAction) => {
    const target = dirtyCloseTarget;
    if (!target) return;

    if (action === "save") {
      // Invoke the workspace-owned save handler. On success, dirty is cleared
      // by the provider and we close. On failure (e.g. the workspace routed the
      // user to complete a canonical form), keep the tab open and dismiss the
      // dialog so the user can finish.
      setSaving(true);
      let ok = false;
      try {
        ok = await saveWorkspace(target.id);
      } finally {
        setSaving(false);
      }
      if (ok) closeWorkspace(target.id);
      setDirtyCloseTarget(null);
      return;
    }

    if (action === "discard") {
      setDirty(target.id, false);
      closeWorkspace(target.id);
    }
    // "cancel" keeps the workspace open and preserves the draft.
    setDirtyCloseTarget(null);
  };

  // Render Home first, then the rest — but ALL through the same SketchTab, so
  // Home and workspace tabs share one visual language. The row itself is a
  // transparent flex (no strip, no band); only the individual tabs are styled.
  const orderedTabs = [
    ...workspaces.filter((w) => w.type === "playground_home"),
    ...workspaces.filter((w) => w.type !== "playground_home"),
  ];

  return (
    <>
      <div
        ref={scrollRef}
        role="tablist"
        className="flex items-center gap-1.5 overflow-x-auto bg-transparent px-4 py-2.5 scrollbar-thin scrollbar-thumb-slate-200"
        data-testid="playground-tab-bar"
      >
        {orderedTabs.map((ws) => (
          <SketchTab key={ws.id} workspace={ws} isActive={ws.id === activeWorkspaceId} onClose={handleCloseRequest} />
        ))}
      </div>
      <DirtyCloseDialog
        open={!!dirtyCloseTarget}
        workspaceTitle={dirtyCloseTarget?.title ?? ""}
        description={dirtyCloseTarget?.dirtyDescription}
        saving={saving}
        onAction={handleDirtyAction}
      />
    </>
  );
}
