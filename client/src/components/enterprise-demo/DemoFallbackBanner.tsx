// Demo fallback banner — honest framing for the four PR #294 tiles.
//
// Renders one consistent banner across Mission Control, Imaging
// Central, Clinic Analytics, and Clinic Onboarding so operators
// never read mock data as live production state.
//
// PR #294 is MVP production-readiness ready, not full production
// complete. Until the backend lands, every tile mounts this banner.

import { AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ENTERPRISE_DEMO_FALLBACK_NOTICE } from "@/lib/enterprise-demo/demoMode";

export interface DemoFallbackBannerProps {
  // Optional extra context (e.g., "Mission Control monitoring is read-only
  // until the spine wires real lane data.").
  context?: string;
  // Optional testid suffix.
  testId?: string;
}

export function DemoFallbackBanner({ context, testId }: DemoFallbackBannerProps) {
  return (
    <Card
      className="rounded-xl border-amber-200 bg-amber-50/70 p-3 flex items-start gap-3"
      data-testid={testId ?? "demo-fallback-banner"}
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
      <div className="min-w-0 text-xs leading-snug text-amber-900">
        <span className="font-semibold">{ENTERPRISE_DEMO_FALLBACK_NOTICE}</span>
        {context ? <span className="block mt-0.5 opacity-90">{context}</span> : null}
      </div>
    </Card>
  );
}
