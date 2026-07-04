// Floating Mac/iMessage-style Messages window for the Team Portal (Task #740).
//
// FRONTEND MOCK ONLY. Floats over the Playground (no dimming backdrop — the
// workspace stays visible behind it). Left sidebar = conversation list, right
// = the active thread with a header (name + type + patient/facility chip),
// bubbles (outgoing purple/white, incoming light-gray), and an input bar with
// a plus + send. Team threads label the sender above each incoming bubble;
// patient threads surface a context chip in the header.

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Users, Smartphone, Plus, Send, X, Search } from "lucide-react";
import {
  type Conversation,
  type ConversationType,
  conversationInitials,
  formatMessageTime,
} from "./mockPortalMessages";

const TYPE_META: Record<ConversationType, { label: string; icon: typeof MessageSquare; chip: string; dot: string }> = {
  direct: { label: "Direct", icon: MessageSquare, chip: "bg-sky-100 text-sky-700", dot: "bg-sky-500" },
  team: { label: "Team", icon: Users, chip: "bg-violet-100 text-violet-700", dot: "bg-violet-500" },
  patient: { label: "Patient", icon: Smartphone, chip: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
};

export function PortalMessagesWindow({
  open,
  conversations,
  activeConversationId,
  onSelectConversation,
  onSend,
  onClose,
}: {
  open: boolean;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onSend: (id: string, body: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  const sidebar = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations
      .filter((c) => (q ? c.name.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q) : true))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [conversations, search]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messages.length, activeConversationId, open]);

  if (!open) return null;

  const submit = () => {
    if (!active || !draft.trim()) return;
    onSend(active.id, draft.trim());
    setDraft("");
  };

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center p-4"
      data-testid="portal-messages-window"
    >
      <div className="pointer-events-auto flex h-[560px] max-h-[88vh] w-[840px] max-w-[94vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_40px_120px_rgba(15,23,42,0.35)]">
        {/* Sidebar */}
        <div className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
            <div className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <span className="ml-1 text-xs font-semibold text-slate-700">Messages</span>
          </div>
          <div className="p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
                data-testid="messages-window-search"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2" data-testid="messages-window-list">
            {sidebar.map((c) => {
              const meta = TYPE_META[c.type];
              const selected = c.id === activeConversationId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConversation(c.id)}
                  className={`flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left transition ${
                    selected ? "bg-purple-600 text-white" : "hover:bg-slate-200/70"
                  }`}
                  data-testid={`messages-window-row-${c.id}`}
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${selected ? "bg-white/25" : meta.dot}`}>
                    {conversationInitials(c)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className={`truncate text-xs font-semibold ${selected ? "text-white" : "text-slate-800"}`}>
                        {c.name}
                      </span>
                      <span className={`ml-auto shrink-0 text-[9px] ${selected ? "text-white/70" : "text-slate-400"}`}>
                        {formatMessageTime(c.timestamp)}
                      </span>
                    </div>
                    <p className={`mt-0.5 truncate text-[10px] ${selected ? "text-white/80" : "text-slate-500"}`}>
                      {c.lastMessage}
                    </p>
                  </div>
                  {c.unreadCount > 0 && !selected ? (
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-purple-600" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            {active ? (
              <>
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${TYPE_META[active.type].dot}`}>
                  {conversationInitials(active)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-slate-800" data-testid="messages-window-title">
                      {active.name}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${TYPE_META[active.type].chip}`}>
                      {(() => {
                        const Icon = TYPE_META[active.type].icon;
                        return <Icon className="h-2.5 w-2.5" />;
                      })()}
                      {TYPE_META[active.type].label}
                    </span>
                  </div>
                  {active.type === "patient" || active.facilityName ? (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1" data-testid="messages-window-context">
                      {(active.contextChips ?? [active.facilityName].filter(Boolean) as string[]).map((chip, i) => (
                        <span key={i} className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-medium text-slate-600">
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <span className="text-sm font-semibold text-slate-500">Messages</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              data-testid="messages-window-close"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Bubbles */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50/60 px-4 py-3" data-testid="messages-window-thread">
            {!active ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-600">
                  <MessageSquare className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold text-slate-700">Select a conversation</p>
                <p className="mt-1 text-xs text-slate-500">Pick a thread on the left to start messaging.</p>
              </div>
            ) : (
              active.messages.map((m, i) => {
                const prev = active.messages[i - 1];
                const showSender =
                  active.type === "team" && !m.fromMe && (!prev || prev.senderId !== m.senderId);
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.fromMe ? "items-end" : "items-start"}`}
                    data-testid={`messages-window-bubble-${m.id}`}
                  >
                    {showSender ? (
                      <span className="mb-0.5 ml-2 text-[9px] font-semibold text-slate-500">{m.senderName}</span>
                    ) : null}
                    <div
                      className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        m.fromMe
                          ? "rounded-br-md bg-purple-600 text-white"
                          : "rounded-bl-md bg-slate-200 text-slate-800"
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-snug">{m.body}</p>
                    </div>
                    <span className="mt-0.5 px-1 text-[9px] text-slate-400">{formatMessageTime(m.timestamp)}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Input bar */}
          <div className="border-t border-slate-200 bg-white p-2.5">
            <div className="flex items-end gap-2">
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                data-testid="messages-window-plus"
                title="Add attachment"
                disabled={!active}
              >
                <Plus className="h-4 w-4" />
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={active ? `Message ${active.name}…` : "Select a conversation…"}
                rows={1}
                disabled={!active}
                className="max-h-28 min-h-[38px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-purple-300 focus:ring-1 focus:ring-purple-200 disabled:bg-slate-50"
                data-testid="messages-window-input"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!active || !draft.trim()}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                data-testid="messages-window-send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
