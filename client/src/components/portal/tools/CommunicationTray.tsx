// Communication tray (Task #655, patients added in Task #648).
//
// iMessage-style tray docked in the bottom half of the Team Portal Tools
// panel. Three tabs, all wired to real backends:
//   - Patients: real two-way patient texting via the Twilio adapter
//             (/api/portal/patient-messages/*). Purple bubbles = outgoing
//             (you), gray = incoming (patient). When Twilio isn't connected
//             the composer shows an honest boundary — nothing is faked.
//   - Direct: real 1:1 person-to-person messaging between team members
//             (/api/portal/direct-messages/*). Sender attribution is decided
//             server-side from the session, so nothing is fabricated.
//   - Team:   real Plexus task-message threads (/api/plexus/tasks/:id/messages)
//             used for group / task conversations.
//
// Email and Notes are no longer tray tabs — they live in the tool dock.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MessageSquare,
  Users,
  Send,
  Smartphone,
  Plus,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type TrayTab = "patients" | "direct" | "team";

export type TeamTaskThread = { id: number; title: string };

// Selected patient SMS thread, lifted to the parent so the docked tray and the
// expanded Playground chat stay in sync (Task #761).
export type PatientTraySelection = {
  phone: string | null;
  name: string | null;
  screeningId: number | null;
};

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

type PlexusMessage = {
  id: number;
  taskId: number;
  senderUserId: string | null;
  body: string;
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
  { id: "patients", label: "Patients", icon: Smartphone },
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

// Real two-way patient texting (Task #648). Threads come from
// patient_sms_messages; sends go through POST /api/portal/patient-messages/send
// which only records "sent" after Twilio accepts. When Twilio isn't
// connected we show an honest boundary — the composer never fakes a send.
function PatientMessagesTab({
  selection,
  onSelectionChange,
  focusNonce = 0,
  expanded = false,
}: {
  selection: PatientTraySelection;
  onSelectionChange: (s: PatientTraySelection) => void;
  focusNonce?: number;
  expanded?: boolean;
}) {
  const activePhone = selection.phone;
  const activeName = selection.name;
  const activeScreeningId = selection.screeningId;
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useComposerFocus(focusNonce);

  const statusQuery = useQuery<SmsStatus>({
    queryKey: ["/api/portal/patient-messages/status"],
    queryFn: async () => {
      const res = await fetch("/api/portal/patient-messages/status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to check texting status");
      return res.json();
    },
    refetchInterval: 60000,
  });
  const connected = statusQuery.data?.connected === true;

  const threadsQuery = useQuery<{ threads: SmsThread[]; unreadTotal: number }>({
    queryKey: ["/api/portal/patient-messages/threads"],
    queryFn: async () => {
      const res = await fetch("/api/portal/patient-messages/threads", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load patient threads");
      return res.json();
    },
    refetchInterval: 15000,
  });
  const threads = useMemo(() => threadsQuery.data?.threads ?? [], [threadsQuery.data]);

  useEffect(() => {
    if (activePhone == null && threads.length > 0) {
      onSelectionChange({
        phone: threads[0].patientPhone,
        name: threads[0].patientName,
        screeningId: null,
      });
    }
  }, [threads, activePhone, onSelectionChange]);

  const patientsQuery = useQuery<{ patients: SmsPatientOption[] }>({
    queryKey: ["/api/portal/patient-messages/patients", search],
    queryFn: async () => {
      const u = new URL("/api/portal/patient-messages/patients", window.location.origin);
      if (search.trim()) u.searchParams.set("q", search.trim());
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to search patients");
      return res.json();
    },
    enabled: picking,
  });

  const messagesQuery = useQuery<{ messages: SmsMessage[] }>({
    queryKey: ["/api/portal/patient-messages/thread", activePhone],
    queryFn: async () => {
      const u = new URL("/api/portal/patient-messages/thread", window.location.origin);
      u.searchParams.set("phone", activePhone!);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load conversation");
      return res.json();
    },
    enabled: activePhone != null,
    refetchInterval: 8000,
  });
  const messages = messagesQuery.data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!activePhone) throw new Error("No patient selected");
      return apiRequest("POST", "/api/portal/patient-messages/send", {
        patientPhone: activePhone,
        patientName: activeName ?? undefined,
        patientScreeningId: activeScreeningId ?? undefined,
        body,
      });
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-messages/thread", activePhone] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-messages/threads"] });
    },
    onError: () => {
      // Even failed sends are recorded server-side with the provider error;
      // refresh so the honest "failed" row appears in the thread.
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-messages/thread", activePhone] });
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, activePhone]);

  const activeThread = threads.find((t) => t.patientPhone === activePhone) ?? null;
  const activeLabel = activeName ?? activeThread?.patientName ?? activePhone ?? "";

  return (
    <div className="flex h-full flex-col" data-testid="tray-patients">
      {!statusQuery.isLoading && !connected ? (
        <div
          className="border-b border-amber-200/60 bg-amber-50/80 px-2.5 py-1.5 text-[10px] leading-snug text-amber-800"
          data-testid="tray-patients-not-connected"
        >
          Texting isn't connected yet — connect the Twilio integration to send and receive real
          patient messages. Nothing is sent until then.
        </div>
      ) : null}

      {/* Thread picker + new-conversation toggle */}
      <div className="flex items-center gap-1.5 border-b border-white/30 p-2">
        {picking ? (
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patients with a phone on file…"
            className="w-full flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none placeholder:text-slate-400"
            data-testid="tray-patients-search"
          />
        ) : (
          <select
            value={activePhone ?? ""}
            onChange={(e) => {
              const t = threads.find((x) => x.patientPhone === e.target.value);
              onSelectionChange({
                phone: e.target.value || null,
                name: t?.patientName ?? null,
                screeningId: null,
              });
            }}
            className="w-full flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none"
            data-testid="tray-patients-thread-select"
          >
            {threads.length === 0 ? <option value="">No conversations yet</option> : null}
            {threads.map((t) => (
              <option key={t.patientPhone} value={t.patientPhone}>
                {(t.patientName ?? t.patientPhone) + (t.unread > 0 ? ` (${t.unread})` : "")}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => {
            setPicking((v) => !v);
            setSearch("");
          }}
          title={picking ? "Cancel" : "New conversation"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
          data-testid="tray-patients-new"
        >
          {picking ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>

      {picking ? (
        <div className="flex-1 overflow-y-auto p-2" data-testid="tray-patients-picker">
          {patientsQuery.isLoading ? (
            <div className="px-1 pt-2 text-[11px] italic text-slate-400">Searching…</div>
          ) : (patientsQuery.data?.patients ?? []).length === 0 ? (
            <div className="px-1 pt-2 text-[11px] italic text-slate-400">
              No patients with a phone number on file match.
            </div>
          ) : (
            <div className="space-y-1">
              {(patientsQuery.data?.patients ?? []).map((p) => (
                <button
                  key={`${p.patientScreeningId}-${p.phone}`}
                  type="button"
                  onClick={() => {
                    onSelectionChange({
                      phone: p.phone,
                      name: p.name,
                      screeningId: p.patientScreeningId,
                    });
                    setPicking(false);
                    setSearch("");
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-xs text-slate-800 transition hover:bg-purple-50"
                  data-testid={`tray-patients-option-${p.patientScreeningId}`}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[10px] text-slate-500">{p.phone}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 space-y-2 overflow-y-auto p-2"
          data-testid="tray-patients-messages"
        >
          {activePhone == null ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-100 text-purple-600">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="text-xs font-semibold text-slate-700">No patient conversations yet</div>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">
                Use + to pick a patient with a phone number on file and start a real text thread.
              </p>
            </div>
          ) : messagesQuery.isLoading ? (
            <div className="px-1 pt-2 text-[11px] italic text-slate-400">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="px-1 pt-2 text-[11px] italic text-slate-400">
              No messages with {activeLabel} yet.
            </div>
          ) : (
            messages.map((m) => {
              const outgoing = m.direction === "outbound";
              const failed = m.status === "failed";
              return (
                <div
                  key={m.id}
                  className={`flex ${outgoing ? "justify-end" : "justify-start"}`}
                  data-testid={`tray-patients-message-${m.id}`}
                >
                  {!outgoing ? (
                    <div className="mr-1.5 mt-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[9px] font-semibold text-slate-700">
                      {initials(activeLabel || "?")}
                    </div>
                  ) : null}
                  <div
                    className={`max-w-[78%] rounded-2xl px-3 py-1.5 shadow-sm ${
                      expanded ? "text-sm" : "text-xs"
                    } ${
                      outgoing
                        ? failed
                          ? "rounded-br-sm border border-rose-300 bg-rose-50 text-rose-700"
                          : "rounded-br-sm bg-purple-600 text-white"
                        : "rounded-bl-sm bg-slate-200 text-slate-800"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <div
                      className={`mt-0.5 text-[9px] ${
                        outgoing ? (failed ? "text-rose-500" : "text-purple-200") : "text-slate-500"
                      }`}
                    >
                      {outgoing
                        ? failed
                          ? `Not sent — ${m.errorMessage ?? "provider error"}`
                          : "You"
                        : activeLabel || "Patient"}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="border-t border-white/30 bg-white/40 p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.metaKey || e.ctrlKey) &&
                draft.trim() &&
                connected &&
                activePhone
              ) {
                sendMutation.mutate(draft.trim());
              }
            }}
            placeholder={
              !connected
                ? "Connect Twilio to text patients…"
                : activePhone
                  ? `Text ${activeLabel}…`
                  : "Pick a patient to text…"
            }
            rows={expanded ? 3 : 2}
            disabled={!connected}
            className={`flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 outline-none placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400 ${
              expanded ? "min-h-[56px] text-sm" : "min-h-[38px] text-xs"
            }`}
            data-testid="tray-patients-input"
          />
          <button
            type="button"
            onClick={() => draft.trim() && sendMutation.mutate(draft.trim())}
            disabled={!draft.trim() || sendMutation.isPending || !connected || activePhone == null}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="tray-patients-send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {sendMutation.isError ? (
          <div className="mt-1 px-1 text-[10px] text-rose-600" data-testid="tray-patients-send-error">
            {(sendMutation.error as Error)?.message?.replace(/^\d+:\s*/, "") ||
              "Message failed to send."}
          </div>
        ) : null}
      </div>
    </div>
  );
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

  const rosterQuery = useQuery<{ roster: RosterEntry[] }>({
    queryKey: ["/api/portal/direct-messages/roster"],
    queryFn: async () => {
      const res = await fetch("/api/portal/direct-messages/roster", { credentials: "include" });
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

  const messagesQuery = useQuery<{ messages: DirectMessage[] }>({
    queryKey: ["/api/portal/direct-messages", activeUserId],
    queryFn: async () => {
      const res = await fetch(`/api/portal/direct-messages/${activeUserId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load conversation");
      return res.json();
    },
    enabled: activeUserId != null,
    refetchInterval: 8000,
  });

  const messages = messagesQuery.data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      if (activeUserId == null) throw new Error("No recipient selected");
      return apiRequest("POST", "/api/portal/direct-messages", {
        recipientUserId: activeUserId,
        body,
      });
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/portal/direct-messages", activeUserId] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/direct-messages/roster"] });
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
            disabled={!draft.trim() || sendMutation.isPending || activeUserId == null}
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

// Real Plexus task-message thread. Reads + posts via the existing
// /api/plexus/tasks/:id/messages endpoints. Attribution is decided
// server-side from the session, so admin "view-as" cannot fake a sender.
function TeamChatTab({
  teamTasks,
  currentUserId,
  activeTaskId,
  onActiveTaskIdChange,
  focusNonce = 0,
  expanded = false,
}: {
  teamTasks: TeamTaskThread[];
  currentUserId: string | null;
  activeTaskId: number | null;
  onActiveTaskIdChange: (id: number | null) => void;
  focusNonce?: number;
  expanded?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const composerRef = useComposerFocus(focusNonce);

  useEffect(() => {
    if (activeTaskId == null && teamTasks.length > 0) {
      onActiveTaskIdChange(teamTasks[0].id);
    } else if (activeTaskId != null && !teamTasks.some((t) => t.id === activeTaskId)) {
      onActiveTaskIdChange(teamTasks[0]?.id ?? null);
    }
  }, [teamTasks, activeTaskId, onActiveTaskIdChange]);

  const messagesQuery = useQuery<PlexusMessage[]>({
    queryKey: ["/api/plexus/tasks", activeTaskId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/plexus/tasks/${activeTaskId}/messages`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: activeTaskId != null,
    refetchInterval: 15000,
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      if (activeTaskId == null) throw new Error("No thread selected");
      return apiRequest("POST", `/api/plexus/tasks/${activeTaskId}/messages`, { body });
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks", activeTaskId, "messages"] });
    },
  });

  if (teamTasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <Users className="h-5 w-5" />
        </div>
        <div className="text-xs font-semibold text-slate-700">No task threads yet</div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Group messaging runs on your Plexus task threads. When you're assigned or collaborating on
          a task, its real conversation shows here.
        </p>
      </div>
    );
  }

  const messages = messagesQuery.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/30 p-2">
        <select
          value={activeTaskId ?? ""}
          onChange={(e) => onActiveTaskIdChange(Number(e.target.value))}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none"
          data-testid="tray-team-task-select"
        >
          {teamTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2" data-testid="tray-team-messages">
        {messagesQuery.isLoading ? (
          <div className="px-1 pt-2 text-[11px] italic text-slate-400">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="px-1 pt-2 text-[11px] italic text-slate-400">
            No messages in this thread yet. Start the conversation below.
          </div>
        ) : (
          messages.map((m) => {
            const mine = !!currentUserId && m.senderUserId === currentUserId;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
                data-testid={`tray-team-message-${m.id}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-1.5 ${
                    expanded ? "text-sm" : "text-xs"
                  } ${
                    mine
                      ? "rounded-br-sm bg-violet-600 text-white"
                      : "rounded-bl-sm bg-slate-200 text-slate-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <div className={`mt-0.5 text-[9px] ${mine ? "text-violet-100" : "text-slate-500"}`}>
                    {mine ? "You" : "Teammate"}
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                sendMutation.mutate(draft.trim());
              }
            }}
            placeholder="Message this task thread…"
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
            disabled={!draft.trim() || sendMutation.isPending || activeTaskId == null}
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
  patients: "bg-purple-600 text-white shadow-sm",
  direct: "bg-sky-500 text-white shadow-sm",
  team: "bg-violet-600 text-white shadow-sm",
};

export function CommunicationTray({
  activeTab,
  onTabChange,
  currentUserId,
  teamTasks,
  directUnread = 0,
  patientsUnread = 0,
  expanded = false,
  onExpand,
  onCollapse,
  focusNonce = 0,
  directActiveUserId,
  onDirectActiveUserIdChange,
  teamActiveTaskId,
  onTeamActiveTaskIdChange,
  patientSelection,
  onPatientSelectionChange,
}: {
  activeTab: TrayTab;
  onTabChange: (tab: TrayTab) => void;
  currentUserId: string | null;
  teamTasks: TeamTaskThread[];
  /** Total unread direct messages, surfaced as a per-tab indicator on the
   *  Direct tab so operators notice new messages (Task #656). */
  directUnread?: number;
  /** Total unread inbound patient texts (Task #648). */
  patientsUnread?: number;
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
   *  share the same active thread across all three tabs. */
  directActiveUserId?: string | null;
  onDirectActiveUserIdChange?: (id: string | null) => void;
  teamActiveTaskId?: number | null;
  onTeamActiveTaskIdChange?: (id: number | null) => void;
  patientSelection?: PatientTraySelection;
  onPatientSelectionChange?: (sel: PatientTraySelection) => void;
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
  const [patientSel, setPatientSel] = useControllable<PatientTraySelection>(
    patientSelection,
    onPatientSelectionChange,
    { phone: null, name: null, screeningId: null },
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="communication-tray">
      <div className="flex items-center gap-1 border-b border-white/30 px-2 py-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === activeTab;
          const unread =
            t.id === "direct" ? directUnread : t.id === "patients" ? patientsUnread : 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
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
        {activeTab === "patients" ? (
          <PatientMessagesTab
            selection={patientSel}
            onSelectionChange={setPatientSel}
            focusNonce={focusNonce}
            expanded={expanded}
          />
        ) : activeTab === "direct" ? (
          <DirectMessagesTab
            currentUserId={currentUserId}
            activeUserId={directActive}
            onActiveUserIdChange={setDirectActive}
            focusNonce={focusNonce}
            expanded={expanded}
          />
        ) : (
          <TeamChatTab
            teamTasks={teamTasks}
            currentUserId={currentUserId}
            activeTaskId={teamActive}
            onActiveTaskIdChange={setTeamActive}
            focusNonce={focusNonce}
            expanded={expanded}
          />
        )}
      </div>
    </div>
  );
}
