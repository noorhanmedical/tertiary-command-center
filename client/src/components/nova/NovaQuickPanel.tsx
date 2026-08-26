// Nova Quick Panel — lightweight floating assistant surface.
//
// Opens when the user clicks the Nova ambient particle cluster or the
// Nova dock icon. Shows: search/ask input, context indicator, quick
// action chips, and an "Open in Playground" button.
//
// AI capabilities are wired progressively — this phase provides the
// visual/interaction shell. The actual AI responses come later.

import { useState } from "react";
import { Sparkles, X, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Props ────────────────────────────────────────────────────────────────

export type NovaQuickPanelProps = {
  /** Whether the panel is visible. */
  open: boolean;
  /** Close handler. */
  onClose: () => void;
  /** Open Nova as a full Playground workspace tab. */
  onOpenInPlayground?: () => void;
  /** Current context label (e.g. "Jane Doe · Carotid Duplex"). */
  contextLabel?: string | null;
  /** Additional className for positioning. */
  className?: string;
};

// ─── Quick action chips ───────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "Summarize Patient", prompt: "Summarize this patient's current status." },
  { label: "Next Action", prompt: "What should I do next for this patient?" },
  { label: "Today's Priorities", prompt: "What are my priorities for today?" },
  { label: "Draft Note", prompt: "Draft a callback note for this patient." },
  { label: "Find Report", prompt: "Find the most recent report for this patient." },
];

// ─── Component ────────────────────────────────────────────────────────────

export function NovaQuickPanel({
  open,
  onClose,
  onOpenInPlayground,
  contextLabel,
  className = "",
}: NovaQuickPanelProps) {
  const [query, setQuery] = useState("");

  if (!open) return null;

  return (
    <div
      className={`w-[320px] rounded-[20px] border border-white/60 bg-white/85 shadow-[0_18px_60px_rgba(217,107,198,0.15)] backdrop-blur-xl ${className}`}
      data-testid="nova-quick-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-rose-100/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center">
            <svg viewBox="0 0 20 20" width={18} height={18} aria-hidden="true">
              <circle cx="10" cy="10" r="2" fill="#EC78B6" opacity="0.9" />
              <circle cx="8" cy="9" r="1.2" fill="#F6A6C8" opacity="0.7" />
              <circle cx="12" cy="8.5" r="1" fill="#D96BC6" opacity="0.75" />
              <circle cx="11" cy="12" r="1.3" fill="#B878E6" opacity="0.65" />
              <circle cx="7.5" cy="11.5" r="0.8" fill="#E8B4F2" opacity="0.6" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-900">Nova</span>
          <span className="text-[10px] text-slate-400">Plexus AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          {onOpenInPlayground && (
            <button
              type="button"
              onClick={onOpenInPlayground}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="Open Nova in Playground"
              data-testid="nova-open-playground"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Close"
            data-testid="nova-quick-panel-close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Context indicator */}
      {contextLabel && (
        <div className="border-b border-rose-50/50 px-4 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Context</div>
          <div className="text-xs font-medium text-slate-700 truncate">{contextLabel}</div>
        </div>
      )}

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Ask input */}
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask Nova..."
            className="h-9 pl-3 pr-8 text-sm bg-white/80 border-rose-100/60 focus:border-rose-200 focus:ring-rose-200/30"
            data-testid="nova-quick-input"
          />
          <Sparkles className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-rose-300" />
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => setQuery(action.prompt)}
              className="rounded-full border border-rose-100/60 bg-rose-50/40 px-2.5 py-1 text-[11px] font-medium text-rose-700 transition-colors hover:bg-rose-100/60 hover:border-rose-200"
              data-testid={`nova-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Placeholder response area */}
        <div className="rounded-xl bg-slate-50/60 px-3 py-3 text-center">
          <p className="text-xs text-slate-400 italic">
            Nova is ready to help. Ask a question or select a quick action.
          </p>
        </div>
      </div>

      {/* Footer */}
      {onOpenInPlayground && (
        <div className="border-t border-rose-50/50 px-4 py-2.5">
          <Button
            size="sm"
            variant="ghost"
            className="w-full h-7 gap-1.5 text-[11px] text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            onClick={onOpenInPlayground}
            data-testid="nova-expand-playground"
          >
            <Maximize2 className="h-3 w-3" />
            Open Nova in Playground
          </Button>
        </div>
      )}
    </div>
  );
}
