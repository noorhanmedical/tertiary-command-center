export type SchedulerAiPatientContext = {
  name: string;
  age: string | number | null;
  insurance: string | null;
  diagnoses: string | null;
  history: string | null;
  qualifyingTests: string[];
  previousTests: string | null;
};

export type SchedulerAiCallListItem = {
  name: string;
  bucket: string;
  qualifyingTests: string[];
};

export type SchedulerAiTurn = { role: "user" | "assistant"; content: string };

export type SchedulerAiAskInput = {
  question: string;
  patientContext: SchedulerAiPatientContext | null;
  callListContext: SchedulerAiCallListItem[];
  history: SchedulerAiTurn[];
};

export async function streamSchedulerAiAnswer(
  input: SchedulerAiAskInput,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch("/api/scheduler-ai/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const err = await resp.text().catch(() => "Request failed");
    throw new Error(err.slice(0, 200));
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;
      const parsed = JSON.parse(payload) as { error?: string; delta?: string };
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.delta) onDelta(parsed.delta);
    }
  }
}
