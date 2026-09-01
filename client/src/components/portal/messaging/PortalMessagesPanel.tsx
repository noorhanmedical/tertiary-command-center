// iMessage-style Messaging inbox for the Team Portal left panel (Task #740).
//
// FRONTEND MOCK ONLY — data comes from mockPortalMessages. Rows show an
// avatar/initials, name, last-message preview, timestamp, an unread dot, a
// type chip, and (for patient threads) a patient/facility context chip.
// Clicking a row opens the floating Messages window. Purple is the accent
// color throughout (selected/unread), matching the portal's purple bubbles.

import { useMemo, useState } from "react";
import { Search, MessageSquare, Users, Smartphone, Plus } from "lucide-react";
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

export type ComposePerson = {
  id: string;
  username: string;
  role: string | null;
  unread: number;
};

export function PortalMessagesPanel({
  conversations,
  activeConversationId,
  onOpenConversation,
  roster = [],
  rosterLoading = false,
  onCompose,
  composePending = false,
  clinicNotSelected = false,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onOpenConversation: (id: string) => void;
  /** Eligible recipients for the compose people-picker. */
  roster?: ComposePerson[];
  rosterLoading?: boolean;
  /** Find-or-create a direct conversation with the chosen person → returns id. */
  onCompose?: (otherUserId: string) => Promise<string>;
  composePending?: boolean;
  /** Admin has no clinic selected → messaging is unavailable until they pick one. */
  clinicNotSelected?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [personSearch, setPersonSearch] = useState("");

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

  const people = useMemo(() => {
    const q = personSearch.trim().toLowerCase();
    return roster
      .filter((p) =>
        !q
          ? true
          : p.username.toLowerCase().includes(q) ||
            (p.role?.toLowerCase().includes(q) ?? false),
      )
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [roster, personSearch]);

  const handlePick = async (personId: string) => {
    if (!onCompose) return;
    const id = await onCompose(personId);
    setComposeOpen(false);
    setPersonSearch("");
    onOpenConversation(id);
  };

  // Admin with no clinic selected — clear, honest empty state; no Compose.
  if (clinicNotSelected) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center"
        data-testid="portal-messages-panel"
      >
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="text-sm font-semibold text-slate-700" data-testid="messages-select-clinic">
          Select a clinic to use messaging
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Choose a clinic from the selector at the top right. Messaging is scoped
          to the selected clinic's team.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="portal-messages-panel">
      {/* New Message + Search */}
      <div className="flex items-center gap-1.5 px-1 pb-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages…"
            className="w-full rounded-xl border border-slate-200 bg-white/80 py-1.5 pl-8 pr-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
            data-testid="messages-search"
          />
        </div>
        <button
          type="button"
          onClick={() => { setComposeOpen((v) => !v); setPersonSearch(""); }}
          disabled={!onCompose}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl bg-purple-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          data-testid="messages-new-message"
          title="New message"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      {/* Compose people picker (Direct). Searchable roster of eligible active
          team members; picking one find-or-creates the 1:1 conversation. */}
      {composeOpen && (
        <div
          className="mx-1 mb-2 rounded-xl border border-purple-200 bg-white shadow-sm"
          data-testid="messages-compose-picker"
        >
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search people…"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
                data-testid="messages-compose-search"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1" data-testid="messages-compose-list">
            {rosterLoading ? (
              <div className="px-2 py-3 text-center text-[11px] italic text-slate-400">Loading people…</div>
            ) : people.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] italic text-slate-400" data-testid="messages-compose-empty">
                No eligible team members.
              </div>
            ) : (
              people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={composePending}
                  onClick={() => handlePick(p.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-purple-50 disabled:opacity-50"
                  data-testid={`messages-compose-person-${p.id}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[10px] font-semibold text-white">
                    {p.username.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-800">{p.username}</span>
                    {p.role ? <span className="block truncate text-[10px] text-slate-400">{p.role}</span> : null}
                  </span>
                  {p.unread > 0 ? (
                    <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-purple-600 px-1 text-[9px] font-semibold text-white">
                      {p.unread}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}

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
