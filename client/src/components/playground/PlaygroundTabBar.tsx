// Playground Tab Bar — minimal, clean tab strip for open workspaces.
//
// Each tab: icon + title + close button + dirty indicator.
// Horizontal scroll on overflow. Active tab has subtle accent.

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { usePlayground } from "./PlaygroundWorkspaceProvider";
import { getWorkspaceDefinition } from "./registry";
import { DirtyCloseDialog, type DirtyCloseAction } from "./DirtyCloseDialog";
import type { PlaygroundWorkspace } from "./types";

function Tab({ workspace, isActive, onClose }: { workspace: PlaygroundWorkspace; isActive: boolean; onClose: (ws: PlaygroundWorkspace) => void }) {
  const { focusWorkspace } = usePlayground();
  const def = getWorkspaceDefinition(workspace.type);
  const Icon = workspace.icon ?? def?.icon ?? null;

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(workspace);
  };

  return (
    <div
      role="tab"
      aria-selected={isActive}
      onClick={() => focusWorkspace(workspace.id)}
      className={[
        "group flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs cursor-pointer transition-colors shrink-0",
        isActive
          ? "bg-slate-900/[0.06] text-slate-900 font-semibold"
          : "text-slate-500 hover:bg-slate-100/60 hover:text-slate-700",
      ].join(" ")}
      data-testid={`playground-tab-${workspace.id}`}
      title={workspace.subtitle ? `${workspace.title} — ${workspace.subtitle}` : workspace.title}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="max-w-[140px] truncate">{workspace.title}</span>
      {workspace.dirty && (
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />
      )}
      {workspace.pinned && (
        <span className="text-[8px] text-slate-400" title="Pinned">📌</span>
      )}
      {workspace.type !== "playground_home" && (
        <button
          type="button"
          onClick={handleClose}
          className="ml-0.5 h-4 w-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-slate-200 transition-opacity"
          aria-label={`Close ${workspace.title}`}
          data-testid={`playground-tab-close-${workspace.id}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function PlaygroundTabBar() {
  const { workspaces, activeWorkspaceId, closeWorkspace, setDirty } = usePlayground();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dirtyCloseTarget, setDirtyCloseTarget] = useState<PlaygroundWorkspace | null>(null);

  const handleCloseRequest = (ws: PlaygroundWorkspace) => {
    if (ws.dirty) {
      setDirtyCloseTarget(ws);
    } else {
      closeWorkspace(ws.id);
    }
  };

  const handleDirtyAction = (action: DirtyCloseAction) => {
    if (!dirtyCloseTarget) return;
    if (action === "save") {
      // TODO: invoke workspace-specific save. For now, clear dirty + close.
      setDirty(dirtyCloseTarget.id, false);
      closeWorkspace(dirtyCloseTarget.id);
    } else if (action === "discard") {
      setDirty(dirtyCloseTarget.id, false);
      closeWorkspace(dirtyCloseTarget.id);
    }
    // "cancel" just closes the dialog.
    setDirtyCloseTarget(null);
  };

  if (workspaces.length === 0) return null;

  return (
    <>
      <div
        ref={scrollRef}
        role="tablist"
        className="flex items-center gap-0.5 overflow-x-auto px-2 py-1.5 border-b border-slate-100/60 scrollbar-thin scrollbar-thumb-slate-200"
        data-testid="playground-tab-bar"
      >
        {workspaces.map((ws) => (
          <Tab key={ws.id} workspace={ws} isActive={ws.id === activeWorkspaceId} onClose={handleCloseRequest} />
        ))}
      </div>
      <DirtyCloseDialog
        open={!!dirtyCloseTarget}
        workspaceTitle={dirtyCloseTarget?.title ?? ""}
        description={dirtyCloseTarget?.dirtyDescription}
        onAction={handleDirtyAction}
      />
    </>
  );
}
