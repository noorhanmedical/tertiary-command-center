import { Button } from "@/components/ui/button";
import {
  CheckSquare,
  Square,
  Trash2,
  Sparkles,
  RefreshCw,
  FileText,
  Loader2,
} from "lucide-react";

// Compact List bar for the Plexus IQ operating list.
//
// Shows list title, selected batch time, patient count, and the
// qualification status (ready / running with progress / completed-
// with-errors), plus a compact action set. Replaces the old full-
// width qualification banner / giant job card.

export type PlexusIQListQualState =
  | { kind: "empty" }
  | { kind: "ready" }
  | { kind: "running"; done: number; total: number }
  | { kind: "completed_with_errors"; errors: number }
  | { kind: "pending"; pending: number };

export type PlexusIQListBarProps = {
  title: string;
  timeLabel: string | null;
  patientCount: number;
  qualState: PlexusIQListQualState;
  selectedCount: number;
  allSelected: boolean;
  hasFailed: boolean;
  isGenerating: boolean;
  canAct: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDeleteSelected: () => void;
  onGenerate: () => void;
  onRetryFailed: () => void;
  onClinicianPdf: () => void;
  onPlexusPdf: () => void;
};

function QualBadge({ state }: { state: PlexusIQListQualState }) {
  switch (state.kind) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running {state.total > 0 ? `${state.done}/${state.total}` : ""}
        </span>
      );
    case "completed_with_errors":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
          {state.errors} with errors
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
          {state.pending} pending
        </span>
      );
    default:
      return null;
  }
}

export function PlexusIQListBar({
  title,
  timeLabel,
  patientCount,
  qualState,
  selectedCount,
  allSelected,
  hasFailed,
  isGenerating,
  canAct,
  onSelectAll,
  onClear,
  onDeleteSelected,
  onGenerate,
  onRetryFailed,
  onClinicianPdf,
  onPlexusPdf,
}: PlexusIQListBarProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 flex-wrap px-3 py-2.5 border-b border-slate-700 bg-slate-900"
      data-testid="plexus-iq-list-bar"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-100 truncate" data-testid="text-list-bar-title">
            {title}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {timeLabel && <span>{timeLabel}</span>}
            <span className="tabular-nums">
              {patientCount} patient{patientCount === 1 ? "" : "s"}
            </span>
            <QualBadge state={qualState} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-slate-200 hover:text-white hover:bg-slate-800 disabled:text-slate-500"
          disabled={!canAct || patientCount === 0}
          onClick={allSelected ? onClear : onSelectAll}
          data-testid="button-list-bar-select-all"
        >
          {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {allSelected ? "Clear" : "Select All"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-slate-800 disabled:text-slate-500"
          disabled={selectedCount === 0}
          onClick={onDeleteSelected}
          data-testid="button-list-bar-delete-selected"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </Button>

        <span className="mx-0.5 h-5 w-px bg-slate-500" />

        <Button
          size="sm"
          className="h-7 gap-1 px-2.5 text-xs rounded-lg"
          disabled={!canAct || patientCount === 0 || isGenerating}
          onClick={onGenerate}
          data-testid="button-list-bar-generate"
        >
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Generate
        </Button>
        {hasFailed && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2.5 text-xs rounded-lg border-slate-500 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white disabled:text-slate-500"
            disabled={!canAct || isGenerating}
            onClick={onRetryFailed}
            data-testid="button-list-bar-retry-failed"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry Failed
          </Button>
        )}

        <span className="mx-0.5 h-5 w-px bg-slate-500" />

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2.5 text-xs rounded-lg border-slate-500 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white disabled:text-slate-500"
          disabled={patientCount === 0}
          onClick={onClinicianPdf}
          data-testid="button-list-bar-clinician-pdf"
        >
          <FileText className="h-3.5 w-3.5" />
          Clinician PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2.5 text-xs rounded-lg border-slate-500 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white disabled:text-slate-500"
          disabled={patientCount === 0}
          onClick={onPlexusPdf}
          data-testid="button-list-bar-plexus-pdf"
        >
          <FileText className="h-3.5 w-3.5" />
          Plexus PDF
        </Button>
      </div>
    </div>
  );
}

export default PlexusIQListBar;
