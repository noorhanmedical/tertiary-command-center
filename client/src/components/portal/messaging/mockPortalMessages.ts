// Frontend-only mock data + state hook for the portal Messaging experience
// (Task #740). This is intentionally NOT wired to any backend — it exists so
// the iMessage-style Messaging tab and floating window have believable,
// well-structured data. The shapes mirror what a future real endpoint would
// return so the mock can be swapped for API data without touching the UI.
//
// The Team Portal already has REAL messaging (Twilio patient SMS, direct
// messages, task threads) in the Communication Tray. This module does not
// touch any of that — it powers the new standalone Messaging surface only.

import { useCallback, useMemo, useState } from "react";

export type ConversationType = "direct" | "team" | "patient";

export type Message = {
  id: string;
  senderId: string;
  senderName: string;
  fromMe: boolean;
  body: string;
  /** ISO timestamp. */
  timestamp: string;
};

export type Conversation = {
  id: string;
  type: ConversationType;
  name: string;
  /** Optional avatar image URL; when absent the UI derives initials. */
  avatar?: string;
  initials?: string;
  lastMessage: string;
  /** ISO timestamp of the last message. */
  timestamp: string;
  unreadCount: number;
  facilityName?: string;
  patientName?: string;
  patientScreeningId?: number;
  /** Optional short context labels (e.g. "PCS Follow-up") for patient threads. */
  contextChips?: string[];
  messages: Message[];
};

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

// A small, hand-authored seed set covering all three conversation types with
// realistic previews. Timestamps are relative to load so they always read as
// "recent" in the UI.
const SEED_CONVERSATIONS: Conversation[] = [
  {
    id: "direct-ayman",
    type: "direct",
    name: "Alhadheri Ayman",
    lastMessage: "Sounds good — I'll get those consents uploaded before noon.",
    timestamp: iso(4),
    unreadCount: 2,
    messages: [
      { id: "m1", senderId: "ayman", senderName: "Alhadheri Ayman", fromMe: false, body: "Hey, are the Taylor Family Practice charts ready for tomorrow?", timestamp: iso(28) },
      { id: "m2", senderId: "me", senderName: "You", fromMe: true, body: "Almost — just waiting on two consent forms.", timestamp: iso(22) },
      { id: "m3", senderId: "ayman", senderName: "Alhadheri Ayman", fromMe: false, body: "Perfect. Can you flag the ones that still need signatures?", timestamp: iso(8) },
      { id: "m4", senderId: "ayman", senderName: "Alhadheri Ayman", fromMe: false, body: "Sounds good — I'll get those consents uploaded before noon.", timestamp: iso(4) },
    ],
  },
  {
    id: "direct-viqar",
    type: "direct",
    name: "Viqar Hussain",
    lastMessage: "Thanks, rescheduling the echo now.",
    timestamp: iso(41),
    unreadCount: 0,
    messages: [
      { id: "m1", senderId: "me", senderName: "You", fromMe: true, body: "Patient in room 3 needs their echo moved to Thursday.", timestamp: iso(52) },
      { id: "m2", senderId: "viqar", senderName: "Viqar Hussain", fromMe: false, body: "Thanks, rescheduling the echo now.", timestamp: iso(41) },
    ],
  },
  {
    id: "direct-luz",
    type: "direct",
    name: "Luz",
    lastMessage: "Can you cover the 2pm carotid duplex?",
    timestamp: iso(95),
    unreadCount: 1,
    messages: [
      { id: "m1", senderId: "luz", senderName: "Luz", fromMe: false, body: "Can you cover the 2pm carotid duplex?", timestamp: iso(95) },
    ],
  },
  {
    id: "direct-robert",
    type: "direct",
    name: "Robert Billing",
    lastMessage: "Invoice #4821 was sent to the patient.",
    timestamp: iso(180),
    unreadCount: 0,
    messages: [
      { id: "m1", senderId: "robert", senderName: "Robert Billing", fromMe: false, body: "Invoice #4821 was sent to the patient.", timestamp: iso(180) },
      { id: "m2", senderId: "me", senderName: "You", fromMe: true, body: "Great, thank you!", timestamp: iso(176) },
    ],
  },
  {
    id: "team-pcs",
    type: "team",
    name: "PCS Team",
    lastMessage: "Luz: I'll take the morning call block.",
    timestamp: iso(12),
    unreadCount: 3,
    messages: [
      { id: "m1", senderId: "ayman", senderName: "Alhadheri Ayman", fromMe: false, body: "Morning everyone — 14 follow-ups on the list today.", timestamp: iso(30) },
      { id: "m2", senderId: "me", senderName: "You", fromMe: true, body: "I can take the Taylor Family Practice ones.", timestamp: iso(24) },
      { id: "m3", senderId: "viqar", senderName: "Viqar Hussain", fromMe: false, body: "I'll handle the Medicare cooldown checks.", timestamp: iso(18) },
      { id: "m4", senderId: "luz", senderName: "Luz", fromMe: false, body: "I'll take the morning call block.", timestamp: iso(12) },
    ],
  },
  {
    id: "team-acs",
    type: "team",
    name: "ACS Team",
    lastMessage: "Viqar: Ultrasound room is prepped.",
    timestamp: iso(33),
    unreadCount: 0,
    messages: [
      { id: "m1", senderId: "viqar", senderName: "Viqar Hussain", fromMe: false, body: "Ultrasound room is prepped.", timestamp: iso(33) },
      { id: "m2", senderId: "me", senderName: "You", fromMe: true, body: "Thanks — first patient arrives at 9.", timestamp: iso(31) },
    ],
  },
  {
    id: "team-scheduling",
    type: "team",
    name: "Scheduling Team",
    lastMessage: "Ayman: Moved 3 appointments off the holiday.",
    timestamp: iso(75),
    unreadCount: 1,
    messages: [
      { id: "m1", senderId: "ayman", senderName: "Alhadheri Ayman", fromMe: false, body: "Moved 3 appointments off the holiday.", timestamp: iso(75) },
    ],
  },
  {
    id: "team-billing",
    type: "team",
    name: "Billing Team",
    lastMessage: "Robert: End-of-month invoices go out Friday.",
    timestamp: iso(240),
    unreadCount: 0,
    messages: [
      { id: "m1", senderId: "robert", senderName: "Robert Billing", fromMe: false, body: "End-of-month invoices go out Friday.", timestamp: iso(240) },
    ],
  },
  {
    id: "team-taylor",
    type: "team",
    name: "Taylor Family Practice",
    lastMessage: "Luz: Dr. Taylor approved the ancillary list.",
    timestamp: iso(140),
    unreadCount: 0,
    facilityName: "Taylor Family Practice",
    messages: [
      { id: "m1", senderId: "luz", senderName: "Luz", fromMe: false, body: "Dr. Taylor approved the ancillary list.", timestamp: iso(140) },
      { id: "m2", senderId: "me", senderName: "You", fromMe: true, body: "Perfect, scheduling those now.", timestamp: iso(138) },
    ],
  },
  {
    id: "patient-mary",
    type: "patient",
    name: "Mary Bowerman",
    lastMessage: "Yes, Thursday at 10am works for me.",
    timestamp: iso(6),
    unreadCount: 1,
    patientName: "Mary Bowerman",
    patientScreeningId: 10231,
    facilityName: "Taylor Family Practice",
    contextChips: ["Patient", "Taylor Family Practice", "PCS Follow-up"],
    messages: [
      { id: "m1", senderId: "me", senderName: "You", fromMe: true, body: "Hi Mary, we'd like to schedule your carotid duplex. Does Thursday 10am work?", timestamp: iso(20) },
      { id: "m2", senderId: "mary", senderName: "Mary Bowerman", fromMe: false, body: "Yes, Thursday at 10am works for me.", timestamp: iso(6) },
    ],
  },
  {
    id: "patient-jose",
    type: "patient",
    name: "Jose Murillo",
    lastMessage: "What should I do to prepare for the test?",
    timestamp: iso(52),
    unreadCount: 2,
    patientName: "Jose Murillo",
    patientScreeningId: 10344,
    facilityName: "Riverside Medical",
    contextChips: ["Patient", "Riverside Medical", "ACS Scheduling"],
    messages: [
      { id: "m1", senderId: "me", senderName: "You", fromMe: true, body: "Hi Jose, your echocardiogram is confirmed for Monday.", timestamp: iso(70) },
      { id: "m2", senderId: "jose", senderName: "Jose Murillo", fromMe: false, body: "Thank you!", timestamp: iso(60) },
      { id: "m3", senderId: "jose", senderName: "Jose Murillo", fromMe: false, body: "What should I do to prepare for the test?", timestamp: iso(52) },
    ],
  },
  {
    id: "patient-shayna",
    type: "patient",
    name: "Shayna Kingbird",
    lastMessage: "Got it, see you then.",
    timestamp: iso(200),
    unreadCount: 0,
    patientName: "Shayna Kingbird",
    patientScreeningId: 10402,
    facilityName: "Northside Clinic",
    contextChips: ["Patient", "Northside Clinic", "PCS Follow-up"],
    messages: [
      { id: "m1", senderId: "me", senderName: "You", fromMe: true, body: "Reminder: your renal artery doppler is tomorrow at 1pm.", timestamp: iso(210) },
      { id: "m2", senderId: "shayna", senderName: "Shayna Kingbird", fromMe: false, body: "Got it, see you then.", timestamp: iso(200) },
    ],
  },
];

// Deep clone so consumers can mutate freely without touching the seed.
function cloneSeed(): Conversation[] {
  return SEED_CONVERSATIONS.map((c) => ({
    ...c,
    contextChips: c.contextChips ? [...c.contextChips] : undefined,
    messages: c.messages.map((m) => ({ ...m })),
  }));
}

export function conversationInitials(c: Conversation): string {
  return c.initials ?? initialsOf(c.name);
}

// Human-friendly relative-ish timestamp for the inbox rows / bubbles.
export function formatMessageTime(isoString: string): string {
  const then = new Date(isoString);
  const now = new Date();
  const diffMin = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (diffMin < 1) return "Now";
  if (diffMin < 60) return `${diffMin}m`;
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) {
    return then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const diffDays = Math.floor(diffMin / (60 * 24));
  if (diffDays < 7) {
    return then.toLocaleDateString([], { weekday: "short" });
  }
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

let msgSeq = 0;
function nextMessageId(): string {
  msgSeq += 1;
  return `local_${Date.now()}_${msgSeq}`;
}

/**
 * Owns the mock conversation list + interaction state (mark-as-read, send).
 * Call once in the shell and pass the result to both the inbox panel and the
 * floating window so they share a single source of truth.
 */
export function usePortalMessages() {
  const [conversations, setConversations] = useState<Conversation[]>(() => cloneSeed());

  const markRead = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c)),
    );
  }, []);

  const sendMessage = useCallback((id: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const msg: Message = {
          id: nextMessageId(),
          senderId: "me",
          senderName: "You",
          fromMe: true,
          body: trimmed,
          timestamp: new Date().toISOString(),
        };
        return {
          ...c,
          messages: [...c.messages, msg],
          lastMessage: trimmed,
          timestamp: msg.timestamp,
        };
      }),
    );
  }, []);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations],
  );

  return { conversations, totalUnread, markRead, sendMessage } as const;
}
