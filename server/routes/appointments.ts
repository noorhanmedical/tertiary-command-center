import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { VALID_FACILITIES } from "./helpers";
import { logAudit } from "../services/auditService";
import { ensureCanonicalSpineForScreening } from "../services/patientCommitService";

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
