import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OutreachCallItem } from "./types";

type AiTurn = { role: "user" | "assistant"; content: string };

export function AiBar({
  selectedItem,
  callListContext,
}: {
  selectedItem: OutreachCallItem | null;
  callListContext: { name: string; bucket: string; qualifyingTests: string[] }[];
}) {
  const [aiQuestion, setAiQuestion] = useState("");
  const [history, setHistory] = useState<AiTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [history, streaming]);

  const ask = async () => {
    const q = aiQuestion.trim();
    if (!q || streaming) return;
    setAiError(null);
    setAiQuestion("");
    const nextHistory: AiTurn[] = [...history, { role: "user", content: q }, { role: "assistant", content: "" }];
    setHistory(nextHistory);
    setStreaming(true);

    const ctx = selectedItem
      ? {
          name: selectedItem.patientName,
          age: selectedItem.age ?? null,
          insurance: selectedItem.insurance ?? null,
          diagnoses: selectedItem.diagnoses ?? null,
          history: selectedItem.history ?? null,
          qualifyingTests: selectedItem.qualifyingTests ?? [],
          previousTests: selectedItem.previousTests ?? null,
        }
      : null;

    try {
      const resp = await fetch("/api/scheduler-ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question: q,
          patientContext: ctx,
          callListContext,
          history: history.slice(-10),
        }),
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.text().catch(() => "Request failed");
        throw new Error(err.slice(0, 200));
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
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
          const parsed = JSON.parse(payload);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.delta) {
            acc += parsed.delta;
            setHistory((h) => {
              const copy = h.slice();
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: acc };
              }
              return copy;
            });
          }
        }
      }
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "Failed to get answer");
      setHistory((h) => h.slice(0, -2));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div
      className="px-5 py-4 bg-gradient-to-br from-indigo-50/40 via-transparent to-transparent"
      data-testid="ai-bar"
    >
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-indigo-500" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">AI co-pilot</span>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => { setHistory([]); setAiError(null); }}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            data-testid="ai-bar-clear"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div
          ref={transcriptRef}
          className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-indigo-100 bg-white/80 p-2 text-xs"
          data-testid="ai-bar-transcript"
        >
          {history.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "rounded-lg bg-indigo-50 px-2 py-1 text-indigo-900"
                  : "rounded-lg bg-slate-50 px-2 py-1 text-slate-700 whitespace-pre-wrap"
              }
              data-testid={`ai-bar-turn-${i}-${m.role}`}
            >
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">{m.role}</span>
              <p className="mt-0.5 leading-relaxed">{m.content || (streaming && m.role === "assistant" ? "…" : "")}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-indigo-100 bg-white/80 px-3 py-2">
        <Input
          value={aiQuestion}
          onChange={(e) => setAiQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
          placeholder={selectedItem ? `Ask about ${selectedItem.patientName}…` : "Ask the AI co-pilot…"}
          className="h-8 border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          data-testid="ai-bar-input"
        />
        <Button
          size="sm"
          onClick={ask}
          disabled={streaming || !aiQuestion.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
          data-testid="ai-bar-send"
        >
          {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {aiError && (
        <p className="mt-2 text-xs text-rose-600" data-testid="ai-bar-error">{aiError}</p>
      )}
    </div>
  );
}
