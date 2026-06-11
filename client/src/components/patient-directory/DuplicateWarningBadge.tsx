// Duplicate warning badge (Batch B7).
//
// Reusable, additive UI rendered next to a patient name on every
// surface where the duplicate-warning engine ran:
//   - Plexus IQ qualification cards / bars
//   - Admin Review dialog header + approval control
//   - Engagement handoff + Team Portal call list rows
//
// Click opens the Patient Audit Trail modal via onOpenAudit so the
// reader sees the full prior context without leaving the page.

import { AlertTriangle, ShieldAlert, Clock4, History, FileWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  DuplicateWarning,
  DuplicateWarningResult,
} from "@/lib/patientDuplicateWarnings";

type Props = {
  result: DuplicateWarningResult | null | undefined;
  onOpenAudit?: (result: DuplicateWarningResult) => void;
  align?: "left" | "right";
  variant?: "inline" | "compact";
};

const ICON_BY_KIND: Record<DuplicateWarning["kind"], React.ComponentType<{ className?: string }>> = {
  matched_prior_run: History,
  previously_sent_to_engagement: AlertTriangle,
  do_not_contact: ShieldAlert,
  active_cooldown: Clock4,
  expired_cooldown_historical: Clock4,
  prior_ancillary_test: FileWarning,
};

const CLASS_BY_SEVERITY: Record<DuplicateWarning["severity"], string> = {
  info: "bg-slate-100 text-slate-700 border-slate-200",
  warn: "bg-amber-100 text-amber-800 border-amber-200",
  block: "bg-rose-100 text-rose-800 border-rose-200",
};

export function DuplicateWarningBadge({
  result,
  onOpenAudit,
  align = "left",
  variant = "inline",
}: Props) {
  if (!result || result.warnings.length === 0) return null;
  const dominant = result.warnings.find((w) => w.severity === "block")
    ?? result.warnings.find((w) => w.severity === "warn")
    ?? result.warnings[0];
  const Icon = ICON_BY_KIND[dominant.kind] ?? AlertTriangle;
  const cls = CLASS_BY_SEVERITY[dominant.severity];

  const label = (() => {
    if (result.blockedFromOutreach) return "Blocked";
    if (result.warnings.length === 1) return labelFor(dominant);
    return `${result.warnings.length} warnings`;
  })();

  const tooltip = (
    <div className="max-w-xs space-y-1.5">
      {result.warnings.map((w, i) => (
        <div key={`${w.kind}-${i}`} className="text-[12px]">
          <div className="font-semibold">{labelFor(w)}</div>
          <div className="text-[11px] text-slate-200/90">{w.message}</div>
          {w.helpText ? <div className="text-[11px] text-slate-300/80">{w.helpText}</div> : null}
        </div>
      ))}
      {onOpenAudit ? <div className="pt-1 text-[11px] text-indigo-200">Click to view audit trail</div> : null}
    </div>
  );

  const inner = (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold leading-none",
        cls,
        variant === "compact" ? "px-1 text-[10px]" : "",
      ].join(" ")}
      data-testid={`duplicate-warning-badge-${result.patientScreeningId}`}
    >
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </span>
  );

  const node = onOpenAudit ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={[
        "h-6 rounded-full px-1.5 py-0",
        align === "right" ? "ml-auto" : "",
      ].join(" ")}
      onClick={() => onOpenAudit(result)}
      aria-label="Open patient audit trail"
      data-testid={`duplicate-warning-button-${result.patientScreeningId}`}
    >
      {inner}
    </Button>
  ) : (
    inner
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="top" align={align === "right" ? "end" : "start"} className="bg-slate-900 text-slate-50">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function labelFor(w: DuplicateWarning): string {
  switch (w.kind) {
    case "matched_prior_run": return "Prior run match";
    case "previously_sent_to_engagement": return "Previously sent";
    case "do_not_contact": return "Do Not Contact";
    case "active_cooldown": return "Active cooldown";
    case "expired_cooldown_historical": return "Prior cooldown";
    case "prior_ancillary_test": return "Prior ancillary";
    default: return "Warning";
  }
}

// Read-only inline summary used when a row needs the warnings shown
// statically (no audit modal hook). Renders one chip per warning.
export function DuplicateWarningSummary({ result }: { result: DuplicateWarningResult | null | undefined }) {
  if (!result || result.warnings.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid={`duplicate-warning-summary-${result.patientScreeningId}`}>
      {result.warnings.map((w, i) => (
        <Badge
          key={`${w.kind}-${i}`}
          variant="secondary"
          className={[
            "border text-[10px] font-semibold",
            CLASS_BY_SEVERITY[w.severity],
          ].join(" ")}
        >
          {labelFor(w)}
        </Badge>
      ))}
    </div>
  );
}
