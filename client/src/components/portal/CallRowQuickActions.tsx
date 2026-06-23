import { Phone, Calendar as CalendarIcon, Maximize2 } from "lucide-react";
import type { TeamWorkspaceCallListItem } from "@/lib/workflow/teamMemberWorkspaceApi";

// Compact action cluster for a call-list row. Each icon launches a dedicated
// Playground tab for this patient/case:
//   • Phone    → Call tab (RingCentral call suite + disposition logging)
//   • Calendar → Schedule tab (Zocdoc-style scheduler)
//   • Maximize → Case Overview tab
// The popover-based quick scheduler was retired in favor of the full tabbed
// workflows so the compact tile stays small and the heavy UI lives in tabs.

const ACCENT = "#4863A0";

export type CallRowQuickActionsProps = {
  row: TeamWorkspaceCallListItem;
  idx: number | string;
  canCall: boolean;
  /** Open the Call workflow tab. */
  onOpenCall: () => void;
  /** Open the Schedule workflow tab. */
  onOpenSchedule: () => void;
  /** Open the Case Overview workflow tab. */
  onOpenCase: () => void;
};

export function CallRowQuickActions({
  row,
  idx,
  canCall,
  onOpenCall,
  onOpenSchedule,
  onOpenCase,
}: CallRowQuickActionsProps) {
  const key = row.id ?? idx;
  const name = row.patientName ?? "patient";

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        disabled={!canCall}
        onClick={onOpenCall}
        aria-label={`Call ${name}`}
        title="Open call tab"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-emerald-600 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
        data-testid={`button-call-phone-${key}`}
      >
        <Phone className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onOpenSchedule}
        aria-label={`Schedule ${name}`}
        title="Open schedule tab"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-colors hover:bg-blue-50"
        style={{ color: ACCENT }}
        data-testid={`button-call-schedule-${key}`}
      >
        <CalendarIcon className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onOpenCase}
        aria-label={`Open case overview for ${name}`}
        title="Open case overview tab"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
        data-testid={`button-call-case-${key}`}
      >
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
}
