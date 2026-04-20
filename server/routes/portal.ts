import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { storage } from "../storage";
import { saveBlob, getLatestBlobForOwner, readBlob } from "../services/blobStore";
import { db } from "../db";
import {
  documentSurfaceAssignments,
  documents as documentsTable,
  DOCUMENT_KINDS,
  type DocumentSurface,
  type DocumentKind,
} from "@shared/schema";
import { eq } from "drizzle-orm";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const PORTAL_ROLES = new Set(["admin", "technician", "liaison"]);

const requirePortalRole = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (!PORTAL_ROLES.has(role)) {
    return res.status(403).json({ error: "Forbidden — technician or liaison role required" });
  }
  return next();
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const PORTAL_DOC_KINDS = new Set<DocumentKind>([
  "informed_consent",
  "screening_form",
  "report",
  "reference",
  "other",
]);

const SIGNED_BY_VALUES = new Set(["patient", "clinician", "technician", "liaison"]);

// Resolve the facility the patient was screened in (via their batch). Used
// for object-level authorization on patient-scoped portal operations.
async function patientFacility(patientScreeningId: number): Promise<{ facility: string | null; patientName: string } | null> {
  const p = await storage.getPatientScreening(patientScreeningId);
  if (!p) return null;
  const batch = await storage.getScreeningBatch(p.batchId);
  return { facility: batch?.facility ?? null, patientName: p.name };
}

export function registerPortalRoutes(app: Express) {
  // ── Today's clinic schedule for a facility (technician/liaison portal right rail) ──
  // Returns committed (non-Draft) patients whose batch.scheduleDate is today,
  // enriched with consent status (does the patient have a signed informed_consent
  // library document?) and any scheduled ancillary appointments.
  app.get("/api/portal/today-schedule", requirePortalRole, async (req, res) => {
    try {
      const facility = String(req.query.facility ?? "").trim();
      const date = String(req.query.date ?? "").trim() || todayIso();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date must be YYYY-MM-DD" });
      }

      const allBatches = await storage.getAllScreeningBatches();
      const batches = allBatches.filter((b) =>
        (b.scheduleDate ?? "").slice(0, 10) === date
        && (!facility || (b.facility ?? "") === facility)
      );

      const out: Array<{
        patientScreeningId: number;
        name: string;
        dob: string | null;
        time: string | null;
        facility: string;
        clinicianName: string | null;
        qualifyingTests: string[];
        appointmentStatus: string;
        commitStatus: string;
        consentSignedDocumentId: number | null;
        consentSigned: boolean;
        appointments: Array<{ id: number; testType: string; scheduledTime: string; status: string }>;
        batchId: number;
      }> = [];

      for (const batch of batches) {
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        for (const p of patients) {
          if (p.commitStatus === "Draft") continue;
          const docs = await storage.listCurrentDocuments({
            kind: "informed_consent",
            patientScreeningId: p.id,
          });
          const signed = docs.find((d) => (d.sourceNotes ?? "").includes("portal_signature"));
          const appts = (await storage.getAppointmentsByPatient(p.id))
            .filter((a) => a.status === "scheduled");
          out.push({
            patientScreeningId: p.id,
            name: p.name,
            dob: p.dob ?? null,
            time: p.time ?? null,
            facility: batch.facility ?? "",
            clinicianName: batch.clinicianName ?? null,
            qualifyingTests: Array.isArray(p.qualifyingTests) ? p.qualifyingTests : [],
            appointmentStatus: p.appointmentStatus ?? "pending",
            commitStatus: p.commitStatus ?? "Ready",
            consentSignedDocumentId: signed?.id ?? null,
            consentSigned: !!signed,
            appointments: appts.map((a) => ({
              id: a.id,
              testType: a.testType,
              scheduledTime: a.scheduledTime,
              status: a.status,
            })),
            batchId: batch.id,
          });
        }
      }

      out.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.name.localeCompare(b.name));
      res.json({ date, facility, patients: out });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load today's schedule" });
    }
  });

  // ── Monthly calendar: per-day patient counts for the facility ──────────────
  app.get("/api/portal/month-summary", requirePortalRole, async (req, res) => {
    try {
      const facility = String(req.query.facility ?? "").trim();
      const month = String(req.query.month ?? "").trim();
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "month must be YYYY-MM" });
      }
      const batches = await storage.getAllScreeningBatches();
      const counts = new Map<string, number>();
      for (const b of batches) {
        const day = (b.scheduleDate ?? "").slice(0, 10);
        if (!day.startsWith(month)) continue;
        if (facility && (b.facility ?? "") !== facility) continue;
        counts.set(day, (counts.get(day) ?? 0) + (b.patientCount ?? 0));
      }
      const days: Array<{ date: string; patientCount: number }> = [];
      for (const [date, patientCount] of counts) days.push({ date, patientCount });
      days.sort((a, b) => a.date.localeCompare(b.date));
      res.json({ month, facility, days });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load month summary" });
    }
  });

  // ── Outreach call list for technicians/liaisons ────────────────────────────
  // Returns derivedType="outreach" patients (no upcoming appointment in the
  // 90-day classifier window) so the portal team can reach out from clinic.
  app.get("/api/portal/outreach-call-list", requirePortalRole, async (req, res) => {
    try {
      const facility = String(req.query.facility ?? "").trim();
      const today = todayIso();
      const ninetyDaysOut = new Date();
      ninetyDaysOut.setDate(ninetyDaysOut.getDate() + 90);
      const horizon = localIso(ninetyDaysOut);

      const allBatches = await storage.getAllScreeningBatches();
      const allScheduled = await storage.getAppointments({ status: "scheduled" });
      const apptsByPatient = new Map<number, { scheduledDate: string }[]>();
      for (const a of allScheduled) {
        if (a.patientScreeningId == null) continue;
        const arr = apptsByPatient.get(a.patientScreeningId) ?? [];
        arr.push({ scheduledDate: a.scheduledDate });
        apptsByPatient.set(a.patientScreeningId, arr);
      }

      const out: Array<{
        patientScreeningId: number;
        name: string;
        phoneNumber: string | null;
        insurance: string | null;
        qualifyingTests: string[];
        facility: string;
        appointmentStatus: string;
      }> = [];

      for (const batch of allBatches) {
        if (facility && (batch.facility ?? "") !== facility) continue;
        const batchDay = (batch.scheduleDate ?? "").slice(0, 10);
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        for (const p of patients) {
          if (p.commitStatus === "Draft") continue;
          // Outreach = no scheduled appt in next 90d AND no batch visit within 90d
          const appts = apptsByPatient.get(p.id) ?? [];
          const hasUpcoming = appts.some((a) => a.scheduledDate >= today && a.scheduledDate <= horizon);
          const batchInWindow = batchDay && batchDay >= today && batchDay <= horizon;
          if (hasUpcoming || batchInWindow) continue;
          // Skip already terminal statuses
          const status = (p.appointmentStatus ?? "").toLowerCase();
          if (["scheduled", "completed", "declined", "dnc", "deceased", "cancelled"].includes(status)) continue;
          out.push({
            patientScreeningId: p.id,
            name: p.name,
            phoneNumber: p.phoneNumber ?? null,
            insurance: p.insurance ?? null,
            qualifyingTests: Array.isArray(p.qualifyingTests) ? p.qualifyingTests : [],
            facility: batch.facility ?? "",
            appointmentStatus: p.appointmentStatus ?? "pending",
          });
        }
      }

      out.sort((a, b) => a.name.localeCompare(b.name));
      res.json({ facility, patients: out.slice(0, 200) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load outreach list" });
    }
  });

  // ── Patient-scoped document upload (technician/liaison allowed) ────────────
  app.post("/api/portal/uploads", requirePortalRole, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });
      const patientScreeningIdRaw = req.body.patientScreeningId;
      const patientScreeningId = parseInt(String(patientScreeningIdRaw ?? ""), 10);
      if (!Number.isFinite(patientScreeningId)) {
        return res.status(400).json({ error: "patientScreeningId is required" });
      }
      const patient = await storage.getPatientScreening(patientScreeningId);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const title = String(req.body.title ?? req.file.originalname ?? "Upload").slice(0, 200);
      const kindRaw = String(req.body.kind ?? "other") as DocumentKind;
      if (!PORTAL_DOC_KINDS.has(kindRaw)) {
        return res.status(400).json({ error: `Unsupported kind. Allowed: ${[...PORTAL_DOC_KINDS].join(", ")}` });
      }
      const description = String(req.body.description ?? "").slice(0, 1000);

      const facilityInfo = await patientFacility(patientScreeningId);
      const facility = facilityInfo?.facility ?? null;

      const doc = await storage.createDocument({
        title,
        description,
        kind: kindRaw,
        signatureRequirement: "none",
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        sizeBytes: req.file.size,
        patientScreeningId,
        facility,
        sourceNotes: "portal_upload",
        createdByUserId: req.session.userId ?? null,
      });

      try {
        await db.insert(documentSurfaceAssignments).values({
          documentId: doc.id,
          surface: "patient_chart" as DocumentSurface,
        }).onConflictDoNothing();

        await saveBlob({
          ownerType: "library_document",
          ownerId: doc.id,
          contentType: req.file.mimetype,
          filename: req.file.originalname,
          buffer: req.file.buffer,
        });
      } catch (innerErr) {
        // Compensating cleanup so we never leave orphan doc rows without bytes.
        await db.delete(documentsTable).where(eq(documentsTable.id, doc.id));
        throw innerErr;
      }

      res.status(201).json({ id: doc.id, title: doc.title, filename: doc.filename });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to upload document" });
    }
  });

  // ── Signature capture: flatten signature image into a consent template PDF ──
  // Body: { patientScreeningId, templateDocumentId, signatureDataUrl, signedBy }
  // Creates a NEW patient-scoped library document (kind=informed_consent) with
  // the signature stamped onto the template's last page.
  app.post("/api/portal/sign-consent", requirePortalRole, async (req, res) => {
    try {
      const patientScreeningId = parseInt(String(req.body.patientScreeningId ?? ""), 10);
      const templateDocumentId = parseInt(String(req.body.templateDocumentId ?? ""), 10);
      const signatureDataUrl = String(req.body.signatureDataUrl ?? "");
      const signedBy = String(req.body.signedBy ?? "patient").toLowerCase();
      if (!SIGNED_BY_VALUES.has(signedBy)) {
        return res.status(400).json({ error: `signedBy must be one of: ${[...SIGNED_BY_VALUES].join(", ")}` });
      }
      if (!Number.isFinite(patientScreeningId)) {
        return res.status(400).json({ error: "patientScreeningId is required" });
      }
      if (!Number.isFinite(templateDocumentId)) {
        return res.status(400).json({ error: "templateDocumentId is required" });
      }
      if (!signatureDataUrl.startsWith("data:image/")) {
        return res.status(400).json({ error: "signatureDataUrl must be a data URL image" });
      }

      const patient = await storage.getPatientScreening(patientScreeningId);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const template = await storage.getDocument(templateDocumentId);
      if (!template || template.deletedAt !== null) {
        return res.status(404).json({ error: "Template not found" });
      }
      if (template.contentType !== "application/pdf") {
        return res.status(400).json({ error: "Template must be a PDF" });
      }

      const blob = await getLatestBlobForOwner("library_document", template.id);
      if (!blob) return res.status(404).json({ error: "Template file missing" });
      const data = await readBlob(blob.id);
      if (!data) return res.status(404).json({ error: "Template bytes unavailable" });

      // Flatten signature onto the last page
      const pdfDoc = await PDFDocument.load(data.buffer);
      const sigBase64 = signatureDataUrl.split(",")[1] ?? "";
      const sigBytes = Buffer.from(sigBase64, "base64");
      const isPng = signatureDataUrl.startsWith("data:image/png");
      const sigImage = isPng
        ? await pdfDoc.embedPng(sigBytes)
        : await pdfDoc.embedJpg(sigBytes);

      const pages = pdfDoc.getPages();
      const last = pages[pages.length - 1];
      const { width, height } = last.getSize();
      const sigW = Math.min(220, width * 0.4);
      const ratio = sigImage.height / Math.max(1, sigImage.width);
      const sigH = sigW * ratio;
      last.drawImage(sigImage, {
        x: width - sigW - 40,
        y: 60,
        width: sigW,
        height: sigH,
      });
      const stamp = `Signed by ${signedBy} — ${patient.name} — ${new Date().toISOString()}`;
      last.drawText(stamp, { x: 40, y: 40, size: 8 });
      const flatBytes = Buffer.from(await pdfDoc.save());

      const filename = `${patient.name.replace(/[^a-z0-9]+/gi, "_")}-consent-signed.pdf`;
      const facilityInfo = await patientFacility(patientScreeningId);
      const newDoc = await storage.createDocument({
        title: `${template.title} — ${patient.name} (signed)`,
        description: `Signed by ${signedBy}`,
        kind: "informed_consent",
        signatureRequirement: "none",
        filename,
        contentType: "application/pdf",
        sizeBytes: flatBytes.byteLength,
        patientScreeningId,
        facility: facilityInfo?.facility ?? template.facility,
        sourceNotes: `portal_signature:template=${template.id}:signedBy=${signedBy}`,
        createdByUserId: req.session.userId ?? null,
      });

      try {
        await db.insert(documentSurfaceAssignments).values({
          documentId: newDoc.id,
          surface: "patient_chart" as DocumentSurface,
        }).onConflictDoNothing();

        await saveBlob({
          ownerType: "library_document",
          ownerId: newDoc.id,
          contentType: "application/pdf",
          filename,
          buffer: flatBytes,
        });
      } catch (innerErr) {
        // Compensating cleanup: remove orphan doc row if blob save fails so
        // today-schedule doesn't falsely report consent as signed.
        await db.delete(documentsTable).where(eq(documentsTable.id, newDoc.id));
        throw innerErr;
      }

      res.status(201).json({ id: newDoc.id, filename, downloadUrl: `/api/documents-library/${newDoc.id}/file` });
    } catch (err: any) {
      console.error("[portal/sign-consent] failed:", err);
      res.status(500).json({ error: err?.message || "Failed to sign consent" });
    }
  });

  // ── Documents for a patient (consent + uploads) ────────────────────────────
  app.get("/api/portal/patient-documents/:id", requirePortalRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const docs = await storage.listCurrentDocuments({ patientScreeningId: id });
      res.json(docs.map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        filename: d.filename,
        contentType: d.contentType,
        createdAt: d.createdAt,
        sourceNotes: d.sourceNotes,
        downloadUrl: `/api/documents-library/${d.id}/file`,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load documents" });
    }
  });
}
