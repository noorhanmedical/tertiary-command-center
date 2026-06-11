// Run comparison selector (Batch B6).
//
// Additive control rendered inside the existing Plexus IQ workspace
// area. Lets the user pick which prior runs the duplicate-warning
// engine compares against:
//   - Select a single parent date (all runs that date)
//   - Select one specific run
//   - Multi-select runs across dates
//   - Select All
//   - Clear
//   - Toggle ascending / descending date order
//
// Uses the qualification run ordering helper (B2). Returns the
// RunSelection payload via onChange so callers feed it directly to
// computeDuplicateWarnings.

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  buildQualificationGroups,
  selectAllRuns,
  selectByDate,
  selectByRuns,
  selectNoRuns,
  type RunSelection,
  type RunSourceRow,
  type QualificationDateGroup,
} from "@/lib/qualificationRunOrdering";

type Props = {
  priorRunRoster: ReadonlyArray<RunSourceRow>;
  selection: RunSelection;
  onChange: (s: RunSelection) => void;
};

export function RunComparisonSelector({ priorRunRoster, selection, onChange }: Props) {
  const [dateOrder, setDateOrder] = useState<"desc" | "asc">("desc");
  const groups: ReadonlyArray<QualificationDateGroup> = useMemo(
    () => buildQualificationGroups(priorRunRoster, { dateOrder, runOrder: "desc" }),
    [priorRunRoster, dateOrder],
  );

  const isAll = selection.kind === "all";
  const isNone = selection.kind === "none";
  const selectedRunIds = selection.kind === "runs" ? new Set(selection.runIds) : new Set<number>();
  const selectedDateKey = selection.kind === "date" ? selection.parentDateKey : null;

  function toggleRun(runId: number) {
    const next = new Set(selectedRunIds);
    if (next.has(runId)) next.delete(runId); else next.add(runId);
    onChange(next.size === 0 ? selectNoRuns() : selectByRuns([...next]));
  }

  function toggleDate(dateKey: string) {
    if (selectedDateKey === dateKey) onChange(selectNoRuns());
    else onChange(selectByDate(dateKey));
  }

  return (
    <Card className="p-3 bg-white" data-testid="run-comparison-selector">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">Compare against prior runs</div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDateOrder((o) => (o === "desc" ? "asc" : "desc"))}
            data-testid="run-comparison-toggle-order"
          >
            {dateOrder === "desc" ? "Newest first" : "Oldest first"}
          </Button>
          <Button
            type="button"
            variant={isAll ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(isAll ? selectNoRuns() : selectAllRuns())}
            data-testid="run-comparison-select-all"
          >
            {isAll ? "Selected: all" : "Select all"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(selectNoRuns())}
            data-testid="run-comparison-clear"
          >
            Clear
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="py-4 text-center text-xs text-slate-500" data-testid="run-comparison-empty">
          No prior runs available yet.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="run-comparison-list">
          {groups.map((g) => {
            const isDate = selectedDateKey === g.parentDateKey;
            return (
              <li
                key={g.parentDateKey}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5"
                data-testid={`run-comparison-date-${g.parentDateKey}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className={`text-left text-[12px] font-medium ${isDate ? "text-indigo-700" : "text-slate-800"}`}
                    onClick={() => toggleDate(g.parentDateKey)}
                    data-testid={`run-comparison-date-toggle-${g.parentDateKey}`}
                  >
                    {g.parentDateLabel}
                    <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                      {g.runs.length} run{g.runs.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {isDate ? <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">Selected</Badge> : null}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {g.runs.map((r) => {
                    const checked = isAll || isDate || selectedRunIds.has(r.runId);
                    return (
                      <li
                        key={r.runId}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1"
                        data-testid={`run-comparison-run-${r.runId}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleRun(r.runId)}
                          aria-label={r.runLabel}
                          data-testid={`run-comparison-run-checkbox-${r.runId}`}
                        />
                        <div className="flex-1">
                          <div className="text-[12px] text-slate-700">{r.runLabel}</div>
                          <div className="text-[11px] text-slate-500">
                            {r.patientCount} patient{r.patientCount === 1 ? "" : "s"}
                            {r.outreachCount > 0 ? ` · outreach ${r.outreachCount}` : ""}
                            {r.visitCount > 0 ? ` · visit ${r.visitCount}` : ""}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
