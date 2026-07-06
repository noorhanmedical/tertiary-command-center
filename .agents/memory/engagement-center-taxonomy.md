---
name: Engagement Center taxonomy + 3-tab shape
description: How the Engagement Center row taxonomy is derived and why distribution is an action, not a tab.
---

# Engagement Center taxonomy + 3-tab shape

The Engagement Center is exactly 3 tabs: **Assignment Pool** (default,
Repository-style 3-zone = filter rail + worklist + detail panel), **Call
Results**, **Call Settings**. Distribution is an **action** (Auto-Distribute
dialog wrapping `EngagementDistributionPanel`) launched from inside Assignment
Pool — it is deliberately NOT a tab. Baskets are folded into smart-filter
groups; there is no Documents tab and no Baskets tab.

Row taxonomy (`category`, `callType`, `source`, `statusTrail`,
`lastCallOutcome`) is a **pure, server-side** derivation:
`deriveEngagementTaxonomy()` lives in `shared/contracts/engagementBoard.ts` and
is called during row assembly in `server/routes/engagementAssignmentBoard.ts`.
Clients never re-derive — they read the row fields and fall back to `"—"`.

**Why:** the user explicitly chose server-side derivation and honest gaps
(Patient-Support-type fields with no data stay `null`/`"—"`, never fabricated).
Smart filters match on the derived `row.callType` (visit/outreach/repeat), so
the derivation is the single source of truth for both display and filtering.

**No PDF/document status in rows or filters.** Packet/PDF actions are allowed
ONLY in the detail panel's Actions (`EngagementCasePanel` still imports
`openSinglePatientPacket`); the `missing_pdf` smart filter was removed. Do not
reintroduce PDF status into worklist rows or the filter rail.

`EngagementBaskets.tsx` / `EngagementDocuments.tsx` component files and their
server routes still exist but are unsurfaced (harmless).
