// Operational queue — additive read-only route (Batch 11b).
//
// Adds GET /api/operational-queue/me as an additive endpoint that surfaces
// the unified work queue across the four operational sources for the
// currently-authenticated user (call list + scheduler tasks + visit
// appointments + global-calendar events).
//
// Auth: global requireAuth middleware (mounted at /api in server/routes.ts)
//       already gates this route. Session user id is read from
//       req.session.userId.
//
// This endpoint is INTENTIONALLY ADDITIVE: every existing portal endpoint
// (/api/portal/today-schedule, /api/portal/outreach-call-list,
//  /api/plexus/tasks/my-work, /api/global-schedule-events, …) continues to
// register and serve traffic unchanged. The Scheduler Portal, Team Portals,
// global calendar, and Plexus IQ calendar UIs are NOT switched to this
// endpoint in this batch.
//
// See docs/architecture/operational-queue-design.md §7 for the multi-phase
// cutover plan that consumes this endpoint in later batches (11d–11f).

import type { Express } from "express";
import {
  OPERATIONAL_QUEUE_ITEM_KINDS,
  getOperationalQueueForUser,
  type OperationalQueueItemKind,
} from "../modules/operational-queue";

const VALID_KIND_SET = new Set<string>(OPERATIONAL_QUEUE_ITEM_KINDS);

function parseDateString(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  // Accept only ISO YYYY-MM-DD to keep the query semantics deterministic
  // across timezones; route does not attempt to parse other formats.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
}

function parseKinds(raw: string | undefined): OperationalQueueItemKind[] | undefined {
  if (!raw) return undefined;
  const tokens = String(raw)
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  const out: OperationalQueueItemKind[] = [];
  for (const t of tokens) {
    if (VALID_KIND_SET.has(t)) {
      out.push(t as OperationalQueueItemKind);
    }
  }
  return out.length > 0 ? out : undefined;
}

function clampPerSourceLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, 1000);
}

export function registerOperationalQueueRoutes(app: Express) {
  // GET /api/operational-queue/me
  //
  // Query params (all optional):
  //   - facility             facility text (must match the per-source rules)
  //   - dateFrom, dateTo     ISO date strings (YYYY-MM-DD)
  //   - includeClosed        "1" / "true" to include closed/terminal items
  //   - kinds                comma-separated subset of:
  //                          call_list_item, scheduler_task,
  //                          visit_appointment, global_calendar_event
  //   - perSourceLimit       per-source limit override (1–1000)
  //
  // Response shape: { items: OperationalQueueItem[] }
  //
  // This handler does NOT mutate any row. It is the read side only.
  app.get("/api/operational-queue/me", async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        // Global requireAuth should catch this, but defend explicitly to
        // avoid a confusing 500 if the middleware is ever bypassed.
        return res.status(401).json({ error: "Not authenticated" });
      }

      const q = req.query as Record<string, string | undefined>;
      const includeClosedRaw = q.includeClosed;
      const includeClosed =
        includeClosedRaw === "1" ||
        includeClosedRaw === "true" ||
        includeClosedRaw === "yes";

      const items = await getOperationalQueueForUser(
        String(userId),
        {
          facility: q.facility?.trim() || undefined,
          dateFrom: parseDateString(q.dateFrom),
          dateTo: parseDateString(q.dateTo),
          includeClosed,
          kinds: parseKinds(q.kinds),
        },
        clampPerSourceLimit(q.perSourceLimit),
      );

      res.json({ items });
    } catch (error: any) {
      console.error("[operational-queue/me] error:", error?.message ?? error);
      res.status(500).json({
        error: error?.message ?? "Failed to load operational queue",
      });
    }
  });
}
