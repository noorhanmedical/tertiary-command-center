import type { Express } from "express";
import { storage } from "../storage";
import { insertPtoRequestSchema, PTO_STATUSES } from "../../shared/schema";
import { z } from "zod";
import { createGlobalScheduleBlockFromPto } from "../repositories/globalSchedule.repo";

export function registerPtoRoutes(app: Express) {
  // List PTO requests
  // - Admins: all (optionally filter by status / userId / date range)
  // - Non-admins: only their own
  app.get("/api/pto-requests", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role ?? "clinician";
      const { status, fromDate, toDate, scope } = req.query as Record<string, string | undefined>;

      const filters: { userId?: string; status?: string; fromDate?: string; toDate?: string } = {};
      if (status) filters.status = status;
      if (fromDate) filters.fromDate = fromDate;
      if (toDate) filters.toDate = toDate;

      // Admins can view all (default) or restrict to their own with scope=mine.
      // Non-admins:
      //   - scope=mine            -> their own requests (any status)
      //   - scope=approved-team   -> all approved requests across the team
      //                              (needed for staffing visibility on the
      //                              Dashboard and Staffing Calendar)
      //   - default               -> their own requests only
      if (role === "admin") {
        if (scope === "mine") filters.userId = userId;
      } else if (scope === "approved-team") {
        filters.status = "approved";
      } else {
        filters.userId = userId;
      }

      const rows = await storage.getPtoRequests(filters);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Submit a new PTO request (any authenticated user, for themselves)
  app.post("/api/pto-requests", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const parsed = insertPtoRequestSchema.safeParse({ ...req.body, userId });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      if (parsed.data.endDate < parsed.data.startDate) {
        return res.status(400).json({ error: "endDate must be on or after startDate" });
      }
      const created = await storage.createPtoRequest(parsed.data);
      res.status(201).json(created);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Approve / deny — admin only
  app.patch("/api/pto-requests/:id", async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const parsed = z.object({
        status: z.enum(["approved", "denied"]),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "status must be 'approved' or 'denied'" });

      const updated = await storage.reviewPtoRequest(id, parsed.data.status, req.session.userId!);
      if (!updated) return res.status(404).json({ error: "Request not found" });

      // On approval: mirror the PTO span into global_schedule_events as a
      // team availability block (pto_block) so the calendar/Team Ops surfaces
      // can show the user as unavailable. Idempotent — dedupes by metadata.ptoId.
      if (parsed.data.status === "approved") {
        void createGlobalScheduleBlockFromPto({
          ptoId: updated.id,
          userId: updated.userId,
          startDate: updated.startDate,
          endDate: updated.endDate,
          note: updated.note,
        }).catch((err) => {
          console.error("[pto] createGlobalScheduleBlockFromPto failed:", err);
        });
      }

      // PTO-driven release + redistribute: when an approval covers today,
      // immediately reshuffle that scheduler's call list to the rest of
      // the team and create a Plexus task summarizing what moved.
      if (parsed.data.status === "approved") {
        try {
          const today = new Date().toISOString().slice(0, 10);
          if (updated.startDate <= today && updated.endDate >= today) {
            const schedulers = await storage.getOutreachSchedulers();
            const sched = schedulers.find((s) => s.userId === updated.userId);
            if (sched) {
              const { releaseAndRedistribute } = await import("../services/callListEngine");
              const summary = await releaseAndRedistribute(
                storage, sched.id, today, `pto_approved:${updated.id}`,
              );
              if (summary.released > 0) {
                await storage.createTask({
                  title: `PTO redistribute: ${sched.name}`,
                  description:
                    `${summary.released} call(s) released from ${sched.name}; ` +
                    `${summary.reassigned} reassigned to teammates; ` +
                    `${summary.unassigned} could not be placed (no remaining capacity).`,
                  taskType: "task",
                  urgency: summary.unassigned > 0 ? "within 1 hour" : "within 3 hours",
                  priority: "high",
                  status: "open",
                  createdByUserId: req.session.userId!,
                });
              }
            }
          }
        } catch (redistributeErr) {
          // Don't fail the PTO approval if redistribute trips — log and continue.
          console.error("[pto] redistribute after approve failed:", redistributeErr);
        }
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel / withdraw — owner of the request only, while pending
  app.delete("/api/pto-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const existing = await storage.getPtoRequest(id);
      if (!existing) return res.status(404).json({ error: "Request not found" });
      const isOwner = existing.userId === req.session.userId;
      const isAdmin = req.session.role === "admin";
      if (!isOwner && !isAdmin) return res.status(403).json({ error: "Forbidden" });
      // Owners may only withdraw a request while it is still pending.
      // Admins may delete a request in any state.
      if (!isAdmin && existing.status !== "pending") {
        return res.status(400).json({ error: "Only pending requests can be withdrawn" });
      }
      await storage.deletePtoRequest(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Tiny helper for the dashboard: list of PTO statuses (handy for clients)
  app.get("/api/pto-requests/_meta/statuses", (_req, res) => {
    res.json([...PTO_STATUSES]);
  });
}
