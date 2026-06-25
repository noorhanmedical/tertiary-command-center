import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { openai, withRetry } from "../services/aiClient";
import { screenSinglePatientWithAI } from "../services/screening";
import { getQualificationMode } from "./helpers";

type RequireRole = (
  ...roles: string[]
) => (req: Request, res: Response, next: NextFunction) => void;

// Portal assistant endpoints power the simplified scheduler/clinician dock
// (Chat AI + quick single-patient qualification). Both are role-gated to
// scheduler/clinician/admin and never persist a batch — quick-qualify is a
// one-off tool, chat history is in-memory per session on the client.

const ASSISTANT_SYSTEM_PROMPT = `You are the Plexus ancillary screening assistant, helping clinic schedulers and clinicians.

You know the ancillary test catalogue this practice offers:
- BrainWave — EEG/neurocognitive testing for cognitive, neurological and mood disorders, headaches, migraines, dizziness, vertigo, syncope, seizures, memory issues, neuropathy, anxiety, depression, insomnia, chronic pain.
- VitalWave — autonomic nervous system (ANS) and ABI testing for cardiac risk, neuropathy, dysautonomia, hypertension, diabetes, hyperlipidemia, PAD, claudication, obesity, cardiovascular disease.
- Bilateral Carotid Duplex (93880) — stroke risk, hypertension, atherosclerosis, carotid stenosis, TIA history.
- Echocardiogram TTE (93306) — cardiac function, valve disease, heart failure, chest pain, dyspnea, palpitations, AFib, edema, CAD.
- Renal Artery Doppler (93975) — renovascular hypertension, kidney disease, resistant hypertension, diabetic CKD.
- Lower Extremity Arterial Doppler (93925) — PAD, claudication, arterial insufficiency, leg pain, non-healing wounds.
- Abdominal Aortic Aneurysm Duplex (93978) — AAA screening, especially older patients with smoking/CV risk.
- Lower Extremity Venous Duplex (93971) — DVT, venous insufficiency, leg edema, varicose veins, limb swelling.

Qualification philosophy: be aggressive — qualify patients for a test whenever there is any plausible clinical connection between their conditions, symptoms or medications and the test's indications. Only exclude a test when it is glaringly inappropriate.

Cooldown rules: a patient cannot repeat the same test until a cooldown passes — 6 months for PPO insurance, 12 months for Medicare.

General workflow: schedulers build a patient schedule, clinical data is added, the AI qualifies each patient, and outreach/scheduling follows. Qualification produces split reasoning: a "Clinician Understanding" (technical, evidence-based) and "Patient Talking Points" (warm, plain-language for phone outreach).

Answer clearly and concisely. When asked which tests a patient might qualify for, reason from their conditions and medications. Keep responses practical for a busy clinic.`;

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

const quickQualifySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  dob: z.string().trim().max(40).optional(),
  insurance: z.string().trim().max(120).optional(),
  diagnoses: z.string().trim().max(8000).optional(),
  history: z.string().trim().max(8000).optional(),
  medications: z.string().trim().max(8000).optional(),
  noPreviousTests: z.boolean().optional(),
  previousTests: z.string().trim().max(8000).optional(),
});

// Derive an integer age from a DOB string (YYYY-MM-DD or anything Date can
// parse). Returns null when the DOB is missing or unparseable.
function ageFromDob(dob: string | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

export function registerPortalAssistantRoutes(app: Express, requireRole: RequireRole) {
  const gate = requireRole("scheduler", "clinician", "admin");

  // ── Conversational AI assistant ──────────────────────────────────────────
  app.post("/api/portal/chat", gate, async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    try {
      const response = await withRetry(
        () =>
          openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
              ...parsed.data.messages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
            ],
            temperature: 0.4,
            max_completion_tokens: 1200,
          }),
        3,
        "portalChat",
      );
      const reply = response.choices[0]?.message?.content?.trim() || "";
      if (!reply) {
        return res.status(502).json({ error: "Assistant returned an empty response" });
      }
      return res.json({ reply });
    } catch (err: any) {
      console.error("[portal/chat]", err?.message);
      return res.status(500).json({ error: "Assistant request failed. Please try again." });
    }
  });

  // ── One-off single-patient qualification (no batch persistence) ──────────
  app.post("/api/portal/quick-qualify", gate, async (req, res) => {
    const parsed = quickQualifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const input = parsed.data;
    try {
      // The screening service builds its prompt from name/age/gender/dx/hx/rx/
      // notes only, so fold insurance + previous tests into the notes channel.
      const noteParts: string[] = [];
      if (input.insurance) noteParts.push(`Insurance: ${input.insurance}`);
      if (input.noPreviousTests) {
        noteParts.push("No previous ancillary tests on record.");
      } else if (input.previousTests) {
        noteParts.push(`Previous tests: ${input.previousTests}`);
      }

      const mode = await getQualificationMode(null);
      const match = await screenSinglePatientWithAI(
        {
          name: input.name,
          age: ageFromDob(input.dob),
          dob: input.dob ?? null,
          diagnoses: input.diagnoses ?? null,
          history: input.history ?? null,
          medications: input.medications ?? null,
          insurance: input.insurance ?? null,
          notes: noteParts.length > 0 ? noteParts.join("\n") : null,
        },
        mode,
      );

      if (!match) {
        return res.status(502).json({ error: "Qualification returned no result. Please retry." });
      }

      return res.json({
        name: match.name ?? input.name,
        age: match.age ?? ageFromDob(input.dob),
        gender: match.gender ?? null,
        diagnoses: match.diagnoses ?? input.diagnoses ?? null,
        history: match.history ?? input.history ?? null,
        medications: match.medications ?? input.medications ?? null,
        qualifyingTests: Array.isArray(match.qualifyingTests) ? match.qualifyingTests : [],
        reasoning: match.reasoning ?? {},
      });
    } catch (err: any) {
      console.error("[portal/quick-qualify]", err?.message);
      return res.status(500).json({ error: "Qualification failed. Please try again." });
    }
  });
}
