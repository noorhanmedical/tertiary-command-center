import { and, eq, lt, or, isNull, isNotNull, count, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  patientExecutionCases,
  ptoRequests,
  appSettings,
  DEFAULT_GLOBAL_CALL_CONFIG,
  DEFAULT_WORKDAY_TIERS,
  ENGAGEMENT_CALL_CONFIG_KEY,
  ENGAGEMENT_WORKDAY_TIERS_KEY,
  globalCallConfigSchema,
  workdayTiersSchema,
  type GlobalCallConfig,
  type WorkdayTier,
  type RoundingMode,
} from "@shared/schema";

// ─── Pure target math ───────────────────────────────────────────────────────
//
// All Engagement Call Settings targets are DERIVED from the persisted inputs +
// the admin-configurable global config and workday-tier table, so the math is a
// single source of truth (never stored, never drifts).
//
// Priority order (Configurable Call Settings):
//   • completed-call KPI: explicit member override → matching workday tier →
//     global full-day target × workday % (rounded with the configured mode).
//   • scheduled KPI: explicit member override → completed KPI × scheduled
//     target % (rounded with the configured mode).
//   • visit/outreach: per-member visit % → global default; outreach target =
//     completed KPI − visit target, so the split ALWAYS sums to the completed
//     KPI (and visit % + outreach % always = 100).
//
// The rounding mode (round / floor / ceil) is admin-configurable and applies to
// every formula-derived value (it does not change exact tier or explicit
// overrides, which are already integers).

export interface CallSettingsInputs {
  callWorkdayPercent: number;
  // Per-member visit %. Null/undefined → use the global default.
  visitPercent?: number | null;
  // Per-member explicit overrides (highest priority). Null → derive.
  explicitCompletedKpi?: number | null;
  explicitScheduledKpi?: number | null;
  maxDailyCapacity?: number | null;
}

export interface CallTargets {
  completedCallKpi: number;
  scheduledKpi: number;
  visitTarget: number;
  outreachTarget: number;
  maxDailyCapacity: number;
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function applyRounding(value: number, mode: RoundingMode): number {
  if (!Number.isFinite(value)) return 0;
  switch (mode) {
    case "floor":
      return Math.floor(value);
    case "ceil":
      return Math.ceil(value);
    case "round":
    default:
      return Math.round(value);
  }
}

// Look up the completed-call KPI for an exact workday-% match in the tier
// table. Returns null when no tier matches (caller falls back to the formula).
export function lookupTierKpi(
  tiers: WorkdayTier[],
  workdayPercent: number,
): number | null {
  const wd = clampPercent(workdayPercent);
  const match = tiers.find((t) => clampPercent(t.workdayPercent) === wd);
  return match ? Math.max(0, Math.floor(match.completedKpi)) : null;
}

export function computeCallTargets(
  input: CallSettingsInputs,
  config: GlobalCallConfig = DEFAULT_GLOBAL_CALL_CONFIG,
  tiers: WorkdayTier[] = DEFAULT_WORKDAY_TIERS,
): CallTargets {
  const mode = config.roundingMode;
  const workday = clampPercent(input.callWorkdayPercent);
  const visitPct = clampPercent(
    input.visitPercent ?? config.defaultVisitPercent,
  );
  const scheduledPct = clampPercent(config.scheduledKpiPercent);
  const fullDay = Math.max(0, Math.floor(config.fullDayCompletedTarget || 0));

  // completed-call KPI: explicit → tier → formula.
  let completedCallKpi: number;
  if (input.explicitCompletedKpi != null && input.explicitCompletedKpi >= 0) {
    completedCallKpi = Math.floor(input.explicitCompletedKpi);
  } else {
    const tierKpi = lookupTierKpi(tiers, workday);
    completedCallKpi =
      tierKpi != null
        ? tierKpi
        : Math.max(0, applyRounding((fullDay * workday) / 100, mode));
  }

  // scheduled KPI: explicit → formula.
  const scheduledKpi =
    input.explicitScheduledKpi != null && input.explicitScheduledKpi >= 0
      ? Math.floor(input.explicitScheduledKpi)
      : Math.max(0, applyRounding((completedCallKpi * scheduledPct) / 100, mode));

  // visit/outreach split — outreach is the remainder so the split always sums
  // exactly to the completed-call KPI.
  const visitTarget = Math.min(
    completedCallKpi,
    Math.max(0, applyRounding((completedCallKpi * visitPct) / 100, mode)),
  );
  const outreachTarget = Math.max(0, completedCallKpi - visitTarget);
  const maxDailyCapacity =
    input.maxDailyCapacity != null && input.maxDailyCapacity >= 0
      ? input.maxDailyCapacity
      : completedCallKpi;

  return {
    completedCallKpi,
    scheduledKpi,
    visitTarget,
    outreachTarget,
    maxDailyCapacity,
  };
}

// ─── Global config + workday tiers persistence (app_settings JSON) ───────────
//
// Stored as JSON strings in the key-value app_settings table so the whole
// distribution model is admin-editable without code/schema changes. Defaults
// are applied (and individual fields back-filled) whenever a key is unset or
// malformed, so reads never throw and always return a complete config.

export interface ResolvedGlobalConfig {
  config: GlobalCallConfig;
  tiers: WorkdayTier[];
}

function parseConfig(raw: string | null): GlobalCallConfig {
  if (!raw) return DEFAULT_GLOBAL_CALL_CONFIG;
  try {
    const parsed = globalCallConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_GLOBAL_CALL_CONFIG;
  } catch {
    return DEFAULT_GLOBAL_CALL_CONFIG;
  }
}

function parseTiers(raw: string | null): WorkdayTier[] {
  if (!raw) return DEFAULT_WORKDAY_TIERS;
  try {
    const parsed = workdayTiersSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_WORKDAY_TIERS;
    return sortTiers(parsed.data);
  } catch {
    return DEFAULT_WORKDAY_TIERS;
  }
}

// Highest workday % first, so the UI and any lookups read top-down.
export function sortTiers(tiers: WorkdayTier[]): WorkdayTier[] {
  return [...tiers].sort((a, b) => b.workdayPercent - a.workdayPercent);
}

export async function getGlobalCallConfig(): Promise<ResolvedGlobalConfig> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(
      inArray(appSettings.key, [
        ENGAGEMENT_CALL_CONFIG_KEY,
        ENGAGEMENT_WORKDAY_TIERS_KEY,
      ]),
    );
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    config: parseConfig(byKey.get(ENGAGEMENT_CALL_CONFIG_KEY) ?? null),
    tiers: parseTiers(byKey.get(ENGAGEMENT_WORKDAY_TIERS_KEY) ?? null),
  };
}

export async function saveGlobalCallConfig(
  config: GlobalCallConfig,
  tiers: WorkdayTier[],
): Promise<ResolvedGlobalConfig> {
  const sorted = sortTiers(tiers);
  await db
    .insert(appSettings)
    .values([
      {
        key: ENGAGEMENT_CALL_CONFIG_KEY,
        value: JSON.stringify(config),
      },
      {
        key: ENGAGEMENT_WORKDAY_TIERS_KEY,
        value: JSON.stringify(sorted),
      },
    ])
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sql`excluded.value` },
    });
  return { config, tiers: sorted };
}

export function remainingCapacity(
  completedCallKpi: number,
  carryover: number,
): number {
  return Math.max(0, completedCallKpi - Math.max(0, carryover));
}

// ─── Carryover (active incomplete work from prior days) ──────────────────────
//
// Carryover = active execution cases assigned to a team member that still
// need a call/follow-up AND are due (or were created) before today. We
// exclude any case that no longer needs call action: completed, scheduled,
// cancelled, archived, closed. Counted per assigned team member.
const CARRYOVER_EXCLUDED_ENGAGEMENT_STATUSES = [
  "completed",
  "scheduled",
  "cancelled",
  "archived",
  "closed",
];

export function startOfTodayUtc(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getCarryoverCounts(
  schedulerIds: number[],
  startOfToday: Date = startOfTodayUtc(),
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (schedulerIds.length === 0) return result;

  const rows = await db
    .select({
      schedulerId: patientExecutionCases.assignedTeamMemberId,
      n: count(),
    })
    .from(patientExecutionCases)
    .where(
      and(
        isNotNull(patientExecutionCases.assignedTeamMemberId),
        inArray(patientExecutionCases.assignedTeamMemberId, schedulerIds),
        eq(patientExecutionCases.lifecycleStatus, "active"),
        sql`${patientExecutionCases.engagementStatus} NOT IN (${sql.join(
          CARRYOVER_EXCLUDED_ENGAGEMENT_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        or(
          and(
            isNotNull(patientExecutionCases.nextActionAt),
            lt(patientExecutionCases.nextActionAt, startOfToday),
          ),
          and(
            isNull(patientExecutionCases.nextActionAt),
            lt(patientExecutionCases.createdAt, startOfToday),
          ),
        ),
      ),
    )
    .groupBy(patientExecutionCases.assignedTeamMemberId);

  for (const r of rows) {
    if (r.schedulerId != null) result.set(r.schedulerId, Number(r.n));
  }
  return result;
}

// ─── Platform-calendar working status (PTO + roster) ─────────────────────────
//
// There is no positive shift-calendar source yet (TeamOps treats coverage as
// full clinic hours), so we derive working-today honestly from the real
// platform signals we DO have: approved PTO (absence) and roster presence.
//   • Approved PTO covering today  → calendarWorkingToday = false (status "pto")
//   • Roster member with a user id → calendarWorkingToday = true  (status "working")
//   • No linked user id            → calendarWorkingToday = null  (status "unavailable")
// No Google Calendar anywhere. The admin manual override always wins.
export type CalendarStatus = "working" | "pto" | "unavailable";

export interface WorkingStatus {
  calendarWorkingToday: boolean | null;
  calendarStatus: CalendarStatus;
  ptoToday: boolean;
}

export async function getPtoUserIdsForToday(
  userIds: string[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<Set<string>> {
  const out = new Set<string>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: ptoRequests.userId })
    .from(ptoRequests)
    .where(
      and(
        inArray(ptoRequests.userId, userIds),
        eq(ptoRequests.status, "approved"),
        sql`${ptoRequests.startDate} <= ${today}`,
        sql`${ptoRequests.endDate} >= ${today}`,
      ),
    );
  for (const r of rows) {
    if (r.userId) out.add(r.userId);
  }
  return out;
}

export function deriveWorkingStatus(
  userId: string | null | undefined,
  ptoUserIds: Set<string>,
): WorkingStatus {
  const ptoToday = !!userId && ptoUserIds.has(userId);
  if (ptoToday) {
    return { calendarWorkingToday: false, calendarStatus: "pto", ptoToday: true };
  }
  if (userId) {
    return {
      calendarWorkingToday: true,
      calendarStatus: "working",
      ptoToday: false,
    };
  }
  return {
    calendarWorkingToday: null,
    calendarStatus: "unavailable",
    ptoToday: false,
  };
}

export function resolveWorkingToday(
  manualWorkingToday: boolean | null | undefined,
  calendarWorkingToday: boolean | null,
): boolean {
  if (manualWorkingToday != null) return manualWorkingToday;
  // No manual override: trust the calendar; default to working when the
  // calendar can't tell us (so distribution is never silently blocked).
  return calendarWorkingToday ?? true;
}
