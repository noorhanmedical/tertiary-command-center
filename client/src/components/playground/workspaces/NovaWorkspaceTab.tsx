// Nova workspace tab — the full AI assistant working environment, rendered in
// the Playground SketchUI language. The ambient Nova particle form (dock icon)
// is a separate concern and is NOT touched here. AI backend capabilities are
// limited; the workspace shell is real. Conversation text stays clean/readable.

import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { SketchButton, SketchInput, SketchSurface } from "../sketch/SketchPrimitives";
import { SKETCH_COLORS } from "../sketch/sketchTokens";
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
    <div className="flex h-full flex-col bg-transparent px-4 py-3" data-testid={`workspace-nova-${workspace.id}`}>
      {/* Header — sketch surface (notebook header). */}
      <SketchSurface seedId={`nova-header-${workspace.id}`} padded={false} className="px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: "rgba(122,106,154,0.14)" }}>
            <Sparkles className="h-4 w-4" style={{ color: SKETCH_COLORS.violet }} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Nova</div>
            <div className="text-[10px] text-slate-500">Plexus AI Assistant · {contextLabel}</div>
          </div>
        </div>
      </SketchSurface>

      {/* Messages */}
      <div className="flex-1 overflow-auto py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="space-y-3 pt-12 text-center">
            <Sparkles className="mx-auto h-10 w-10" style={{ color: "rgba(122,106,154,0.35)" }} />
            <div className="text-lg font-light text-slate-400">Ask Nova anything</div>
            <p className="mx-auto max-w-sm text-sm text-slate-500">
              Summarize patients, find reports, suggest next actions, or help navigate your workspace.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-4">
              {["Summarize my day", "Next action", "Find recent report", "Who is overdue?"].map((chip) => (
                <SketchButton
                  key={chip}
                  variant="ghost"
                  size="sm"
                  seedId={`nova-chip-${chip}`}
                  onClick={() => setQuery(chip)}
                >
                  {chip}
                </SketchButton>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm text-slate-900"
                  style={{ backgroundColor: "rgba(84,106,154,0.14)" }}
                >
                  {msg.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <SketchSurface seedId={`nova-msg-${i}`} padded={false} className="max-w-[80%] px-4 py-2.5">
                  <div className="text-sm text-slate-800">{msg.text}</div>
                </SketchSurface>
              </div>
            ),
          )
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 pt-2">
        <SketchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
          placeholder="Ask Nova..."
          containerClassName="flex-1"
          data-testid="nova-workspace-input"
        />
        <SketchButton
          variant="icon"
          size="sm"
          seedId="nova-send"
          onClick={handleSend}
          disabled={!query.trim()}
          aria-label="Send"
          data-testid="nova-workspace-send"
        >
          <Send className="h-4 w-4" />
        </SketchButton>
      </div>
    </div>
  );
}
