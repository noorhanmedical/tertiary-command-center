import { useMemo, useState } from "react";
import {
  Bell,
  Bot,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  Home,
  Mail,
  Menu,
  MessageCircle,
  NotebookPen,
  Phone,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  Smile,
  StickyNote,
  User,
  Users,
  Video,
  Wrench,
} from "lucide-react";

type WorkspaceRole = "patientCareSpecialist" | "ancillaryCareSpecialist";
type LeftRailTab = "messaging" | "notes" | "work" | "system";
type QueueMode = "clinic" | "ancillary" | "calls";

type Conversation = {
  id: string;
  name: string;
  initials: string;
  time: string;
  preview: string;
  unread?: boolean;
  messages: Array<{
    id: string;
    from: "me" | "them" | "system";
    body: string;
    time?: string;
  }>;
};

const CONVERSATIONS: Conversation[] = [
  {
    id: "grace",
    name: "+1 (224) 578-1410",
    initials: "G",
    time: "Yesterday",
    preview: "driving there now. eta 9:07",
    messages: [
      { id: "m1", from: "me", body: "Hi Grace, Ali Imran here. I am not sure if you work at Green Bay still but needed to reach out! I just got to my hotel and taking a quick shower. I will be like 15–20min late." },
      { id: "m2", from: "them", body: "Hi Ali! I’ll tell the team. Thanks for reaching out!" },
      { id: "m3", from: "system", body: "Yesterday 8:22 PM" },
      { id: "m4", from: "them", body: "Hi Ali! Are you on your way here at the hospital?" },
      { id: "m5", from: "me", body: "Yup! I just got to the hotel! I should be there right at 9!" },
      { id: "m6", from: "me", body: "driving there now. eta 9:07" },
    ],
  },
  {
    id: "ayman",
    name: "Alhadheri Ayman",
    initials: "AA",
    time: "2:32 PM",
    preview: "6pm insha’Allah",
    messages: [
      { id: "a1", from: "them", body: "6pm insha’Allah" },
      { id: "a2", from: "me", body: "Sounds good." },
    ],
  },
  {
    id: "ram",
    name: "Ram & +1 (630) 802-8400",
    initials: "R",
    time: "2:22 PM",
    preview: "You liked “Let me check on this for you. Stay tuned on this.”",
    unread: true,
    messages: [
      { id: "r1", from: "them", body: "Let me check on this for you. Stay tuned on this." },
      { id: "r2", from: "me", body: "Thank you." },
    ],
  },
  {
    id: "viqar",
    name: "Viqar Hussain",
    initials: "VH",
    time: "2:22 PM",
    preview: "Just keep a couple clinics in mind IA.",
    messages: [
      { id: "v1", from: "them", body: "Just keep a couple clinics in mind IA. I want to get contracts between all of us." },
    ],
  },
  {
    id: "luz",
    name: "Luz",
    initials: "L",
    time: "Yesterday",
    preview: "Safe travels, Ty",
    unread: true,
    messages: [
      { id: "l1", from: "them", body: "Safe travels, Ty" },
    ],
  },
];

const TAB_LABELS: Record<LeftRailTab, string> = {
  messaging: "Messaging",
  notes: "Notes & Docs",
  work: "Work",
  system: "System",
};

function ToolTile({ label, icon: Icon, onClick }: { label: string; icon: React.ComponentType<{ className?: string }>; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white/80 px-2 py-3 text-center text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
    >
      <Icon className="h-5 w-5" />
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </button>
  );
}

function MiniCalendar() {
  const days = ["", "", "", "1", "2", "3", "4"];
  return (
    <div className="rounded-[24px] bg-white/85 p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between text-xs font-semibold text-slate-700">
        <span>‹</span>
        <span>Jul 2026</span>
        <span>›</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-400">
        {["S", "M", "T", "W", "T", "F", "S"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs text-slate-600">
        {days.map((d, idx) => (
          <div key={`${d}-${idx}`} className={d === "4" ? "rounded-md bg-slate-900 py-1 text-white" : "py-1"}>{d}</div>
        ))}
      </div>
    </div>
  );
}

function LeftRail({ activeTab, setActiveTab, onOpenMessages }: { activeTab: LeftRailTab; setActiveTab: (tab: LeftRailTab) => void; onOpenMessages: () => void }) {
  const content = useMemo(() => {
    if (activeTab === "messaging") {
      return (
        <div className="space-y-3">
          <button
            type="button"
            onClick={onOpenMessages}
            className="flex w-full items-center gap-3 rounded-2xl bg-purple-600 px-4 py-3 text-left text-white shadow-lg shadow-purple-500/20 transition hover:bg-purple-700"
          >
            <MessageCircle className="h-5 w-5" />
            <div>
              <div className="text-sm font-semibold">Open Messages</div>
              <div className="text-[11px] text-purple-100">iMessage-style workspace chat</div>
            </div>
          </button>
          <div className="space-y-2">
            {CONVERSATIONS.slice(0, 4).map((c) => (
              <button key={c.id} type="button" onClick={onOpenMessages} className="flex w-full items-center gap-2 rounded-2xl bg-white/80 p-2 text-left shadow-sm hover:bg-white">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">{c.initials}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-900">{c.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{c.preview}</div>
                </div>
                {c.unread ? <span className="h-2 w-2 rounded-full bg-purple-500" /> : null}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (activeTab === "notes") {
      return (
        <div className="grid grid-cols-2 gap-3">
          <ToolTile label="Sticky Notes" icon={StickyNote} />
          <ToolTile label="Quick Note" icon={NotebookPen} />
          <ToolTile label="Documents" icon={FileText} />
          <ToolTile label="Scripts" icon={ClipboardList} />
          <ToolTile label="Proof/PDFs" icon={FileText} />
        </div>
      );
    }

    if (activeTab === "work") {
      return (
        <div className="grid grid-cols-2 gap-3">
          <ToolTile label="Calendar" icon={CalendarDays} />
          <ToolTile label="Tasks" icon={Bell} />
          <ToolTile label="Calls" icon={Phone} />
          <ToolTile label="Contacts" icon={Users} />
          <ToolTile label="Patient Search" icon={Search} />
          <ToolTile label="Invoice Desk" icon={Building2} />
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-3">
        <ToolTile label="Settings" icon={Settings} />
      </div>
    );
  }, [activeTab, onOpenMessages]);

  return (
    <aside className="absolute left-6 top-6 bottom-6 z-20 w-[330px] rounded-[30px] bg-white/88 shadow-[0_28px_90px_rgba(15,23,42,0.22)] backdrop-blur-xl">
      <div className="flex items-center justify-between rounded-t-[30px] bg-[#4D66AB] px-4 py-3 text-white">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
          <Wrench className="h-4 w-4" /> Tools
        </div>
        <button type="button" className="rounded-full bg-white/90 p-1.5 text-[#4D66AB]"><Pin className="h-4 w-4" /></button>
      </div>
      <div className="flex h-[calc(100%-48px)] flex-col p-4">
        <div className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
          {(Object.keys(TAB_LABELS) as LeftRailTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-2 py-2 text-[10px] font-semibold transition ${activeTab === tab ? "bg-white text-purple-700 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto pr-1">{content}</div>
        <div className="mt-4 text-[11px] leading-snug text-slate-500">Tip: drag Email or Sticky Notes onto the Playground to open a floating widget.</div>
        <div className="mt-3"><MiniCalendar /></div>
      </div>
    </aside>
  );
}

function WorkQueue({ queueMode, setQueueMode }: { queueMode: QueueMode; setQueueMode: (mode: QueueMode) => void }) {
  const modes: Array<{ key: QueueMode; label: string; count: number; icon: React.ComponentType<{ className?: string }> }> = [
    { key: "clinic", label: "Clinic", count: 0, icon: CalendarDays },
    { key: "ancillary", label: "Ancillary", count: 0, icon: Bell },
    { key: "calls", label: "Calls", count: 0, icon: Phone },
  ];
  return (
    <aside className="absolute right-6 top-6 bottom-6 z-20 w-[360px] rounded-[30px] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.18)]">
      <div className="rounded-t-[30px] bg-[#4D66AB] p-4 text-white">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/75">Work Queue</div>
          <div className="flex items-center gap-2 text-xs text-white/70"><span>Today</span><button type="button" className="rounded-full bg-white/90 p-1 text-[#4D66AB]"><Pin className="h-4 w-4" /></button></div>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white/10 p-1">
          {modes.map(({ key, label, count, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setQueueMode(key)} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition ${queueMode === key ? "bg-purple-500 text-white shadow-lg shadow-purple-900/20" : "text-white/65 hover:bg-white/10 hover:text-white"}`}>
              <Icon className="h-4 w-4" /> {label} <span className="rounded-full bg-white/20 px-1.5 text-[10px]">{count}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 text-xs text-white/55">Outreach & follow-up queue</div>
      </div>
      <div className="flex h-[calc(100%-128px)] items-start justify-center px-4 pt-10 text-sm text-slate-500">
        {queueMode === "calls" ? "No calls for this facility/date." : queueMode === "clinic" ? "No clinic patients for this facility/date." : "No ancillary tests scheduled for this facility/date."}
      </div>
    </aside>
  );
}

function MessagesPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState(CONVERSATIONS[0].id);
  const selected = CONVERSATIONS.find((c) => c.id === selectedId) ?? CONVERSATIONS[0];
  if (!open) return null;

  return (
    <div className="absolute inset-x-10 top-8 bottom-12 z-40 overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_35px_120px_rgba(15,23,42,0.34)]" data-testid="portal-messages-popup">
      <div className="grid h-full grid-cols-[380px_1fr]">
        <section className="border-r border-slate-200 bg-slate-50/95">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex gap-2">
              <span className="h-3.5 w-3.5 rounded-full bg-red-400" />
              <span className="h-3.5 w-3.5 rounded-full bg-yellow-400" />
              <span className="h-3.5 w-3.5 rounded-full bg-green-500" />
            </div>
            <div className="flex items-center gap-4 text-slate-700">
              <Menu className="h-5 w-5" />
              <button type="button" onClick={onClose} className="rounded-full bg-white p-2 shadow-sm hover:bg-slate-100" aria-label="Close messages">×</button>
            </div>
          </div>
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-slate-500 shadow-inner">
              <Search className="h-5 w-5" />
              <span className="text-sm font-semibold">Search</span>
            </div>
          </div>
          <div className="space-y-1 overflow-y-auto px-3 pb-5">
            {CONVERSATIONS.map((conversation) => {
              const active = conversation.id === selected.id;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25" : "hover:bg-white"}`}
                >
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold ${active ? "bg-white/25 text-white" : "bg-purple-100 text-purple-700"}`}>{conversation.initials}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold">{conversation.name}</span>
                      <span className={`text-xs ${active ? "text-white/80" : "text-slate-500"}`}>{conversation.time}</span>
                    </div>
                    <div className={`truncate text-sm ${active ? "text-white/90" : "text-slate-500"}`}>{conversation.preview}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
        <section className="flex min-w-0 flex-col bg-white">
          <header className="relative flex items-center justify-center border-b border-slate-100 px-6 py-4">
            <div className="absolute left-6 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 text-lg font-bold text-purple-700">{selected.initials}</div>
            <div className="text-center">
              <div className="rounded-full bg-slate-50 px-4 py-1.5 text-sm font-bold text-slate-900 shadow-sm">{selected.name} ›</div>
            </div>
            <Video className="absolute right-7 h-6 w-6 text-slate-700" />
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto px-8 py-8">
            {selected.messages.map((message) => {
              if (message.from === "system") {
                return <div key={message.id} className="text-center text-xs font-medium text-slate-400">{message.body}</div>;
              }
              const mine = message.from === "me";
              return (
                <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[68%] rounded-[24px] px-4 py-2.5 text-[15px] leading-snug shadow-sm ${mine ? "rounded-br-md bg-purple-600 text-white" : "rounded-bl-md bg-slate-100 text-slate-900"}`}>
                    {message.body}
                  </div>
                </div>
              );
            })}
            <div className="text-right text-xs text-slate-400">Delivered</div>
          </div>
          <footer className="flex items-center gap-3 border-t border-slate-100 px-5 py-4">
            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700"><Plus className="h-5 w-5" /></button>
            <div className="flex flex-1 items-center gap-2 rounded-full bg-slate-100 px-4 py-2.5">
              <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" placeholder="iMessage" />
              <Send className="h-4 w-4 text-purple-600" />
            </div>
            <Smile className="h-6 w-6 text-slate-500" />
          </footer>
        </section>
      </div>
    </div>
  );
}

function Dock({ onOpenMessages }: { onOpenMessages: () => void }) {
  const items = [
    { key: "home", icon: Home, label: "Home" },
    { key: "messages", icon: MessageCircle, label: "Messages", onClick: onOpenMessages },
    { key: "tasks", icon: Bell, label: "Tasks" },
    { key: "calendar", icon: CalendarDays, label: "Calendar" },
    { key: "note", icon: NotebookPen, label: "Quick Note" },
    { key: "patient", icon: User, label: "Patient" },
    { key: "docs", icon: FileText, label: "Documents" },
    { key: "ai", icon: Bot, label: "AI" },
  ];
  return (
    <div className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-3xl bg-slate-400/45 px-3 py-2 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2">
        {items.map(({ key, icon: Icon, label, onClick }) => (
          <button key={key} type="button" onClick={onClick} title={label} className={`relative flex h-12 w-12 items-center justify-center rounded-2xl text-white transition hover:-translate-y-1 hover:bg-white/20 ${key === "messages" ? "bg-purple-600 shadow-lg shadow-purple-500/30" : "bg-white/15"}`}>
            <Icon className="h-5 w-5" />
            {key === "messages" ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-purple-200 px-1 text-[10px] font-bold text-purple-800">2</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TeamMemberPortalPlayground({ role }: { role: WorkspaceRole }) {
  const [leftTab, setLeftTab] = useState<LeftRailTab>("messaging");
  const [queueMode, setQueueMode] = useState<QueueMode>("calls");
  const [messagesOpen, setMessagesOpen] = useState(false);
  const title = role === "ancillaryCareSpecialist" ? "Ancillary Care Specialist Playground" : "Patient Care Specialist Playground";

  return (
    <div className="fixed inset-0 z-[80] overflow-hidden bg-white text-slate-900" data-testid={`portal-playground-${role}`}>
      <header className="absolute left-0 right-0 top-0 z-10 flex h-[76px] items-center justify-between px-8">
        <div className="font-[cursive] text-[34px] italic tracking-tight text-[#2F67F2]">The Playground</div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-600">Viewing as</span>
          <button className="rounded-xl border border-slate-200 bg-white px-5 py-2 shadow-sm">Admin (self)⌄</button>
          <span className="text-slate-600">Clinic</span>
          <button className="rounded-xl border border-slate-200 bg-white px-5 py-2 shadow-sm">Taylor Family/...⌄</button>
          <button className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm"><CalendarDays className="h-5 w-5" /></button>
        </div>
      </header>
      <main className="absolute inset-0 pt-[76px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_80%,rgba(91,111,168,0.13),transparent_32%),radial-gradient(circle_at_78%_18%,rgba(147,51,234,0.08),transparent_26%)]" />
        <div className="absolute left-[395px] right-[395px] top-[110px] text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">{title}</div>
        </div>
        <LeftRail activeTab={leftTab} setActiveTab={setLeftTab} onOpenMessages={() => setMessagesOpen(true)} />
        <WorkQueue queueMode={queueMode} setQueueMode={setQueueMode} />
        <Dock onOpenMessages={() => setMessagesOpen(true)} />
        <MessagesPopup open={messagesOpen} onClose={() => setMessagesOpen(false)} />
      </main>
    </div>
  );
}
