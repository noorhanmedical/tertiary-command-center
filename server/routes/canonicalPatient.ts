// Canonical Patient routes — the unified create/update/parse/dedup surface for
// Plexus EHR. Manual Add and Smart Paste use these; bulk import + Plexus IQ
// converge on the same underlying canonicalPatientService write boundary.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { invalidatePatientDatabase } from "./patientDatabase";
import {
  createCanonicalPatient,
  updateCanonicalPatient,
  resolveCanonicalPatientCandidates,
  deriveClinicIdFromFacility,
} from "../services/canonicalPatient/canonicalPatientService";
import { parsePatientDraft } from "../services/canonicalPatient/patientDraftParser";
import { normalizePatientDraft } from "@shared/canonicalPatientDraft";

const draftSchema = z.object({
  name: z.string().optional().nullable(),
  dob: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  age: z.number().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  mrn: z.string().optional().nullable(),
  insurance: z.string().optional().nullable(),
  memberId: z.string().optional().nullable(),
  facility: z.string().optional().nullable(),
  provider: z.string().optional().nullable(),
  diagnoses: z.string().optional().nullable(),
  medications: z.string().optional().nullable(),
  history: z.string().optional().nullable(),
  allergies: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  patientType: z.enum(["visit", "outreach"]).optional().nullable(),
});

function requireStaff(req: Request, res: Response): boolean {
  if (!req.session?.role || !["admin", "clinician"].includes(req.session.role)) {
    res.status(403).json({ error: "Admin or clinician access required" });
    return false;
  }
  return true;
}

/** Get-or-create the per-day Plexus EHR batch for a facility (shared with the
 *  legacy direct-add route so manual/paste patients land coherently). */
async function getOrCreateDailyEhrBatch(facility: string, clinicId: number | null, userId: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  const batchName = `Plexus EHR — ${today}`;
  const all = await storage.getAllScreeningBatches();
  const existing = all.find((b) => b.name === batchName && b.facility === facility);
  if (existing) return existing;
  return storage.createScreeningBatch({
    name: batchName,
    facility,
    scheduleDate: today,
    clinicId: clinicId ?? undefined,
    status: "draft",
    importKind: "full",
    importCreatedBy: userId ?? undefined,
  } as never);
}

export function registerCanonicalPatientRoutes(app: Express) {
  // ── Smart paste → DRAFT (no write) ───────────────────────────────────────
  app.post("/api/patients/canonical/parse-draft", async (req: Request, res: Response) => {
    if (!requireStaff(req, res)) return;
    const schema = z.object({ text: z.string().min(1).max(50000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    try {
      const result = await parsePatientDraft(parsed.data.text);
      return res.json(result);
    } catch (e) {
      return res.status(502).json({ error: (e as Error)?.message ?? "Parse failed", code: "parse_failed" });
    }
  });

  // ── Duplicate check for a draft (no write) ───────────────────────────────
  app.post("/api/patients/canonical/dedup-check", async (req: Request, res: Response) => {
    if (!requireStaff(req, res)) return;
    const schema = z.object({ draft: draftSchema, facility: z.string().optional().nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    const draft = normalizePatientDraft({ ...parsed.data.draft, facility: parsed.data.facility ?? parsed.data.draft.facility });
    if (!draft.name) return res.json({ duplicate: null });
    const { clinicId } = await deriveClinicIdFromFacility(draft.facility);
    const duplicate = await resolveCanonicalPatientCandidates(draft, clinicId);
    return res.json({ duplicate });
  });

  // ── Create ONE canonical patient (manual or smart paste) ─────────────────
  app.post("/api/patients/canonical", async (req: Request, res: Response) => {
    if (!requireStaff(req, res)) return;
    const schema = z.object({
      draft: draftSchema,
      sourceType: z.enum(["manual", "manual_paste"]).optional(),
      force: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });

    const draft = normalizePatientDraft(parsed.data.draft);
    if (!draft.name) return res.status(400).json({ error: "Patient name is required" });
    if (!draft.facility) return res.status(400).json({ error: "Facility is required" });

    try {
      const { clinicId, canonicalFacility } = await deriveClinicIdFromFacility(draft.facility);
      const facility = canonicalFacility ?? draft.facility;
      const batch = await getOrCreateDailyEhrBatch(facility, clinicId, req.session?.userId ?? null);

      const result = await createCanonicalPatient({
        draft: { ...draft, facility },
        provenance: {
          sourceType: parsed.data.sourceType ?? "manual",
          clinicId,
          facility,
          createdByUserId: req.session?.userId ?? null,
          batchId: batch.id,
          sourceSystem: "plexus_ehr_canonical_add",
        },
        batchId: batch.id,
        force: parsed.data.force,
        req,
      });

      if (result.status === "duplicate_blocked") {
        return res.status(409).json({ status: "duplicate_blocked", duplicate: result.duplicate });
      }
      invalidatePatientDatabase();
      return res.status(201).json({ status: "created", patient: result.patient, identityStatus: result.identityStatus });
    } catch (e) {
      console.error("[canonicalPatient] create error:", (e as Error)?.message);
      return res.status(500).json({ error: (e as Error)?.message ?? "Failed to create patient" });
    }
  });

  // ── Update a canonical patient (identity-sensitive → collision-checked) ──
  app.patch("/api/patients/canonical/:id", async (req: Request, res: Response) => {
    if (!requireStaff(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const schema = z.object({ updates: draftSchema, force: z.boolean().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });

    try {
      const result = await updateCanonicalPatient({
        screeningId: id,
        updates: parsed.data.updates,
        force: parsed.data.force,
        req,
      });
      if (result.status === "not_found") return res.status(404).json({ error: "Patient not found" });
      if (result.status === "identity_collision") {
        return res.status(409).json({ status: "identity_collision", collision: result.collision, changedFields: result.changedFields });
      }
      invalidatePatientDatabase();
      return res.json({ status: "updated", patient: result.patient, changedFields: result.changedFields });
    } catch (e) {
      console.error("[canonicalPatient] update error:", (e as Error)?.message);
      return res.status(500).json({ error: (e as Error)?.message ?? "Failed to update patient" });
    }
  });
}
