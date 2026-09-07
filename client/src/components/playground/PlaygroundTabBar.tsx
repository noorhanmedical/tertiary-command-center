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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { PlaygroundWorkspace } from "./types";

// The canonical Playground tab. EVERY workspace tab — Home included — renders
// through this one component so the tab strip has a single visual language.
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
            // iOS-style frosted glass pill. Backdrop blur + translucent fill
            // over the winter scene. Active = brighter glass with a soft lift;
            // inactive = faint glass that warms on hover.
            "group relative flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs cursor-pointer shrink-0 backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            "transition-[background-color,border-color,box-shadow,transform] duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
            isActive
              ? "border-white/70 bg-white/70 text-slate-900 font-semibold shadow-[0_8px_24px_rgba(15,23,42,0.14),inset_0_1px_0_rgba(255,255,255,0.75)]"
              : "border-white/40 bg-white/25 text-slate-600 hover:bg-white/45 hover:text-slate-800 hover:border-white/55 shadow-[0_2px_10px_rgba(15,23,42,0.06)]",
          ].join(" ")}
          data-testid={`playground-tab-${workspace.id}`}
          title={workspace.subtitle ? `${workspace.title} — ${workspace.subtitle}` : workspace.title}
        >
          {Icon && <Icon className="relative h-3.5 w-3.5 shrink-0" />}
          <span className="relative max-w-[140px] truncate">{workspace.title}</span>
          {workspace.dirty && (
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0 bg-amber-500"
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
              className="relative z-10 ml-0.5 h-4 w-4 rounded-full flex items-center justify-center text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-800 hover:bg-white/60 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Close ${workspace.title}`}
              data-testid={`playground-tab-close-${workspace.id}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-48 rounded-md border border-slate-200 bg-white text-slate-800"
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

  // The redundant "Home" tab was removed. Filter out any playground_home
  // workspace that may still exist (e.g. restored from a persisted session)
  // so it never appears in the strip. Only real workspace tabs render.
  const orderedTabs = workspaces.filter((w) => w.type !== "playground_home");

  // When there are no open workspaces, render nothing — the empty playground
  // shows the winter background scene directly, with no tab strip chrome.
  if (orderedTabs.length === 0) return null;

  return (
    <>
      <div
        ref={scrollRef}
        role="tablist"
        className="flex items-center gap-1.5 overflow-x-auto bg-transparent px-4 py-2.5 scrollbar-thin scrollbar-thumb-transparent"
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
