import { useMemo } from "react";
import { AlertTriangle, Home, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CallSettingsMember } from "@/hooks/api/engagementCallSettings";

// Admin roster-wide coverage overview. Inverts member coverage into a
// facility -> members map so admins can spot gaps (a facility nobody covers)
// and overlaps at a glance. Reuses the existing engagement call-settings
// data; no schema change.
//
// Coverage semantics mirror the routing engine
// (server/services/schedulerAutoAssign.ts):
//   - An active member's own roster `facility` is their PRIMARY coverage and
//     counts by default (the routing engine's first-choice match).
//   - `facilitiesCovered` is ADDITIVE — extra facilities the member also
//     covers beyond their home facility.
// A facility is a true "gap" only when no active member has it as their home
// facility AND no active member lists it in facilitiesCovered.

export interface CoverageCoverer {
  member: CallSettingsMember;
  // True when this member covers the facility via their home roster facility
  // (primary), false when via the additive facilitiesCovered allow-list.
  home: boolean;
}

export interface FacilityCoverage {
  facility: string;
  coverers: CoverageCoverer[];
}

// Group case-insensitively but keep the first-seen display label.
export function buildCoverage(members: CallSettingsMember[]): {
  facilities: FacilityCoverage[];
} {
  const labelByKey = new Map<string, string>();
  const coverersByKey = new Map<string, Map<number, CoverageCoverer>>();

  const register = (raw: string | null | undefined): string | null => {
    const name = (raw ?? "").trim();
    if (!name) return null;
    const key = name.toLowerCase();
    if (!labelByKey.has(key)) {
      labelByKey.set(key, name);
      coverersByKey.set(key, new Map());
    }
    return key;
  };

  // Seed the universe of facilities from every member's home facility plus
  // each entry in their facilitiesCovered list (including inactive members),
  // so a clinic that no active member covers still appears as a gap.
  for (const m of members) {
    register(m.facility);
    for (const f of m.facilitiesCovered ?? []) register(f);
  }

  // Assign coverers from ACTIVE members only: home facility (primary) plus
  // facilitiesCovered (additive). Dedup per facility by schedulerId; a home
  // match wins over an additive match for the same member/facility.
  const activeMembers = members.filter((m) => m.active);
  for (const m of activeMembers) {
    const homeKey = register(m.facility);
    if (homeKey) {
      coverersByKey.get(homeKey)!.set(m.schedulerId, { member: m, home: true });
    }
    for (const f of m.facilitiesCovered ?? []) {
      const key = register(f);
      if (!key) continue;
      const bucket = coverersByKey.get(key)!;
      if (!bucket.has(m.schedulerId)) {
        bucket.set(m.schedulerId, { member: m, home: false });
      }
    }
  }

  const facilities: FacilityCoverage[] = Array.from(labelByKey.entries())
    .map(([key, facility]) => ({
      facility,
      coverers: Array.from(coverersByKey.get(key)!.values()).sort((a, b) =>
        a.member.name.localeCompare(b.member.name),
      ),
    }))
    .sort((a, b) => {
      // Gaps first, then alphabetical.
      if ((a.coverers.length === 0) !== (b.coverers.length === 0)) {
        return a.coverers.length === 0 ? -1 : 1;
      }
      return a.facility.localeCompare(b.facility);
    });

  return { facilities };
}

export function CoverageSummary({ members }: { members: CallSettingsMember[] }) {
  const { facilities } = useMemo(() => buildCoverage(members), [members]);

  const gapCount = facilities.filter((f) => f.coverers.length === 0).length;
  const coveredCount = facilities.length - gapCount;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      data-testid="coverage-summary-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <MapPin className="h-4 w-4 text-indigo-500" /> Coverage map
        </h3>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1 text-[10px] text-slate-500 dark:text-slate-400"
            data-testid="coverage-stat-covered"
          >
            <Users className="h-3 w-3" /> {coveredCount} covered
          </Badge>
          <Badge
            className={
              gapCount > 0
                ? "gap-1 bg-rose-100 text-[10px] text-rose-700 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300"
                : "gap-1 bg-emerald-100 text-[10px] text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300"
            }
            data-testid="coverage-stat-gaps"
          >
            <AlertTriangle className="h-3 w-3" /> {gapCount} gap
            {gapCount === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Which facilities each active member covers — their home facility plus any
        extra facilities they cover. Facilities nobody covers are flagged so
        routing gaps are easy to catch.
      </p>

      {facilities.length === 0 ? (
        <div
          className="mt-3 rounded-lg border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400 dark:border-slate-700"
          data-testid="coverage-empty"
        >
          No facilities configured yet. Members' home facilities and "Facilities
          covered" build the coverage map.
        </div>
      ) : (
        <div className="mt-3 space-y-1.5" data-testid="coverage-facility-list">
          {facilities.map((f) => {
            const uncovered = f.coverers.length === 0;
            return (
              <div
                key={f.facility.toLowerCase()}
                className={
                  uncovered
                    ? "flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900/50 dark:bg-rose-950/30"
                    : "flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60"
                }
                data-testid={`coverage-facility-${f.facility.toLowerCase()}`}
              >
                <span
                  className={
                    uncovered
                      ? "min-w-[8rem] text-xs font-semibold text-rose-700 dark:text-rose-300"
                      : "min-w-[8rem] text-xs font-semibold text-slate-700 dark:text-slate-200"
                  }
                >
                  {f.facility}
                </span>
                {uncovered ? (
                  <Badge
                    className="gap-1 bg-rose-100 text-[10px] text-rose-700 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300"
                    data-testid={`coverage-gap-badge-${f.facility.toLowerCase()}`}
                  >
                    <AlertTriangle className="h-3 w-3" /> No coverage
                  </Badge>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {f.coverers.map((c) => (
                      <Badge
                        key={c.member.schedulerId}
                        variant="outline"
                        className="gap-1 text-[10px] font-medium text-slate-600 dark:text-slate-300"
                        data-testid={`coverage-coverer-${f.facility.toLowerCase()}-${c.member.schedulerId}`}
                      >
                        {c.home ? (
                          <Home className="h-2.5 w-2.5 text-indigo-500" />
                        ) : null}
                        {c.member.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
        <Home className="h-2.5 w-2.5 text-indigo-500" /> = home facility · others
        are additional facilities covered
      </p>
    </div>
  );
}
