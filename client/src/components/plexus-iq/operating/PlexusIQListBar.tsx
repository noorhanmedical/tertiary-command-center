import {
  CheckSquare,
  Square,
  Trash2,
  RefreshCw,
  ClipboardList,
  Network,
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
  isGenerating: boolean;
  canAct: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDeleteSelected: () => void;
  onRetryFailed: () => void;
  onClinicianPdf: () => void;
  onPlexusPdf: () => void;
};

export function PlexusIQListBar({
  patientCount,
  selectedCount,
  allSelected,
  hasFailed,
  isGenerating,
  canAct,
  onSelectAll,
  onClear,
  onDeleteSelected,
  onRetryFailed,
  onClinicianPdf,
  onPlexusPdf,
}: PlexusIQListBarProps) {
  const iconBtn =
    "inline-flex items-center justify-center h-8 w-8 rounded-full bg-white text-slate-900 shadow-sm transition-colors hover:bg-slate-200 disabled:bg-white/30 disabled:text-slate-500 disabled:cursor-not-allowed";

  return (
    <div
      className="flex min-h-[3.5rem] items-center px-3 border-b border-white/10 bg-black"
      data-testid="plexus-iq-list-bar"
    >
      <div className="flex-1" />
      <div
        className="shrink-0 text-sm font-semibold tracking-widest text-white uppercase"
        data-testid="text-list-bar-title"
      >
        Patient List
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
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
