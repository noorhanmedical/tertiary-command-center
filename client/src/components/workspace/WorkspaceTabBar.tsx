// WorkspaceTabBar — the application-level workspace switcher.
//
// A compact, refined workspace tab strip that spans the full main-app width
// directly beneath the TopBanner and above the GlobalNav + content row. It is
// persistent shell chrome (never mounted per-page). Understated light
// treatment: white surface, subtle separators, restrained active state
// (deep-navy text + a 2px periwinkle underline). Horizontal overflow only —
// it never wraps to multiple rows.

import { X } from "lucide-react";
import { getWorkspaceById } from "@/lib/navigation/workspaceRegistry";
import { useWorkspaceTabs } from "@/lib/navigation/workspaceTabs";

export function WorkspaceTabBar() {
  const { openTabs, activeId, activateTab, closeTab } = useWorkspaceTabs();

  // Nothing open (e.g. Home, or a route with no owning workspace) — render
  // nothing at all so no empty strip appears on top of the page.
  if (openTabs.length === 0) {
    return null;
  }

  return (
    <div
      className="flex h-10 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-slate-200 bg-white workspace-tabbar-scroll"
      role="tablist"
      aria-label="Open workspaces"
      data-testid="workspace-tab-bar"
    >
      {openTabs.map((tab) => {
        const ws = getWorkspaceById(tab.id);
        const closeable = ws?.closeable !== false;
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => activateTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activateTab(tab.id);
              }
            }}
            title={tab.title}
            data-testid={`workspace-tab-${tab.id}`}
            data-active={active ? "true" : "false"}
            className={[
              "group relative flex items-center gap-2 pl-3.5 pr-2 h-full max-w-[220px] shrink-0 cursor-pointer select-none",
              "border-r border-slate-200/70 text-[13px] leading-none transition-colors",
              active
                ? "text-[#1E2A5A]"
                : "text-[#7E8CA1] hover:text-[#1E2A5A] hover:bg-slate-50",
            ].join(" ")}
          >
            {/* Active accent — a 2px periwinkle underline. */}
            <span
              className={[
                "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 transition-opacity",
                active ? "bg-[#5F7EEA] opacity-100" : "opacity-0",
              ].join(" ")}
              aria-hidden="true"
            />
            <span className="truncate font-medium">{tab.title}</span>
            {closeable ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={`Close ${tab.title}`}
                data-testid={`workspace-tab-close-${tab.id}`}
                className={[
                  "shrink-0 rounded p-0.5 transition-colors hover:bg-slate-200/70 hover:text-[#1E2A5A]",
                  active
                    ? "text-slate-400 opacity-80"
                    : "text-slate-400 opacity-0 group-hover:opacity-70 focus:opacity-100",
                ].join(" ")}
                tabIndex={active ? 0 : -1}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              // Keep horizontal rhythm consistent for non-closeable tabs so
              // titles don't shift when hovering neighbors.
              <span className="w-[18px] shrink-0" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}
