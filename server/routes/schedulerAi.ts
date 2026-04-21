import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { openai, withRetry } from "../services/aiClient";

function requireSchedulerOrAdmin(req: Request, res: Response, next: NextFunction) {
  const sess = (req as Request & { session?: { userId?: string; role?: string } }).session;
  if (!sess?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = sess.role ?? "clinician";
  if (role !== "admin" && role !== "scheduler") {
    return res.status(403).json({ error: "Forbidden — requires scheduler or admin role" });
  }
  return next();
}

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(messageSchema).max(20).optional(),
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
  callListContext: z
    .array(
      z.object({
        name: z.string(),
        bucket: z.string().optional(),
        qualifyingTests: z.array(z.string()).optional(),
      }),
    )
    .max(25)
    .optional(),
});

const SYSTEM_PROMPT = `You are an AI co-pilot for a medical scheduler making outreach calls to qualify patients for ancillary diagnostic tests (BrainWave, VitalWave, ultrasounds). Be concise, direct, and clinically grounded. When given patient context, tailor your answer to that patient. Never invent clinical facts; if you don't know, say so. Keep replies under 120 words unless the user explicitly asks for more.`;

export function registerSchedulerAiRoutes(app: Express): void {
  app.post("/api/scheduler-ai/ask", requireSchedulerOrAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = askSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { question, patientContext, callListContext, history } = parsed.data;

      const groundingParts: string[] = [];
      if (patientContext) {
        groundingParts.push(`Active patient:\n${JSON.stringify(patientContext, null, 2)}`);
      }
      if (callListContext && callListContext.length > 0) {
        groundingParts.push(
          `Today's call list (compact):\n${callListContext
            .map((p) => `- ${p.name} [${p.bucket ?? "?"}] tests=${(p.qualifyingTests ?? []).join(",")}`)
            .join("\n")}`,
        );
      }

      const systemMessages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
      ];
      if (groundingParts.length > 0) {
        systemMessages.push({ role: "system", content: groundingParts.join("\n\n") });
      }

      const historyMessages = (history ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Stream as text/event-stream-style SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const stream = await withRetry(
        () =>
          openai.chat.completions.create({
            model: "gpt-5.1",
            messages: [...systemMessages, ...historyMessages, { role: "user", content: question }],
            max_completion_tokens: 600,
            stream: true,
          }),
        2,
        "scheduler-ai",
      );

      for await (const chunk of stream) {
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: any) {
      console.error("[scheduler-ai] error:", err?.message || err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err?.message || "AI request failed" });
      }
      try {
        res.write(`data: ${JSON.stringify({ error: err?.message || "AI failed" })}\n\n`);
        res.end();
      } catch {}
    }
  });
}
