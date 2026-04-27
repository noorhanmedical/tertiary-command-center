import type { Express } from "express";
import {
  listExecutionCases,
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
  listJourneyEvents,
  listEngagementCenterCases,
  listSchedulerPortalCases,
} from "../repositories/executionCase.repo";

export function registerExecutionCaseRoutes(app: Express) {
  // GET /api/execution-cases
  // Filters: engagementBucket, lifecycleStatus, engagementStatus, facilityId,
  //          patientScreeningId, limit (default 100, max 500)
  app.get("/api/execution-cases", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listExecutionCases>[0] = {};
      if (q.engagementBucket) filters.engagementBucket = q.engagementBucket;
      if (q.lifecycleStatus) filters.lifecycleStatus = q.lifecycleStatus;
      if (q.engagementStatus) filters.engagementStatus = q.engagementStatus;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      const rows = await listExecutionCases(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/engagement-center/cases
  // Filters: engagementBucket, facilityId, assignedTeamMemberId, assignedRole,
  //          lifecycleStatus, engagementStatus, qualificationStatus,
  //          limit (default 100, max 500)
  app.get("/api/engagement-center/cases", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listEngagementCenterCases>[0] = {};
      if (q.engagementBucket) filters.engagementBucket = q.engagementBucket;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.assignedTeamMemberId) {
        const id = parseInt(q.assignedTeamMemberId, 10);
        if (!isNaN(id)) filters.assignedTeamMemberId = id;
      }
      if (q.assignedRole) filters.assignedRole = q.assignedRole;
      if (q.lifecycleStatus) filters.lifecycleStatus = q.lifecycleStatus;
      if (q.engagementStatus) filters.engagementStatus = q.engagementStatus;
      if (q.qualificationStatus) filters.qualificationStatus = q.qualificationStatus;
      const rows = await listEngagementCenterCases(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/scheduler-portal/cases
  // Filters: assignedTeamMemberId, facilityId, engagementBucket, lifecycleStatus,
  //          engagementStatus, qualificationStatus, limit (default 100, max 500)
  // Defaults to scheduler-relevant buckets (visit, outreach, scheduling_triage)
  // and excludes terminal engagement statuses (completed, closed) unless caller
  // provides explicit filters.
  app.get("/api/scheduler-portal/cases", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listSchedulerPortalCases>[0] = {};
      if (q.assignedTeamMemberId) {
        const id = parseInt(q.assignedTeamMemberId, 10);
        if (!isNaN(id)) filters.assignedTeamMemberId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.engagementBucket) filters.engagementBucket = q.engagementBucket;
      if (q.lifecycleStatus) filters.lifecycleStatus = q.lifecycleStatus;
      if (q.engagementStatus) filters.engagementStatus = q.engagementStatus;
      if (q.qualificationStatus) filters.qualificationStatus = q.qualificationStatus;
      const rows = await listSchedulerPortalCases(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/execution-cases/by-screening/:patientScreeningId
  // Must be registered before /:id to avoid shadowing
  app.get("/api/execution-cases/by-screening/:patientScreeningId", async (req, res) => {
    try {
      const screeningId = parseInt(req.params.patientScreeningId, 10);
      if (isNaN(screeningId)) return res.status(400).json({ error: "Invalid patientScreeningId" });
      const row = await getExecutionCaseByScreeningId(screeningId);
      if (!row) return res.status(404).json({ error: "Execution case not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/execution-cases/:id
  app.get("/api/execution-cases/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getExecutionCaseById(id);
      if (!row) return res.status(404).json({ error: "Execution case not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/patient-journey-events
  // Filters: executionCaseId, patientScreeningId, patientName, patientDob,
  //          eventType, limit (default 100, max 500)
  app.get("/api/patient-journey-events", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listJourneyEvents>[0] = {};
      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.patientName) filters.patientName = q.patientName;
      if (q.patientDob) filters.patientDob = q.patientDob;
      if (q.eventType) filters.eventType = q.eventType;
      const rows = await listJourneyEvents(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
