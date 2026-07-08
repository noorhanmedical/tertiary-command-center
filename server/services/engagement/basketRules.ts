// ─── Engagement basket membership rules (pure) ──────────────────────────────
//
// Extracted from the /api/engagement/baskets route so the bucketing logic can
// be unit-tested in isolation. A regression here would silently mis-count
// Completed Conversations vs Voicemail / No Answer — the exact distinction
// the business cares about — so tests/unit/engagementBaskets.test.ts locks
// these rules.

import type { EngagementBasketKey } from "@shared/contracts/engagementBaskets";

export const TERMINAL_ENGAGEMENT_STATUSES = new Set(["scheduled", "completed"]);

export interface BasketCaseInput {
  isAssigned: boolean;
  isActive: boolean;
  engagementStatus: string | null;
  disposition: string | null;
  nextActionAt: Date | null;
  startToday: Date;
  endToday: Date;
}

// Which baskets does a single enriched case belong to? A case can appear in
// more than one tile (e.g. an assigned overdue voicemail is both Carryover and
// Voicemail Left) — the tiles are filters, not a partition.
export function basketsForCase(args: BasketCaseInput): EngagementBasketKey[] {
  const keys: EngagementBasketKey[] = [];
  const status = (args.engagementStatus ?? "").toLowerCase();
  const isTerminalStatus = TERMINAL_ENGAGEMENT_STATUSES.has(status);

  if (!args.isAssigned && args.isActive && !isTerminalStatus) {
    keys.push("unassigned");
  }
  if (args.isAssigned && args.isActive && !isTerminalStatus) {
    if (args.nextActionAt && args.nextActionAt < args.startToday) {
      keys.push("carryover");
    } else if (
      args.nextActionAt &&
      args.nextActionAt >= args.startToday &&
      args.nextActionAt <= args.endToday
    ) {
      keys.push("assignedToday");
    }
  }
  if (args.disposition === "completed") keys.push("completedConversations");
  if (status === "scheduled" || args.disposition === "scheduled") {
    keys.push("scheduled");
  }
  if (args.disposition === "voicemail") keys.push("voicemailLeft");
  if (args.disposition === "noAnswer") keys.push("noAnswer");
  if (args.disposition === "followUp") keys.push("followUpNeeded");
  if (args.disposition === "declined") keys.push("declined");
  return keys;
}
