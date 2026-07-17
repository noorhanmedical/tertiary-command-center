// iMessage-style Messaging inbox for the Team Portal left panel (Task #740).
//
// FRONTEND MOCK ONLY — data comes from mockPortalMessages. Rows show an
// avatar/initials, name, last-message preview, timestamp, an unread dot, a
// type chip, and (for patient threads) a patient/facility context chip.
// Clicking a row opens the floating Messages window. Purple is the accent
// color throughout (selected/unread), matching the portal's purple bubbles.

import { useMemo, useState } from "react";
import { Search, MessageSquare, Users, Smartphone } from "lucide-react";
import {
  type Conversation,
  type ConversationType,
  conversationInitials,
  formatMessageTime,
} from "./mockPortalMessages";

type Filter = "all" | "direct" | "team" | "patient";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "direct", label: "Direct" },
  { id: "team", label: "Teams" },
  { id: "patient", label: "Patients" },
];

const TYPE_META: Record<ConversationType, { label: string; icon: typeof MessageSquare; chip: string }> = {
  direct: { label: "Direct", icon: MessageSquare, chip: "bg-sky-100 text-sky-700" },
  team: { label: "Team", icon: Users, chip: "bg-violet-100 text-violet-700" },
  patient: { label: "Patient", icon: Smartphone, chip: "bg-emerald-100 text-emerald-700" },
};

function AvatarBubble({ conversation }: { conversation: Conversation }) {
  const { type } = conversation;
  const ring =
    type === "direct"
      ? "bg-sky-500"
      : type === "team"
        ? "bg-violet-500"
        : "bg-emerald-500";
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${ring}`}
      data-testid={`messages-avatar-${conversation.id}`}
    >
      {conversationInitials(conversation)}
    </div>
  );
}

export function PortalMessagesPanel({
  conversations,
  activeConversationId,
  onOpenConversation,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onOpenConversation: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations
      .filter((c) => (filter === "all" ? true : c.type === filter))
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.lastMessage.toLowerCase().includes(q) ||
          (c.facilityName?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [conversations, filter, search]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="portal-messages-panel">
      {/* Search */}
      <div className="px-1 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages…"
            className="w-full rounded-xl border border-slate-200 bg-white/80 py-1.5 pl-8 pr-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
            data-testid="messages-search"
          />
        </div>
      </div>

      {/* Segmented control */}
      <div
        className="mx-1 mb-2 grid grid-cols-4 gap-0.5 rounded-xl bg-slate-100/80 p-0.5"
        data-testid="messages-filter"
      >
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-lg py-1 text-[10px] font-semibold transition ${
                active
                  ? "bg-white text-purple-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              data-testid={`messages-filter-${f.id}`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Conversation rows */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 pb-1" data-testid="messages-list">
        {visible.length === 0 ? (
          <div className="px-2 pt-6 text-center text-[11px] italic text-slate-400" data-testid="messages-empty">
            No conversations match.
          </div>
        ) : (
          visible.map((c) => {
            const meta = TYPE_META[c.type];
            const selected = c.id === activeConversationId;
            const unread = c.unreadCount > 0;
            const contextChip =
              c.type === "patient"
                ? c.facilityName ?? "Patient"
                : c.type === "team" && c.facilityName
                  ? c.facilityName
                  : null;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenConversation(c.id)}
                className={`flex w-full items-start gap-2.5 rounded-2xl border px-2.5 py-2 text-left transition ${
                  selected
                    ? "border-purple-300 bg-purple-50"
                    : "border-transparent hover:border-slate-200 hover:bg-white"
                }`}
                data-testid={`messages-row-${c.id}`}
              >
                <AvatarBubble conversation={c} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`truncate text-xs ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}
                      data-testid={`messages-row-name-${c.id}`}
                    >
                      {c.name}
                    </span>
                    <span className="ml-auto shrink-0 text-[9px] text-slate-400" data-testid={`messages-row-time-${c.id}`}>
                      {formatMessageTime(c.timestamp)}
                    </span>
                    {unread ? (
                      <span
                        className="ml-0.5 inline-flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-purple-600 px-1 text-[9px] font-semibold text-white"
                        data-testid={`messages-row-unread-${c.id}`}
                      >
                        {c.unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={`mt-0.5 truncate text-[11px] ${unread ? "text-slate-700" : "text-slate-500"}`}
                    data-testid={`messages-row-preview-${c.id}`}
                  >
                    {c.lastMessage}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${meta.chip}`}>
                      <meta.icon className="h-2.5 w-2.5" />
                      {meta.label}
                    </span>
                    {contextChip ? (
                      <span className="inline-flex max-w-[130px] items-center truncate rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-medium text-slate-600">
                        {contextChip}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
