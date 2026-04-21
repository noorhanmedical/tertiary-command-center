import type { Express, Request } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { buildDailyAssignments, releaseAndRedistribute } from "../services/callListEngine";
import { VALID_FACILITIES } from "../../shared/plexus";

function sessionRole(req: Request): string | null {
  const sess = (req as Request & { session?: { role?: string } }).session;
  return sess?.role ?? null;
}
function sessionUserId(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerSchedulerAssignmentRoutes(app: Express) {
  // GET active assignments — ?schedulerId, ?asOfDate (defaults today).
  // Non-admin scheduler accounts can only read their OWN active assignments;
  // they cannot enumerate the team. Admins may pass ?schedulerId or omit it
  // to see all rows for the day.
  app.get("/api/scheduler-assignments", async (req, res) => {
    try {
      const userId = sessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const schedulerIdRaw = req.query.schedulerId;
      const asOfDate = String(req.query.asOfDate ?? todayIso());
      const filters: { schedulerId?: number; asOfDate?: string } = { asOfDate };
      const isAdmin = sessionRole(req) === "admin";
      if (schedulerIdRaw != null && schedulerIdRaw !== "") {
        const n = parseInt(String(schedulerIdRaw), 10);
        if (!Number.isFinite(n)) return res.status(400).json({ error: "Invalid schedulerId" });
        filters.schedulerId = n;
      }
      if (!isAdmin) {
        // Resolve the requesting user's scheduler row and lock the filter
        // to that scheduler id, regardless of any schedulerId query arg.
        const allSchedulers = await storage.getOutreachSchedulers();
        const mine = allSchedulers.find((s) => s.userId === userId);
        if (!mine) return res.json([]);
        filters.schedulerId = mine.id;
      }
      const rows = await storage.listActiveSchedulerAssignments(filters);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to list assignments" });
    }
  });

  // POST rebuild — admin-only. Optional ?facility= (else rebuilds all).
  app.post("/api/scheduler-assignments/rebuild", async (req, res) => {
    try {
      if (sessionRole(req) !== "admin") return res.status(403).json({ error: "Admin access required" });
      const facilityRaw = String(req.query.facility ?? req.body?.facility ?? "");
      const asOfDate = String(req.query.asOfDate ?? req.body?.asOfDate ?? todayIso());

      const facilities: string[] = facilityRaw
        ? [facilityRaw]
        : [...VALID_FACILITIES];

      // Validate any explicit facility against the canonical list.
      for (const f of facilities) {
        if (!(VALID_FACILITIES as readonly string[]).includes(f)) {
          return res.status(400).json({ error: `Unknown facility: ${f}` });
        }
      }

      const lockName = `call_list_rebuild:${asOfDate}:${facilities.join(",")}`;
      const { acquired, result } = await withAdvisoryLock(lockName, async () => {
        const out = [];
        for (const f of facilities) {
          out.push(await buildDailyAssignments(storage, f, asOfDate));
        }
        return out;
      });
      if (!acquired) return res.status(409).json({ error: "Build already in progress" });
      res.json({ asOfDate, results: result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Rebuild failed" });
    }
  });

  // POST release + redistribute — admin-only. Used by absence watcher and
  // the "Run distribution now" button.
  app.post("/api/scheduler-assignments/redistribute", async (req, res) => {
    try {
      if (sessionRole(req) !== "admin") return res.status(403).json({ error: "Admin access required" });
      const parsed = z.object({
        schedulerId: z.number().int().positive(),
        asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        reason: z.string().max(500).default("manual_redistribute"),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const summary = await releaseAndRedistribute(
        storage,
        parsed.data.schedulerId,
        parsed.data.asOfDate ?? todayIso(),
        parsed.data.reason,
      );
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Redistribute failed" });
    }
  });

  // POST approve a pending absence-alert proposal — executes the embedded
  // release+redistribute and resolves the underlying Plexus task. Admin-only.
  app.post("/api/scheduler-assignments/approve-absence", async (req, res) => {
    try {
      if (sessionRole(req) !== "admin") return res.status(403).json({ error: "Admin access required" });
      const parsed = z.object({
        taskId: z.number().int().positive(),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const task = await storage.getTaskById(parsed.data.taskId);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (task.taskType !== "absence_alert") return res.status(400).json({ error: "Not an absence_alert task" });
      const m = (task.description ?? "").match(/<!--proposal:(\{[\s\S]*?\})-->/);
      if (!m) return res.status(400).json({ error: "No proposal found in task" });
      let proposal: { schedulerId?: number; asOfDate?: string };
      try { proposal = JSON.parse(m[1]); } catch { return res.status(400).json({ error: "Invalid proposal JSON" }); }
      if (!proposal.schedulerId || !proposal.asOfDate) {
        return res.status(400).json({ error: "Proposal missing schedulerId/asOfDate" });
      }
      const summary = await releaseAndRedistribute(
        storage,
        proposal.schedulerId,
        proposal.asOfDate,
        "absence_admin_approved",
      );
      await storage.updateTask(parsed.data.taskId, { status: "resolved" });
      res.json({ summary });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Approve failed" });
    }
  });

  // GET admin dashboard surface — per-scheduler queue depth + today's stats.
  app.get("/api/scheduler-assignments/dashboard", async (req, res) => {
    try {
      if (sessionRole(req) !== "admin") return res.status(403).json({ error: "Admin access required" });
      const asOfDate = String(req.query.asOfDate ?? todayIso());
      const [schedulers, assignments, ptoToday] = await Promise.all([
        storage.getOutreachSchedulers(),
        storage.listActiveSchedulerAssignments({ asOfDate }),
        storage.getPtoRequests({ status: "approved", fromDate: asOfDate, toDate: asOfDate }),
      ]);
      const onPto = new Set<string>();
      for (const r of ptoToday) {
        if (r.startDate <= asOfDate && r.endDate >= asOfDate) onPto.add(r.userId);
      }
      const grouped = new Map<number, { active: number; reassignedIn: number }>();
      for (const a of assignments) {
        const cur = grouped.get(a.schedulerId) ?? { active: 0, reassignedIn: 0 };
        cur.active += 1;
        if (a.source === "reassigned") cur.reassignedIn += 1;
        grouped.set(a.schedulerId, cur);
      }
      // Last-activity per scheduler (most recent call's startedAt today).
      const lastActivity = new Map<string, string>();
      await Promise.all(
        schedulers
          .filter((sc) => !!sc.userId)
          .map(async (sc) => {
            const calls = await storage.listOutreachCallsForSchedulerToday(sc.userId!, asOfDate);
            const latest = calls[0];
            if (latest) lastActivity.set(sc.userId!, String(latest.startedAt));
          }),
      );
      const rows = schedulers.map((sc) => ({
        id: sc.id,
        name: sc.name,
        facility: sc.facility,
        capacityPercent: sc.capacityPercent,
        userId: sc.userId,
        onPtoToday: !!sc.userId && onPto.has(sc.userId),
        activeCount: grouped.get(sc.id)?.active ?? 0,
        reassignedInCount: grouped.get(sc.id)?.reassignedIn ?? 0,
        lastCallAt: sc.userId ? lastActivity.get(sc.userId) ?? null : null,
      }));
      res.json({ asOfDate, rows });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Dashboard failed" });
    }
  });
}
