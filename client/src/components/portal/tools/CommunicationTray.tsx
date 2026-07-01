// Communication tray (Task #643).
//
// iMessage-style tray docked in the bottom half of the Team Portal Tools
// panel. Purple bubbles = outgoing/you; gray bubbles = incoming/teammate.
// Four tabs:
//   - Patient Messages: honest boundary — no patient SMS/messaging backend.
//   - Team Chat:        REAL Plexus task-message threads. Pick one of your
//                       tasks to read + post real messages (attribution is
//                       server-side, so admin view-as can't fake a sender).
//   - Email:            the REAL Email composer (live send endpoints).
//   - Notes:            quick session notes tied to the active patient /
//                       the logged-in user. Session-only, clearly marked.
//
// Nothing here fabricates messages or senders. The Patient tab draft
// composer never sends. The Team tab talks to the real Plexus API.

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageSquare, Users, Mail, NotebookPen, Send, PlugZap, X } from "lucide-react";
import { PortalEmailComposerTab } from "@/components/portal/PortalEmailComposerTab";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type TrayTab = "patient" | "team" | "email" | "notes";

type TraySelectedPatient = {
  patientScreeningId: number;
  name: string;
  email?: string | null;
} | null;

export type TeamTaskThread = { id: number; title: string };

type PlexusMessage = {
  id: number;
  taskId: number;
  senderUserId: string | null;
  body: string;
  createdAt: string;
};

const TABS: { id: TrayTab; label: string; icon: typeof MessageSquare }[] = [
  { id: "patient", label: "Patient", icon: MessageSquare },
  { id: "team", label: "Team", icon: Users },
  { id: "email", label: "Email", icon: Mail },
  { id: "notes", label: "Notes", icon: NotebookPen },
];

function BoundaryState({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-3 py-6 text-center">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <PlugZap className="h-5 w-5" />
          </div>
          <div className="text-xs font-semibold text-slate-700">{title}</div>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">{detail}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function DraftComposer({
  placeholder,
  testId,
}: {
  placeholder: string;
  testId: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="border-t border-white/30 bg-white/40 p-2">
      <div className="mb-1 text-[10px] font-medium text-slate-500">Draft only — not sent</div>
      <div className="flex items-end gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="min-h-[38px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400"
          data-testid={`${testId}-input`}
        />
        <button
          type="button"
          disabled
          title="Sending requires an integration"
          className="inline-flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-xl bg-slate-200 text-slate-400"
          data-testid={`${testId}-send`}
        >
          <Send className="h-4 w-4" />
        </button>
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
    // Keep a valid selection as the task set changes.
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
      <BoundaryState
        title="No task threads yet"
        detail="Team messaging runs on your Plexus task threads. When you're assigned or collaborating on a task, its real conversation shows here — no messages are fabricated."
      />
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

type SessionNote = { id: string; text: string; forName: string | null; by: string };

function NotesTab({
  selectedPatient,
  currentUsername,
}: {
  selectedPatient: TraySelectedPatient;
  currentUsername: string;
}) {
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setNotes((prev) => [
      { id: `n${Date.now()}`, text, forName: selectedPatient?.name ?? null, by: currentUsername || "you" },
      ...prev,
    ]);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        <div className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
          Session notes — cleared on reload (persistence is a next step).
        </div>
        {notes.length === 0 ? (
          <div className="px-1 pt-2 text-[11px] italic text-slate-400">No quick notes yet.</div>
        ) : (
          notes.map((n) => (
            <div
              key={n.id}
              className="group rounded-xl border border-amber-200 bg-amber-100/70 px-2.5 py-1.5"
              data-testid={`tray-note-${n.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap text-xs text-slate-800">{n.text}</p>
                <button
                  type="button"
                  onClick={() => setNotes((prev) => prev.filter((x) => x.id !== n.id))}
                  className="rounded-full p-0.5 text-slate-400 opacity-0 transition hover:bg-white/60 group-hover:opacity-100"
                  aria-label="Delete note"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="mt-0.5 text-[9px] text-slate-500">
                {n.forName ? `Re: ${n.forName} · ` : ""}by {n.by}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-white/30 bg-white/40 p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
            }}
            placeholder={selectedPatient ? `Note about ${selectedPatient.name}…` : "Quick note…"}
            rows={2}
            className="min-h-[38px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400"
            data-testid="tray-note-input"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="tray-note-add"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function CommunicationTray({
  activeTab,
  onTabChange,
  selectedPatient,
  currentUsername,
  currentUserId,
  teamTasks,
}: {
  activeTab: TrayTab;
  onTabChange: (tab: TrayTab) => void;
  selectedPatient: TraySelectedPatient;
  currentUsername: string;
  currentUserId: string | null;
  teamTasks: TeamTaskThread[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="communication-tray">
      <div className="flex items-center gap-1 border-b border-white/30 px-2 py-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition ${
                isActive
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-white/60"
              }`}
              data-testid={`tray-tab-${t.id}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "patient" ? (
          <BoundaryState
            title="Patient messaging not connected"
            detail="Two-way patient SMS/messaging needs an integration. When connected, real threads (purple = you, gray = patient) appear here — no messages are fabricated."
          >
            <DraftComposer placeholder="Draft a patient message…" testId="tray-patient" />
          </BoundaryState>
        ) : activeTab === "team" ? (
          <div className="h-full" data-testid="tray-team">
            <TeamChatTab teamTasks={teamTasks} currentUserId={currentUserId} />
          </div>
        ) : activeTab === "email" ? (
          <div className="h-full overflow-y-auto" data-testid="tray-email">
            <PortalEmailComposerTab
              selectedPatient={
                selectedPatient && selectedPatient.patientScreeningId > 0
                  ? {
                      patientScreeningId: selectedPatient.patientScreeningId,
                      name: selectedPatient.name,
                      email: selectedPatient.email ?? null,
                    }
                  : null
              }
            />
          </div>
        ) : (
          <NotesTab selectedPatient={selectedPatient} currentUsername={currentUsername} />
        )}
      </div>
    </div>
  );
}
