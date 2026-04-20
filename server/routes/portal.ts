import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { storage } from "../storage";
import { saveBlob, getLatestBlobForOwner, readBlob } from "../services/blobStore";
import { db } from "../db";
import {
  documentSurfaceAssignments,
  documents as documentsTable,
  ancillaryAppointments,
  users as usersTable,
  type DocumentSurface,
  type DocumentKind,
  type AncillaryAppointment,
} from "@shared/schema";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import {
  PORTAL_OUTREACH_BASE_CAP,
  PORTAL_OUTREACH_HEAVY_LOAD_THRESHOLD,
  PORTAL_OUTREACH_HEAVY_DAY_CAP_FACTOR,
} from "@shared/platformSettings";

type ConsentDoc = { id: number; sourceNotes: string | null; createdAt: Date | string; kind: string };

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

// ── Clinic-scoped authorization ──────────────────────────────────────────────
// Admins can access every clinic. Technician/liaison users can access only
// the clinics they are mapped to via outreach_schedulers.userId. This is the
// same mapping table used by the scheduler-assignment service so we don't
// introduce a new ownership concept.
async function allowedFacilities(req: Request): Promise<{ all: boolean; facilities: Set<string> }> {
  if ((req.session.role ?? "") === "admin") return { all: true, facilities: new Set() };
  const userId = req.session.userId;
  if (!userId) return { all: false, facilities: new Set() };
  const all = await storage.getOutreachSchedulers();
  const mine = all.filter((s) => s.userId === userId).map((s) => s.facility);
  return { all: false, facilities: new Set(mine) };
}

function ensureFacility(allowed: { all: boolean; facilities: Set<string> }, facility: string | null): string | null {
  // Returns an HTTP error message string if access is denied, otherwise null.
  if (allowed.all) return null;
  if (!facility) return "Facility unknown for this resource";
  if (!allowed.facilities.has(facility)) return "Forbidden — clinic not assigned to this user";
  return null;
}

async function patientFacility(patientScreeningId: number): Promise<{ facility: string | null; patientName: string } | null> {
  const p = await storage.getPatientScreening(patientScreeningId);
  if (!p) return null;
  const batch = await storage.getScreeningBatch(p.batchId);
  return { facility: batch?.facility ?? null, patientName: p.name };
}

// Map ancillary test type -> doc-library "ancillary type" tag the consent
// template was tagged with. Templates are filtered by description/title
// containing the test type token (best-effort) so portal users always pick
// the right consent for the test they are running.
function templateMatchesTest(title: string, description: string | null, testType: string): boolean {
  const hay = `${title} ${description ?? ""}`.toLowerCase();
  const t = testType.toLowerCase();
  if (!t) return true;
  if (hay.includes(t)) return true;
  // Common short-tokens: BrainWave, VitalWave, Doppler, Echo, Carotid, etc.
  const tokens = t.split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
  return tokens.some((tok) => hay.includes(tok));
}

// Strict per-test-per-day consent: a current informed_consent document for
// this patient whose sourceNotes contain `:test=<testType>` (the marker
// sign-consent writes) AND was created on/after the scheduled date. No
// fallback — signing one test must NOT mark another test as consented.
function consentForTest(
  docs: ConsentDoc[],
  testType: string,
  scheduledDate: string,
): { signed: boolean; documentId: number | null } {
  const t = testType.toLowerCase();
  const sameOrAfter = (d: Date | string) => {
    const iso = (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
    return iso >= scheduledDate;
  };
  const marker = `:test=${t}`;
  const exact = docs.find((d) =>
    d.kind === "informed_consent"
    && (d.sourceNotes ?? "").toLowerCase().includes(marker)
    && sameOrAfter(d.createdAt));
  return { signed: !!exact, documentId: exact?.id ?? null };
}

export function registerPortalRoutes(app: Express) {
  // ── Today's clinic schedule for a facility (anchored on ancillary_appointments) ──
  app.get("/api/portal/today-schedule", requirePortalRole, async (req, res) => {
    try {
      const facility = String(req.query.facility ?? "").trim();
      const date = String(req.query.date ?? "").trim() || todayIso();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date must be YYYY-MM-DD" });
      }
      const allowed = await allowedFacilities(req);
      const denied = ensureFacility(allowed, facility || null);
      if (denied) return res.status(403).json({ error: denied });

      const conds = [eq(ancillaryAppointments.scheduledDate, date)];
      if (facility) conds.push(eq(ancillaryAppointments.facility, facility));
      const appts = await db.select().from(ancillaryAppointments).where(and(...conds));

      // Group by patient + collect tests/times
      type PatientRow = {
        patientScreeningId: number | null;
        name: string;
        dob: string | null;
        time: string | null;
        facility: string;
        clinicianName: string | null;
        qualifyingTests: string[];
        appointmentStatus: string;
        consentByTest: Array<{ testType: string; signed: boolean; documentId: number | null }>;
        consentSigned: boolean;
        appointments: Array<{ id: number; testType: string; scheduledTime: string; status: string }>;
        batchId: number | null;
        plexusPdfUrl: string | null;
        clinicianPdfUrl: string | null;
        scheduleUrl: string | null;
      };
      const byKey = new Map<string, PatientRow>();
      for (const a of appts) {
        const key = a.patientScreeningId != null ? `p:${a.patientScreeningId}` : `n:${a.patientName}`;
        let row = byKey.get(key);
        if (!row) {
          let dob: string | null = null;
          let qualifyingTests: string[] = [];
          let appointmentStatus = a.status ?? "scheduled";
          let batchId: number | null = null;
          let clinicianName: string | null = null;
          if (a.patientScreeningId != null) {
            const p = await storage.getPatientScreening(a.patientScreeningId);
            if (p) {
              dob = p.dob ?? null;
              qualifyingTests = Array.isArray(p.qualifyingTests) ? p.qualifyingTests : [];
              appointmentStatus = p.appointmentStatus ?? appointmentStatus;
              batchId = p.batchId;
              const batch = await storage.getScreeningBatch(p.batchId);
              clinicianName = batch?.clinicianName ?? null;
            }
          }
          row = {
            patientScreeningId: a.patientScreeningId ?? null,
            name: a.patientName,
            dob,
            time: a.scheduledTime ?? null,
            facility: a.facility,
            clinicianName,
            qualifyingTests,
            appointmentStatus,
            consentByTest: [],
            consentSigned: false,
            appointments: [],
            batchId,
            // PDFs are produced client-side from the shared schedule view
            // (see SharedSchedule). The portal swaps the center pane to that
            // route in an iframe so the user can print/download from there.
            plexusPdfUrl: batchId != null ? `/schedule/${batchId}#plexus-pdf` : null,
            clinicianPdfUrl: batchId != null ? `/schedule/${batchId}#clinician-pdf` : null,
            scheduleUrl: batchId != null ? `/schedule/${batchId}` : null,
          };
          byKey.set(key, row);
        }
        row.appointments.push({
          id: a.id,
          testType: a.testType,
          scheduledTime: a.scheduledTime,
          status: a.status,
        });
        // Earliest time wins for the row time.
        if (!row.time || (a.scheduledTime && a.scheduledTime < row.time)) row.time = a.scheduledTime;
      }

      // Compute consent per test for each row.
      for (const row of byKey.values()) {
        const docs = row.patientScreeningId != null
          ? await storage.listCurrentDocuments({
            kind: "informed_consent",
            patientScreeningId: row.patientScreeningId,
          })
          : [];
        const seen = new Set<string>();
        for (const a of row.appointments) {
          if (seen.has(a.testType)) continue;
          seen.add(a.testType);
          const c = consentForTest(docs as ConsentDoc[], a.testType, date);
          row.consentByTest.push({ testType: a.testType, signed: c.signed, documentId: c.documentId });
        }
        row.consentSigned = row.consentByTest.length > 0 && row.consentByTest.every((c) => c.signed);
      }

      const out = [...byKey.values()].sort((x, y) =>
        (x.time ?? "").localeCompare(y.time ?? "") || x.name.localeCompare(y.name),
      );

      // Side-effect: ensure a tech_assignment Plexus task exists for every
      // patient with at least one unsigned consent on a same-day appointment.
      // Idempotent: we check for an open task with taskType=tech_assignment
      // for this patient + due date == today before creating a new one.
      if (date === todayIso()) {
        const facSchedulers = await storage.getOutreachSchedulers();
        for (const row of out) {
          if (row.patientScreeningId == null) continue;
          const hasGap = row.consentByTest.some((c) => !c.signed);
          if (!hasGap) continue;
          const existing = await storage.getTasksByPatient(row.patientScreeningId);
          const already = existing.find(
            (t) => t.taskType === "tech_assignment" && t.status !== "closed" && t.dueDate === date,
          );
          if (already) continue;
          const assignee = facSchedulers.find(
            (s) => s.userId && s.facility === row.facility,
          )?.userId ?? null;
          // Best-effort: failing to create a tech_assignment task must NOT
          // break the schedule response. Log and continue.
          try {
            await storage.createTask({
              title: `Consent needed — ${row.name}`,
              description: `Patient ${row.name} has ${row.consentByTest.filter((c) => !c.signed).length} unsigned consent(s) for today's clinic at ${row.facility}.`,
              taskType: "tech_assignment",
              urgency: "EOD",
              priority: "normal",
              status: "open",
              assignedToUserId: assignee,
              createdByUserId: req.session.userId ?? null,
              patientScreeningId: row.patientScreeningId,
              projectId: null,
              parentTaskId: null,
              batchId: row.batchId,
              dueDate: date,
            });
          } catch (taskErr) {
            console.warn("[portal/today-schedule] tech_assignment create failed:", taskErr);
          }
        }
      }

      res.json({ date, facility, patients: out });
    } catch (err: any) {
      console.error("[portal/today-schedule]", err);
      res.status(500).json({ error: err?.message || "Failed to load today's schedule" });
    }
  });

  // ── Monthly calendar: per-day appointment counts for the facility ──────────
  app.get("/api/portal/month-summary", requirePortalRole, async (req, res) => {
    try {
      const facility = String(req.query.facility ?? "").trim();
      const month = String(req.query.month ?? "").trim();
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "month must be YYYY-MM" });
      }
      const allowed = await allowedFacilities(req);
      const denied = ensureFacility(allowed, facility || null);
      if (denied) return res.status(403).json({ error: denied });

      const monthStart = `${month}-01`;
      const [y, m] = month.split("-").map((s) => parseInt(s, 10));
      const monthEndDate = new Date(y, m, 0);
      const monthEnd = localIso(monthEndDate);
      const conds = [
        gte(ancillaryAppointments.scheduledDate, monthStart),
        lte(ancillaryAppointments.scheduledDate, monthEnd),
      ];
      if (facility) conds.push(eq(ancillaryAppointments.facility, facility));
      const rows = await db.select().from(ancillaryAppointments).where(and(...conds));
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.scheduledDate, (counts.get(r.scheduledDate) ?? 0) + 1);
      const days: Array<{ date: string; appointmentCount: number }> = [];
      for (const [date, appointmentCount] of counts) days.push({ date, appointmentCount });
      days.sort((a, b) => a.date.localeCompare(b.date));
      res.json({ month, facility, days });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load month summary" });
    }
  });

  // ── Outreach call list with capacity-weighted distribution ─────────────────
  // Pool = patients with no scheduled appt and no batch visit in next 90 days.
  // Active workers = users with role technician/liaison mapped via
  // outreach_schedulers to the facility (capacityPercent default 100). The
  // pool is partitioned deterministically across active workers so each user
  // sees their share only. On heavy days (pool > 50 per worker), each
  // worker's cap scales by 1.5x to avoid over-truncation.
  app.get("/api/portal/outreach-call-list", requirePortalRole, async (req, res) => {
    try {
      const facility = String(req.query.facility ?? "").trim();
      const today = todayIso();
      const ninetyDaysOut = new Date();
      ninetyDaysOut.setDate(ninetyDaysOut.getDate() + 90);
      const horizon = localIso(ninetyDaysOut);
      const allowed = await allowedFacilities(req);
      const denied = ensureFacility(allowed, facility || null);
      if (denied) return res.status(403).json({ error: denied });

      const allBatches = await storage.getAllScreeningBatches();
      const allScheduled = await storage.getAppointments({ status: "scheduled" });
      const apptsByPatient = new Map<number, { scheduledDate: string }[]>();
      for (const a of allScheduled) {
        if (a.patientScreeningId == null) continue;
        const arr = apptsByPatient.get(a.patientScreeningId) ?? [];
        arr.push({ scheduledDate: a.scheduledDate });
        apptsByPatient.set(a.patientScreeningId, arr);
      }

      // In-clinic ancillary load TODAY (used to detect "heavy" days). The
      // heavier the in-clinic schedule, the LOWER the outreach cap so we
      // protect bandwidth for the patients who are physically here today.
      const todaysApptsConds = [eq(ancillaryAppointments.scheduledDate, today)];
      if (facility) todaysApptsConds.push(eq(ancillaryAppointments.facility, facility));
      const todaysAppts = await db.select().from(ancillaryAppointments).where(and(...todaysApptsConds));

      type Item = {
        patientScreeningId: number;
        name: string;
        phoneNumber: string | null;
        insurance: string | null;
        qualifyingTests: string[];
        facility: string;
        appointmentStatus: string;
      };
      const pool: Item[] = [];
      for (const batch of allBatches) {
        if (facility && (batch.facility ?? "") !== facility) continue;
        if (!allowed.all && !allowed.facilities.has(batch.facility ?? "")) continue;
        const batchDay = (batch.scheduleDate ?? "").slice(0, 10);
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        for (const p of patients) {
          if (p.commitStatus === "Draft") continue;
          // Only patients tagged as outreach cohort are call-list candidates;
          // an in-clinic visit patient with no upcoming appt is NOT outreach.
          if ((p.patientType ?? "visit") !== "outreach") continue;
          const appts = apptsByPatient.get(p.id) ?? [];
          const hasUpcoming = appts.some((a) => a.scheduledDate >= today && a.scheduledDate <= horizon);
          const batchInWindow = batchDay && batchDay >= today && batchDay <= horizon;
          if (hasUpcoming || batchInWindow) continue;
          const status = (p.appointmentStatus ?? "").toLowerCase();
          if (["scheduled", "completed", "declined", "dnc", "deceased", "cancelled"].includes(status)) continue;
          pool.push({
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
      pool.sort((a, b) => a.patientScreeningId - b.patientScreeningId);

      // Active workers for this facility (capacity-weighted partition).
      // Restrict to users who are active AND have role technician/liaison; admin
      // accounts and inactive users are excluded so the share math is honest.
      const schedulers = await storage.getOutreachSchedulers();
      const facilityWorkers = schedulers
        .filter((s) => s.userId && (!facility || s.facility === facility))
        .map((s) => ({ userId: s.userId!, weight: Math.max(1, s.capacityPercent ?? 100) }));
      const dedup = new Map<string, number>();
      for (const w of facilityWorkers) dedup.set(w.userId, Math.max(dedup.get(w.userId) ?? 0, w.weight));
      const candidateIds = [...dedup.keys()];
      const activeWorkers = candidateIds.length === 0 ? [] : await db
        .select({ id: usersTable.id, role: usersTable.role, active: usersTable.active })
        .from(usersTable)
        .where(and(inArray(usersTable.id, candidateIds), eq(usersTable.active, true)));
      const workers = activeWorkers
        .filter((u) => u.role === "technician" || u.role === "liaison")
        .map((u) => ({ userId: u.id, weight: dedup.get(u.id) ?? 100 }))
        .sort((a, b) => a.userId.localeCompare(b.userId));
      const totalWeight = workers.reduce((s, w) => s + w.weight, 0) || 1;

      const myUserId = req.session.userId!;
      const myWeight = workers.find((w) => w.userId === myUserId)?.weight ?? 0;

      let myShare: Item[];
      if (workers.length === 0 || myWeight === 0) {
        // No worker mapping: show full pool (admin/legacy fallback).
        myShare = pool;
      } else {
        // Deterministic weighted partition: each worker owns a contiguous slice.
        const sortedWorkers = workers;
        let cursor = 0;
        const ranges = new Map<string, [number, number]>();
        for (const w of sortedWorkers) {
          const span = Math.round((pool.length * w.weight) / totalWeight);
          ranges.set(w.userId, [cursor, cursor + span]);
          cursor += span;
        }
        // Make sure last worker gets any rounding remainder.
        if (sortedWorkers.length > 0) {
          const last = sortedWorkers[sortedWorkers.length - 1];
          const [start] = ranges.get(last.userId)!;
          ranges.set(last.userId, [start, pool.length]);
        }
        const range = ranges.get(myUserId);
        myShare = range ? pool.slice(range[0], range[1]) : [];
      }

      // Heavy-day cap scaling: when in-clinic load per worker is heavy, REDUCE
      // outreach cap so workers focus on the patients physically present.
      // Tunable via PORTAL_OUTREACH_* settings in shared/platformSettings.ts.
      const inClinicPerWorker = workers.length > 0
        ? todaysAppts.length / workers.length
        : todaysAppts.length;
      const heavy = inClinicPerWorker >= PORTAL_OUTREACH_HEAVY_LOAD_THRESHOLD;
      const cap = heavy
        ? Math.max(1, Math.round(PORTAL_OUTREACH_BASE_CAP * PORTAL_OUTREACH_HEAVY_DAY_CAP_FACTOR))
        : PORTAL_OUTREACH_BASE_CAP;
      myShare.sort((a, b) => a.name.localeCompare(b.name));

      res.json({
        facility,
        heavyDay: heavy,
        cap,
        baseCap: PORTAL_OUTREACH_BASE_CAP,
        heavyDayFactor: PORTAL_OUTREACH_HEAVY_DAY_CAP_FACTOR,
        inClinicAppointmentsToday: todaysAppts.length,
        totalPool: pool.length,
        workerCount: workers.length,
        patients: myShare.slice(0, cap),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load outreach list" });
    }
  });

  // ── My open tech_assignment tasks (right-rail tasks pane) ──────────────────
  // Returns tasks assigned to the current portal user. Tasks marked URGENT
  // are returned first via the `urgent` array; remaining open tasks come back
  // in `open`. Closed tasks are excluded.
  app.get("/api/portal/my-tasks", requirePortalRole, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const all = await storage.getTasksByAssignee(userId);
      const open = all.filter((t) => t.status !== "closed");
      const urgent = open.filter((t) => t.urgency === "now" || t.urgency === "EOD");
      const rest = open.filter((t) => !urgent.includes(t));
      res.json({
        urgent: urgent.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          taskType: t.taskType,
          urgency: t.urgency,
          patientScreeningId: t.patientScreeningId,
          dueDate: t.dueDate,
          status: t.status,
        })),
        open: rest.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          taskType: t.taskType,
          urgency: t.urgency,
          patientScreeningId: t.patientScreeningId,
          dueDate: t.dueDate,
          status: t.status,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load my tasks" });
    }
  });

  // ── Consent template picker filtered by ancillary test type ────────────────
  app.get("/api/portal/consent-templates", requirePortalRole, async (req, res) => {
    try {
      const testType = String(req.query.testType ?? "").trim();
      const docs = await storage.listCurrentDocuments({
        kind: "informed_consent",
        surface: "tech_consent_picker" as DocumentSurface,
      });
      const filtered = docs
        .filter((d) => d.contentType === "application/pdf")
        .filter((d) => !testType || templateMatchesTest(d.title, d.description, testType));
      res.json(filtered.map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description,
        filename: d.filename,
        contentType: d.contentType,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to list templates" });
    }
  });

  // ── Patient-scoped document upload ─────────────────────────────────────────
  app.post("/api/portal/uploads", requirePortalRole, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });
      const patientScreeningId = parseInt(String(req.body.patientScreeningId ?? ""), 10);
      if (!Number.isFinite(patientScreeningId)) {
        return res.status(400).json({ error: "patientScreeningId is required" });
      }
      const facilityInfo = await patientFacility(patientScreeningId);
      if (!facilityInfo) return res.status(404).json({ error: "Patient not found" });
      const allowed = await allowedFacilities(req);
      const denied = ensureFacility(allowed, facilityInfo.facility);
      if (denied) return res.status(403).json({ error: denied });

      const title = String(req.body.title ?? req.file.originalname ?? "Upload").slice(0, 200);
      const kindRaw = String(req.body.kind ?? "other") as DocumentKind;
      if (!PORTAL_DOC_KINDS.has(kindRaw)) {
        return res.status(400).json({ error: `Unsupported kind. Allowed: ${[...PORTAL_DOC_KINDS].join(", ")}` });
      }
      const description = String(req.body.description ?? "").slice(0, 1000);

      const doc = await storage.createDocument({
        title,
        description,
        kind: kindRaw,
        signatureRequirement: "none",
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        sizeBytes: req.file.size,
        patientScreeningId,
        facility: facilityInfo.facility,
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
        await db.delete(documentsTable).where(eq(documentsTable.id, doc.id));
        throw innerErr;
      }

      res.status(201).json({ id: doc.id, title: doc.title, filename: doc.filename });
    } catch (err: any) {
      console.error("[portal/uploads]", err);
      res.status(500).json({ error: err?.message || "Failed to upload document" });
    }
  });

  // ── Signature capture: flatten signature image into a consent template PDF ──
  app.post("/api/portal/sign-consent", requirePortalRole, async (req, res) => {
    try {
      const patientScreeningId = parseInt(String(req.body.patientScreeningId ?? ""), 10);
      const templateDocumentId = parseInt(String(req.body.templateDocumentId ?? ""), 10);
      const signatureDataUrl = String(req.body.signatureDataUrl ?? "");
      const signedBy = String(req.body.signedBy ?? "patient").toLowerCase();
      const testType = String(req.body.testType ?? "").trim();
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

      const facilityInfo = await patientFacility(patientScreeningId);
      if (!facilityInfo) return res.status(404).json({ error: "Patient not found" });
      const allowed = await allowedFacilities(req);
      const denied = ensureFacility(allowed, facilityInfo.facility);
      if (denied) return res.status(403).json({ error: denied });

      const template = await storage.getDocument(templateDocumentId);
      if (!template || template.deletedAt !== null) {
        return res.status(404).json({ error: "Template not found" });
      }
      if (template.contentType !== "application/pdf") {
        return res.status(400).json({ error: "Template must be a PDF" });
      }
      if (template.kind !== "informed_consent") {
        return res.status(403).json({ error: "Template must be an informed_consent document" });
      }
      // Template must also be a current (non-superseded) consent template
      // explicitly published to the technician/liaison consent picker surface.
      const allowedTemplates = await storage.listCurrentDocuments({
        kind: "informed_consent",
        surface: "tech_consent_picker" as DocumentSurface,
      });
      if (!allowedTemplates.some((d) => d.id === template.id)) {
        return res.status(403).json({ error: "Template is not published to the consent picker" });
      }
      if (template.facility && template.facility !== facilityInfo.facility) {
        return res.status(403).json({ error: "Template is restricted to a different clinic" });
      }

      const blob = await getLatestBlobForOwner("library_document", template.id);
      if (!blob) return res.status(404).json({ error: "Template file missing" });
      const data = await readBlob(blob.id);
      if (!data) return res.status(404).json({ error: "Template bytes unavailable" });

      const pdfDoc = await PDFDocument.load(data.buffer);
      const sigBase64 = signatureDataUrl.split(",")[1] ?? "";
      const sigBytes = Buffer.from(sigBase64, "base64");
      const isPng = signatureDataUrl.startsWith("data:image/png");
      const sigImage = isPng
        ? await pdfDoc.embedPng(sigBytes)
        : await pdfDoc.embedJpg(sigBytes);

      const pages = pdfDoc.getPages();
      const last = pages[pages.length - 1];
      const { width } = last.getSize();
      const sigW = Math.min(220, width * 0.4);
      const ratio = sigImage.height / Math.max(1, sigImage.width);
      const sigH = sigW * ratio;
      last.drawImage(sigImage, { x: width - sigW - 40, y: 60, width: sigW, height: sigH });
      const stamp = `Signed by ${signedBy} — ${facilityInfo.patientName} — ${new Date().toISOString()}${testType ? ` — ${testType}` : ""}`;
      last.drawText(stamp, { x: 40, y: 40, size: 8 });
      const flatBytes = Buffer.from(await pdfDoc.save());

      const filename = `${facilityInfo.patientName.replace(/[^a-z0-9]+/gi, "_")}-consent-signed.pdf`;
      const newDoc = await storage.createDocument({
        title: `${template.title} — ${facilityInfo.patientName} (signed)${testType ? ` — ${testType}` : ""}`,
        description: `Signed by ${signedBy}${testType ? ` for ${testType}` : ""}`,
        kind: "informed_consent",
        signatureRequirement: "none",
        filename,
        contentType: "application/pdf",
        sizeBytes: flatBytes.byteLength,
        patientScreeningId,
        facility: facilityInfo.facility,
        sourceNotes: `portal_signature:template=${template.id}:signedBy=${signedBy}${testType ? `:test=${testType}` : ""}`,
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
        await db.delete(documentsTable).where(eq(documentsTable.id, newDoc.id));
        throw innerErr;
      }

      res.status(201).json({ id: newDoc.id, filename, downloadUrl: `/api/documents-library/${newDoc.id}/file` });
    } catch (err: any) {
      console.error("[portal/sign-consent]", err);
      res.status(500).json({ error: err?.message || "Failed to sign consent" });
    }
  });

  // ── Documents for a patient (consent + uploads) ────────────────────────────
  app.get("/api/portal/patient-documents/:id", requirePortalRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const facilityInfo = await patientFacility(id);
      if (!facilityInfo) return res.status(404).json({ error: "Patient not found" });
      const allowed = await allowedFacilities(req);
      const denied = ensureFacility(allowed, facilityInfo.facility);
      if (denied) return res.status(403).json({ error: denied });

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

  // ── List the facilities this user is allowed to view ───────────────────────
  app.get("/api/portal/my-facilities", requirePortalRole, async (req, res) => {
    try {
      const allowed = await allowedFacilities(req);
      if (allowed.all) {
        // Admin gets every facility ever used by an appointment.
        const rows = await db.selectDistinct({ facility: ancillaryAppointments.facility })
          .from(ancillaryAppointments);
        res.json({ facilities: rows.map((r) => r.facility).sort() });
      } else {
        res.json({ facilities: [...allowed.facilities].sort() });
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load facilities" });
    }
  });
}
