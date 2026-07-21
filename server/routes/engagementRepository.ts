/**
 * Phase 2C — Engagement Repository read/write routes.
 *
 * All routes are registered UNCONDITIONALLY but every handler
 * short-circuits with 404 when FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY
 * is OFF (avoids leaking route existence + preserves the previous
 * "route not found" behavior).
 *
 * Every route:
 *   • Requires an authenticated session (mounted after requireAuth).
 *   • Derives clinicId from req.clinicId (populated by clinicContext
 *     middleware). Cross-clinic reads are impossible from these routes
 *     because they never accept an unrestricted clinicId param from
 *     the caller.
 *   • Returns no Plexus global registry data.
 *   • Returns no PHI beyond what the existing Engagement UI already
 *     surfaces (list label, facility, service_date, counts).
 */

import type { Express, Request, Response } from "express";
import { featureFlags } from "../lib/featureFlags";
import {
  listActiveMembershipsForAncillaryCase,
  listActiveMembershipsForList,
  listEngagementListsForRepository,
  listMostRecentlySentEngagementLists,
} from "../repositories/engagementLists.repo";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { engagementLists } from "@shared/schema/engagementLists";

function isMultiListFlagOn(): boolean {
  return featureFlags.engagementMultiListRepository;
}

function is404IfFlagOff(res: Response): boolean {
  if (!isMultiListFlagOn()) {
    res.status(404).json({ error: "Not Found" });
    return true;
  }
  return false;
}

function requireClinicScope(req: Request, res: Response): number | null {
  const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (!clinicId) {
    res.status(403).json({ error: "Clinic scope required" });
    return null;
  }
  return clinicId;
}

export function registerEngagementRepositoryRoutes(app: Express): void {
  // GET /api/engagement/repository/lists — Repository listing.
  app.get("/api/engagement/repository/lists", async (req, res) => {
    if (is404IfFlagOff(res)) return;
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
      const lists = await listEngagementListsForRepository({ clinicId, limit });
      res.json({ lists });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "repository list failed" });
    }
  });

  // GET /api/engagement/repository/recent — Most Recently Sent (top-10).
  app.get("/api/engagement/repository/recent", async (req, res) => {
    if (!featureFlags.engagementRecentLists && !isMultiListFlagOn()) {
      return res.status(404).json({ error: "Not Found" });
    }
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10)));
      const lists = await listMostRecentlySentEngagementLists({ clinicId, limit });
      res.json({ lists });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "recent lists failed" });
    }
  });

  // GET /api/engagement/repository/lists/:id — Single list + memberships.
  // Tenant guard: reload the list and verify clinic match before
  // returning any memberships.
  app.get("/api/engagement/repository/lists/:id", async (req, res) => {
    if (is404IfFlagOff(res)) return;
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const listId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(listId) || listId <= 0) {
        return res.status(400).json({ error: "invalid list id" });
      }
      // Tenant guard: the reader itself scopes by clinicId, but this
      // single-row read joins on id. Confirm the row belongs to the
      // caller's clinic before returning it OR any memberships.
      const [row] = await db
        .select()
        .from(engagementLists)
        .where(and(eq(engagementLists.id, listId), eq(engagementLists.clinicId, clinicId)))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Not Found" });
      const memberships = await listActiveMembershipsForList(listId);
      res.json({ list: row, memberships });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "list read failed" });
    }
  });

  // GET /api/engagement/repository/ancillary-cases/:id/memberships —
  // Source memberships for one ancillary case. Tenant guard: the
  // memberships must all share the caller's clinicId (enforced by
  // the fact that engagement_lists.clinic_id is per-list; we join
  // client-side and filter).
  app.get("/api/engagement/repository/ancillary-cases/:id/memberships", async (req, res) => {
    if (is404IfFlagOff(res)) return;
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const acId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(acId) || acId <= 0) {
        return res.status(400).json({ error: "invalid ancillary case id" });
      }
      const raw = await listActiveMembershipsForAncillaryCase(acId);
      // Cross-check against the lists' clinic to filter out any that
      // don't belong to the caller. (Defensive — the repo should
      // already be safe.)
      const listIds = Array.from(new Set(raw.map((m) => m.engagementListId)));
      const lists = listIds.length === 0
        ? []
        : await db
            .select()
            .from(engagementLists)
            .where(and(eq(engagementLists.clinicId, clinicId)));
      const allowedListIds = new Set(lists.map((l) => l.id));
      const filtered = raw.filter((m) => allowedListIds.has(m.engagementListId));
      res.json({ memberships: filtered });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "memberships read failed" });
    }
  });
}
