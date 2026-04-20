import type { Express, Request } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { patientScreenings, screeningBatches, outreachSchedulers } from "../../shared/schema";
import { sendOutreachEmail } from "../services/emailService";
import { MARKETING_MATERIALS, getMarketingMaterial } from "../services/marketingMaterials";

function sessionUserId(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

function sessionRole(req: Request): string | null {
  const sess = (req as Request & { session?: { role?: string } }).session;
  return sess?.role ?? null;
}

/**
 * Authorize the logged-in user to act on a given patient. Admins may act on
 * any patient; everyone else must be the scheduler currently assigned to
 * the patient — either via batch.assigned_scheduler_id or via an active
 * scheduler_assignment row for today (to cover PTO/absence redistribution).
 */
async function userMayActOnPatient(
  req: Request,
  patientScreeningId: number,
): Promise<boolean> {
  if (sessionRole(req) === "admin") return true;
  const userId = sessionUserId(req);
  if (!userId) return false;

  const rows = await db
    .select({ userId: outreachSchedulers.userId })
    .from(patientScreenings)
    .innerJoin(screeningBatches, eq(patientScreenings.batchId, screeningBatches.id))
    .leftJoin(outreachSchedulers, eq(screeningBatches.assignedSchedulerId, outreachSchedulers.id))
    .where(eq(patientScreenings.id, patientScreeningId))
    .limit(1);
  if (rows[0]?.userId && rows[0].userId === userId) return true;

  const todayIso = new Date().toISOString().slice(0, 10);
  const active = await storage.getActiveAssignmentForPatientOnDate(patientScreeningId, todayIso);
  if (active) {
    const allSchedulers = await storage.getOutreachSchedulers();
    const sc = allSchedulers.find((s) => s.id === active.schedulerId);
    if (sc?.userId && sc.userId === userId) return true;
  }
  return false;
}

const sendEmailSchema = z.object({
  patientScreeningId: z.number().int().positive(),
  to: z.string().email("A valid recipient email address is required."),
  subject: z.string().trim().min(1, "Subject is required."),
  body: z.string().min(1, "Body is required."),
});

const sendMaterialSchema = z.object({
  patientScreeningId: z.number().int().positive(),
  materialId: z.string().min(1),
  to: z.string().email().optional(),
});

export function registerEmailRoutes(app: Express) {
  // List the marketing materials available for sending. Mirrors the
  // catalog used in the scheduler portal UI but keeps the server as the
  // source of truth for what can actually be delivered.
  app.get("/api/outreach/materials", (_req, res) => {
    res.json(
      MARKETING_MATERIALS.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        filename: m.filename,
      })),
    );
  });

  app.post("/api/outreach/send-email", async (req, res) => {
    if (!sessionUserId(req)) return res.status(401).json({ error: "Not authenticated" });
    const parsed = sendEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    try {
      const patient = await storage.getPatientScreening(parsed.data.patientScreeningId);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      if (!(await userMayActOnPatient(req, patient.id))) {
        return res.status(403).json({ error: "Not authorized to send email for this patient" });
      }

      // Persist the email back to the patient if it was newly entered, so
      // future sends pre-fill correctly.
      const trimmedTo = parsed.data.to.trim();
      if (trimmedTo && trimmedTo.toLowerCase() !== (patient.email ?? "").trim().toLowerCase()) {
        try {
          await storage.updatePatientScreening(patient.id, { email: trimmedTo });
        } catch (err) {
          console.warn("[email] failed to persist patient email:", (err as Error)?.message);
        }
      }

      const result = await sendOutreachEmail({
        to: trimmedTo,
        subject: parsed.data.subject,
        body: parsed.data.body,
      });
      res.json({ ok: true, messageId: result.messageId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message || "Failed to send email" });
    }
  });

  app.post("/api/outreach/send-material", async (req, res) => {
    if (!sessionUserId(req)) return res.status(401).json({ error: "Not authenticated" });
    const parsed = sendMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    try {
      const patient = await storage.getPatientScreening(parsed.data.patientScreeningId);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      if (!(await userMayActOnPatient(req, patient.id))) {
        return res.status(403).json({ error: "Not authorized to send email for this patient" });
      }

      const recipient = (parsed.data.to ?? patient.email ?? "").trim();
      if (!recipient) {
        return res
          .status(400)
          .json({ error: "Patient has no email on file. Add one in the email composer first." });
      }

      const material = getMarketingMaterial(parsed.data.materialId);
      if (!material) return res.status(404).json({ error: "Unknown marketing material" });

      // Persist email if newly captured.
      if (recipient.toLowerCase() !== (patient.email ?? "").trim().toLowerCase()) {
        try {
          await storage.updatePatientScreening(patient.id, { email: recipient });
        } catch (err) {
          console.warn("[email] failed to persist patient email:", (err as Error)?.message);
        }
      }

      const firstName = (patient.name || "").split(/\s+/)[0] || "there";
      const subject = `${material.title} — ${patient.facility ?? "your screening visit"}`;
      const body =
        `Hi ${firstName},\n\n` +
        `Attached is the ${material.title} you requested from your scheduling team.\n` +
        `${material.description}\n\n` +
        `Please reply to this email or call us back if you have any questions.\n\n` +
        `Thank you,\nScheduling Team`;

      const result = await sendOutreachEmail({
        to: recipient,
        subject,
        body,
        attachments: [
          {
            filename: material.filename,
            content: material.content,
            contentType: material.contentType,
          },
        ],
      });
      res.json({ ok: true, messageId: result.messageId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message || "Failed to send material" });
    }
  });
}
