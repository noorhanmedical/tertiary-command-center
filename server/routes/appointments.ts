import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { VALID_FACILITIES } from "./helpers";
import { logAudit } from "../services/auditService";
import { ensureCanonicalSpineForScreening } from "../services/patientCommitService";
import { featureFlags } from "../lib/featureFlags";
import { scheduleCanonicalAncillaryAppointment } from "../services/canonicalAppointments/scheduleAncillaryOrchestrator";

export function registerAppointmentRoutes(app: Express) {
  app.get("/api/appointments", async (req, res) => {
    try {
      const { facility, date, testType, status, upcoming } = req.query as Record<string, string>;
      if (upcoming === "true") {
        const parsedLimit = parseInt(req.query.limit as string);
        const limitParam = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
        const appts = await storage.getUpcomingAppointments(limitParam);
        return res.json(appts);
      }
      const appts = await storage.getAppointments({ facility, date, testType, status });
      res.json(appts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/appointments", async (req, res) => {
    try {
      const schema = z.object({
        patientScreeningId: z.number().int().nullable().optional(),
        patientName: z.string().min(1),
        facility: z.enum(VALID_FACILITIES),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
        testType: z.string().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const { patientScreeningId, patientName, facility, scheduledDate, scheduledTime, testType } = parsed.data;

      // ── Phase 2D-B2: canonical bridge / refusal ────────────────
      // When FEATURE_CANONICAL_APPOINTMENT is ON, this route must not
      // create an independent legacy ancillary appointment truth. If a
      // screening is present we bridge to the canonical service (the
      // ancillary_appointments row is only ever a compatibility
      // projection). Without enough context to resolve a canonical
      // case, we refuse (409) rather than insert a legacy-only row.
      if (featureFlags.canonicalAppointment) {
        const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
        if (patientScreeningId == null || clinicId == null) {
          return res.status(409).json({
            error: "Canonical scheduling is enabled — use the canonical ancillary scheduling route; a patient screening and clinic scope are required.",
            code: "CANONICAL_ANCILLARY_CASE_REQUIRED",
          });
        }
        const startsAt = new Date(`${scheduledDate}T${scheduledTime}:00`);
        if (isNaN(startsAt.getTime())) {
          return res.status(400).json({ error: "Invalid scheduledDate/scheduledTime" });
        }
        try {
          const canonical = await scheduleCanonicalAncillaryAppointment({
            clinicId,
            executionCaseId: null,
            patientScreeningId,
            serviceType: testType,
            startsAt,
            eventType: "ancillary_appointment",
            facilityId: facility,
            source: "appointments_route",
            actorUserId: req.session?.userId ?? null,
          });
          if (canonical.status === "created" || canonical.status === "reused") {
            void logAudit(req, "create", "appointment", canonical.globalScheduleEventId, {
              canonical: true, ancillaryCaseId: canonical.ancillaryCaseId, testType, facility,
            });
            return res.json({
              ok: true,
              canonical: true,
              globalScheduleEventId: canonical.globalScheduleEventId,
              ancillaryCaseId: canonical.ancillaryCaseId,
              status: canonical.status,
              projectionDeferred: canonical.projectionDeferred,
            });
          }
          // deferred (no identity / no case) or error → controlled refusal.
          return res.status(409).json({
            error: "Could not resolve a canonical ancillary case for this appointment — use the canonical scheduling route.",
            code: "CANONICAL_ANCILLARY_CASE_REQUIRED",
          });
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
            return res.status(503).json({
              error: "canonical appointment schema unavailable — apply migration 0052",
              code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING",
            });
          }
          throw e;
        }
      }

      if (patientScreeningId != null) {
        const patient = await storage.getPatientScreening(patientScreeningId);
        if (patient) {
          const batch = await storage.getScreeningBatch(patient.batchId);
          if (batch?.scheduleDate && batch.scheduleDate !== scheduledDate) {
            console.warn(
              `[appointments] canonical date mismatch: patient ${patientScreeningId} batch scheduleDate=${batch.scheduleDate} but scheduledDate=${scheduledDate}. Allowing with warning.`
            );
          }
        }
      }

      const existing = await storage.getAppointments({ facility, date: scheduledDate, testType, status: "scheduled" });
      const duplicate = existing.find((a) => a.scheduledTime === scheduledTime);
      if (duplicate) {
        return res.status(409).json({ error: "That time slot is already booked." });
      }

      const appt = await storage.createAppointment({
        patientScreeningId: patientScreeningId ?? null,
        patientName,
        facility,
        scheduledDate,
        scheduledTime,
        testType,
        status: "scheduled",
      });
      // Booking an ancillary appointment locks the patient into the
      // Scheduled commit status so the recall window can no longer apply.
      if (patientScreeningId != null) {
        await storage.updatePatientScreening(patientScreeningId, {
          commitStatus: "Scheduled",
          appointmentStatus: "scheduled",
        });
        // Make sure the canonical spine reflects this booking — execution
        // case + doctor_visit event. Idempotent; safe to re-run. Fire-and-
        // forget so a spine failure never breaks the user-facing booking.
        void ensureCanonicalSpineForScreening(patientScreeningId, {
          actorUserId: req.session?.userId ?? null,
          auto: true,
        }).catch((err) => {
          console.error("[appointments.book] ensureCanonicalSpineForScreening failed:", err);
        });
      }
      void logAudit(req, "create", "appointment", appt.id, { patientName, facility, scheduledDate, scheduledTime, testType });
      res.json(appt);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/appointments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const schema = z.object({ status: z.enum(["scheduled", "cancelled"]) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      if (parsed.data.status === "cancelled") {
        const appt = await storage.cancelAppointment(id);
        if (!appt) return res.status(404).json({ error: "Appointment not found" });
        void logAudit(req, "cancel", "appointment", id, { status: "cancelled" });
        return res.json(appt);
      }
      res.status(400).json({ error: "Only cancellation is supported via PATCH" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/appointments/patient/:patientId", async (req, res) => {
    try {
      const patientId = parseInt(req.params.patientId);
      const appts = await storage.getAppointmentsByPatient(patientId);
      res.json(appts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
