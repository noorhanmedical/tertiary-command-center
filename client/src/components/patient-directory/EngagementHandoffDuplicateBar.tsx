// Engagement + Team Portal duplicate warning bar (Batch B9).
//
// Read-only banner rendered at the top of an Engagement handoff
// confirmation surface or above a Team Portal patient card. Does not
// write anything; opens the audit modal on click.

import { AlertTriangle } from "lucide-react";
import { DuplicateWarningBadge } from "@/components/patient-directory/DuplicateWarningBadge";
import type { DuplicateWarningResult } from "@/lib/patientDuplicateWarnings";

type Props = {
  results: ReadonlyArray<DuplicateWarningResult>;
  onOpenAudit?: (result: DuplicateWarningResult) => void;
  title?: string;
};

export function EngagementHandoffDuplicateBar({
  results,
  onOpenAudit,
  title = "Patient Directory warnings",
}: Props) {
  const flagged = results.filter((r) => r.warnings.length > 0);
  if (flagged.length === 0) return null;
  const blockedCount = flagged.filter((r) => r.blockedFromOutreach).length;
  return (
    <div
      className={[
        "rounded-xl border p-3 text-[12px]",
        blockedCount > 0
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-amber-200 bg-amber-50 text-amber-900",
      ].join(" ")}
      data-testid="engagement-handoff-duplicate-bar"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <div className="font-semibold">
          {title} — {flagged.length} flagged{blockedCount > 0 ? ` (${blockedCount} blocked)` : ""}
        </div>
      </div>
      <ul className="mt-2 space-y-1">
        {flagged.map((r) => (
          <li
            key={r.patientScreeningId}
            className="flex items-center gap-2"
            data-testid={`engagement-handoff-duplicate-row-${r.patientScreeningId}`}
          >
            <span className="truncate">{r.patientName}</span>
            <DuplicateWarningBadge result={r} onOpenAudit={onOpenAudit} variant="compact" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Convenience: count of patients flagged with any warning. */
export function flaggedCount(results: ReadonlyArray<DuplicateWarningResult>): number {
  return results.filter((r) => r.warnings.length > 0).length;
}

/** Convenience: count of patients with a blocking warning. */
export function blockedCount(results: ReadonlyArray<DuplicateWarningResult>): number {
  return results.filter((r) => r.blockedFromOutreach).length;
}
