import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { patientScreenings } from "@shared/schema/screening";
import { getTeamMetrics } from "../services/engagement/teamMetricsService";
import { startOfTodayUtc } from "../services/engagement/callSettingsService";
import { listJourneyEvents } from "../repositories/executionCase.repo";

// Engagement Center — Phase 3: Live Team Metrics + Activity Feed (admin-only).
//
// Two read-only endpoints, both derived ONLY from data we already have:
//   • GET /api/engagement/team-metrics  — today's per-member + team rollup
//     (disposition counts from the call log, targets reused from Call
//     Settings, active queue + carryover from the execution-case spine).
//   • GET /api/engagement/activity-feed — a chronological, day-scoped, team-
//     scoped, paginated merge of recent patient-journey events and call-log
//     entries.
//
// Neither endpoint invents RingCentral telemetry. The team-metrics payload is
// explicit that live dial/connect events are not connected
// (ringCentralLiveConnected: false).

type ActivityFeedItem = {
  id: string;
  kind: "journey" | "call";
  at: string; // ISO; never null (used as the pagination cursor anchor)
  title: string;
  detail: string | null;
  patientName: string | null;
  actorName: string | null;
  eventType: string | null;
};

// The activity feed surfaces team CALL/ASSIGNMENT/SCHEDULING activity only —
// not every journey-event type (e.g. document or billing events). We match by
// token so naming variants (scheduler_assigned, engagement_assignment_changed,
// schedule_cancelled, call_result_logged, …) are all included without having to
// enumerate every literal.
const RELEVANT_EVENT_TOKENS = ["call", "assign", "schedul"];

function isRelevantEventType(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return RELEVANT_EVENT_TOKENS.some((tok) => t.includes(tok));
}

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  // Cursor: only return items strictly OLDER than this ISO timestamp.
  before: z.string().datetime().optional(),
});

export function registerEngagementTeamMetricsRoutes(
  app: Express,
  requireRole: (...roles: string[]) => RequestHandler,
) {
  // ─── Live team metrics (admin-only) ─────────────────────────────────────
  app.get(
    "/api/engagement/team-metrics",
    requireRole("admin"),
    async (_req: Request, res: Response) => {
      try {
        const metrics = await getTeamMetrics();
        res.json(metrics);
      } catch (error: unknown) {
        console.error(
          "[engagement/team-metrics:get] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to load team metrics",
          code: "internal_error",
        });
      }
    },
  );

  // ─── Activity feed (admin-only) ─────────────────────────────────────────
  // Day-scoped (today), team-scoped (roster-linked actors), relevant event
  // types only, chronological (newest first), paginated via a `before` cursor.
  app.get(
    "/api/engagement/activity-feed",
    requireRole("admin"),
    async (req: Request, res: Response) => {
      const parsed = feedQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid query",
          code: "bad_request",
        });
      }
      const limit = parsed.data.limit ?? 50;
      const before = parsed.data.before ? new Date(parsed.data.before) : null;

      try {
        const now = new Date();
        const dayStart = startOfTodayUtc(now);
        // Upper bound for both sources: the cursor if paginating, else now.
        const upper = before && before < now ? before : now;

        // Team = roster members linked to a user account. When no roster row
        // is linked to a user (possible in this environment), we cannot
        // attribute activity to a member, so we day-scope only and flag it.
        const schedulers = await storage.getOutreachSchedulers();
        const teamUserIds = Array.from(
          new Set(
            schedulers
              .map((s) => s.userId)
              .filter((id): id is string => !!id),
          ),
        );
        const teamScoped = teamUserIds.length > 0;
        const teamUserIdSet = new Set(teamUserIds);

        const [journey, calls, users] = await Promise.all([
          listJourneyEvents(
            {
              createdAfter: dayStart,
              createdBefore: upper,
              // Restrict to roster actors when we have a mapping.
              ...(teamScoped ? { actorUserIds: teamUserIds } : {}),
            },
            500,
          ),
          storage.listOutreachCallsInRange(dayStart, upper),
          storage.getAllUsers(),
        ]);

        const userNameById = new Map(users.map((u) => [u.id, u.username]));

        // Bulk-resolve patient names for the call rows.
        const screeningIds = Array.from(
          new Set(calls.map((c) => c.patientScreeningId)),
        );
        const nameByScreeningId = new Map<number, string>();
        if (screeningIds.length > 0) {
          const rows = await db
            .select({ id: patientScreenings.id, name: patientScreenings.name })
            .from(patientScreenings)
            .where(inArray(patientScreenings.id, screeningIds));
          for (const r of rows) nameByScreeningId.set(r.id, r.name);
        }

        const journeyItems: ActivityFeedItem[] = journey
          .filter((e) => isRelevantEventType(e.eventType))
          .filter((e) => e.createdAt != null)
          .map((e) => ({
            id: `journey-${e.id}`,
            kind: "journey" as const,
            at: new Date(e.createdAt as unknown as string).toISOString(),
            title: e.summary ?? e.eventType,
            detail: e.eventSource ?? null,
            patientName: e.patientName ?? null,
            actorName: e.actorUserId
              ? userNameById.get(e.actorUserId) ?? null
              : null,
            eventType: e.eventType,
          }));

        const callItems: ActivityFeedItem[] = calls
          // Team-scope calls to roster members when we have a mapping.
          .filter((c) =>
            teamScoped
              ? c.schedulerUserId != null && teamUserIdSet.has(c.schedulerUserId)
              : true,
          )
          .filter((c) => c.startedAt != null)
          .map((c) => ({
            id: `call-${c.id}`,
            kind: "call" as const,
            at: new Date(c.startedAt as unknown as string).toISOString(),
            title: `Call logged — ${c.outcome}`,
            detail: c.notes ?? null,
            patientName: nameByScreeningId.get(c.patientScreeningId) ?? null,
            actorName: c.schedulerUserId
              ? userNameById.get(c.schedulerUserId) ?? null
              : null,
            eventType: c.outcome,
          }));

        // Merge, drop anything at/after the cursor, sort newest-first with a
        // stable tie-breaker (timestamp desc, then id desc) so pagination is
        // deterministic across same-timestamp items.
        const merged = [...journeyItems, ...callItems]
          .filter((it) => (before ? new Date(it.at).getTime() < before.getTime() : true))
          .sort((a, b) => {
            const ta = new Date(a.at).getTime();
            const tb = new Date(b.at).getTime();
            if (tb !== ta) return tb - ta;
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
          });

        const page = merged.slice(0, limit);
        const hasMore = merged.length > limit;
        const nextCursor = hasMore ? page[page.length - 1]?.at ?? null : null;

        res.json({
          items: page,
          limit,
          hasMore,
          nextCursor,
          teamScoped,
          dayStart: dayStart.toISOString(),
          ringCentralLiveConnected: false,
          generatedAt: now.toISOString(),
        });
      } catch (error: unknown) {
        console.error(
          "[engagement/activity-feed:get] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to load activity feed",
          code: "internal_error",
        });
      }
    },
  );
}
