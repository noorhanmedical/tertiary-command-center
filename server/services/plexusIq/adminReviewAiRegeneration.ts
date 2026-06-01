import OpenAI from "openai";
import type { PatientScreening } from "@shared/schema";
import type {
  AdminEvidenceChip,
  AdminReviewAncillaryId,
} from "@shared/plexus-iq/adminReviewEvidence";

type RegenerateMode = "clinician" | "patient" | "all";

export type AdminReviewAiRegenerationInput = {
  patient: PatientScreening;
  ancillaryId: AdminReviewAncillaryId | string;
  mode: RegenerateMode;
  assignedEvidence: AdminEvidenceChip[];
  ancillaryNote?: string;
  previousClinicianReasoning?: string;
  previousPatientExplanation?: string;
};

export type AdminReviewAiRegenerationOutput = {
  clinicianReasoning: string;
  patientExplanation: string;
  ancillaryNote: string;
};

function patientAge(patient: PatientScreening): number | null {
  if (typeof patient.age === "number") return patient.age;
  if (!patient.dob) return null;

  const dob = new Date(patient.dob);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function evidenceLine(item: AdminEvidenceChip): string {
  const icd = item.icdCode
    ? ` ICD ${item.icdCode}${item.icdLabel ? ` (${item.icdLabel})` : ""}`
    : "";
  const source = item.source ? ` source ${item.source}` : "";
  const detail = item.detail ? ` detail ${item.detail}` : "";
  return `- ${item.kind}: ${item.label}${icd}${source}${detail}`;
}

function parseJsonOutput(raw: string): AdminReviewAiRegenerationOutput {
  const parsed = JSON.parse(raw) as Partial<AdminReviewAiRegenerationOutput>;
  return {
    clinicianReasoning: String(parsed.clinicianReasoning ?? "").trim(),
    patientExplanation: String(parsed.patientExplanation ?? "").trim(),
    ancillaryNote: String(parsed.ancillaryNote ?? "").trim(),
  };
}

export async function regenerateAdminReviewReasoning(
  input: AdminReviewAiRegenerationInput,
): Promise<AdminReviewAiRegenerationOutput> {
  // Repo convention: AI_INTEGRATIONS_OPENAI_API_KEY is the canonical key (set
  // by Replit integration). Fall back to OPENAI_API_KEY for local/dev setups.
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is not configured",
    );
  }

  const client = new OpenAI({ apiKey });
  const age = patientAge(input.patient);
  const under16 = typeof age === "number" && age < 16;
  const evidenceText = input.assignedEvidence.length
    ? input.assignedEvidence.map(evidenceLine).join("\n")
    : "- no selected evidence";

  const systemPrompt = [
    "You generate concise clinician-facing and patient-facing ancillary review text.",
    "Use only the patient context and selected evidence provided.",
    "Do not invent diagnoses, medications, symptoms, ICD codes, prior tests, or eligibility.",
    "Do not say the patient automatically qualifies.",
    "If evidence is weak or missing, state what is missing.",
    "Clinician/admin approval is final.",
    "For patients under 16, clearly state admin approval is required and routine ancillary testing is generally not performed.",
    "Return strict JSON only.",
  ].join("\n");

  const userPrompt = [
    `Ancillary: ${input.ancillaryId}`,
    `Mode requested: ${input.mode}`,
    `Under 16: ${under16 ? "yes" : "no"}`,
    "",
    "Patient context:",
    `Name: ${input.patient.name ?? ""}`,
    `Age: ${age ?? ""}`,
    `Hx: ${input.patient.history ?? ""}`,
    `Dx: ${input.patient.diagnoses ?? ""}`,
    `Rx: ${input.patient.medications ?? ""}`,
    `Admin ancillary note: ${input.ancillaryNote ?? ""}`,
    "",
    "Selected evidence:",
    evidenceText,
    "",
    "Write:",
    "- clinicianReasoning: concise medical rationale tied to selected evidence.",
    "- patientExplanation: simple, patient-friendly explanation.",
    "- ancillaryNote: short admin-facing note for the ancillary card.",
  ].join("\n");

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "admin_review_regeneration",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            clinicianReasoning: { type: "string" },
            patientExplanation: { type: "string" },
            ancillaryNote: { type: "string" },
          },
          required: ["clinicianReasoning", "patientExplanation", "ancillaryNote"],
        },
      },
    },
  });

  const output = parseJsonOutput(response.output_text);

  return {
    clinicianReasoning:
      output.clinicianReasoning || input.previousClinicianReasoning || "",
    patientExplanation:
      output.patientExplanation || input.previousPatientExplanation || "",
    ancillaryNote: output.ancillaryNote || input.ancillaryNote || "",
  };
}
