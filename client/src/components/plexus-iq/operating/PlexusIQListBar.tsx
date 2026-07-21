import {
  CheckSquare,
  Square,
  Trash2,
  RefreshCw,
  ClipboardList,
  Network,
  Sparkles,
  Loader2,
  Clock,
  ArrowDownAZ,
} from "lucide-react";

// Minimal night-sky List bar for the Plexus IQ operating list.
//
// A solid black header with the centered "PATIENT LIST" label and a
// right-aligned cluster of circular white icon buttons (delete-when-selected,
// select all, retry-when-failed, and the two PDF exports).

export type PlexusIQListBarProps = {
  patientCount: number;
  selectedCount: number;
  allSelected: boolean;
  hasFailed: boolean;
  /** Number of patients still pending analysis (un-qualified). */
  pendingCount: number;
  isGenerating: boolean;
  canAct: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDeleteSelected: () => void;
  onRetryFailed: () => void;
  onGenerate: () => void;
  onClinicianPdf: () => void;
  onPlexusPdf: () => void;
  /** Active list sort. When provided (with onSortModeChange), a Time/Name
      toggle renders on the left side of the bar. */
  sortMode?: "time" | "name";
  onSortModeChange?: (mode: "time" | "name") => void;
};

export function PlexusIQListBar({
  patientCount,
  selectedCount,
  allSelected,
  hasFailed,
  pendingCount,
  isGenerating,
  canAct,
  onSelectAll,
  onClear,
  onDeleteSelected,
  onRetryFailed,
  onGenerate,
  onClinicianPdf,
  onPlexusPdf,
  sortMode,
  onSortModeChange,
}: PlexusIQListBarProps) {
  const iconBtn =
    "inline-flex items-center justify-center h-8 w-8 rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div
      className="flex min-h-[3.5rem] items-center px-3 border-b border-slate-200 bg-slate-50"
      data-testid="plexus-iq-list-bar"
    >
      <div className="flex flex-1 items-center">
        {sortMode && onSortModeChange && patientCount > 0 && (
          <div
            className="inline-flex items-center rounded-md border border-slate-200 bg-white p-0.5"
            role="group"
            aria-label="Sort patient list"
            data-testid="toggle-list-sort"
          >
            <button
              type="button"
              onClick={() => onSortModeChange("time")}
              aria-pressed={sortMode === "time"}
              title="Sort by appointment time"
              className={`inline-flex items-center gap-1 h-7 rounded px-2.5 text-[11px] font-semibold transition-colors ${
                sortMode === "time"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              data-testid="button-list-sort-time"
            >
              <Clock className="h-3.5 w-3.5" />
              Time
            </button>
            <button
              type="button"
              onClick={() => onSortModeChange("name")}
              aria-pressed={sortMode === "name"}
              title="Sort by name (A–Z)"
              className={`inline-flex items-center gap-1 h-7 rounded px-2.5 text-[11px] font-semibold transition-colors ${
                sortMode === "name"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              data-testid="button-list-sort-name"
            >
              <ArrowDownAZ className="h-3.5 w-3.5" />
              Name
            </button>
          </div>
        )}
      </div>
      <div
        className="shrink-0 text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase"
        data-testid="text-list-bar-title"
      >
        Patient List
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        {/* Generate — only shown while the batch still has un-analyzed
            patients. Hides itself once every patient is screened ("Ready"). */}
        {(pendingCount > 0 || isGenerating) && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 rounded-md bg-plexus-navy-800 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-plexus-navy-700 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!canAct || isGenerating || pendingCount === 0}
            onClick={onGenerate}
            aria-label={
              isGenerating ? "Analysis running" : `Generate ${pendingCount} pending`
            }
            title={
              isGenerating
                ? "Analysis running"
                : `Generate ${pendingCount} pending patient${pendingCount === 1 ? "" : "s"}`
            }
            data-testid="button-list-bar-generate"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate ({pendingCount})
              </>
            )}
          </button>
        )}

        {/* Trash — appears LEFT of Select All when anything is selected */}
        {selectedCount > 0 && (
          <button
            type="button"
            className={`${iconBtn} text-rose-600 hover:text-rose-700`}
            onClick={onDeleteSelected}
            aria-label={`Delete ${selectedCount} selected`}
            title={`Delete ${selectedCount} selected`}
            data-testid="button-list-bar-delete-selected"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          className={iconBtn}
          disabled={!canAct || patientCount === 0}
          onClick={allSelected ? onClear : onSelectAll}
          aria-label={allSelected ? "Clear selection" : "Select all"}
          title={allSelected ? "Clear selection" : "Select all"}
          data-testid="button-list-bar-select-all"
        >
          {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
        </button>

        {hasFailed && (
          <button
            type="button"
            className={iconBtn}
            disabled={!canAct || isGenerating}
            onClick={onRetryFailed}
            aria-label="Retry failed"
            title="Retry failed"
            data-testid="button-list-bar-retry-failed"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          className={iconBtn}
          disabled={patientCount === 0}
          onClick={onClinicianPdf}
          aria-label="Clinician PDF"
          title="Clinician PDF"
          data-testid="button-list-bar-clinician-pdf"
        >
          <ClipboardList className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={iconBtn}
          disabled={patientCount === 0}
          onClick={onPlexusPdf}
          aria-label="Plexus PDF"
          title="Plexus PDF"
          data-testid="button-list-bar-plexus-pdf"
        >
          <Network className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default PlexusIQListBar;
