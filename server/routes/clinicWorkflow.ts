import { Router } from "express";
import { z } from "zod";
import {
  DEFAULT_CLINIC_WORKFLOW_ASSIGNMENT,
  DEFAULT_CLINIC_WORKFLOW_INDICATORS,
  DEFAULT_CLINIC_WORKFLOW_TIMESTAMPS,
  type VisitWorkflowCard,
} from "../../shared/clinicWorkflow";
import { applyWorkflowMutation, getWorkflowQueues } from "../services/clinicWorkflowAutomation";

const router = Router();

const cards = new Map<string, VisitWorkflowCard>();

function seedCard(patientId: string): VisitWorkflowCard {
  const existing = cards.get(patientId);
  if (existing) return existing;
  const created: VisitWorkflowCard = {
    patientId,
    visitId: patientId,
    facility: "UNASSIGNED",
    clinicDate: new Date().toISOString().slice(0, 10),
    appointmentTime: null,
    qualifiedService: null,
    status: "prescreened_eligible",
    indicators: { ...DEFAULT_CLINIC_WORKFLOW_INDICATORS },
    assignment: { ...DEFAULT_CLINIC_WORKFLOW_ASSIGNMENT },
    timestamps: { ...DEFAULT_CLINIC_WORKFLOW_TIMESTAMPS },
  };
  cards.set(patientId, created);
  return created;
}

router.get("/queues", (_req, res) => {
  res.json(getWorkflowQueues(Array.from(cards.values())));
});

router.get("/:patientId", (req, res) => {
  const card = seedCard(String(req.params.patientId));
  res.json(card);
});

router.post("/:patientId/mutate", (req, res) => {
  const patientId = String(req.params.patientId);
  const schema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("engage_liaison") }),
    z.object({ type: z.literal("mark_interested"), interested: z.boolean() }),
    z.object({ type: z.literal("request_same_day") }),
    z.object({ type: z.literal("complete_screening_form") }),
    z.object({ type: z.literal("complete_informed_consent") }),
    z.object({
      type: z.literal("schedule_later"),
      reason: z.enum([
        "patient_unsure",
        "patient_requested_later",
        "time_constraint",
        "liaison_interrupted",
        "technician_unavailable",
        "missing_screening_form",
        "missing_informed_consent",
        "other",
      ]),
      callbackWindow: z.string().nullable(),
    }),
    z.object({ type: z.literal("assign_remote_scheduler"), schedulerId: z.string().min(1) }),
    z.object({ type: z.literal("book_future_appointment") }),
    z.object({ type: z.literal("complete_upcoming_appointment_confirmation") }),
    z.object({ type: z.literal("start_technician_work") }),
    z.object({ type: z.literal("complete_test") }),
  ]);

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid workflow mutation", details: parsed.error.flatten() });
  }

  const current = seedCard(patientId);
  const next = applyWorkflowMutation(current, parsed.data);
  cards.set(patientId, next);
  return res.json(next);
});

export default router;
