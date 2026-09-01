// First-class messaging service (Phase 1).
//
// Auth boundary for the canonical conversation model. Enforces:
//   • Caller must be an active member of the conversation to read/post.
//   • Direct conversations are INTERNAL user-to-user only (no phone numbers).
//   • Body sanitization (strip angle brackets) + length cap.
//   • Rate limit: max 10 sends / 10s per sender.
//   • PHI-safe live signal on send (eventType only; never the body/patient).
//
// This service replaces the flag-gated /api/internal-messages backend and the
// commented-out /api/portal/direct-messages endpoints as the ONE messaging
// backend. It is NOT feature-flagged — it is the canonical path.

import {
  findOrCreateDirectConversation,
  listConversationsForUser,
  isConversationMember,
  getConversationById,
  listMessages,
  createMessage,
  markConversationRead,
  countTotalUnread,
  listRoster,
} from "../../repositories/messaging.repo";
import { publishLiveActivity } from "../engagement/liveActivityBus";

const rateLimitBuckets = new Map<string, number[]>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 10_000;

function sanitizeBody(input: string): string {
  return String(input).replace(/[<>]/g, "").trim().slice(0, 4_000);
}

function assertRateLimit(senderUserId: string, now = Date.now()): void {
  const bucket = rateLimitBuckets.get(senderUserId) ?? [];
  const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) {
    const err = new Error("Message rate limit exceeded") as Error & { code?: string };
    err.code = "RATE_LIMITED";
    throw err;
  }
  fresh.push(now);
  rateLimitBuckets.set(senderUserId, fresh);
}

function validationError(message: string): Error & { code?: string } {
  const err = new Error(message) as Error & { code?: string };
  err.code = "VALIDATION";
  return err;
}

function forbiddenError(message: string): Error & { code?: string } {
  const err = new Error(message) as Error & { code?: string };
  err.code = "FORBIDDEN";
  return err;
}

export async function getMyConversations(args: { clinicId: number; userId: string }) {
  return listConversationsForUser(args);
}

export async function getMyUnreadCount(args: { clinicId: number; userId: string }) {
  return countTotalUnread(args);
}

export async function getRoster(args: { clinicId: number; meUserId: string }) {
  return listRoster(args);
}

/** Open (find-or-create) a 1:1 direct conversation and return its id. */
export async function openDirectConversation(args: {
  clinicId: number;
  meUserId: string;
  otherUserId: string;
}): Promise<{ conversationId: number }> {
  if (!args.otherUserId) throw validationError("otherUserId required");
  if (args.meUserId === args.otherUserId) throw validationError("Cannot message yourself");
  // INTERNAL-only guard: recipient must be an internal user id, never a phone.
  if (/^\+?[\d\s\-().]{7,}$/.test(args.otherUserId)) {
    throw validationError("Recipient must be an internal user id");
  }
  const conv = await findOrCreateDirectConversation(args);
  return { conversationId: conv.id };
}

export async function getConversationMessages(args: {
  conversationId: number;
  userId: string;
  limit?: number;
}) {
  const member = await isConversationMember(args.conversationId, args.userId);
  if (!member) throw forbiddenError("Not a member of this conversation");
  return listMessages({ conversationId: args.conversationId, limit: args.limit });
}

export async function postMessage(args: {
  conversationId: number;
  senderUserId: string;
  body: string;
}) {
  const member = await isConversationMember(args.conversationId, args.senderUserId);
  if (!member) throw forbiddenError("Not a member of this conversation");
  const body = sanitizeBody(args.body);
  if (!body) throw validationError("Message body required");
  assertRateLimit(args.senderUserId);

  const message = await createMessage({
    conversationId: args.conversationId,
    senderUserId: args.senderUserId,
    body,
  });

  // Sender has now seen their own message.
  await markConversationRead({ conversationId: args.conversationId, userId: args.senderUserId });

  // PHI-safe live signal — eventType only, never the body/patient.
  publishLiveActivity("message_sent");
  return message;
}

/** Post a system/workflow message (handoff/assignment notice). No human
 *  sender; used by workforce flows in later phases. PHI-safe SSE signal. */
export async function postSystemMessage(args: {
  conversationId: number;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  const body = sanitizeBody(args.body);
  if (!body) throw validationError("System message body required");
  const message = await createMessage({
    conversationId: args.conversationId,
    senderUserId: null,
    body,
    messageType: "system",
    metadata: args.metadata,
  });
  publishLiveActivity("message_sent");
  return message;
}

export async function markRead(args: { conversationId: number; userId: string }) {
  const member = await isConversationMember(args.conversationId, args.userId);
  if (!member) throw forbiddenError("Not a member of this conversation");
  await markConversationRead(args);
  return { ok: true };
}

export { getConversationById };
