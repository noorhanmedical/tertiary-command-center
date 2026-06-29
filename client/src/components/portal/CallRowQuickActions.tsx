import { Phone, Calendar as CalendarIcon } from "lucide-react";
import type { TeamWorkspaceCallListItem } from "@/lib/workflow/teamMemberWorkspaceApi";

// Minimal action cluster for a call-list row: a circular phone button (opens
// the call workflow) and a circular calendar button (opens the quick schedule
// popup). The case/maximize action was removed so the card stays to just the
// patient name plus these two buttons.

const ACCENT = "#4863A0";

export type CallRowQuickActionsProps = {
  row: TeamWorkspaceCallListItem;
  idx: number | string;
  canCall: boolean;
  /** Open the Call workflow tab. */
  onOpenCall: () => void;
  /** Open the quick schedule popup. */
  onOpenSchedule: () => void;
  /** Open the Case Overview workflow tab. Optional / no longer rendered. */
  onOpenCase?: () => void;
};

export function CallRowQuickActions({
  row,
  idx,
  canCall,
  onOpenCall,
  onOpenSchedule,
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
        title="Call patient"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-emerald-600 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
        data-testid={`button-call-phone-${key}`}
      >
        <Phone className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onOpenSchedule}
        aria-label={`Schedule ${name}`}
        title="Schedule appointment"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-colors hover:bg-blue-50"
        style={{ color: ACCENT }}
        data-testid={`button-call-schedule-${key}`}
      >
        <CalendarIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
