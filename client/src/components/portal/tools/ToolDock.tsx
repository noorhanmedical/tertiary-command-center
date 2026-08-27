// Premium tool launcher dock (Task #655).
//
// The Team Portal left "Tools" panel. Tools are organized into labeled
// GROUPS of frosted-glass tiles, each group carrying a light iOS color
// tint. Each tile opens a tool in the Playground, switches a tray tab, or
// spawns a floating widget. Draggable tiles (Email, Sticky Notes) can be
// dragged onto the Playground to spawn a floating widget.

import { type ComponentType, type ReactNode } from "react";
import {
  LeftRailToolsButton,
  type ToolTint,
} from "@/components/portal/leftRail/LeftRailToolsButton";
import { WIDGET_DND_MIME, type PlaygroundWidgetType } from "./workspaceWidgets";

export type DockTool = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  active?: boolean;
  badge?: ReactNode;
  /** If set, the tile is draggable and drops spawn this widget type. */
  draggableWidget?: PlaygroundWidgetType;
  testId: string;
};

export type DockGroup = {
  id: string;
  label: string;
  tint: ToolTint;
  tools: DockTool[];
};

function DockTile({ tool, tint, compact }: { tool: DockTool; tint: ToolTint; compact: boolean }) {
  return (
    <LeftRailToolsButton
      label={tool.label}
      icon={tool.icon}
      active={!!tool.active}
      compact={compact}
      badge={tool.badge}
      tint={tint}
      onClick={tool.onClick}
      draggable={!!tool.draggableWidget}
      onDragStart={
        tool.draggableWidget
          ? (e) => {
              e.dataTransfer.setData(WIDGET_DND_MIME, tool.draggableWidget as string);
              e.dataTransfer.effectAllowed = "copy";
            }
          : undefined
      }
      testId={tool.testId}
    />
  );
}

export function ToolDock({
  groups,
  compact,
}: {
  groups: DockGroup[];
  compact: boolean;
}) {
  // Compact (narrow rail): drop group chrome, show a single icon column with
  // subtle dividers between groups so the tint grouping is still legible.
  if (compact) {
    return (
      <div data-testid="tool-dock" className="space-y-2">
        {groups.map((group, i) => (
          <div
            key={group.id}
            className={i > 0 ? "border-t border-slate-300/50 pt-2" : ""}
            data-testid={`tool-dock-group-${group.id}`}
          >
            <div className="grid grid-cols-1 gap-2">
              {group.tools.map((tool) => (
                <DockTile key={tool.id} tool={tool} tint={group.tint} compact />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="tool-dock" className="space-y-3">
      {groups.map((group) => (
        <div key={group.id} data-testid={`tool-dock-group-${group.id}`}>
          <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            {group.label}
          </div>
          <div className="grid grid-cols-3 gap-2" data-testid={`tool-dock-grid-${group.id}`}>
            {group.tools.map((tool) => (
              <DockTile key={tool.id} tool={tool} tint={group.tint} compact={false} />
            ))}
          </div>
        </div>
      ))}
      <p className="px-1 text-[9px] leading-tight text-slate-500">
        Tip: drag Email or Sticky Notes onto the Playground to open a floating widget.
      </p>
    </div>
  );
}
