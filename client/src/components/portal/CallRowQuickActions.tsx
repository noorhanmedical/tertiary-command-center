import { Phone, Calendar as CalendarIcon, ArrowRightLeft } from "lucide-react";
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
  /** Open the Handoff dialog for this row (Phase 5C). Optional — rendered only
   *  when the row has an execution case to hand off. */
  onHandoff?: () => void;
};

export function CallRowQuickActions({
  row,
  idx,
  canCall,
  onOpenCall,
  onOpenSchedule,
  onHandoff,
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors hover:bg-slate-900/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
        style={{ borderColor: "rgba(31,41,55,0.45)", backgroundColor: "#FAFBFD", color: "var(--sketch-green, #5C7A5C)" }}
        data-testid={`button-call-phone-${key}`}
      >
        <Phone className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onOpenSchedule}
        aria-label={`Schedule ${name}`}
        title="Schedule appointment"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors hover:bg-slate-900/[0.04]"
        style={{ borderColor: "rgba(31,41,55,0.45)", backgroundColor: "#FAFBFD", color: ACCENT }}
        data-testid={`button-call-schedule-${key}`}
      >
        <CalendarIcon className="h-4 w-4" />
      </button>

      {onHandoff ? (
        <button
          type="button"
          onClick={onHandoff}
          aria-label={`Hand off ${name}`}
          title="Hand off to a teammate"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors hover:bg-slate-900/[0.04]"
          style={{ borderColor: "rgba(31,41,55,0.45)", backgroundColor: "#FAFBFD", color: "#8250DF" }}
          data-testid={`button-call-handoff-${key}`}
        >
          <ArrowRightLeft className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
