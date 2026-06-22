// Backend-pending notice — used across the API Integration Station to
// be explicit that an action / table / panel is wired in the UI but
// has no backend implementation yet.
//
// PHASE 1 SCOPE: every write action in the Integration Station is
// disabled by default. This notice is the SAFE affordance — it tells
// admins that data will populate when the backend ships.

import { Card } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export interface BackendPendingNoticeProps {
  // Headline for the notice (e.g., "Backend endpoint pending").
  title?: string;
  // Specific message about what's not wired yet.
  message: string;
  // Optional inline severity (info vs warning).
  tone?: "info" | "warning";
  // Optional testid suffix for the surrounding card.
  testId?: string;
}

export function BackendPendingNotice({
  title = "Backend endpoint pending",
  message,
  tone = "info",
  testId,
}: BackendPendingNoticeProps) {
  const toneClasses =
    tone === "warning"
      ? "border-amber-200 bg-amber-50/70 text-amber-900"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <Card
      className={`rounded-xl border ${toneClasses} p-4 flex items-start gap-3`}
      data-testid={testId ?? "backend-pending-notice"}
    >
      <AlertCircle
        className={`w-4 h-4 mt-0.5 shrink-0 ${
          tone === "warning" ? "text-amber-600" : "text-slate-500"
        }`}
      />
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight">{title}</div>
        <p className="text-xs mt-1 leading-snug opacity-90">{message}</p>
      </div>
    </Card>
  );
}
