// Nova workspace tab — the full AI assistant working environment.
// AI backend capabilities are limited; the workspace shell is real.

import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNovaContext } from "@/components/nova/NovaContextProvider";
import type { WorkspaceRenderProps } from "../types";

export function NovaWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  const novaCtx = useNovaContext();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "nova"; text: string }>>([]);

  const handleSend = () => {
    if (!query.trim()) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: query },
      { role: "nova", text: "I'm Nova, your Plexus AI assistant. Full AI capabilities are being connected — for now I can help you navigate your workspace." },
    ]);
    setQuery("");
  };

  const contextLabel = novaCtx.patientScreeningId
    ? `Patient #${novaCtx.patientScreeningId}`
    : novaCtx.workspaceType
      ? `Workspace: ${novaCtx.workspaceType}`
      : "General context";

  return (
    <div className="flex h-full flex-col" data-testid={`workspace-nova-${workspace.id}`}>
      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-3 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-indigo-600" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900">Nova</div>
          <div className="text-[10px] text-slate-400">Plexus AI Assistant · {contextLabel}</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center pt-12 space-y-3">
            <Sparkles className="h-10 w-10 text-slate-200 mx-auto" />
            <div className="text-lg font-light text-slate-300">Ask Nova anything</div>
            <p className="text-sm text-slate-400 max-w-sm mx-auto">
              Summarize patients, find reports, suggest next actions, or help navigate your workspace.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-4">
              {["Summarize my day", "Next action", "Find recent report", "Who is overdue?"].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setQuery(chip)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-800"
              }`}>
                {msg.text}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 px-5 py-3">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            placeholder="Ask Nova..."
            className="flex-1"
            data-testid="nova-workspace-input"
          />
          <Button size="sm" onClick={handleSend} disabled={!query.trim()} data-testid="nova-workspace-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
