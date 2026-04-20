import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function sessionUserId(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  patientContext: z
    .object({
      name: z.string().optional(),
      age: z.number().nullable().optional(),
      insurance: z.string().nullable().optional(),
      diagnoses: z.string().nullable().optional(),
      history: z.string().nullable().optional(),
      qualifyingTests: z.array(z.string()).optional(),
      previousTests: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const SYSTEM_PROMPT = `You are an AI co-pilot for a medical scheduler making outreach calls to qualify patients for ancillary diagnostic tests (BrainWave, VitalWave, ultrasounds). Be concise, direct, and clinically grounded. When given patient context, tailor your answer to that patient. Never invent clinical facts; if you don't know, say so. Keep replies under 120 words unless the user explicitly asks for more.`;

export function registerSchedulerAiRoutes(app: Express): void {
  app.post("/api/scheduler-ai/ask", async (req: Request, res: Response) => {
    try {
      if (!sessionUserId(req)) return res.status(401).json({ error: "Not authenticated" });
      const parsed = askSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { question, patientContext } = parsed.data;

      const userMessage = patientContext
        ? `Patient context:\n${JSON.stringify(patientContext, null, 2)}\n\nQuestion: ${question}`
        : question;

      const completion = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_completion_tokens: 600,
      });

      const answer = completion.choices[0]?.message?.content?.trim() ?? "";
      res.json({ answer });
    } catch (err: any) {
      console.error("[scheduler-ai] error:", err?.message || err);
      res.status(500).json({ error: err?.message || "AI request failed" });
    }
  });
}
