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

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageSquare, Users, Send, Smartphone, Plus, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type TrayTab = "patients" | "direct" | "team";

export type TeamTaskThread = { id: number; title: string };

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
function PatientMessagesTab() {
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [activeScreeningId, setActiveScreeningId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
      setActivePhone(threads[0].patientPhone);
      setActiveName(threads[0].patientName);
    }
  }, [threads, activePhone]);

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
              setActivePhone(e.target.value || null);
              setActiveName(t?.patientName ?? null);
              setActiveScreeningId(null);
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
                    setActivePhone(p.phone);
                    setActiveName(p.name);
                    setActiveScreeningId(p.patientScreeningId);
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
                    className={`max-w-[78%] rounded-2xl px-3 py-1.5 text-xs shadow-sm ${
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
            rows={2}
            disabled={!connected}
            className="min-h-[38px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
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
function DirectMessagesTab({ currentUserId }: { currentUserId: string | null }) {
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
      setActiveUserId(roster[0].id);
    } else if (activeUserId != null && !roster.some((r) => r.id === activeUserId)) {
      setActiveUserId(roster[0]?.id ?? null);
    }
  }, [roster, activeUserId]);

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
          onChange={(e) => setActiveUserId(e.target.value)}
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
                  className={`max-w-[78%] rounded-2xl px-3 py-1.5 text-xs shadow-sm ${
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                sendMutation.mutate(draft.trim());
              }
            }}
            placeholder={activePerson ? `Message ${activePerson.username}…` : "Message…"}
            rows={2}
            className="min-h-[38px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400"
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
}: {
  teamTasks: TeamTaskThread[];
  currentUserId: string | null;
}) {
  const [activeTaskId, setActiveTaskId] = useState<number | null>(teamTasks[0]?.id ?? null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (activeTaskId == null && teamTasks.length > 0) {
      setActiveTaskId(teamTasks[0].id);
    } else if (activeTaskId != null && !teamTasks.some((t) => t.id === activeTaskId)) {
      setActiveTaskId(teamTasks[0]?.id ?? null);
    }
  }, [teamTasks, activeTaskId]);

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
          onChange={(e) => setActiveTaskId(Number(e.target.value))}
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
                  className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-xs ${
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
            rows={2}
            className="min-h-[38px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400"
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
}) {
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
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "patients" ? (
          <PatientMessagesTab />
        ) : activeTab === "direct" ? (
          <DirectMessagesTab currentUserId={currentUserId} />
        ) : (
          <TeamChatTab teamTasks={teamTasks} currentUserId={currentUserId} />
        )}
      </div>
    </div>
  );
}
