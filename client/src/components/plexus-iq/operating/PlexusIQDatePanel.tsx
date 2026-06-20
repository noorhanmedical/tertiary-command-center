import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

// Left "Date" panel for the Plexus IQ operating list.
//
// Expandable date groups; each child row is a real batch/import for
// the selected facility (newest first), showing time, patient count,
// and the batch's qualification status. Selecting a child row drives
// the list and stays highlighted. Facility is implied by the page's
// facility context, so there is no facility column or grouping here.

export type PlexusIQBatchNode = {
  batchId: number;
  /** Human time label derived from createdAt (e.g. "9:24 AM"). */
  timeLabel: string;
  patientCount: number;
  statusLabel: string;
  statusTone: "ready" | "running" | "errors" | "pending";
  /** Sort key — batch createdAt epoch ms, newest first. */
  createdAtMs: number;
};

export type PlexusIQDateGroup = {
  /** ISO date or "unscheduled". */
  key: string;
  label: string;
  batches: PlexusIQBatchNode[];
};

const TONE_DOT: Record<PlexusIQBatchNode["statusTone"], string> = {
  ready: "bg-emerald-500",
  running: "bg-sky-500",
  errors: "bg-rose-500",
  pending: "bg-slate-500",
};

export type PlexusIQDatePanelProps = {
  groups: PlexusIQDateGroup[];
  selectedBatchId: number | null;
  expandedDates: Set<string>;
  onToggleDate: (key: string) => void;
  onSelectBatch: (batchId: number) => void;
};

export function PlexusIQDatePanel({
  groups,
  selectedBatchId,
  expandedDates,
  onToggleDate,
  onSelectBatch,
}: PlexusIQDatePanelProps) {
  return (
    <div
      className="flex flex-col h-full min-h-0 border-r border-slate-800 bg-slate-900"
      data-testid="plexus-iq-date-panel"
    >
      <div className="px-3 py-2.5 border-b border-slate-800 bg-slate-900">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          Date
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1">
        {groups.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-slate-500">
            No imports for this facility yet.
          </div>
        )}
        {groups.map((group) => {
          const expanded = expandedDates.has(group.key);
          return (
            <div key={group.key}>
              <button
                type="button"
                onClick={() => onToggleDate(group.key)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors text-left"
                data-testid={`button-date-group-${group.key}`}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                )}
                <span className="text-sm font-medium text-slate-100 truncate flex-1">
                  {group.label}
                </span>
              </button>
              {expanded && (
                <div className="ml-3 pl-2 border-l border-slate-800 space-y-0.5 mt-0.5">
                  {group.batches.map((b) => {
                    const active = b.batchId === selectedBatchId;
                    return (
                      <button
                        key={b.batchId}
                        type="button"
                        onClick={() => onSelectBatch(b.batchId)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                          active
                            ? "bg-slate-800 ring-1 ring-slate-600"
                            : "hover:bg-slate-800/60"
                        }`}
                        data-testid={`button-batch-node-${b.batchId}`}
                        aria-current={active ? "true" : undefined}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT[b.statusTone]}`}
                        />
                        <span
                          className={`text-xs font-medium truncate flex-1 ${
                            active ? "text-slate-100" : "text-slate-300"
                          }`}
                        >
                          {b.timeLabel}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] ${
                            active ? "text-slate-300" : "text-slate-400"
                          }`}
                        >
                          {b.statusTone === "running" && (
                            <Loader2 className="h-3 w-3 animate-spin text-sky-500" />
                          )}
                          {b.statusLabel}
                          <span className="tabular-nums">· {b.patientCount}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PlexusIQDatePanel;
