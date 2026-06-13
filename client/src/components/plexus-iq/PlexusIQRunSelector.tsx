// Compact run selector (hotfix) — replaces the giant
// PlexusIQRunOrganizationPanel. Rendered inside the existing date
// card / row so multiple qualification runs on the same (facility,
// date) collapse into one card with compact run rows underneath.
//
// Behavior pinned by the hotfix brief:
//   - Most recent run is the default active run
//   - Clicking a run sets the active run for the card
//   - Optional explicit "All runs for this date" row (NOT default)
//   - Compact compare-against-prior-runs chip per run row
//   - Run labels: "Run N - h:mm AM/PM"

import { ChevronRight, GitCompare } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type PlexusIQRunSibling = {
  batchId: number;
  /** Stable run index within the sibling set, 1-based, chronological asc. */
  runNumber: number;
  /** ISO timestamp of when this run was created. */
  createdAt: string;
  patientCount: number;
};

type Props = {
  /** Sibling runs for one (facility, scheduleDate) bucket. Sorted ascending so the highest
   *  index is the latest. The component renders them latest-first. */
  siblings: ReadonlyArray<PlexusIQRunSibling>;
  /** Currently selected batch id; null means "all runs explicitly". */
  selectedBatchId: number | null;
  /** Whether the explicit "all runs for this date" mode is active. */
  allRunsMode: boolean;
  /** Fired when a specific run is picked. */
  onSelectRun: (batchId: number) => void;
  /** Fired when the explicit "all runs" row is picked. */
  onSelectAllRuns: () => void;
  /** Fired by the per-row Compare chip. */
  onCompareRun?: (batchId: number) => void;
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function PlexusIQRunSelector({
  siblings,
  selectedBatchId,
  allRunsMode,
  onSelectRun,
  onSelectAllRuns,
  onCompareRun,
}: Props) {
  // Always render even for single-run buckets — keeps the run label
  // visible above the patient list. Compact horizontal pill rail
  // replaces the prior stacked panel; same handlers, same testids.
  const sortedDesc = siblings.slice().sort((a, b) => b.runNumber - a.runNumber);

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto px-1 py-1"
      data-testid="plexus-iq-run-selector"
    >
      {sortedDesc.map((s) => {
        const active = !allRunsMode && s.batchId === selectedBatchId;
        return (
          <div
            key={s.batchId}
            className="inline-flex items-center gap-1 shrink-0"
            data-testid={`plexus-iq-run-row-${s.batchId}`}
          >
            <button
              type="button"
              onClick={() => onSelectRun(s.batchId)}
              className={[
                "inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors whitespace-nowrap",
                active
                  ? "bg-[#EFF6FF] text-[#1D4ED8] ring-1 ring-[#1D4ED8]/30"
                  : "text-[#475467] hover:bg-[#F8F9FB]",
              ].join(" ")}
              data-testid={`plexus-iq-run-pick-${s.batchId}`}
              title={`Run ${s.runNumber} · ${timeLabel(s.createdAt)} · ${s.patientCount} patient${s.patientCount === 1 ? "" : "s"}`}
            >
              <ChevronRight className={`h-3 w-3 ${active ? "text-[#1D4ED8]" : "text-[#9AA3B2]"}`} />
              <span className="font-medium">Run {s.runNumber}</span>
              <span className="text-[#9AA3B2] tabular-nums">{timeLabel(s.createdAt)}</span>
              <span className="text-[#9AA3B2] tabular-nums">· {s.patientCount}</span>
              {active ? (
                <Badge variant="secondary" className="bg-[#1D4ED8]/10 text-[#1D4ED8] text-[10px] px-1 py-0">
                  Active
                </Badge>
              ) : null}
            </button>
            {onCompareRun ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCompareRun(s.batchId);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#475467] hover:bg-[#F8F9FB]"
                data-testid={`plexus-iq-run-compare-${s.batchId}`}
                title="Compare against prior runs"
              >
                <GitCompare className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
      {siblings.length > 1 ? (
        <div
          className="inline-flex items-center shrink-0"
          data-testid="plexus-iq-run-all"
        >
          <button
            type="button"
            onClick={onSelectAllRuns}
            className={[
              "inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors whitespace-nowrap",
              allRunsMode
                ? "bg-[#FFFBEB] text-[#B45309] ring-1 ring-[#B45309]/30"
                : "text-[#475467] hover:bg-[#F8F9FB]",
            ].join(" ")}
            data-testid="plexus-iq-run-all-pick"
          >
            <ChevronRight className={`h-3 w-3 ${allRunsMode ? "text-[#B45309]" : "text-[#9AA3B2]"}`} />
            <span className="font-medium">All runs</span>
            {allRunsMode ? (
              <Badge variant="secondary" className="bg-[#B45309]/10 text-[#B45309] text-[10px] px-1 py-0">
                Active
              </Badge>
            ) : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Helper exported so callers can compute the default sibling roster.
export type PlexusIQSiblingGroup = {
  groupKey: string;
  facility: string;
  scheduleDate: string | null;
  siblings: PlexusIQRunSibling[];
};

export function buildSiblingGroups<T extends { facility: string | null; scheduleDate: string | null; batchId: number; batchCreatedAt: string; patientCount: number }>(
  rows: ReadonlyArray<T>,
): ReadonlyArray<PlexusIQSiblingGroup> {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    const key = `${r.facility ?? "Unassigned"}::${r.scheduleDate ?? "no-date"}`;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const out: PlexusIQSiblingGroup[] = [];
  for (const [groupKey, list] of buckets.entries()) {
    const sortedAsc = list.slice().sort((a, b) =>
      new Date(a.batchCreatedAt).getTime() - new Date(b.batchCreatedAt).getTime()
      || a.batchId - b.batchId,
    );
    const siblings: PlexusIQRunSibling[] = sortedAsc.map((r, idx) => ({
      batchId: r.batchId,
      runNumber: idx + 1,
      createdAt: r.batchCreatedAt,
      patientCount: r.patientCount,
    }));
    const first = sortedAsc[0];
    out.push({
      groupKey,
      facility: first.facility ?? "Unassigned",
      scheduleDate: first.scheduleDate,
      siblings,
    });
  }
  return out;
}
