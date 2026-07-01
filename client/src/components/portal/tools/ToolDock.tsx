// Premium tool launcher dock (Task #643).
//
// Replaces the flat icon list in the Team Portal left "Tools" panel with
// a clean, iOS-like launcher grid. Each tile opens a tool in the
// Playground (or triggers a tray tab / sticky note). Draggable tiles
// (Email, Team Chat, Sticky Notes) can be dragged onto the Playground to
// spawn a floating widget.

import { type ComponentType, type ReactNode } from "react";
import { LeftRailToolsButton } from "@/components/portal/leftRail/LeftRailToolsButton";
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

export function ToolDock({
  tools,
  compact,
}: {
  tools: DockTool[];
  compact: boolean;
}) {
  return (
    <div data-testid="tool-dock">
      <div
        className={compact ? "grid grid-cols-1 gap-2" : "grid grid-cols-3 gap-2"}
        data-testid="tool-dock-grid"
      >
        {tools.map((tool) => (
          <LeftRailToolsButton
            key={tool.id}
            label={tool.label}
            icon={tool.icon}
            active={!!tool.active}
            compact={compact}
            badge={tool.badge}
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
        ))}
      </div>
      {!compact && (
        <p className="mt-2 px-1 text-[9px] leading-tight text-slate-500">
          Tip: drag Email, Team Chat, or Sticky Notes onto the Playground to open a floating widget.
        </p>
      )}
    </div>
  );
}
