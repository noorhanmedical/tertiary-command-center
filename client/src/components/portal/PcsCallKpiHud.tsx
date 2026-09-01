// PCS call-list KPI HUD — parity with the legacy console's
// FloatingMetricsTile + DailyTargetsTile, rendered compactly at the top of
// the PCS Workspace call-list.
//
// This surface introduces NO new metric system. It reuses:
//   • useEngagementCallSettings() — the canonical server-derived per-member
//     targets (completedCallKpi / scheduledKpi / visit / outreach split).
//   • useOutreachCallsToday(userId) — the member's calls logged today, from
//     which "calls worked / reached / booked / conversion" are derived using
//     the SAME computation the legacy scheduler console used.
//   • DailyTargetsTile + FloatingMetricsTile — the existing presentational
//     tiles, reused as-is.
//
// The member is matched to a Call Settings row by the effective userId
// (the logged-in caller, or the admin's view-as target). When no settings
// row matches (e.g. an unmapped login) the targets tile is simply omitted —
// the live metrics still render.

import { useMemo } from "react";
import { useOutreachCallsToday } from "@/hooks/api/outreach";
import { useEngagementCallSettings } from "@/hooks/api/engagementCallSettings";
import { FloatingMetricsTile } from "@/components/outreach/FloatingMetricsTile";
import { DailyTargetsTile } from "@/components/outreach/DailyTargetsTile";

// Outcomes that count as "reached" — mirrors the legacy scheduler console's
// reachedCount derivation so the HUD reports the same numbers.
const REACHED_OUTCOMES = new Set([
  "reached",
  "scheduled",
  "callback",
  "declined",
  "not_interested",
  "language_barrier",
]);

export function PcsCallKpiHud({
  memberUserId,
}: {
  /** Effective member user id: the logged-in caller, or the admin's
   *  view-as target. Null disables the today's-calls query. */
  memberUserId: string | null;
}) {
  const { data: todayCalls = [] } = useOutreachCallsToday(memberUserId);
  const { data: callSettings } = useEngagementCallSettings();

  const metrics = useMemo(() => {
    const callsMade = todayCalls.length;
    const reachedCount = todayCalls.filter((c) =>
      REACHED_OUTCOMES.has(c.outcome),
    ).length;
    const scheduledFromCalls = todayCalls.filter(
      (c) => c.outcome === "scheduled",
    ).length;
    const conversionPct =
      callsMade === 0 ? 0 : Math.round((scheduledFromCalls / callsMade) * 100);
    return { callsMade, reachedCount, scheduledFromCalls, conversionPct };
  }, [todayCalls]);

  // Match the member to a canonical Call Settings row by userId. Values are
  // NEVER recomputed here — the server-derived targets pass straight through.
  const targets = useMemo(() => {
    if (!memberUserId || !callSettings?.members) return null;
    const member = callSettings.members.find((m) => m.userId === memberUserId);
    if (!member) return null;
    return {
      completedCallKpi: member.completedCallKpi,
      scheduledKpi: member.scheduledKpi,
      visitTarget: member.visitTarget,
      outreachTarget: member.outreachTarget,
    };
  }, [memberUserId, callSettings]);

  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-2"
      data-testid="pcs-call-kpi-hud"
    >
      <FloatingMetricsTile
        callsMade={metrics.callsMade}
        reachedCount={metrics.reachedCount}
        scheduledFromCalls={metrics.scheduledFromCalls}
        conversionPct={metrics.conversionPct}
        callbacksDue={0}
      />
      {targets ? (
        <DailyTargetsTile
          completedCallKpi={targets.completedCallKpi}
          scheduledKpi={targets.scheduledKpi}
          visitTarget={targets.visitTarget}
          outreachTarget={targets.outreachTarget}
          callsDone={metrics.callsMade}
          scheduledDone={metrics.scheduledFromCalls}
        />
      ) : null}
    </div>
  );
}
