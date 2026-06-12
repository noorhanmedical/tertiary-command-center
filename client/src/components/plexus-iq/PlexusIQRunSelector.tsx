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
  // visible above the patient list.
  const sortedDesc = siblings.slice().sort((a, b) => b.runNumber - a.runNumber);

  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50/70 p-1.5"
      data-testid="plexus-iq-run-selector"
    >
      <ul className="space-y-1">
        {sortedDesc.map((s) => {
          const active = !allRunsMode && s.batchId === selectedBatchId;
          return (
            <li
              key={s.batchId}
              className={[
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                active
                  ? "bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-indigo-200"
                  : "hover:bg-white",
              ].join(" ")}
              data-testid={`plexus-iq-run-row-${s.batchId}`}
            >
              <button
                type="button"
                onClick={() => onSelectRun(s.batchId)}
                className="flex flex-1 items-center gap-2 text-left"
                data-testid={`plexus-iq-run-pick-${s.batchId}`}
              >
                <ChevronRight className={`h-3 w-3 ${active ? "text-indigo-600" : "text-slate-400"}`} />
                <span className="font-medium text-slate-800">
                  Run {s.runNumber} - {timeLabel(s.createdAt)}
                </span>
                <span className="text-[11px] text-slate-500">
                  {s.patientCount} patient{s.patientCount === 1 ? "" : "s"}
                </span>
                {active ? (
                  <Badge variant="secondary" className="bg-indigo-100 text-indigo-700 text-[10px]">
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
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                  data-testid={`plexus-iq-run-compare-${s.batchId}`}
                  title="Compare against prior runs"
                >
                  <GitCompare className="h-3 w-3" />
                  Compare
                </button>
              ) : null}
            </li>
          );
        })}
        {siblings.length > 1 ? (
          <li
            className={[
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors",
              allRunsMode
                ? "bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-amber-200"
                : "hover:bg-white",
            ].join(" ")}
            data-testid="plexus-iq-run-all"
          >
            <button
              type="button"
              onClick={onSelectAllRuns}
              className="flex flex-1 items-center gap-2 text-left"
              data-testid="plexus-iq-run-all-pick"
            >
              <ChevronRight className={`h-3 w-3 ${allRunsMode ? "text-amber-600" : "text-slate-400"}`} />
              <span className="font-medium text-slate-800">All runs for this date</span>
              <span className="text-[10px] italic text-slate-500">explicit only</span>
              {allRunsMode ? (
                <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-[10px]">
                  Active
                </Badge>
              ) : null}
            </button>
          </li>
        ) : null}
      </ul>
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
