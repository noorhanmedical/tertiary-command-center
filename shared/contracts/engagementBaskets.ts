// Engagement baskets read-model contract.
//
// SOURCE (canonical): server/routes/engagementBaskets.ts
// (GET /api/engagement/baskets handler)
//
// The nine engagement baskets are the operational tiles on the Engagement
// Center's Baskets view. Each basket is a FILTER over the same enriched case
// rows (a case can belong to several — e.g. an overdue voicemail is both
// Carryover and Voicemail Left), so the frontend renders tiles by filtering
// `rows` on `basketKeys` and reads the honest total from `baskets[].count`.

export type EngagementBasketKey =
  | "unassigned"
  | "assignedToday"
  | "carryover"
  | "completedConversations"
  | "scheduled"
  | "voicemailLeft"
  | "noAnswer"
  | "followUpNeeded"
  | "declined";

export const BASKET_DEFS: Array<{
  key: EngagementBasketKey;
  label: string;
  description: string;
}> = [
  {
    key: "unassigned",
    label: "Unassigned",
    description: "Approved, awaiting distribution to a team member",
  },
  {
    key: "assignedToday",
    label: "Assigned Today",
    description: "On a team member's plate with an action due today",
  },
  {
    key: "carryover",
    label: "Carryover",
    description: "Assigned, still open, past its action date",
  },
  {
    key: "completedConversations",
    label: "Completed Conversations",
    description: "Live conversation reached (never voicemail / no-answer)",
  },
  {
    key: "scheduled",
    label: "Scheduled",
    description: "Patient booked for their ancillary",
  },
  {
    key: "voicemailLeft",
    label: "Voicemail Left",
    description: "Left a voicemail — not a completed conversation",
  },
  {
    key: "noAnswer",
    label: "No Answer",
    description: "No live contact — not a completed conversation",
  },
  {
    key: "followUpNeeded",
    label: "Follow-up Needed",
    description: "Needs another touch (callback / more info)",
  },
  {
    key: "declined",
    label: "Declined",
    description: "Patient declined or is not contactable",
  },
];

// Compact per-document status shown on a case card. "not_generated" is an
// honest boundary — the document has not been produced yet.
export type BasketReadinessStatus =
  | "not_generated"
  | "pending"
  | "uploaded"
  | "generated"
  | "finalized"
  | "blocked";

export type EngagementBasketRow = {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  phoneNumber: string | null;
  facility: string | null;
  scheduleDate: string | null;
  patientType: string | null;
  engagementBucket: string | null;
  engagementStatus: string | null;
  lifecycleStatus: string | null;
  commitStatus: string | null;
  approvalStatus: string | null;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  assignedName: string | null;
  ancillary: string[];
  callReason: string;
  priority: "high" | "medium" | "normal";
  cooldownTests: string[];
  missingInfo: string[];
  lastCallOutcome: string | null;
  disposition: string | null;
  callAttemptCount: number;
  lastAttemptAt: string | null;
  nextActionAt: string | null;
  createdAt: string | null;
  approvedAt: string | null;
  readiness: {
    report: BasketReadinessStatus;
    orderNote: BasketReadinessStatus;
    procedureNote: BasketReadinessStatus;
    billing: BasketReadinessStatus;
  };
  basketKeys: EngagementBasketKey[];
};

export type EngagementBasketCount = {
  key: EngagementBasketKey;
  label: string;
  description: string;
  count: number;
};

export type EngagementBasketsResponse = {
  generatedAt: string;
  baskets: EngagementBasketCount[];
  rows: EngagementBasketRow[];
};
