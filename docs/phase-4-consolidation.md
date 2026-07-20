# Phase 4 — Consolidation notes

Companion to `integration/wiring-phase-4-internal-persistence`. Records
what shipped, what is deferred, and why every deferred sub-phase is
safer that way.

## Delivered in this branch

### 4A Internal Direct Messages
- **Schema**: `shared/schema/directMessages.ts` — INTERNAL user-to-user only. `sender_user_id` + `recipient_user_id` reference `users`; row is tenant-scoped via `clinic_id NOT NULL`.
- **Migration** (proposed, not run): `migrations/0043_add_direct_messages.sql`. Additive `CREATE TABLE` + 3 indexes. Rollback: `DROP TABLE IF EXISTS direct_messages`.
- **Repository**: `server/repositories/directMessages.repo.ts` — `listInbox`, `listConversation`, `createMessage`, `markConversationRead`, `countUnreadForRecipient`. All bounded.
- **Service**: `server/services/directMessages/directMessagesService.ts` — feature-gate, sanitize body (strips `<>`, hard-caps 4,000 chars), rate-limit (5 outbound per sender per 10 s), reject any recipient that matches a phone number pattern (Twilio guard), reject self-message.
- **Routes**: `server/routes/directMessages.ts` — 5 endpoints under `/api/internal-messages/*`. Gated by feature flag; when disabled every path returns 501.
- **Feature flag**: `FEATURE_INTERNAL_DIRECT_MESSAGES` default **OFF**. Client falls back to `mockPortalMessages` local state.

### 4B Portal Assistant
- **Route**: `server/routes/portalAssistant.ts` with `POST /api/portal-assistant/chat`. Feature-flagged OFF via `FEATURE_PORTAL_ASSISTANT`. Rate-limited (10 requests / user / minute, in-process bucket).
- **Response shape** when the flag is off: `{ reply: null, feature: "portal-assistant", disabled: true, reason: ... }`. This preserves the client contract when the flag flips.
- **Not wired**: no OpenAI call is issued while the flag is off. When enabled, the assistant must (a) use the existing provider abstraction, (b) enforce clinic/user scope on every prompt, (c) log every turn via `auditService`, (d) restrict tools to a whitelist, (e) never contact patients, (f) never send messages by any channel.

## Deferred sub-phases (in this branch)

### 4C Clinical Intelligence live persistence
The canonical schema is already on main at `shared/schema/clinicalIntelligence.ts` — 5 tables (`ci_learning_items`, `ci_rules`, `ci_rule_versions`, `ci_evidence_records`, `ci_audit_entries`) — but there is **no corresponding migration**. Writing the migration correctly requires auditing the current schema definitions against the localStorage payload the client persists today. Rather than propose a possibly-mis-shaped migration in this branch, the plan is:
1. Follow-up PR authors a per-table CREATE migration matching the 5 pgTable definitions exactly.
2. Same PR adds `server/repositories/clinicalIntelligence.repo.ts` + `server/services/clinicalIntelligence/importFromLocalStorageService.ts` for the one-time localStorage → server import.
3. Same PR adds `server/routes/clinicalIntelligence.ts` gated by `FEATURE_CLINICAL_INTELLIGENCE_LIVE`.
The feature flag entry is already defined so the follow-up PR only needs the schema/repo/service/route + tests.

### 4D Clinician Portal backend consolidation
No new tables are added. The recommended path is to **reuse** `server/routes/physicianPortal.ts` + `server/services/physicianPortal/*` + `server/repositories/physicianPortal*.repo.ts` — the existing chain already backs the source-canonical `PhysicianPortalShell`. The persistence branch's separate `clinician_portal_*` tables would create a duplicate source of truth; the consolidation plan is:

| Persistence-branch surface | Consolidation target |
|----------------------------|----------------------|
| `clinician_portal.assigned_patients` | Read from `patient_execution_cases` filtered by `assignedTeamMemberId` |
| `clinician_portal.dashboard_snapshot` | Compute from Phase 2's `getPhysicianPortalSummary` + `getFinancialHealth` |
| `clinician_portal.orders_queue` | Read from `case_document_readiness` where `document_type = 'order_note'` |
| `clinician_portal.engagement_snapshot` | Read from `engagement/team_metrics_service` per Phase 1 architecture |

Under this plan, no new schema is required. If a specific persistence-branch column turns out to be unavoidable (e.g., a per-physician preference), it should live on `physician_portal_prefs` — a small additive table — rather than a wholesale `clinician_portal.*` schema.

### 4E Remaining mock/local controls (audit)

| Live surface | Behavior on main | Classification | Recommendation |
|--------------|------------------|----------------|----------------|
| `team-ops.tsx` "coming soon" toast | Documented UI-only toast for un-wired actions | acceptable placeholder | Wire the missing action set in a follow-up PR that plans the backend contract first; do NOT wire ad-hoc |
| `plexus-bank/modules-core.tsx` "AI-assisted claim analysis coming soon (placeholder)" | Placeholder in the Plexus Bank mock | acceptable local mock | Keep — Plexus Bank ships as a design mock |
| `mission-control.tsx` disabled chat input `"Ask Plexus… (coming soon)"` | Disabled input | acceptable disabled control | Wire only when Portal Assistant flag flips |
| Physician alt shell tabs (`Dashboard`, `Finance`, `Orders`, `Engagement`) reading `mockData.ts` | 5 files consume component-scoped mock data | acceptable canonical UI + local mock | Live wiring already added for signature + reports + ancillary + Phase 2 summary + Phase 2 financial-health. Follow-up PRs wire the remaining tabs one-by-one |
| Portal messaging tab + window reading `mockPortalMessages` | Client-side mock, honest label | preserved local UI | Flips to live when 4A flag ON (route already ships) |
| Plexus Bank Invoice Desk | 2 consumers of `plexus-bank/mockData.ts` | acceptable local mock | Keep — Plexus Bank ships as a design mock |
| Clinical Intelligence page | Client localStorage prototype | preserved local UI | Flips to live when 4C schema + migration lands and flag flips |

No control on any live route is dead: every button either fires a real API call, opens a real dialog, or is documented as an intentional placeholder / preview.

## Twilio / SMS

**Absent.** Zero references across schema, migration, repo, service, route, or test files in this branch. The DM stack (4A) explicitly guards against Twilio-style recipients at the service layer:

```ts
if (/^\+?[\d\s\-().]{7,}$/.test(args.recipientUserId)) {
  throw Error("Recipient must be an internal user id");
}
```

## Migrations proposed but NOT run

1. `migrations/0043_add_direct_messages.sql` — additive `CREATE TABLE direct_messages` + 3 indexes.
2. Follow-up: authored CI migration for the 5 existing ci_* schemas (deferred to a subsequent PR — see 4C).

To run either, run `drizzle-kit push` in Replit / CI **after** owner review. Never run `drizzle-kit push --force`. Never truncate `clinics`.

## Feature flags introduced

| Flag env var | Default | Behavior when OFF |
|--------------|:-------:|-------------------|
| `FEATURE_INTERNAL_DIRECT_MESSAGES` | OFF | Every `/api/internal-messages/*` endpoint returns 501; client uses `mockPortalMessages` |
| `FEATURE_PORTAL_ASSISTANT` | OFF | `POST /api/portal-assistant/chat` returns 501; UI chat surface remains disabled |
| `FEATURE_CLINICAL_INTELLIGENCE_LIVE` | OFF | No route registered; UI keeps localStorage prototype |
| `FEATURE_CLINICIAN_PORTAL_BACKEND` | OFF | No route registered; existing physicianPortal chain remains canonical |

## Rollback

Revert `integration/wiring-phase-4-internal-persistence`. No migration is executed by the branch; the SQL file is text-only until an operator runs `drizzle-kit push`.
