// Admin Review duplicate guard (Batch B8).
//
// Additive surface rendered next to the approve/send control inside
// the existing Admin Review dialog. Does NOT change reasoning,
// evidence, regeneration, or approval logic — only adds a warning
// strip + an optional hard-block when a blocking warning is active.
//
// Callers feed the engine result. Hard-block happens only when the
// dominant warning has severity="block" (DNC or active cooldown).

import { ShieldAlert, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DuplicateWarningBadge } from "@/components/patient-directory/DuplicateWarningBadge";
import type { DuplicateWarningResult } from "@/lib/patientDuplicateWarnings";

type Props = {
  result: DuplicateWarningResult | null | undefined;
  onOpenAudit?: (result: DuplicateWarningResult) => void;
};

export function AdminReviewDuplicateGuard({ result, onOpenAudit }: Props) {
  if (!result || result.warnings.length === 0) return null;
  const blocking = result.blockedFromOutreach;
  return (
    <div
      className={[
        "mt-2 rounded-xl border p-2.5 text-[12px]",
        blocking
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-amber-200 bg-amber-50 text-amber-900",
      ].join(" ")}
      data-testid="admin-review-duplicate-guard"
    >
      <div className="flex items-start gap-2">
        {blocking ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="flex-1 space-y-1">
          <div className="font-semibold">
            {blocking
              ? "Patient is blocked from outreach"
              : "Duplicate / history warning"}
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {result.warnings.map((w, i) => (
              <li key={`${w.kind}-${i}`}>{w.message}</li>
            ))}
          </ul>
          <div className="flex items-center gap-2 pt-1">
            <DuplicateWarningBadge result={result} onOpenAudit={onOpenAudit} variant="compact" />
            {onOpenAudit ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-6 px-1 text-[12px]"
                onClick={() => onOpenAudit(result)}
                data-testid="admin-review-duplicate-open-audit"
              >
                Open audit trail
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Returns true when approval should be hard-blocked. Callers use this
 * to disable the existing approval/send button. Approval logic and
 * regeneration are untouched.
 */
export function isApprovalHardBlocked(result: DuplicateWarningResult | null | undefined): boolean {
  if (!result) return false;
  return result.blockedFromOutreach;
}
