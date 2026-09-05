/**
 * Plexus EHR — Direct patient creation endpoint.
 *
 * Creates a patient directly in the system (global_plexus_patients +
 * patient_clinic_memberships + patient_screenings) without requiring a
 * batch-based intake flow. The patient appears in the EHR immediately
 * and can optionally be queued for AI qualification.
 *
 * Accepts free-form clinical text — the AI parses it into structured fields.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import { patientScreenings, screeningBatches } from "@shared/schema/screening";
import { resolveAndLinkPlexusIdentityForScreening } from "../services/plexusIdentity/screeningIntegration";
import { VALID_FACILITIES } from "@shared/plexus";
import { errorPhiSafe } from "../lib/phiSafeLogger";

const addPatientSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  dob: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  insurance: z.string().optional().nullable(),
  diagnoses: z.string().optional().nullable(),
  medications: z.string().optional().nullable(),
  history: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  facility: z.string().optional().nullable(),
  clinicId: z.number().int().optional().nullable(),
  // Free-form clinical text that can be parsed by AI
  rawClinicalText: z.string().optional().nullable(),
});

export function registerPlexusEhrAddPatientRoutes(app: Express) {
  /**
   * POST /api/plexus-ehr/patients
   *
   * Creates a patient directly in Plexus EHR. Creates a screening batch
   * (type: "ehr_direct_add") if one doesn't exist for today, then inserts
   * the patient_screenings row and links identity.
   */
  app.post("/api/plexus-ehr/patients", async (req: Request, res: Response) => {
    try {
      if (!req.session.role || !["admin", "clinician"].includes(req.session.role)) {
        return res.status(403).json({ error: "Admin or clinician access required" });
      }

      const parsed = addPatientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }

      const data = parsed.data;
      const clinicId = data.clinicId ?? 1; // Default to clinic 1
      const facility = data.facility ?? "Taylor Family Practice";
      const today = new Date().toISOString().slice(0, 10);

      // Find or create an EHR direct-add batch for today
      const batchName = `Plexus EHR — ${today}`;
      const allBatches = await storage.getAllScreeningBatches();
      let batch = allBatches.find(
        (b) => b.name === batchName && b.facility === facility,
      );

      if (!batch) {
        batch = await storage.createScreeningBatch({
          name: batchName,
          facility,
          scheduleDate: today,
          clinicId,
          status: "draft",
          importKind: "full",
          importCreatedBy: req.session.userId ?? undefined,
        });
      }

      // Create the patient screening row
      const patient = await storage.createPatientScreening({
        batchId: batch.id,
        name: data.name,
        dob: data.dob ?? undefined,
        phoneNumber: data.phoneNumber ?? undefined,
        email: data.email ?? undefined,
        gender: data.gender ?? undefined,
        insurance: data.insurance ?? undefined,
        diagnoses: data.diagnoses ?? undefined,
        medications: data.medications ?? undefined,
        history: data.history ?? undefined,
        notes: data.notes ?? data.rawClinicalText ?? undefined,
        facility,
        clinicId,
        status: "draft",
        commitStatus: "Draft",
        patientType: "visit",
      });

      // Link identity
      let identityResult: any = null;
      try {
        identityResult = await resolveAndLinkPlexusIdentityForScreening({
          screeningId: patient.id,
          clinicId,
          sourceSystem: "plexus_ehr_direct_add",
          demographics: {
            displayName: data.name,
            dob: data.dob ?? null,
            phone: data.phoneNumber ?? null,
            email: data.email ?? null,
          },
        });
      } catch (err: any) {
        errorPhiSafe("plexus_ehr_identity_link_failed", {
          route: "POST /api/plexus-ehr/patients",
          error: err?.message ?? String(err),
        });
      }

      // Re-fetch the patient to get identity linkage
      const finalPatient = await storage.getPatientScreening(patient.id);

      // Auto-trigger Plexus IQ qualification (fire-and-forget)
      void (async () => {
        try {
          const { screenSinglePatientWithAI } = await import("../services/screening");
          const { getQualificationMode } = await import("./helpers");
          const mode = await getQualificationMode(facility);
          const result = await screenSinglePatientWithAI({
            name: data.name,
            dob: data.dob ?? null,
            gender: data.gender ?? null,
            diagnoses: data.diagnoses ?? null,
            history: data.history ?? null,
            medications: data.medications ?? null,
            notes: data.notes ?? null,
            insurance: data.insurance ?? null,
          }, mode);
          if (result && result.qualifyingTests && Array.isArray(result.qualifyingTests)) {
            await storage.updatePatientScreening(patient.id, {
              qualifyingTests: result.qualifyingTests,
              reasoning: result.reasoning ?? {},
              status: "completed",
            });
          }
        } catch (aiErr: any) {
          errorPhiSafe("plexus_ehr_auto_qualification_failed", {
            route: "POST /api/plexus-ehr/patients",
            error: aiErr?.message ?? String(aiErr),
          });
        }
      })();

      res.status(201).json({
        patient: finalPatient ?? patient,
        batchId: batch.id,
        identityResult: identityResult?.status ?? "unknown",
        autoQualificationTriggered: true,
      });
    } catch (error: any) {
      errorPhiSafe("plexus_ehr_create_error", {
        route: "POST /api/plexus-ehr/patients",
        error: error?.message ?? String(error),
      });
      res.status(500).json({ error: "Failed to create patient" });
    }
  });

  /**
   * POST /api/plexus-ehr/patients/parse-and-create
   *
   * Accepts free-form clinical text, uses AI to parse it into structured
   * patient data, creates the patient, and returns the result.
   */
  app.post("/api/plexus-ehr/patients/parse-and-create", async (req: Request, res: Response) => {
    try {
      if (!req.session.role || !["admin", "clinician"].includes(req.session.role)) {
        return res.status(403).json({ error: "Admin or clinician access required" });
      }

      const bodySchema = z.object({
        text: z.string().min(1, "Clinical text is required").max(50000),
        facility: z.enum(VALID_FACILITIES, {
          errorMap: () => ({ message: "A valid facility is required" }),
        }),
        clinicId: z.number().int().optional().nullable(),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }

      const { text, facility, clinicId } = parsed.data;

      // Use OpenAI to parse the clinical text
      const { openai, withRetry } = await import("../services/aiClient");

      const parseResponse = await withRetry(
        () =>
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a clinical data extractor. Extract patient information from the provided text and return valid JSON only. Extract as much information as possible. Return this exact JSON structure:
{
  "name": "Full patient name (REQUIRED)",
  "dob": "Date of birth in YYYY-MM-DD format if found, null otherwise",
  "gender": "M or F if determinable, null otherwise",
  "phoneNumber": "Phone number if found, null otherwise",
  "email": "Email if found, null otherwise",
  "insurance": "Insurance info if found, null otherwise",
  "diagnoses": "All diagnoses, conditions, and ICD codes found, comma separated",
  "medications": "All medications found, comma separated",
  "history": "Medical history, surgical history, family history if found",
  "notes": "Any other relevant clinical information"
}`,
              },
              { role: "user", content: text },
            ],
            temperature: 0.1,
            response_format: { type: "json_object" },
          }),
        2,
        "plexus_ehr_parse_patient",
      );

      const content = parseResponse.choices[0]?.message?.content ?? "{}";
      let patientData: Record<string, any>;
      try {
        patientData = JSON.parse(content);
      } catch {
        return res.status(422).json({ error: "AI failed to parse clinical text into structured data" });
      }

      if (!patientData.name || typeof patientData.name !== "string" || patientData.name.trim().length === 0) {
        return res.status(422).json({ error: "Could not extract a patient name from the provided text" });
      }

      // Now create the patient using the structured endpoint logic
      const effectiveClinicId = clinicId ?? 1;
      const effectiveFacility = facility;
      const today = new Date().toISOString().slice(0, 10);

      const batchName = `Plexus EHR — ${today}`;
      const allBatches = await storage.getAllScreeningBatches();
      let batch = allBatches.find(
        (b) => b.name === batchName && b.facility === effectiveFacility,
      );
      if (!batch) {
        batch = await storage.createScreeningBatch({
          name: batchName,
          facility: effectiveFacility,
          scheduleDate: today,
          clinicId: effectiveClinicId,
          status: "draft",
          importKind: "full",
          importCreatedBy: req.session.userId ?? undefined,
        });
      }

      const patient = await storage.createPatientScreening({
        batchId: batch.id,
        name: patientData.name.trim(),
        dob: patientData.dob ?? undefined,
        phoneNumber: patientData.phoneNumber ?? undefined,
        email: patientData.email ?? undefined,
        gender: patientData.gender ?? undefined,
        insurance: patientData.insurance ?? undefined,
        diagnoses: patientData.diagnoses ?? undefined,
        medications: patientData.medications ?? undefined,
        history: patientData.history ?? undefined,
        notes: patientData.notes ?? undefined,
        facility: effectiveFacility,
        clinicId: effectiveClinicId,
        status: "draft",
        commitStatus: "Draft",
        patientType: "visit",
      });

      // Link identity
      let identityResult: any = null;
      try {
        identityResult = await resolveAndLinkPlexusIdentityForScreening({
          screeningId: patient.id,
          clinicId: effectiveClinicId,
          sourceSystem: "plexus_ehr_direct_add",
          demographics: {
            displayName: patientData.name.trim(),
            dob: patientData.dob ?? null,
            phone: patientData.phoneNumber ?? null,
            email: patientData.email ?? null,
          },
        });
      } catch (err: any) {
        errorPhiSafe("plexus_ehr_identity_link_failed", {
          route: "POST /api/plexus-ehr/patients/parse",
          error: err?.message ?? String(err),
        });
      }

      const finalPatient = await storage.getPatientScreening(patient.id);

      // Auto-trigger Plexus IQ qualification (fire-and-forget — don't block response)
      void (async () => {
        try {
          const { screenSinglePatientWithAI } = await import("../services/screening");
          const { getQualificationMode } = await import("./helpers");
          const mode = await getQualificationMode(effectiveFacility);
          const result = await screenSinglePatientWithAI({
            name: patientData.name,
            dob: patientData.dob ?? null,
            gender: patientData.gender ?? null,
            diagnoses: patientData.diagnoses ?? null,
            history: patientData.history ?? null,
            medications: patientData.medications ?? null,
            notes: patientData.notes ?? null,
            insurance: patientData.insurance ?? null,
          }, mode);
          if (result && result.qualifyingTests && Array.isArray(result.qualifyingTests)) {
            await storage.updatePatientScreening(patient.id, {
              qualifyingTests: result.qualifyingTests,
              reasoning: result.reasoning ?? {},
              status: "completed",
            });
          }
        } catch (aiErr: any) {
          errorPhiSafe("plexus_ehr_auto_qualification_failed", {
            route: "POST /api/plexus-ehr/patients/parse",
            error: aiErr?.message ?? String(aiErr),
          });
        }
      })();

      res.status(201).json({
        patient: finalPatient ?? patient,
        batchId: batch.id,
        parsedFields: patientData,
        identityResult: identityResult?.status ?? "unknown",
        autoQualificationTriggered: true,
      });
    } catch (error: any) {
      errorPhiSafe("plexus_ehr_parse_error", {
        route: "POST /api/plexus-ehr/patients/parse",
        error: error?.message ?? String(error),
      });
      res.status(500).json({ error: error.message ?? "Failed to parse and create patient" });
    }
  });

  /**
   * POST /api/plexus-ehr/patients/parse-preview
   *
   * Accepts free-form pasted text that may contain ONE OR MANY patients
   * (rosters, schedules, one-per-line lists, or clinical notes). Uses AI to
   * extract EVERY distinct patient and returns them as an array WITHOUT
   * writing anything to the database. The client shows this list in a
   * confirmation popup; the user then commits via POST /api/plexus-ehr/patients
   * per confirmed patient.
   *
   * On AI failure this returns HTTP 502 with code "ai_parse_unavailable" so
   * the client can fall back to manual entry rather than dead-ending.
   */
  app.post("/api/plexus-ehr/patients/parse-preview", async (req: Request, res: Response) => {
    try {
      if (!req.session.role || !["admin", "clinician"].includes(req.session.role)) {
        return res.status(403).json({ error: "Admin or clinician access required" });
      }

      const bodySchema = z.object({
        text: z.string().min(1, "Clinical text is required").max(50000),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { text } = parsed.data;

      const { openai, withRetry } = await import("../services/aiClient");

      let parseResponse;
      try {
        parseResponse = await withRetry(
          () =>
            openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content: `You are a clinical data extractor. The pasted text may describe ONE patient or MANY patients (a roster, a schedule, a table, or a one-patient-per-line list). Extract EVERY distinct patient you can find — do not merge multiple people into one, and do not drop anyone.

Return valid JSON ONLY, in exactly this shape:
{
  "patients": [
    {
      "name": "Full patient name, formatted 'First Last' (REQUIRED)",
      "dob": "YYYY-MM-DD if found, else null",
      "gender": "M or F if determinable, else null",
      "phoneNumber": "phone if found, else null",
      "email": "email if found, else null",
      "insurance": "insurance if found, else null",
      "diagnoses": "diagnoses/conditions/ICD codes, comma separated, else null",
      "medications": "medications, comma separated, else null",
      "history": "medical/surgical/family history if found, else null",
      "notes": "any other relevant clinical info, else null",
      "confidence": "high | medium | low — your confidence in the name extraction"
    }
  ]
}

Rules:
- Each row/line that names a person becomes its own patient object.
- Normalize names to 'First Last' (convert 'Last, First' → 'First Last'). Preserve suffixes (Jr, III) but strip titles (Mr, Dr).
- Never invent a patient. If the text names no patient, return {"patients": []}.
- Convert dates like 05/14/1960 or 5-14-60 to YYYY-MM-DD; if the year is ambiguous, prefer a plausible adult DOB.`,
                },
                { role: "user", content: text },
              ],
              temperature: 0.1,
              response_format: { type: "json_object" },
            }),
          2,
          "plexus_ehr_parse_preview",
        );
      } catch (aiErr: any) {
        errorPhiSafe("plexus_ehr_ai_unavailable", {
          route: "POST /api/plexus-ehr/parse-preview",
          error: aiErr?.message ?? String(aiErr),
        });
        return res.status(502).json({
          error: "Automatic parsing is unavailable right now. You can enter patients manually.",
          code: "ai_parse_unavailable",
        });
      }

      const content = parseResponse.choices[0]?.message?.content ?? "{}";
      let parsedJson: Record<string, any>;
      try {
        parsedJson = JSON.parse(content);
      } catch {
        return res.status(422).json({
          error: "Could not parse the pasted text automatically. You can enter patients manually.",
          code: "ai_parse_unusable",
        });
      }

      const rawList = Array.isArray(parsedJson.patients) ? parsedJson.patients : [];
      const patients = rawList
        .map((p: any) => ({
          name: typeof p?.name === "string" ? p.name.trim() : "",
          dob: p?.dob ?? null,
          gender: p?.gender ?? null,
          phoneNumber: p?.phoneNumber ?? null,
          email: p?.email ?? null,
          insurance: p?.insurance ?? null,
          diagnoses: p?.diagnoses ?? null,
          medications: p?.medications ?? null,
          history: p?.history ?? null,
          notes: p?.notes ?? null,
          confidence: ["high", "medium", "low"].includes(p?.confidence) ? p.confidence : "medium",
        }))
        .filter((p: { name: string }) => p.name.length > 0);

      return res.status(200).json({ patients, count: patients.length });
    } catch (error: any) {
      errorPhiSafe("plexus_ehr_parse_preview_error", {
        route: "POST /api/plexus-ehr/parse-preview",
        error: error?.message ?? String(error),
      });
      res.status(500).json({ error: "Failed to parse pasted text" });
    }
  });
}
