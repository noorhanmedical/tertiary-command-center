// Communication tray (Task #655).
//
// iMessage-style tray docked in the bottom half of the Team Portal Tools
// panel. Two tabs, both wired to real internal backends:
//   - Direct: real 1:1 person-to-person messaging between team members via the
//             canonical /api/messaging/* conversation model (Phase 1). Sender
//             attribution is decided server-side from the session.
//   - Team:   real Plexus task-message threads (/api/plexus/tasks/:id/messages)
//             used for group / task conversations.
//
// Patient SMS / Twilio is intentionally NOT part of this tray. The
// live Patients tab, all /api/portal/patient-messages/* calls, and
// the PatientMessagesTab component have been removed to prevent any
// live patient-texting path from being reachable.
//
// Email and Notes are not tray tabs — they live in the tool dock.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MessageSquare,
  Users,
  Send,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { messagingFetch } from "@/lib/portalClinicContext";

export type TrayTab = "direct" | "team";

export type TeamTaskThread = { id: number; title: string };

// Optional controlled-selection helper. When an `onChange` is supplied the
// value is owned by the parent (so the docked tray + Playground chat share the
// same selected thread); otherwise the tray keeps its own internal state and
// nothing about the previous behavior changes.
function useControllable<T>(
  value: T | undefined,
  onChange: ((v: T) => void) | undefined,
  initial: T,
) {
  const [internal, setInternal] = useState<T>(initial);
  const controlled = onChange !== undefined;
  const current = controlled ? (value as T) : internal;
  const set = useCallback(
    (v: T) => {
      if (!controlled) setInternal(v);
      onChange?.(v);
    },
    [controlled, onChange],
  );
  return [current, set] as const;
}

// Focus a composer textarea when the parent bumps `focusNonce` (dock tile
// click / expand). Never fires on the initial page load (nonce starts at 0),
// so the slid-aside tray never steals focus on mount.
function useComposerFocus(focusNonce: number) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (focusNonce > 0) {
      ref.current?.focus();
    }
  }, [focusNonce]);
  return ref;
}

// Canonical team channel (message_conversations type='team') + its messages.
type TeamConversation = {
  id: number;
  type: string;
  title: string | null;
  unreadCount: number;
};
type TeamConvMessage = {
  id: number;
  conversationId: number;
  senderUserId: string | null;
  body: string;
  messageType: string;
  createdAt: string;
};

type RosterEntry = { id: string; username: string; role: string | null; unread: number };

type DirectMessage = {
  id: number;
  senderUserId: string;
  recipientUserId: string;
  body: string;
  createdAt: string;
};

const TABS: { id: TrayTab; label: string; icon: typeof MessageSquare }[] = [
  { id: "direct", label: "Direct", icon: MessageSquare },
  { id: "team", label: "Team", icon: Users },
];

type SmsStatus = { connected: boolean; fromNumber: string | null };

type SmsThread = {
  patientPhone: string;
  patientName: string | null;
  lastBody: string;
  lastDirection: string;
  lastAt: string;
  unread: number;
};

type SmsMessage = {
  id: number;
  patientPhone: string;
  patientName: string | null;
  direction: string;
  body: string;
  senderUserId: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

type SmsPatientOption = {
  patientScreeningId: number;
  name: string;
  phone: string;
  dob: string | null;
  facility: string | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}


// Real 1:1 direct messaging. Pick a teammate, read the full thread, send.
function DirectMessagesTab({
  currentUserId,
  activeUserId,
  onActiveUserIdChange,
  focusNonce = 0,
  expanded = false,
}: {
  currentUserId: string | null;
  activeUserId: string | null;
  onActiveUserIdChange: (id: string | null) => void;
  focusNonce?: number;
  expanded?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useComposerFocus(focusNonce);

  // Phase 1 — repointed to the canonical /api/messaging backend (was the
  // broken /api/portal/direct-messages/* path). Roster + per-recipient
  // conversation resolution + list/send all use /api/messaging/*.
  const rosterQuery = useQuery<{ roster: RosterEntry[] }>({
    queryKey: ["/api/messaging/roster"],
    queryFn: async () => {
      const res = await messagingFetch("/api/messaging/roster");
      if (!res.ok) throw new Error("Failed to load teammates");
      return res.json();
    },
    refetchInterval: 20000,
  });

  const roster = useMemo(() => rosterQuery.data?.roster ?? [], [rosterQuery.data]);

  useEffect(() => {
    if (activeUserId == null && roster.length > 0) {
      onActiveUserIdChange(roster[0].id);
    } else if (activeUserId != null && !roster.some((r) => r.id === activeUserId)) {
      onActiveUserIdChange(roster[0]?.id ?? null);
    }
  }, [roster, activeUserId, onActiveUserIdChange]);

  const activePerson = roster.find((r) => r.id === activeUserId) ?? null;

  // Resolve (find-or-create) the 1:1 conversation id for the active recipient.
  const conversationQuery = useQuery<{ conversationId: number }>({
    queryKey: ["/api/messaging/direct", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/messaging/direct", { otherUserId: activeUserId });
      return res.json();
    },
    enabled: activeUserId != null,
    staleTime: 5 * 60 * 1000,
  });
  const conversationId = conversationQuery.data?.conversationId ?? null;

  const messagesQuery = useQuery<{ messages: DirectMessage[] }>({
    queryKey: ["/api/messaging/conversations", conversationId, "messages"],
    queryFn: async () => {
      const res = await messagingFetch(`/api/messaging/conversations/${conversationId}/messages`);
      if (!res.ok) throw new Error("Failed to load conversation");
      return res.json();
    },
    enabled: conversationId != null,
    refetchInterval: 8000,
  });

  const messages = messagesQuery.data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      if (conversationId == null) throw new Error("No conversation selected");
      return apiRequest("POST", `/api/messaging/conversations/${conversationId}/messages`, { body });
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/conversations", conversationId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/roster"] });
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, activeUserId]);

  if (rosterQuery.isLoading) {
    return <div className="px-3 pt-4 text-[11px] italic text-slate-400">Loading teammates…</div>;
  }

  if (roster.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="text-xs font-semibold text-slate-700">No teammates to message yet</div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Direct messages appear here once other team members have accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="tray-direct">
      {/* Recipient picker */}
      <div className="border-b border-white/30 p-2">
        <select
          value={activeUserId ?? ""}
          onChange={(e) => onActiveUserIdChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none"
          data-testid="tray-direct-recipient-select"
        >
          {roster.map((r) => (
            <option key={r.id} value={r.id}>
              {r.username}
              {r.unread > 0 ? ` (${r.unread})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto p-2"
        data-testid="tray-direct-messages"
      >
        {messagesQuery.isLoading ? (
          <div className="px-1 pt-2 text-[11px] italic text-slate-400">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="px-1 pt-2 text-[11px] italic text-slate-400">
            No messages with {activePerson?.username ?? "this teammate"} yet. Say hello below.
          </div>
        ) : (
          messages.map((m) => {
            const mine = !!currentUserId && m.senderUserId === currentUserId;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
                data-testid={`tray-direct-message-${m.id}`}
              >
                {!mine && activePerson ? (
                  <div className="mr-1.5 mt-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[9px] font-semibold text-slate-700">
                    {initials(activePerson.username)}
                  </div>
                ) : null}
                <div
                  className={`max-w-[78%] rounded-2xl px-3 py-1.5 shadow-sm ${
                    expanded ? "text-sm" : "text-xs"
                  } ${
                    mine
                      ? "rounded-br-sm bg-sky-500 text-white"
                      : "rounded-bl-sm bg-slate-200 text-slate-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <div className={`mt-0.5 text-[9px] ${mine ? "text-sky-100" : "text-slate-500"}`}>
                    {mine ? "You" : activePerson?.username ?? "Teammate"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-white/30 bg-white/40 p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                sendMutation.mutate(draft.trim());
              }
            }}
            placeholder={activePerson ? `Message ${activePerson.username}…` : "Message…"}
            rows={expanded ? 3 : 2}
            className={`flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 outline-none placeholder:text-slate-400 ${
              expanded ? "min-h-[56px] text-sm" : "min-h-[38px] text-xs"
            }`}
            data-testid="tray-direct-input"
          />
          <button
            type="button"
            onClick={() => draft.trim() && sendMutation.mutate(draft.trim())}
            disabled={!draft.trim() || sendMutation.isPending || conversationId == null}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="tray-direct-send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Phase 5A — CANONICAL team channels. Team Chat is now a real team CONVERSATION
// (message_conversations type='team'), synced from canonical team_memberships
// (Phase 4D), NOT a disguised Plexus task thread. Reads/posts via
// /api/messaging/conversations/:id/messages; membership is server-enforced.
function TeamChatTab({
  currentUserId,
  activeConversationId,
  onActiveConversationIdChange,
  focusNonce = 0,
  expanded = false,
}: {
  currentUserId: string | null;
  activeConversationId: number | null;
  onActiveConversationIdChange: (id: number | null) => void;
  focusNonce?: number;
  expanded?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const composerRef = useComposerFocus(focusNonce);

  // The user's TEAM conversations (membership-based; server filters to teams
  // they actively belong to).
  const conversationsQuery = useQuery<TeamConversation[]>({
    queryKey: ["/api/messaging/conversations", "team"],
    queryFn: async () => {
      const res = await messagingFetch("/api/messaging/conversations");
      if (!res.ok) throw new Error("Failed to load team channels");
      const json = (await res.json()) as { conversations: TeamConversation[] };
      return (json.conversations ?? []).filter((c) => c.type === "team");
    },
    refetchInterval: 20000,
  });
  const teamChannels = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  useEffect(() => {
    if (activeConversationId == null && teamChannels.length > 0) {
      onActiveConversationIdChange(teamChannels[0].id);
    } else if (activeConversationId != null && !teamChannels.some((c) => c.id === activeConversationId)) {
      onActiveConversationIdChange(teamChannels[0]?.id ?? null);
    }
  }, [teamChannels, activeConversationId, onActiveConversationIdChange]);

  const messagesQuery = useQuery<{ messages: TeamConvMessage[] }>({
    queryKey: ["/api/messaging/conversations", activeConversationId, "messages"],
    queryFn: async () => {
      const res = await messagingFetch(`/api/messaging/conversations/${activeConversationId}/messages`);
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: activeConversationId != null,
    refetchInterval: 15000,
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      if (activeConversationId == null) throw new Error("No channel selected");
      return apiRequest("POST", `/api/messaging/conversations/${activeConversationId}/messages`, { body });
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/conversations", activeConversationId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/conversations", "team"] });
    },
  });

  if (conversationsQuery.isLoading) {
    return <div className="px-3 pt-4 text-[11px] italic text-slate-400">Loading team channels…</div>;
  }

  if (teamChannels.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <Users className="h-5 w-5" />
        </div>
        <div className="text-xs font-semibold text-slate-700">No team channels yet</div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Team Chat shows the channels for the teams you belong to. An admin adds
          you to a team in Settings; its channel appears here automatically.
        </p>
      </div>
    );
  }

  const messages = messagesQuery.data?.messages ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/30 p-2">
        <select
          value={activeConversationId ?? ""}
          onChange={(e) => onActiveConversationIdChange(Number(e.target.value))}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none"
          data-testid="tray-team-channel-select"
        >
          {teamChannels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title ?? "Team channel"}
              {c.unreadCount > 0 ? ` (${c.unreadCount})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2" data-testid="tray-team-messages">
        {messagesQuery.isLoading ? (
          <div className="px-1 pt-2 text-[11px] italic text-slate-400">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="px-1 pt-2 text-[11px] italic text-slate-400">
            No messages in this channel yet. Start the conversation below.
          </div>
        ) : (
          messages.map((m) => {
            const mine = !!currentUserId && m.senderUserId === currentUserId;
            const isSystem = m.messageType === "system";
            return (
              <div
                key={m.id}
                className={`flex ${isSystem ? "justify-center" : mine ? "justify-end" : "justify-start"}`}
                data-testid={`tray-team-message-${m.id}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-1.5 ${
                    expanded ? "text-sm" : "text-xs"
                  } ${
                    isSystem
                      ? "bg-slate-100 text-slate-500 italic text-[11px]"
                      : mine
                      ? "rounded-br-sm bg-violet-600 text-white"
                      : "rounded-bl-sm bg-slate-200 text-slate-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  {!isSystem && (
                    <div className={`mt-0.5 text-[9px] ${mine ? "text-violet-100" : "text-slate-500"}`}>
                      {mine ? "You" : "Teammate"}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-white/30 bg-white/40 p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                sendMutation.mutate(draft.trim());
              }
            }}
            placeholder="Message this team channel…"
            rows={expanded ? 3 : 2}
            ref={composerRef}
            className={`flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 outline-none placeholder:text-slate-400 ${
              expanded ? "min-h-[56px] text-sm" : "min-h-[38px] text-xs"
            }`}
            data-testid="tray-team-input"
          />
          <button
            type="button"
            onClick={() => draft.trim() && sendMutation.mutate(draft.trim())}
            disabled={!draft.trim() || sendMutation.isPending || activeConversationId == null}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="tray-team-send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

const TAB_ACTIVE_CLASS: Record<TrayTab, string> = {
  direct: "bg-sky-500 text-white shadow-sm",
  team: "bg-violet-600 text-white shadow-sm",
};

export function CommunicationTray({
  activeTab,
  onTabChange,
  currentUserId,
  teamTasks,
  directUnread = 0,
  expanded = false,
  onExpand,
  onCollapse,
  focusNonce = 0,
  directActiveUserId,
  onDirectActiveUserIdChange,
  teamActiveTaskId,
  onTeamActiveTaskIdChange,
}: {
  activeTab: TrayTab;
  onTabChange: (tab: TrayTab) => void;
  currentUserId: string | null;
  teamTasks: TeamTaskThread[];
  /** Total unread direct messages, surfaced as a per-tab indicator on the
   *  Direct tab so operators notice new messages (Task #656). */
  directUnread?: number;
  /** When true, render the larger Playground layout (bigger bubbles/composer)
   *  and show the Minimize2 control. (Task #761) */
  expanded?: boolean;
  /** Called when the docked tray's Maximize2 button is clicked. */
  onExpand?: () => void;
  /** Called when the expanded Playground chat's Minimize2 button is clicked. */
  onCollapse?: () => void;
  /** Bump to focus the composer for the active tab. Ignored when 0. */
  focusNonce?: number;
  /** Optional controlled selection so the docked tray and Playground chat
   *  share the same active thread across both tabs. */
  directActiveUserId?: string | null;
  onDirectActiveUserIdChange?: (id: string | null) => void;
  teamActiveTaskId?: number | null;
  onTeamActiveTaskIdChange?: (id: number | null) => void;
}) {
  const [directActive, setDirectActive] = useControllable<string | null>(
    directActiveUserId,
    onDirectActiveUserIdChange,
    null,
  );
  const [teamActive, setTeamActive] = useControllable<number | null>(
    teamActiveTaskId,
    onTeamActiveTaskIdChange,
    null,
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="communication-tray">
      <div className="flex items-center gap-1 border-b border-white/30 px-2 py-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === activeTab;
          const unread = t.id === "direct" ? directUnread : 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              aria-selected={isActive}
              className={`relative inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition ${
                isActive ? TAB_ACTIVE_CLASS[t.id] : "text-slate-600 hover:bg-white/60"
              }`}
              data-testid={`tray-tab-${t.id}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {unread > 0 ? (
                <span
                  className={`ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-semibold ${
                    isActive ? "bg-white/90 text-sky-700" : "bg-rose-600 text-white"
                  }`}
                  data-testid={`tray-tab-${t.id}-unread`}
                >
                  {unread}
                </span>
              ) : null}
            </button>
          );
        })}
        {!expanded && onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            title="Expand to Playground"
            className="ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/60 hover:text-slate-700"
            data-testid="tray-expand"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {expanded && onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse to tray"
            className="ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/60 hover:text-slate-700"
            data-testid="tray-collapse"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {/*
          Active-tab container. The panel wrapper is ALWAYS rendered
          for the active tab (even while the inner tab component is
          fetching its roster or has an empty result set) so external
          consumers — automated tests, focus management, layout
          observers — can rely on a stable
          `data-testid="tray-panel-${activeTab}"` root marker whose
          visibility mirrors "the active tab is mounted." Prior
          `tray-direct` / `tray-team` markers live inside each inner
          tab component and only render once that component has
          content to show, which caused false-negative visibility
          assertions during roster hydration.
        */}
        <div
          className="h-full min-h-0"
          data-testid={`tray-panel-${activeTab}`}
        >
        {activeTab === "direct" ? (
          <DirectMessagesTab
            currentUserId={currentUserId}
            activeUserId={directActive}
            onActiveUserIdChange={setDirectActive}
            focusNonce={focusNonce}
            expanded={expanded}
          />
        ) : (
          <TeamChatTab
            currentUserId={currentUserId}
            activeConversationId={teamActive}
            onActiveConversationIdChange={setTeamActive}
            focusNonce={focusNonce}
            expanded={expanded}
          />
        )}
        </div>
      </div>
    </div>
  );
}
