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
        console.error("[plexus-ehr/patients] identity link failed:", err?.message ?? err);
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
          console.error("[plexus-ehr/patients] auto-qualification failed:", aiErr?.message ?? aiErr);
        }
      })();

      res.status(201).json({
        patient: finalPatient ?? patient,
        batchId: batch.id,
        identityResult: identityResult?.status ?? "unknown",
        autoQualificationTriggered: true,
      });
    } catch (error: any) {
      console.error("[plexus-ehr/patients] create error:", error?.message ?? error);
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
        facility: z.string().optional().nullable(),
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
      const effectiveFacility = facility ?? "Taylor Family Practice";
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
        console.error("[plexus-ehr/patients/parse] identity link failed:", err?.message ?? err);
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
          console.error("[plexus-ehr/patients/parse] auto-qualification failed:", aiErr?.message ?? aiErr);
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
      console.error("[plexus-ehr/patients/parse] error:", error?.message ?? error);
      res.status(500).json({ error: error.message ?? "Failed to parse and create patient" });
    }
  });
}
