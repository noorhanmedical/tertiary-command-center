// Capacity-aware scheduling availability endpoint.
//
// ONE endpoint consumed by BOTH the full UnifiedScheduler and the Quick
// Schedule popover so they never compute availability differently. The client
// renders these server decisions (slots / conflict / suggestions / agenda); it
// does not recompute overlaps.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { RESOURCE_TYPES } from "@shared/schema/schedulingCapacity";
import { computeAvailability } from "../services/scheduling/availabilityService";

const serviceRequestSchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  studyCount: z.number().int().min(1).max(20).optional(),
});

const availabilityBodySchema = z.object({
  facility: z.string().nullable().optional(),
  clinicId: z.number().int().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  services: z.array(serviceRequestSchema).default([]),
  patientKey: z.string().nullable().optional(),
  preferredTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .nullable()
    .optional(),
});

export function registerSchedulingAvailabilityRoutes(app: Express) {
  // GET /api/scheduling/patient-qualification/:screeningId
  // Plexus IQ preselection source for the scheduler: the patient's canonical
  // qualifying ancillary services (patient_screenings.qualifyingTests) mapped
  // to registry internalCode + resource pool, each annotated with its current
  // Admin Review status. Scheduling is NOT blocked by review status — the tag
  // is informational so PCS/ACS can proceed.
  app.get(
    "/api/scheduling/patient-qualification/:screeningId",
    async (req: Request, res: Response) => {
      const screeningId = parseInt(String(req.params.screeningId), 10);
      if (Number.isNaN(screeningId)) {
        return res.status(400).json({ error: "Invalid screening id" });
      }
      try {
        const { storage } = await import("../storage");
        const screening = await storage.getPatientScreening(screeningId);
        if (!screening) return res.status(404).json({ error: "Patient not found" });

        const { getAncillaryCategory } = await import("@shared/ancillaryCategory");
        const { listServices } = await import(
          "../repositories/ancillaryServiceRegistry.repo"
        );
        const { listAncillaryCasesForScreening } = await import(
          "../repositories/ancillaryCases.repo"
        ).catch(() => ({ listAncillaryCasesForScreening: null as never }));

        const registry = await listServices({ activeOnly: true });
        const byName = new Map(registry.map((r) => [r.displayName.toLowerCase(), r]));
        const byCode = new Map(registry.map((r) => [r.internalCode.toLowerCase(), r]));

        // Per-service admin-review status from canonical ancillary cases.
        let reviewByService = new Map<string, string>();
        try {
          if (listAncillaryCasesForScreening) {
            const cases = await listAncillaryCasesForScreening(screeningId);
            reviewByService = new Map(
              cases
                .filter(
                  (c) =>
                    c.lifecycleStatus === "new" ||
                    c.lifecycleStatus === "active" ||
                    c.lifecycleStatus === "on_hold",
                )
                .map((c) => [c.serviceType.toLowerCase(), c.adminReviewStatus ?? "pending"]),
            );
          }
        } catch {
          /* flag/migration guards — fall back to the screening projection */
        }

        const qualifyingTests: string[] = Array.isArray(
          (screening as { qualifyingTests?: string[] }).qualifyingTests,
        )
          ? ((screening as { qualifyingTests?: string[] }).qualifyingTests as string[])
          : [];

        // Per-service qualifying EVIDENCE (why this patient qualifies for THIS
        // study) from the canonical patient_screenings.reasoning jsonb. Keyed by
        // the qualifying-test name; a value may be a rich object or a plain
        // string. This read-only projection lets the scheduler surface a subtle
        // "why qualified" indicator without duplicating qualification logic.
        const reasoningRaw =
          ((screening as { reasoning?: Record<string, unknown> }).reasoning as
            | Record<string, unknown>
            | undefined) ?? {};
        const reasoningByKey = new Map<string, unknown>();
        for (const [k, v] of Object.entries(reasoningRaw)) {
          const clean = k.replace(/\s*\(\d{4,5}\)\s*$/, "").trim().toLowerCase();
          reasoningByKey.set(k.toLowerCase(), v);
          if (!reasoningByKey.has(clean)) reasoningByKey.set(clean, v);
        }
        const evidenceOf = (raw: string, clean: string, displayName: string) => {
          const v =
            reasoningByKey.get(raw.toLowerCase()) ??
            reasoningByKey.get(clean.toLowerCase()) ??
            reasoningByKey.get(displayName.toLowerCase());
          if (v == null) return null;
          if (typeof v === "string") {
            const understanding = v.trim();
            return understanding
              ? { qualifyingFactors: [] as string[], icd10: [] as string[], understanding, adminJustification: null as string | null }
              : null;
          }
          if (typeof v === "object") {
            const o = v as {
              qualifying_factors?: unknown;
              icd10_codes?: unknown;
              clinician_understanding?: unknown;
              admin_justification?: unknown;
            };
            const asStrings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
            const qualifyingFactors = asStrings(o.qualifying_factors);
            const icd10 = asStrings(o.icd10_codes);
            const understanding = typeof o.clinician_understanding === "string" ? o.clinician_understanding.trim() : null;
            const adminJustification = typeof o.admin_justification === "string" ? o.admin_justification.trim() : null;
            if (qualifyingFactors.length === 0 && icd10.length === 0 && !understanding && !adminJustification) return null;
            return { qualifyingFactors, icd10, understanding: understanding || null, adminJustification: adminJustification || null };
          }
          return null;
        };

        const services = qualifyingTests
          .map((raw) => {
            // qualifyingTests may carry CPT suffixes like "Bilateral Carotid Duplex (93880)".
            const clean = raw.replace(/\s*\(\d{4,5}\)\s*$/, "").trim();
            const match =
              byCode.get(clean.toLowerCase()) ??
              byName.get(clean.toLowerCase()) ??
              registry.find(
                (r) =>
                  clean.toLowerCase().includes(r.displayName.toLowerCase()) ||
                  r.displayName.toLowerCase().includes(clean.toLowerCase()),
              ) ??
              null;
            const internalCode = match?.internalCode ?? clean;
            const cat = getAncillaryCategory(internalCode);
            if (cat === "other") return null;
            const reviewStatus =
              reviewByService.get(internalCode.toLowerCase()) ??
              reviewByService.get(clean.toLowerCase()) ??
              null;
            const displayName = match?.displayName ?? clean;
            return {
              rawTest: raw,
              internalCode,
              displayName,
              resourceType: cat,
              cptCode: match?.cptCode ?? null,
              adminReviewStatus: reviewStatus, // approved | pending | needs_info | rejected | null
              qualification: evidenceOf(raw, clean, displayName), // { qualifyingFactors, icd10, understanding, adminJustification } | null
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        // Summary review status across the qualifying services.
        const statuses = services.map((s) => s.adminReviewStatus).filter(Boolean) as string[];
        const adminReviewSummary =
          statuses.length === 0
            ? "not_reviewed"
            : statuses.every((s) => s === "approved")
              ? "approved"
              : statuses.some((s) => s === "rejected" || s === "needs_info")
                ? "partially_reviewed"
                : "pending";

        res.json({
          screeningId,
          patientName: (screening as { name?: string }).name ?? null,
          facility: (screening as { facility?: string }).facility ?? null,
          services,
          adminReviewSummary,
        });
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : "Qualification lookup failed" });
      }
    },
  );

  // POST /api/scheduling/availability
  app.post("/api/scheduling/availability", async (req: Request, res: Response) => {
    const parsed = availabilityBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    try {
      const result = await computeAvailability({
        facilityName: parsed.data.facility ?? null,
        clinicId: parsed.data.clinicId ?? null,
        isoDate: parsed.data.date,
        services: parsed.data.services,
        patientKey: parsed.data.patientKey ?? null,
        preferredTime: parsed.data.preferredTime ?? null,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Availability failed" });
    }
  });
}
