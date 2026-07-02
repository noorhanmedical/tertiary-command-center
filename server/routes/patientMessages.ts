// Patient SMS messaging routes (Task #648) — real two-way texting via the
// Twilio adapter. Honest boundaries everywhere:
//   - When Twilio isn't connected, /status says so and /send returns 503
//     SMS_NOT_CONNECTED. Nothing is faked as sent.
//   - Outbound rows are recorded only AFTER the provider responds — status
//     "sent" with the real Twilio SID, or "failed" with the provider error.
//   - Sender attribution always comes from the session, never the client.
//   - Inbound patient replies arrive via the Twilio webhook (signature
//     validated when an auth token is available).
import type { Express } from "express";
import crypto from "node:crypto";
import { requirePortalRole } from "./portal";
import { patientSmsRepository } from "../repositories/patientSms.repo";
import {
  getTwilioConfig,
  sendSmsViaTwilio,
  normalizePhone,
} from "../integrations/twilioSms";
import { sendPatientSmsSchema } from "@shared/schema/patientSms";
import { logPatientCommunicationEvent } from "../services/communication/communicationLogService";
import { db } from "../db";
import { sql } from "drizzle-orm";

function maskNumber(num: string): string {
  return num.length > 4 ? `…${num.slice(-4)}` : num;
}

/** Validate X-Twilio-Signature (only possible with an auth token). */
function twilioSignatureValid(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = crypto.createHmac("sha1", authToken).update(data).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function registerPatientMessagesRoutes(app: Express) {
  // Is real texting available? The tray uses this to show an honest
  // connect-Twilio boundary instead of a dead composer.
  app.get("/api/portal/patient-messages/status", requirePortalRole, async (_req, res) => {
    try {
      const config = await getTwilioConfig();
      res.json({
        connected: !!config,
        fromNumber: config ? maskNumber(config.fromNumber) : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to check SMS status" });
    }
  });

  // All conversation threads (one per patient phone) plus total unread.
  app.get("/api/portal/patient-messages/threads", requirePortalRole, async (_req, res) => {
    try {
      const threads = await patientSmsRepository.listThreads();
      const unreadTotal = threads.reduce((sum, t) => sum + t.unread, 0);
      res.json({ threads, unreadTotal });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load threads" });
    }
  });

  // Patient picker for starting a new thread — real screening rows that
  // have a phone number on file. Distinct by (name, phone).
  app.get("/api/portal/patient-messages/patients", requirePortalRole, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const like = `%${q}%`;
      const rows = await db.execute(sql`
        SELECT DISTINCT ON (lower(name), phone_number)
          id, name, phone_number, dob, facility
        FROM patient_screenings
        WHERE phone_number IS NOT NULL
          AND length(regexp_replace(phone_number, '\\D', '', 'g')) >= 7
          AND deleted_at IS NULL
          ${q ? sql`AND name ILIKE ${like}` : sql``}
        ORDER BY lower(name), phone_number, id DESC
        LIMIT 25
      `);
      res.json({
        patients: (rows.rows as any[]).map((r) => ({
          patientScreeningId: Number(r.id),
          name: String(r.name),
          phone: normalizePhone(String(r.phone_number)),
          dob: r.dob != null ? String(r.dob) : null,
          facility: r.facility != null ? String(r.facility) : null,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to search patients" });
    }
  });

  // One conversation, oldest-first. Marks inbound messages read.
  app.get("/api/portal/patient-messages/thread", requirePortalRole, async (req, res) => {
    try {
      const phone = normalizePhone(String(req.query.phone ?? ""));
      if (!phone) return res.status(400).json({ error: "phone is required" });
      const messages = await patientSmsRepository.listThread(phone);
      await patientSmsRepository.markThreadRead(phone);
      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load conversation" });
    }
  });

  // Send a real SMS. Requires Twilio to be connected — otherwise 503 with
  // an honest code the tray understands. Never records "sent" unless the
  // provider accepted the message.
  app.post("/api/portal/patient-messages/send", requirePortalRole, async (req, res) => {
    try {
      const parsed = sendPatientSmsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid message", code: "VALIDATION" });
      }
      const config = await getTwilioConfig();
      if (!config) {
        return res.status(503).json({
          error: "Texting is not connected. Connect Twilio to send patient messages.",
          code: "SMS_NOT_CONNECTED",
        });
      }
      const phone = normalizePhone(parsed.data.patientPhone);
      if (!phone || phone.length < 8) {
        return res.status(400).json({ error: "Invalid phone number", code: "VALIDATION" });
      }
      const senderUserId = req.session.userId ?? null;

      const result = await sendSmsViaTwilio(config, phone, parsed.data.body);

      const row = await patientSmsRepository.record({
        patientPhone: phone,
        patientName: parsed.data.patientName ?? null,
        patientScreeningId: parsed.data.patientScreeningId ?? null,
        direction: "outbound",
        body: parsed.data.body,
        senderUserId,
        providerSid: result.ok ? result.sid : null,
        status: result.ok ? "sent" : "failed",
        errorMessage: result.ok ? null : result.error,
      });

      if (!result.ok) {
        return res.status(502).json({
          error: `SMS failed: ${result.error}`,
          code: "SMS_SEND_FAILED",
          message: row,
        });
      }

      // Journey timeline (genuine send → kind "sms"). Best-effort only.
      if (parsed.data.patientScreeningId && parsed.data.patientName) {
        logPatientCommunicationEvent({
          patientScreeningId: parsed.data.patientScreeningId,
          patientName: parsed.data.patientName,
          kind: "sms",
          actorUserId: senderUserId,
          subject: null,
          recipient: phone,
          messageId: result.sid,
          sentAt: result.sentAt,
        }).catch(() => {});
      }

      res.status(201).json({ message: row });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to send message" });
    }
  });

  // Twilio inbound webhook (public — Twilio can't hold a session). Form
  // encoded From/Body/MessageSid. Signature-validated when the resolved
  // config exposes an auth token (env path); connector API-key setups
  // can't validate, so we fall back to shape checks + a connected gate.
  app.post("/api/sms/twilio/inbound", async (req, res) => {
    try {
      const config = await getTwilioConfig();
      if (!config) return res.status(503).send("SMS not configured");

      const from = normalizePhone(String(req.body?.From ?? ""));
      const body = String(req.body?.Body ?? "").slice(0, 1600);
      const sid = String(req.body?.MessageSid ?? "") || null;
      if (!from || !body.trim()) return res.status(400).send("Missing From/Body");

      const envToken = process.env.TWILIO_AUTH_TOKEN;
      const signature = req.get("X-Twilio-Signature");
      if (envToken) {
        const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.body ?? {})) params[k] = String(v);
        if (!signature || !twilioSignatureValid(envToken, url, params, signature)) {
          return res.status(403).send("Invalid signature");
        }
      }

      await patientSmsRepository.record({
        patientPhone: from,
        patientName: null,
        patientScreeningId: null,
        direction: "inbound",
        body,
        senderUserId: null,
        providerSid: sid,
        status: "received",
        errorMessage: null,
      });

      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      res.status(500).send("Webhook error");
    }
  });
}
