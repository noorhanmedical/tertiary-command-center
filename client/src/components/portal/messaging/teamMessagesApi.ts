// Client access to the first-class messaging backend (Phase 1) + a drop-in
// replacement for the mock usePortalMessages() hook.
//
// The real backend is /api/messaging/* (conversations + team_messages). This
// module adapts the server shapes into the SAME `Conversation` / `Message`
// interface the existing PortalMessagesPanel + PortalMessagesWindow already
// consume, so the presentational components are untouched — only the data
// source changes (mock → real). Conversation ids are numeric server-side and
// surfaced as strings to match the existing UI contract.

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Conversation, ConversationType, Message } from "./mockPortalMessages";

// ── Server shapes (mirror server/repositories/messaging.repo.ts) ────────────
type ServerConversation = {
  id: number;
  type: string;
  title: string | null;
  facilityId: string | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  taskId: number | null;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
  unreadCount: number;
  members: Array<{ userId: string; username: string; role: string | null }>;
};
type ServerMessage = {
  id: number;
  conversationId: number;
  senderUserId: string | null;
  body: string;
  messageType: string;
  createdAt: string;
};

const CONVERSATIONS_KEY = ["/api/messaging/conversations"] as const;
function messagesKey(conversationId: string | null) {
  return ["/api/messaging/conversations", conversationId, "messages"] as const;
}

/** Map a server conversation type to the UI's ConversationType. Server has
 *  more types (task/system); collapse them into the three the panel renders. */
function uiType(serverType: string): ConversationType {
  if (serverType === "team") return "team";
  if (serverType === "patient") return "patient";
  return "direct";
}

/** A display name for a conversation from the caller's perspective. */
function displayName(c: ServerConversation): string {
  if (c.title) return c.title;
  if (c.type === "direct") return c.members[0]?.username ?? "Direct message";
  return c.members.map((m) => m.username).join(", ") || "Conversation";
}

async function fetchConversations(): Promise<ServerConversation[]> {
  const res = await apiRequest("GET", "/api/messaging/conversations");
  const json = (await res.json()) as { conversations: ServerConversation[] };
  return json.conversations ?? [];
}

async function fetchMessages(conversationId: string): Promise<ServerMessage[]> {
  const res = await apiRequest("GET", `/api/messaging/conversations/${conversationId}/messages`);
  const json = (await res.json()) as { messages: ServerMessage[] };
  return json.messages ?? [];
}

/**
 * Drop-in real replacement for usePortalMessages(). Returns the same
 * { conversations, totalUnread, markRead, sendMessage } surface the mock did,
 * shaped as the existing `Conversation[]`. Messages for the ACTIVE conversation
 * are fetched and merged so the floating window can render the thread.
 *
 * @param currentUserId the logged-in user id (to flag `fromMe`)
 * @param activeConversationId the currently open conversation (string id)
 */
export function useTeamMessages(
  currentUserId: string | null,
  activeConversationId: string | null,
) {
  const queryClient = useQueryClient();

  const conversationsQuery = useQuery<ServerConversation[]>({
    queryKey: CONVERSATIONS_KEY,
    queryFn: fetchConversations,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const activeMessagesQuery = useQuery<ServerMessage[]>({
    queryKey: messagesKey(activeConversationId),
    queryFn: () => fetchMessages(activeConversationId as string),
    enabled: activeConversationId != null,
    refetchInterval: activeConversationId != null ? 8_000 : false,
  });

  const conversations: Conversation[] = useMemo(() => {
    const serverConvs = conversationsQuery.data ?? [];
    const activeMsgs = activeMessagesQuery.data ?? [];
    return serverConvs.map((c) => {
      const idStr = String(c.id);
      const isActive = idStr === activeConversationId;
      const msgs: Message[] = isActive
        ? activeMsgs.map((m) => ({
            id: String(m.id),
            senderId: m.senderUserId ?? "system",
            senderName: m.messageType === "system" ? "System" : (m.senderUserId === currentUserId ? "You" : displayName(c)),
            fromMe: m.senderUserId != null && m.senderUserId === currentUserId,
            body: m.body,
            timestamp: m.createdAt,
          }))
        : [];
      const lastBody = isActive && msgs.length > 0 ? msgs[msgs.length - 1].body : "";
      return {
        id: idStr,
        type: uiType(c.type),
        name: displayName(c),
        lastMessage: lastBody,
        timestamp: c.lastMessageAt ?? c.createdAt,
        unreadCount: c.unreadCount,
        facilityName: c.facilityId ?? undefined,
        patientScreeningId: c.patientScreeningId ?? undefined,
        messages: msgs,
      };
    });
  }, [conversationsQuery.data, activeMessagesQuery.data, activeConversationId, currentUserId]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations],
  );

  const markReadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      await apiRequest("POST", `/api/messaging/conversations/${conversationId}/mark-read`, {});
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      await apiRequest("POST", `/api/messaging/conversations/${id}/messages`, { body });
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: messagesKey(vars.id) });
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    },
  });

  const markRead = useCallback(
    (id: string) => {
      markReadMutation.mutate(id);
    },
    [markReadMutation],
  );

  const sendMessage = useCallback(
    (id: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      sendMutation.mutate({ id, body: trimmed });
    },
    [sendMutation],
  );

  return { conversations, totalUnread, markRead, sendMessage } as const;
}
