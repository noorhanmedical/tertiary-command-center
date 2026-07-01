---
name: Engagement baskets read model
description: Why the Engagement Center baskets need their own endpoint and how they bucket
---
The Engagement Center's nine baskets (Unassigned, Assigned Today, Carryover, Completed Conversations, Scheduled, Voicemail Left, No Answer, Follow-up Needed, Declined) are served by `/api/engagement/baskets` (server/routes/engagementBaskets.ts), NOT the assignment board.

**Why a separate endpoint:** `/api/engagement/assignment-board` deliberately filters out terminal cases (`engagementStatus NOT IN ('archived','closed','cancelled','completed')`), so it can never populate the Completed/Scheduled/Declined tiles. The baskets endpoint queries ALL execution cases (active always; terminal only within a recent ~90-day window to stay bounded).

**How buckets are derived:** disposition = `mapOutcomeToDisposition(lastCallOutcome)` from `server/services/engagement/teamMetricsService.ts`. Reuse that mapping — do NOT re-implement it, or basket counts drift from Team Metrics. voicemail/no-answer are NEVER "completed conversations" (reached→completed only). A case can be in multiple baskets (tiles are filters, not a partition); each row carries `basketKeys[]` and the client filters on it.

**No-auto-push gate:** `assignment.scheduler_auto_assign_enabled` defaults to `{enabled:false}` (adminSettings.repo.ts seed), so `schedulerAutoAssign.ts` returns `auto_assign_disabled` and approved cases stay Unassigned for manual distribution. Do not flip this default.
