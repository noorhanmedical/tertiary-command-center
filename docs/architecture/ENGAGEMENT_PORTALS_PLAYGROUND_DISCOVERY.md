# Engagement + Team Portals + Playground — Complete Discovery Review

Date: August 2026
Purpose: Pre-implementation current-state map. NO CODE CHANGES.

---

## A. Executive Architecture Summary

The platform has THREE operational layers above the Plexus EHR V1 foundation:

1. **Engagement Center** (`/engagement-center`) — Manager/admin command center for case distribution and assignment. Reads/writes `patient_execution_cases`. Three-zone layout: smart-filter rail + grouped worklist + case detail panel.

2. **Team Portals** (PCS + ACS via `TeamPortalShell`) — Staff workspaces for daily operations. Full-screen fixed overlay with: left Portal Utility Rail (Messaging + Tools), center Playground canvas, right Work Queue (3 modes: Clinic/Ancillary/Calls), bottom dock (7 apps).

3. **Outreach Scheduler Portal** (`/outreach/scheduler/:id`) — Legacy standalone scheduler workspace. Uses `card.callList` from the outreach dashboard + `scheduler_assignments` merged with operational queue engagement items. Has its own layout (left icon rail + center playfield + right call list).

**The dual-system problem:** Engagement Center writes `patient_execution_cases.assignedTeamMemberId`. The Outreach Scheduler Portal reads from BOTH `scheduler_assignments` (legacy) AND operational queue (canonical). Team Portal Shell reads from canonical `fetchWorkspaceCallList()`. These are converging but not yet unified.

---

## B. Engagement Center — Complete Current-State Inventory

### Route and Access
- Path: `/engagement-center`
- No explicit role gate (auth-only). Call Settings tab checks `role === "admin"` for edit permission.

### Page Layout (Assignment Pool tab)
- **Header:** "Plexus Ancillary · Engagement Center" title + 5 metric chips (Ready to Assign, Due Today, Follow-up, Callbacks, Blocked) + view switcher tabs + search + facility/team/status dropdowns + Auto-Distribute button
- **Left (260px):** `EngagementFilterRail` — 17 smart filters in 4 groups
- **Center (flex-1):** `EngagementDuplicateBanner` + `EngagementWorklist` grouped by schedule-date × facility
- **Right (360px):** `EngagementCasePanel` — case detail + assignment form

### Tabs (View Switcher)
1. **Repository** (feature-flagged: `VITE_FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY`)
2. **Assignment Pool** — the 3-zone worklist
3. **Call Results** — team metrics dashboard
4. **Call Settings** — distribution configuration

### Smart Filters (Left Rail)
| Group | Filters |
|-------|---------|
| Assignment | All cases, Ready to Assign, Assigned |
| Call Type | Visit Scheduling, Outreach Scheduling, Repeat Test Due |
| Due Window | Due Today, Overdue, Due Soon |
| Work State | Follow-up, Callbacks, No Answer, Left Voicemail, Needs Scheduling, Blocked, Declined, Re-Eligible |

### Worklist (Center)
- Grouped by scheduleDate × facility (collapsed accordion)
- Per-card fields: Patient name (+ missing info alert), Call Type, Assigned To, Status chip
- Status values: Awaiting assignment, Assigned, On call list, Review assignment, Kept assigned, Scheduled, Declined, Cooldown
- Card actions (hover reveal): Assign/Reassign picker, Open patient link, Remove
- Toolbar: Select all, Bulk Assign, Distribute (round-robin multi-member), Remove, Clear
- Group header: Group select, "Assign all" picker

### Case Panel (Right)
Sections top-to-bottom:
1. Header (name, priority badge, DOB, phone, facility)
2. Call summary (Call reason + Next action)
3. Classification (Category, Call type, Source, Status trail, Last call result)
4. Target tests (service chips)
5. Appointments (canonical per-service, feature-flagged)
6. Blocking gaps (missing info)
7. Qualification reasoning (per-test clinician understanding + patient talking points)
8. Clinical context (Dx, Hx, Rx)
9. Cooldown / eligibility (active cooldown chips)
10. Journey timeline (events + Add Note)
11. Packets (Plexus Atlas, Clinician Atlas, Open patient)

Assignment form (sticky footer):
- Triage (read-only derived: Priority, Next action date)
- Team member picker (coverage-sorted with load tags)
- Role picker (Scheduler / PCS / ACS)
- Notes textarea
- Save assignment button + Remove button

### Auto-Distribution Dialog
- Preview: Waiting Pool / Will Assign / Unplaced / Working Members
- Per-member allocation: name, facility, assigned totals, visit/outreach split, patient chips
- Unplaced: patient name, facility, reason
- Live Progress: Completed Today / In Progress / Remaining / Active Members per team member
- Activity feed with relative timestamps

---

## C. Engagement Data Model / Services / Routes

### Core Tables
| Table | Purpose |
|-------|---------|
| `patient_execution_cases` | THE operational case spine — links patient → engagement state |
| `patient_journey_events` | Append-only audit trail per patient/case |
| `engagement_lists` | Phase 2C multi-list identity (clinic + source + idempotency key) |
| `engagement_list_memberships` | Per-service links from ancillary cases to engagement lists |
| `engagement_call_settings` | Per-member capacity/KPI configuration |
| `engagement_reconciliation_failures` | Durable retry ledger |
| `outreach_calls` | Multi-channel communication records |
| `outreach_schedulers` | Team roster (name, facility, capacity) |
| `scheduler_assignments` | Daily assignment of patients to schedulers |
| `cooldown_records` | Per-service cooldown tracking |

### Key Services
| Service | File | Purpose |
|---------|------|---------|
| `sendToEngagement` | `server/services/engagementLists/sendToEngagement.ts` | Single entry point for routing cases to engagement |
| `distributionService` | `server/services/engagement/distributionService.ts` | Pure deterministic capacity-aware auto-allocator |
| `callSettingsService` | `server/services/engagement/callSettingsService.ts` | Derived KPI targets from global config + workday tiers |
| `queueProjection` | `server/services/engagementLists/queueProjection.ts` | Admin Review → engagement eligibility bridge |
| `communications.repo` | `server/repositories/communications.repo.ts` | logCommunication + operational propagation + Story |
| `callListEngine` | `server/services/callListEngine.ts` | LEGACY assignment engine (scheduler_assignments) |
| `engagementCallListService` | `server/services/engagement/engagementCallListService.ts` | DORMANT scaffold (canonical call-list read model) |

### API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/engagement/assignment-board` | Board rows (all active execution cases) |
| POST | `/api/engagement/assignment-board/assign` | Assign patient(s) to team member |
| POST | `/api/engagement/assignment-board/cancel-many` | Remove cases from engagement |
| GET | `/api/engagement/assignment-board/cases/:id/journey` | Journey timeline for a case |
| POST | `/api/engagement/assignment-board/cases/:id/journey` | Add note to timeline |
| GET | `/api/engagement/baskets` | Basket/queue grouping |
| GET | `/api/engagement/repository/lists` | Browse engagement lists |
| GET | `/api/engagement/repository/recent` | Recently sent lists |
| GET/POST | `/api/engagement/call-settings` | Per-member call settings CRUD |
| POST | `/api/engagement/distribution/preview` | Preview distribution plan |
| POST | `/api/engagement/distribution/apply` | Apply distribution (atomic) |

---

## D. Engagement Assignment + Distribution Workflow

### Manual Assignment
1. Manager selects case in worklist → opens in right panel
2. Team member picker shows schedulers sorted by coverage relation (Home → Covers → None)
3. Load tag per member: "N / target" or "N open"
4. Role selection: Scheduler / PCS / ACS
5. Optional notes
6. Save → POST `/api/engagement/assignment-board/assign`
7. Write: `patient_execution_cases.assignedTeamMemberId = schedulerId`, `assignedRole = role`
8. Invalidates board + baskets + call-list queries

### Auto-Distribution (distributionService.ts)
**Input:** All unassigned active execution cases + all working team members
**Eligibility criteria:** `assignedTeamMemberId IS NULL` AND `lifecycleStatus = 'active'` AND `engagementStatus NOT IN ('archived','closed','cancelled','completed')`
**Staff pool:** Active schedulers where `workingToday = true`
**Capacity model:** `remainingCapacity = completedCallKpi - carryover` (derived from call settings)
**Facility restrictions:** Members with `facilitiesCovered[]` only receive cases from those facilities; empty = covers all
**Visit/outreach split:** `laneForBucket(engagementBucket)` → visit or outreach lane; each has a sub-cap target
**Algorithm:** Greedy assignment — sort cases by scheduleDate ASC, then for each case find eligible members with lane headroom sorted by remaining capacity descending
**Tie breaking:** Remaining capacity → lane headroom → schedulerId ASC
**Write path:** Row-level `FOR UPDATE` lock per case, re-read state, guard against race conditions (already assigned, lifecycle changed, terminal status, sibling-date conflict)
**Audit:** Journey events emitted AFTER transaction commits (avoids cross-connection deadlock)

---

## E. Engagement Lists

### What a list represents
An immutable "send action" — when approved cases are routed into the engagement pool. Identity: `(clinicId, sourceType, sourceId, sendIdempotencyKey)`.

### Behavior
- Lists are GENERATED by `sendToEngagement()`, not manually created by users
- Cases CAN belong to multiple lists (memberships are per-service, not exclusive)
- `sentToEngagementAt` on the execution case is set exactly ONCE (immutable timestamp)
- Repeat sends with the same identity return the existing list (deduplication)
- Distinct `sendIdempotencyKey` creates a new list for the same source
- List status: active (default), archived (manual), cancelled (manual)
- UI: Repository tab shows label, facility, service date, sent timestamp, eligible count, active work count

### What is NOT a list
- Assignment is NOT list-based — it lives on `patient_execution_cases.assignedTeamMemberId`
- Distribution operates on execution cases directly, not on list memberships

---

## F. Engagement Metrics / Settings

### Call Settings (per-member editable fields)
| Field | Meaning | Affects Distribution? |
|-------|---------|----------------------|
| Team (PCS/ACS) | Team classification | No (display only) |
| Workday % | Fraction of full day this member works | YES (capacity) |
| Visit % | Fraction of calls that should be visit-type | YES (lane target) |
| Explicit completed KPI | Override for computed calls target | YES (hard override) |
| Explicit scheduled KPI | Override for scheduled target | No (reporting) |
| Max daily capacity | Hard ceiling on new assignments | YES (remaining cap) |
| Working today | Auto/Force working/Force off | YES (pool inclusion) |
| Facilities covered | Which facilities this member serves | YES (eligibility filter) |
| Active | Whether member participates in distribution | YES (pool inclusion) |

### Global Defaults
- Full-day completed target (base number of calls)
- Scheduled KPI % (what fraction should result in scheduled appointments)
- Default visit % / outreach % (sum to 100)
- Rounding mode (round/floor/ceil)
- Workday tier table: maps specific workday % → explicit completed KPI

### Team Metrics (Call Results tab)
| Metric | Source |
|--------|--------|
| Calls Today (done / target) | Logged calls today / completedCallKpi |
| Scheduled (done / target) | "scheduled" outcomes / scheduledKpi |
| Calls Remaining | completedCallKpi - logged today |
| Active Queue | Active unresolved cases |
| Carryover | Open cases carried from previous days |
| Working Members | Members with workingToday=true |
| Dispositions | Grouped by outcome (scheduled/reached/follow-up/no-answer/voicemail/declined/other) |

---

## G. Legacy Engagement Components

### callListEngine.ts (LEGACY)
- Operates on `PatientScreening` objects + `scheduler_assignments` table
- Simple greedy round-robin assignment by capacity
- Still used by the Outreach Scheduler Portal via `useOutreachData` hook
- Does NOT use execution cases or the distribution engine
- Can diverge from `assignedTeamMemberId`

### engagementCallListService.ts (DORMANT)
- Defines a canonical call-list read-model contract
- NO runtime callers
- Interface is sound but never wired

### Outreach Scheduler Portal (LEGACY)
- Route: `/outreach/scheduler/:id`
- Own full-screen layout (does NOT use TeamPortalShell)
- Reads from outreach dashboard `card.callList` + `scheduler_assignments` + operational queue
- Merged with engagement items for assignment
- Has its own playfield tabs, disposition sheet, booking, email, materials
- PatientJourneyDrawer (Sheet) for patient detail — NOT the full EHR

---

## H. TeamPortalShell — Complete Layout / Behavior

### Component Props
```typescript
TeamPortalShell({
  role: "technician" | "liaison",
  workspaceLabel?: string,
  defaultMode?: "clinicSchedule" | "ancillarySchedule" | "callList",
  workspaceRole?: "patientCareSpecialist" | "ancillaryCareSpecialist" | "technician" | "liaison",
})
```

### Full-screen Layout (fixed inset-0 z-[80])
```
┌─────────────────────────────────────────┐
│ TOP: "The Playground" + Viewing As +    │
│       Clinic selector + Calendar        │
├─────────────────────────────────────────┤
│ LEFT RAIL    │  CENTER      │ RIGHT RAIL│
│ (320px)      │  (Playground)│ (340px)   │
│ z-20         │  z-1         │ z-20      │
│ hover-peek   │  max-1600px  │ hover-peek│
│ pinnable     │  px-10%      │ pinnable  │
├─────────────────────────────────────────┤
│ BOTTOM DOCK (z-50, centered)            │
│ bg-slate-900/40 backdrop-blur           │
└─────────────────────────────────────────┘
```

### State (~40+ useState calls)
Key selections: `selectedPatientId`, `selectedDate`, `facility`, `centerMode`, `activeWorkspaceMode`, `portalTabs[]`, `activePortalTabId`, `dockOpenApps[]`, `dockActiveApp`, `viewAsTeamMemberId`, `leftPanelTab`, `leftRailPeek/Pinned`, `rightRailPeek/Pinned`

---

## I. Top Context Controls

### Viewing As (admin only)
- Lists team members for the workspace type (PCS→liaison users, ACS→technician users)
- Server-side: session preserves admin identity for audit; `viewAsTeamMemberId` narrows feeds
- Changes: facility snaps to viewed member's clinic; call list/schedule refetch; profile capabilities update; NO permission impersonation (admin stays admin)
- Non-admins: selector hidden; backend ignores the param

### Clinic Selector
- Source: `/api/portal/my-facilities` (narrowed by profile's `assignedFacilityIds`)
- Default: profile's `defaultFacilityId` or first in list
- Persistence: React state only (not URL; resets on refresh)
- Effect: All right-panel feeds (clinic schedule, ancillary schedule, call list) refetch with new facility. Selected patient NOT cleared.

---

## J. Portal Utility Rail — Complete Inventory

### Top-Level Structure
Two tabs in blue header band (`bg-[#4863A0]`):
1. **Messaging** — iMessage-style inbox (PortalMessagesPanel)
2. **Tools** — ToolDock + Calendar + CommunicationTray

Pin button: toggles `leftRailPinned` (keeps panel open regardless of hover).

### Collapse/Reveal Behavior
- Rests translated -82% off-screen at 50% opacity (always mounted)
- Mouse-enter reveals (120ms debounce on leave)
- Touch: tap edge to reveal, click-away to dismiss
- Width: 320px (normal mode)
- Both PCS and ACS get identical rail

---

## K. Messaging Mode

### PortalMessagesPanel
- Conversation list with search
- Thread types: Direct staff, Team/task, Patient (mock data via `usePortalMessages`)
- Unread badge per conversation
- Click → opens `PortalMessagesWindow` (floating iMessage-style window)
- Source: Frontend mock (`mockPortalMessages.ts`) — NOT backed by a real API
- No real send/receive — honest scaffold

---

## L. Tools Mode

### ToolDock Groups

| Group | Tint | Tools |
|-------|------|-------|
| **Messaging** | sky | Messages, Direct, Team Chat, Email |
| **Notes & Docs** | amber | Sticky Notes, Quick Note, Documents, Scripts, Proof/PDFs |
| **Work** | emerald | Calendar, Tasks, Calls, Contacts, Patient Search, Invoice Desk |
| **System** | slate | Settings |

Below the dock: LeftRailCompactCalendar + CommunicationTray (bottom half).

---

## M. Every Utility Tool

| Tool | Icon | Click Action | Renders In | Patient-Specific? | Canonical? |
|------|------|--------------|------------|-------------------|------------|
| Messages | MessageCircle | Opens floating PortalMessagesWindow | Overlay | No | Mock |
| Direct | MessageSquare | Focuses CommunicationTray direct tab | Left rail (tray) | No | Live (DM roster) |
| Team Chat | Users | Focuses CommunicationTray team tab | Left rail (tray) | No | Live (task-based) |
| Email | Mail | Opens PortalEmailComposerTab in Playground | Center | Yes (selected patient) | Scaffold |
| Sticky Notes | StickyNote | Adds floating sticky widget to Playground | Playground overlay | Yes (attributed) | Persisted (widgets) |
| Quick Note | NotebookPen | Opens QuickNoteTool in Playground | Center | Patient-aware | Scaffold |
| Documents | FileText | Opens PortalDocumentLibraryTab in Playground | Center | No (global library) | Live (/api/documents-library) |
| Scripts | BookOpen | Opens PortalTemplatesResourcesTab in Playground | Center | No (staff resources) | Scaffold |
| Proof/PDFs | Megaphone | Opens PortalMarketingTab in Playground | Center | Yes (compose to patient) | Scaffold |
| Calendar | CalendarDays | Opens Quick Schedule popup (or center calendar) | Dialog/Center | Facility-scoped | Live (canonical schedule) |
| Tasks | ClipboardList | Opens PortalPlexusTasksTab in Playground | Center | Yes (patient filter) | Live (/api/portal/my-tasks) |
| Calls | PhoneCall | Opens CallsRepositoryPanel in Playground | Center | Facility-scoped | Live (/api/worked-calls) |
| Contacts | Phone | Opens InternalContactsTool in Playground | Center | No (staff directory) | Scaffold |
| Patient Search | Search | Opens PortalPatientSearchTab in Playground | Center | Selects patient → opens EHR | Live |
| Invoice Desk | Landmark | Opens InvoiceDeskPanel in Playground | Center | No | Scaffold (Plexus Bank mock) |
| Settings | SettingsIcon | Opens WorkspaceSettingsDialog | Dialog | No | Persisted (prefs) |

---

## N. Right Work Queue — Complete Inventory

### Header
- "Work Queue" label + selected date + Pin button
- WorkspaceModeSwitcher (3 tabs with counts)

### Clinic Schedule Tab
- Source: `fetchWorkspaceClinicSchedule()` + `/api/portal/today-schedule`
- Entity: Patient visit (TodayPatient)
- Fields: Name, time, test count, consent status badge
- Actions: Toggle patient in Playground, Schedule, Consent, Screening, Expand profile
- Default for: ACS

### Ancillary Schedule Tab
- Source: `fetchWorkspaceAncillarySchedule()` (filtered by allowedServiceTypes)
- Entity: Ancillary appointment
- Fields: Patient name, service type, time, facility, status badge
- Actions: Open in Playground (with ancillary context), ProcedureCompleteButton (ACS only)
- Default for: ACS (primary work)

### Call List Tab
- Source: `fetchWorkspaceCallList()` (canonical endpoint)
- Entity: Execution case (TeamWorkspaceCallListItem)
- Fields: Patient name, call reason badge
- Actions: Open patient, Phone (CallWorkspace dialog), Schedule
- Default for: PCS

### Row Click → Playground
- Clinic/Ancillary: `openSchedulePatientPlayground()` or `togglePatientInPlayground()`
- Call list: `openCallRowPatient()` → `openPatientTabById()` → PortalPatientDirectory (full EMR)

---

## O. Bottom Dock — Complete Inventory

| Position | Key | Icon | Name | What It Does | Patient Persists? |
|----------|-----|------|------|--------------|-------------------|
| 0 (admin) | home | Home | Home | Navigate to /home | N/A (leaves portal) |
| 1 | tasks | Bell | Tasks | Shows tasks grid in Playground | Yes |
| 2 | schedule | Calendar | Schedule | Shows expanded calendar in Playground | Yes |
| 3 | consent | FileSignature | Consent | Shows consent pane for selected patient | Yes |
| 4 | chart | User | Chart | Shows PatientDetail for selected patient | Yes |
| 5 | documents | FileText | Documents | Shows documents workspace | Yes |
| 6 | ai | Bot | AI | Toggles floating AI assistant panel | Yes |

---

## P–S. PCS Portal

### Purpose
Outreach-focused workspace: receive assigned cases, call patients, log outcomes, schedule appointments, work callbacks, re-engagement.

### Daily Entry
- Default mode: Call List tab
- Shows assigned call work + due callbacks
- Facility auto-selected from profile
- Selected date defaults to today

### Call List (Work Queue → Calls)
- Source: `fetchWorkspaceCallList()` (canonical from `patient_execution_cases`)
- Priority: Derived from `nextActionAt` proximity
- Row actions: Phone → CallWorkspace dialog, Calendar → SchedulePatientDialog, Name → opens patient in Playground

### Call Flow
1. Click phone icon → CallWorkspace dialog opens
2. Manual dial (RingCentral not connected — honest boundary)
3. After call → DispositionSheet → outcome selection → notes → next action
4. POST to `/api/engagement-center/call-result`
5. Propagates: callAttemptCount++, lastCallOutcome, engagementStatus, nextActionAt
6. Story event emitted
7. Queue refetches

### PCS Playground Permissions (from section access matrix)
Full access to: Overview, Qualifying Tests, Cooldown, Journey, Demographics, Insurance, Providers, Scheduling, Plexus Story
Summary only for: Admin Review (read-only status), Re-engagement
Hidden: Labs, Imaging, Encounters, Vitals, Ancillary Cases, Billing

---

## T–V. ACS Portal

### Purpose
Clinic-day execution: manage scheduled ancillary tests, consent/screening, procedure completion, report handoff.

### Daily Entry
- Default mode: Clinic Schedule tab
- Shows today's patients with consent readiness indicators
- Facility auto-selected from profile

### Key Difference from PCS
- Has `ProcedureCompleteButton` on ancillary rows
- Can mark procedures complete
- Primary consent/screening ownership
- Can upload procedure reports
- Default tab is Clinic Schedule (vs PCS's Call List)

### ACS Playground Permissions
Full access to: Overview, Journey, Demographics, Insurance, Providers, Scheduling, Documents, Plexus Story
Summary only for: Cooldown, Vitals, Data Signals
Hidden: Labs, Imaging, Encounters, Billing, Ancillary Cases

---

## W–AB. Playground

### What It Is Today
The large center workspace inside TeamPortalShell. It's a multi-purpose canvas that renders different content based on:
1. Active portal tab kind (patient, call, schedule, tools, etc.)
2. Center mode (playground, patient, consent, calendar, chat)
3. Dock active app
4. Schedule/patient playground context

### Patient Selection Flow
Queue row clicked → `selectedPatientId` set → tab created → `PortalPatientDirectory` mounts → full EMR chart renders for that patient.

### What PortalPatientDirectory Is
It's the canonical patient command canvas that wraps the REAL Plexus EHR V1 patient workspace (`PatientProfileWorkspace` → `PatientChart`) for the selected patient. This IS the embedded EHR — same chart, same sections, same permissions.

### Empty State
When no patient/work is selected, falls through to dock-driven content (tasks grid, schedule calendar, or blank playground-home).

### Patient Switching
Clicking a new patient in the queue → `selectedPatientId` changes → active tab updates or new tab created → `PortalPatientDirectory` re-mounts (React Query cache preserves data).

**Unsaved work risk:** NO confirmation dialog exists. If user is mid-disposition or composing a note and clicks another patient, the state is lost. **Flagged.**

### Performance Considerations
- Each patient tab mounts `PortalPatientDirectory` which fetches all EHR data
- React Query cache deduplicates requests within `staleTime`
- Tools (email, docs, etc.) share the same mount/unmount pattern
- No lazy-loading of EHR sections within the embedded chart

---

## AC. Legacy Patient Journey Drawer

`PatientJourneyDrawer` is a Sheet (slide-over, max-w-md/lg) that shows a patient's journey timeline with call history, qualification reasoning, and "Open patient" link. Used in:
- Outreach Scheduler Portal (per call-list row)
- Canonical case rows (per execution case)

**Should it retire?** Partially. Its use in the Outreach Scheduler Portal is justified (that page doesn't have the full EHR embedded). In Team Portals where PortalPatientDirectory provides the full EHR, the drawer is redundant.

---

## AD. Canonical vs Legacy Matrix

| Component | Canonical? | Legacy? | Duplicated? | Recommended |
|-----------|------------|---------|-------------|-------------|
| patient_execution_cases | ✅ | — | — | PRESERVE |
| patient_ancillary_cases | ✅ | — | — | PRESERVE |
| scheduler_assignments | — | ✅ (ownership) | YES (vs assignedTeamMemberId) | AUDIT ONLY |
| distributionService | ✅ | — | — | PRESERVE |
| callListEngine | — | ✅ | YES (vs distribution) | RETIRE |
| engagementCallListService | — | — | DORMANT | EVALUATE |
| sendToEngagement | ✅ | — | — | PRESERVE |
| queueProjection | ✅ | — | — | PRESERVE |
| engagement_lists | ✅ | — | — | PRESERVE |
| engagement_call_settings | ✅ | — | — | PRESERVE |
| outreach_calls | ✅ | — | — | PRESERVE |
| communications.repo | ✅ | — | — | PRESERVE |
| TeamPortalShell | ✅ | — | — | PRESERVE |
| ClinicWorkflowPortal | ✅ (adapter) | — | — | PRESERVE |
| CallWorkspace | ✅ | — | — | PRESERVE |
| SchedulingWorkspace | ✅ | — | — | PRESERVE |
| SelectedCaseOverview | ✅ | — | — | PRESERVE |
| CallListPanel (outreach) | — | ✅ | YES (vs CompactCallRow) | RETIRE when OSP retires |
| CompactCallRow | ✅ | — | — | PRESERVE |
| Portal Utility Rail | ✅ | — | — | PRESERVE |
| Messaging mode | — | — | MOCK | Wire to real backend |
| Patient Search | ✅ | — | — | PRESERVE |
| Outreach Scheduler Portal | — | ✅ | YES (vs Team Portal) | RETIRE (migrate to Team Portal) |
| PatientJourneyDrawer | ✅ (in OSP) | REDUNDANT (in Team Portal) | — | Keep in OSP, hide in Team Portal |
| PortalPatientDirectory | ✅ | — | — | PRESERVE (is embedded EHR) |
| PatientChart | ✅ | — | — | PRESERVE |
| PlexusEhr | ✅ | — | — | PRESERVE |

---

## AE. Exact Duplicate Systems

1. **Assignment ownership:** `patient_execution_cases.assignedTeamMemberId` vs `scheduler_assignments` table
2. **Call list read:** `fetchWorkspaceCallList()` (canonical) vs `card.callList` (legacy outreach dashboard)
3. **Assignment engine:** `distributionService.ts` (canonical) vs `callListEngine.ts` (legacy greedy round-robin)
4. **Patient detail:** `PortalPatientDirectory` (full EHR embed) vs `PatientJourneyDrawer` (Sheet with partial data)
5. **Scheduling UI:** `SchedulePatientDialog` + `CalendarQuickScheduleDialog` + `SchedulePatientPlayground` (Team Portal) vs `SlotBookingDialog` + `PatientQuickBookDialog` (Outreach Scheduler Portal)

---

## AF. What Should Be Preserved

- patient_execution_cases as the operational spine
- distributionService pure allocator
- sendToEngagement entry point
- engagement_lists + memberships
- queueProjection (Admin Review → engagement eligibility)
- engagement_call_settings + callSettingsService
- communications.repo (logCommunication)
- Engagement Center UI (all 4 tabs)
- TeamPortalShell (entire shell architecture)
- Left Portal Utility Rail (Messaging + Tools)
- Right Work Queue (3-mode switcher)
- Bottom dock
- Viewing As / Clinic / Calendar controls
- Center Playground concept
- PortalPatientDirectory (embedded EHR)
- CompactCallRow / CallRowQuickActions
- CallWorkspace / SchedulingWorkspace / SelectedCaseOverview
- DispositionSheet (canonical call result logging)

---

## AG. What Should Be Replaced

| Replace | With |
|---------|------|
| `callListEngine.ts` | Unified read from execution cases via distribution engine |
| Outreach Scheduler Portal's `card.callList` reads | Same canonical `fetchWorkspaceCallList()` used by Team Portal |
| Dual `scheduler_assignments` / `assignedTeamMemberId` ownership | Single source: `assignedTeamMemberId`. `scheduler_assignments` → audit/history only. |
| `engagementCallListService.ts` (dormant) | Either wire it as the unified read model or remove in favor of existing canonical reads |

---

## AH. What Should Be Retired

1. **callListEngine.ts** — superseded by distributionService
2. **scheduler_assignments as ownership source** — keep table for audit/history, stop writing for live ownership
3. **Outreach Scheduler Portal** (eventually) — all its capabilities exist in Team Portal (PCS mode). Migration sequence: ensure Team Portal covers every OSP feature → redirect `/outreach/scheduler/:id` → Team Portal
4. **PatientJourneyDrawer in Team Portal** — redundant when PortalPatientDirectory provides the full EHR

---

## AI. Recommended Final Engagement Architecture

```
PATIENT QUALIFIES (Plexus IQ)
        ↓
ADMIN REVIEW APPROVES (per-service ancillary case)
        ↓
SEND TO ENGAGEMENT (sendToEngagement → list + memberships)
        ↓
ENGAGEMENT CENTER (assignment board)
        ↓
AUTO/MANUAL DISTRIBUTION (distributionService)
        ↓
patient_execution_cases.assignedTeamMemberId
        ↓
TEAM PORTAL WORK QUEUE (canonical call list feed)
        ↓
STAFF CLICKS PATIENT/SERVICE
        ↓
PLAYGROUND (PortalPatientDirectory = embedded EHR V1)
        ↓
CALL / SCHEDULE / WORK (DispositionSheet / ScheduleDialog)
        ↓
CANONICAL STATE UPDATE (logCommunication / appointment / outcome)
        ↓
WORK QUEUE REFRESH + STORY EVENT
```

---

## AJ. Recommended Final Team Portal Architecture

```
TEAM PORTAL SHELL (fixed full-screen)
├── TOP: Viewing As + Clinic + Calendar
├── LEFT: Portal Utility Rail (Messaging + Tools)
│   ├── Messaging: Real DM + Team Chat (wire backend)
│   └── Tools: Email, Notes, Docs, Scripts, Calendar, Tasks, Calls, Contacts, Patient Search, Invoice Desk, Settings
├── CENTER: Playground
│   ├── No patient: clean empty state
│   └── Patient selected: PortalPatientDirectory (full Plexus EHR V1)
├── RIGHT: Work Queue (3 modes)
│   ├── Clinic Schedule (doctor visits + consent)
│   ├── Ancillary Schedule (procedures + completion)
│   └── Call List (outreach + follow-up)
└── BOTTOM: Dock (Home[admin] + Tasks + Schedule + Consent + Chart + Documents + AI)
```

---

## AK. Recommended Final Playground Architecture

The Playground IS the center canvas. When a patient is selected, it renders `PortalPatientDirectory` which wraps the real `PatientProfileWorkspace` → `PatientChart`. The EHR's own section navigation sits inline. No standalone patient-directory rail needed (the Work Queue provides selection).

### Canonical Selection Context
```typescript
{
  patientScreeningId: number;
  executionCaseId?: number;
  ancillaryCaseId?: number;
  serviceKey?: string;
  focusSection?: string;
  documentId?: number;
  appointmentId?: number;
}
```

---

## AL. Unified Call List Recommendation

**Do NOT wire `engagementCallListService`** — the existing `fetchWorkspaceCallList()` already reads from canonical execution cases with correct scoping (facility, date, viewAs, workspace context). This IS the unified read model. The dormant scaffold can be removed.

**What remains:** Ensure the Outreach Scheduler Portal (while it lives) reads from the same canonical source. Currently it merges `card.callList` (legacy) with operational queue items — the convergence path is to replace `card.callList` with the canonical workspace feed.

---

## AM. Migration / Convergence Sequence

1. Stop writing `scheduler_assignments` for live ownership (keep as audit table)
2. Make Outreach Scheduler Portal read from canonical `fetchWorkspaceCallList()` (same as Team Portal)
3. Remove `callListEngine.ts` once OSP is migrated
4. Wire real messaging backend to replace mock `PortalMessagesPanel`
5. Add unsaved-work confirmation dialog on patient switch
6. Eventually redirect `/outreach/scheduler/:id` → PCS Portal (once feature parity confirmed)
7. Remove dormant `engagementCallListService.ts`

---

## AN. Risks / Blockers

1. **Unsaved work on patient switch** — no confirmation exists today
2. **Messaging is mock** — `usePortalMessages` is frontend-only mock data
3. **RingCentral not connected** — CallWorkspace degrades to manual-dial card (honest boundary)
4. **Two assignment sources still coexist** — `scheduler_assignments` + `assignedTeamMemberId` can diverge
5. **Outreach Scheduler Portal divergence** — uses different data hooks than Team Portal for the same patients
6. **Invoice Desk is scaffold** — backed by Plexus Bank mock store, not real billing

---

## AO. Questions That Still Cannot Be Answered From Code

1. Which patients does the legacy `card.callList` (outreach dashboard) actually exclude that the canonical feed includes? (Requires live DB comparison)
2. Does the operational queue (`/api/operational-queue/me`) correctly resolve all engagement-assigned work for the viewed scheduler? (Requires runtime verification)
3. Are there any patients stuck in `scheduler_assignments` that have no corresponding execution case? (Requires DB audit)
4. What happens when Admin Review rejects a service AFTER the case has been assigned in engagement? (Code shows the board re-fetches, but does the assigned case become hidden or does it show a "rejected" badge?)
5. How many real users currently use the Outreach Scheduler Portal vs. the Team Portal PCS workspace? (Usage data needed for retirement timing)

---

## AP. Playground SketchUI Visual System

The platform now has **three distinct visual layers**, assigned by OWNER (not by CSS
selector sniffing):

| Layer | Owner | Visual language |
|-------|-------|-----------------|
| Team Portal chrome — top controls, left utility rail, right work-queue rail, GlobalDock | Team Portal shell | Apple Liquid Glass |
| Playground canvas — tabs, workspaces, workspace dialogs/popovers, daily artwork | Playground | SketchUI / Rough.js / digital notebook |
| Nova ambient form | Nova | Dark-purple/indigo particle nebula (currently dock-icon-only) |

**Rule:** the visual language is decided by which subsystem OWNS the surface. Anything
rendered inside `PlaygroundCanvas` is SketchUI. Shell chrome outside the canvas stays
Liquid Glass. When Plexus EHR opens *inside* the Playground it adopts SketchUI — same
data, same permissions, same workflows, different visual environment. There is exactly
ONE canonical implementation per workspace; SketchUI is a **visual adapter layer**, never
a forked functional component.

### AP.1 Foundation (implemented — Phase S1)

Location: `client/src/components/playground/sketch/`

- `sketchTokens.ts` — single source of truth. Pencil palette (`SKETCH_COLORS`), line
  opacities (`SKETCH_LINE`), three roughness tiers (`SKETCH_ROUGHNESS`), the
  `sketchOptions(level, color, overrides)` Rough.js builder, `stableSeed()` /
  `dailySeedIdentity()`, and `SKETCH_CSS_VARS` (`--sketch-graphite`, `--sketch-blue`,
  `--sketch-paper`, etc.).
- `PlaygroundSketchProvider.tsx` — context signalling `environment="playground"`,
  `visualLanguage="sketch"`. Shared Plexus components call `useSketchEnv()` and branch to
  their sketch variant. Injects the CSS vars on its wrapper. Wired around the workspace
  content in `PlaygroundCanvas.tsx`.
- `useSketchCanvas.ts` — resize-aware, DPR-aware canvas hook that redraws rough geometry
  ONLY when box size / seed / deps change (never on unrelated re-renders).
- `SketchPrimitives.tsx` — `SketchSurface`, `SketchSectionHeader`, `SketchButton`,
  `SketchInput`, `SketchDivider`. Hand-drawn shell + clean Inter content.

### AP.2 Roughness discipline

| Level | Use for | Feel |
|-------|---------|------|
| `decorative` | daily artwork, empty-state illustration | most hand-drawn |
| `structural` | workspace panels, section boundaries, buttons, inputs, dialog edges | medium |
| `data` | table separators, dense repeated rows | barely-there wobble |

Performance contract: generate structural geometry with **stable seeds**; never run
per-row Rough.js on large tables — use `SketchDivider` (`data` tier) for separators.

### AP.3 Component mapping (§52)

| Current component | SketchUI variant | Rough.js? | Notes |
|-------------------|------------------|-----------|-------|
| Card / Panel / Section | `SketchSurface` | yes (border) | paper fill, clean content |
| Section header bar | `SketchSectionHeader` | yes (underline) | clean title, no cursive |
| Button | `SketchButton` | yes (border) | controlled size, small press |
| Input | `SketchInput` | yes (bottom line) | focus ring preserved |
| Divider / row separator | `SketchDivider` | yes (`data`) | cheap, dense-safe |
| Tabs | `SketchTabs` (S3 backlog) | yes | paper strip, pencil active accent |
| Accordion | `SketchAccordion` (S3 backlog) | yes (edge) | clean expanded content |
| Dialog | `SketchDialog` (S3 backlog) | yes (frame) | workspace-owned dialogs only |
| Table | clean table + `SketchSectionHeader` | header only | never roughen column geometry |

### AP.4 Phased migration plan (§55)

**Gate:** S3–S6 are BLOCKED until Phase 4 runtime closeout is proven
(dirty-state in a real workflow, service focus end-to-end, legacy state deprecation).
Do not derail that validation.

- **S1 — foundation** ✅ provider + tokens + roughness levels + seed helper + canvas hook
- **S2 — Bicycle daily scene** ✅ ~520px scene, unfinished background, calm animation
- **S3 — primitives + tabs/Home** ⏳ core primitives done; `SketchTabs`/tab-strip migration + Home polish remain
- **S4 — core tool workspaces** ⛔ gated: Calls, Tasks, Schedule, Documents, Nova shell
- **S5 — embedded Plexus EHR (visual only)** ⛔ gated: header, Intelligence Strip, Ancillary Journey, Qualifying Tests, Labs, Notes, Story — presentation only, zero behavior change
- **S6 — remaining workspaces** ⛔ gated: Email, Quick Note, Team Chat, Contacts, Team Ops, Reports, Patient Search

### AP.5 Non-negotiable constraints

- Visual layer only — no change to EHR behavior, service episodes, calls, scheduling,
  tasks, documents, permissions, tab behavior, dirty state, or session state (§56).
- Typography stays Inter; no cursive for clinical/operational data (§41).
- Accessibility is not overridden by aesthetic — contrast, keyboard nav, focus state,
  screen readers, touch targets all preserved (§59).
- EHR must read as *a physician's organized clinical notebook*, not a drawing app (§50).
- Do NOT migrate shell components (dock, rails, Viewing-As, clinic selector, top shell).

---

## AQ. Playground Button Contract & Migration Audit

**Hard rule:** every button visually rendered INSIDE the Playground canvas uses
the SketchUI button language, routed through the single canonical `SketchButton`
(or `SketchAwareButton`, which selects it by context). Shell-owned buttons (dock,
left/right rails, top selectors, panel-popover promote controls) stay Liquid
Glass. The boundary is decided by OWNER, not by which workspace renders it.

### AQ.1 Canonical primitives

- `SketchButton` (`sketch/SketchPrimitives.tsx`) — variants `primary` /
  `secondary` / `ghost` / `danger` / `icon`; sizes `sm` / `md`; `active` state
  (soft pencil-blue wash); structural roughness; hover (no glass shimmer), 1px
  press, always-visible focus ring, disabled dimming. Clean Inter label — the
  shell is hand-drawn, the text is not.
- `SketchAwareButton` (`sketch/SketchAwareButton.tsx`) — accepts the shadcn
  Button vocabulary (`default|secondary|outline|ghost|destructive` + `sm|lg|icon`)
  and renders `SketchButton` when under `PlaygroundSketchProvider`, otherwise the
  normal shadcn `Button`. This is the migration path for SHARED components that
  render both inside and outside the Playground — swap `<Button>` →
  `<SketchAwareButton>` with no logic fork (§24).

### AQ.2 Migrated now (Playground-owned buttons)

| Location | Buttons | Result |
|----------|---------|--------|
| `PlaygroundTabBar` | tab (as button), active underline, close affordance, dirty mark | Paper tab + rough pencil-blue active underline; gold pencil dirty mark; sketch-consistent close |
| `DirtyCloseDialog` | Save / Discard / Cancel | `SketchButton` primary / danger / ghost (workspace-owned dialog §20) |
| `NovaWorkspaceTab` | prompt chips, Send | `SketchButton` ghost + icon |
| Tab context menu | Pin/Unpin, Close, Close Others, Close All | radix ContextMenu (menu, not buttons) |

### AQ.3 Gated (S4–S6) — shared workspace buttons

These render inside the canvas via the registry but live in SHARED components
reused outside the Playground. They must adopt `SketchAwareButton` during the
gated visual migration (do NOT fork logic). Counts are current `<Button>` usages:

| Component | Renders in | `<Button>` count | Phase |
|-----------|-----------|------------------|-------|
| `CallWorkspace` (+ `DispositionSheet`) | Call workspace | 8 (+4) | S4 |
| `PatientChart` + `PatientChartSections` | Patient EHR | 8 + 6 | S5 |
| Tasks / Schedule / Documents wrapped components | those workspaces | (in wrapped portal components) | S4 |
| Email / Quick Note / Team Chat / Contacts / Team Ops / Reports / Patient Search | those workspaces | scaffold / TBD | S6 |

**Gate:** per §55, S4–S6 stay blocked until Phase 4 runtime closeout is confirmed
in the browser. The canonical primitives + context-aware wrapper are ready so the
migration is mechanical when the gate opens.

### AQ.4 Explicitly NOT migrated (shell-owned, stays Liquid Glass)

`GlobalDock`, left Portal Utility Rail, right Work Queue Rail, top shell
selectors (Viewing-As, clinic), and `PromoteToPlaygroundButton` (mounted on
shell/panel popovers such as `PatientMiniCalendar` that promote content INTO the
Playground — it belongs to the source surface, not the canvas).

### AQ.5 Note on "Home" / "Tome"

There is no standalone Home/Tome button component today. "Home" is a Playground
workspace tab (`playground_home`) rendered by `PlaygroundTabBar` — now on the
SketchUI paper-tab treatment. If a distinct Home/Tome control is added later, it
must use `SketchButton` when it sits inside the Playground area.

### AQ.6 Header composition fix (control-level SketchUI, no full-width surface)

Correcting an earlier mistake: the tab-strip container had been given a warm
paper background + border, which rendered as a full-width tan band behind the
lone Home tab. SketchUI must apply to individual CONTROLS, never to a
full-width row surface (§18).

Fixed composition:
- `PlaygroundTabBar` row wrapper is now a transparent flex (no bg, no border
  band). Home + Tome render as small standalone `SketchButton` controls sitting
  directly on the canvas; workspace tabs follow as individual paper tabs after a
  subtle divider (only when tabs exist). Home shows an active pencil accent via
  the `active` prop, not a full-width selected region.
- New `SketchSelect` primitive (native `<select>` + rough graphite border, paper
  fill, chevron, blue-pencil focus) — added to `sketch/index.ts`.
- The Playground page header in `TeamPortalShell` (title + Viewing-as / Clinic
  selectors + Calendar) is now SketchUI per the §8 page-level override: the two
  `Select`s → `SketchSelect`, the Calendar `<button>` → `SketchButton` icon. All
  behavior and `data-testid`s preserved. The header + center share one
  continuous paper background (`#FAFBF8`); the glass `backdrop-blur` and the
  alternating white/rounded surfaces were removed.
- Boundary unchanged elsewhere: GlobalDock, left/right rails stay Liquid Glass;
  the shell dialogs/left-rail shadcn `Select`s (consent template, upload kind)
  are NOT Playground-owned and remain as-is.

### AQ.7 Continuous canvas + canonical SketchTab + artwork fix

Three corrections after screenshot review:

1. **No inner white tile.** The root cause was the LEGACY center renderer in
   `TeamPortalShell` (the `centerMode`/`activeTab` IIFE ending in a
   `rounded-[28px] bg-white shadow` `playground-home` fallback) still rendering
   as a sibling of `PlaygroundBridge`. It is now `display:none` (`hidden`,
   `aria-hidden`) — type-identical, never displayed. The Playground engine is
   the sole center. The bridge is now a transparent `flex-1` region and the
   `playground-canvas-surface` carries `h-full` so the canvas has real height;
   the header + canvas share one `#FAFBF8` paper background with no rounded
   container, shadow, or white/tan split.

2. **Tome removed.** No Tome button, workspace, alias, or routing (it was an
   undefined feature and was wrongly aliased to Documents — deleted).

3. **Canonical `SketchTab`.** Home and every workspace tab now render through a
   single `SketchTab` component (rough graphite paper outline via `TabOutline`,
   colored-pencil active underline, gold pencil dirty mark, pin, compact close,
   Playground-owned context menu). Home is just the first `SketchTab`, not a
   separate button. The tab row is a transparent flex — no strip/band/border.

4. **Home artwork restored.** With the bridge/content height chain fixed
   (`PlaygroundSketchProvider` is a `flex-1 flex-col`, content div `flex-1`,
   home pane `absolute inset-0`), the `playground_home` keep-alive pane now has
   real height and the ~520px bicycle scene centers on the paper. It shows
   whenever Home is the active tab (regardless of other open tabs) and hides
   when another workspace is active.

### AQ.8 TECH DEBT — DELETE Legacy TeamPortal Center Renderer

**Action item (open):** DELETE the Legacy TeamPortal Center Renderer.

- It is currently only `hidden` (`display:none`, `aria-hidden`) inside
  `TeamPortalShell` — NOT physically removed. This is a TEMPORARY state.
- The block is the `centerMode`/`activeTab` IIFE (approx. the `flex min-h-0
  flex-1 gap-4` container through its split-panel close) plus the deprecated
  center state (`centerMode`, `centerSrc`, `centerTitle`, `portalTabs`,
  `activePortalTabId`, `dockOpenApps`, `dockActiveApp`, `openPortalTab`,
  `focusPortalTab`, `closePortalTab`, `ExpandedSectionView`).
- Do NOT add any new dependency on it. The Playground engine
  (`PlaygroundWorkspaceProvider` + `PlaygroundBridge`) is the sole center.
- Removal is deferred only because it is a large, mechanical deletion in a
  4k-line file and should land as its own reviewed change, not bundled with the
  SketchUI work.

---

## AR. S4 — Core Workspace SketchUI Migration Report

Visual-only migration of the five core Playground workspaces. No API, mutation,
permission, routing, dirty-state, or patient-context logic was changed.

New primitives added: `SketchTextarea`, `SketchBadge` (tones graphite/blue/green/
gold/red/violet). `SketchSurface` gained a `data-testid` passthrough.

### Nova (NovaWorkspaceTab)
- STATUS: migrated (Playground-only).
- COMPONENTS: header → `SketchSurface`; message input → `SketchInput`; Nova reply
  bubble → `SketchSurface`; user bubble → soft pencil-blue wash; prompt chips +
  Send already `SketchButton`. Transparent wrapper, no tile.
- PRIMITIVES: SketchSurface, SketchInput, SketchButton.
- BUTTON AUDIT: chips + Send = SketchButton. No shadcn buttons.
- STANDARD UI REMAINING: none. Ambient Nova particle form is a separate concern
  (dock) and intentionally untouched.
- TYPECHECK: 0.

### Tasks (PortalPlexusTasksTab)
- STATUS: migrated (Playground-only).
- COMPONENTS: header → `SketchSectionHeader`; list panel → `SketchSurface`; task
  status chip → `SketchBadge` (tone mapped from status); rows use cheap `divide-y`
  separators (no per-row Rough.js).
- PRIMITIVES: SketchSectionHeader, SketchSurface, SketchBadge.
- BUTTON AUDIT: no buttons in this read-only feed.
- STANDARD UI REMAINING: none. 0 `Card` imports.
- TYPECHECK: 0.

### Documents (PortalDocumentLibraryTab)
- STATUS: migrated (Playground-only).
- COMPONENTS: 3 `Card` → `SketchSurface`; search `Input` → `SketchInput`; Kind +
  Surface `Select` → `SketchSelect`; per-row Open `Button` → `SketchButton` (wrapped
  in `<a>`); "superseded" chip → `SketchBadge` (gold). Rows use `divide-y`.
- PRIMITIVES: SketchSurface, SketchInput, SketchSelect, SketchButton, SketchBadge.
- BUTTON AUDIT: Open = SketchButton. No shadcn buttons.
- STANDARD UI REMAINING: none. 0 shadcn Card/Select/Button imports.
- TYPECHECK: 0.

### Calls (CallWorkspace) — CONTEXT-AWARE
- STATUS: migrated via context-aware rendering. CallWorkspace ALSO renders in a
  non-Playground quick-dial `<Dialog>` in TeamPortalShell, so it must NOT be hard
  sketch. It reads `useSketchEnv()`: inside the Playground it renders SketchUI;
  in the Dialog it renders the original shadcn look, unchanged.
- COMPONENTS: local `Panel` (SketchSurface in Playground / `Card` in Dialog) for
  the 5 cards; `StatusPill` → SketchBadge-or-span by context; `TargetChip` and
  `QuickOutcomeButton` → sketch-or-original by context; all action `Button`s →
  `SketchAwareButton` (Start/End call, Full disposition, Open Schedule, Open
  Case, Close tab, proof Open/Download).
- PRIMITIVES: SketchSurface, SketchBadge, SketchButton, SketchAwareButton +
  useSketchEnv.
- BUTTON AUDIT: every button is SketchAwareButton or (context) SketchButton.
- STANDARD UI REMAINING (by design): `Card` + `Badge` imports are retained ONLY
  for the non-Playground Dialog fallback path. Inside the Playground canvas, no
  generic shadcn control renders.
- TYPECHECK: 0.

### Schedule (SchedulingWorkspace)
- STATUS: migrated (Playground-only).
- COMPONENTS: removed the self-wrapped `rounded-[28px] bg-slate-50 shadow` FULL-
  WORKSPACE TILE (now transparent) and the gradient header (now a `SketchSurface`
  notebook header); hand-rolled panels → `SketchSurface` (times, booking form,
  month calendar); `Input`×4 → `SketchInput`; `Textarea` → `SketchTextarea`; raw
  native `<select>` → `SketchSelect`; time-slot buttons + calendar prev/next +
  close + Confirm → `SketchButton`. Month-calendar DAY CELLS kept as legible grid
  buttons (structural legibility per the "don't roughen the time grid" rule).
- PRIMITIVES: SketchSurface, SketchInput, SketchTextarea, SketchSelect,
  SketchButton.
- BUTTON AUDIT: all controls = SketchButton. No shadcn Button/Input/Textarea.
- STANDARD UI REMAINING: `Label` (ui/label) retained for form labels (text only,
  not a styled control surface). Calendar day cells are plain grid buttons for
  scannability — intentional, not a generic-UI leak.
- TYPECHECK: 0.

### Disclosure
- The ONLY generic shadcn UI that can still render is (a) CallWorkspace's Dialog
  fallback OUTSIDE the Playground (by design), and (b) `Label` text elements in
  Schedule. No full-workspace tile remains in any of the five. `npm run check` = 0.
- STOP POINT: S5 (embedded Plexus EHR) NOT started — awaiting user visual review.

---

## AS. Team Portal SketchUI Convergence Report

Expanded the SketchUI boundary from "Playground only" to the whole Team Portal
shell (header + both rails + all Team-Portal-owned overlays). GlobalDock stays
Liquid Glass; Plexus EHR content stays clinical UI. Visual-only — no behavior,
data, permission, or routing change. `npm run check` = 0.

### New shared overlay primitives (`sketch/SketchOverlays.tsx`)
SketchPopover, SketchDialog (+Header/Footer/Title/Description/Close),
SketchDropdownMenu + SketchMenuItem (default/active/danger + icon),
SketchTooltip, SketchCheckbox, SketchRadio. Floating content uses a stable CSS
paper look (paper fill, graphite border, irregular corner radius, soft shadow) —
NOT per-open Rough.js — so PORTALED menus/dialogs render as sketch without
jitter (§9, §40, §35).

### Converted surfaces
| Surface | Result |
|---------|--------|
| Top header | Already SketchUI (SketchSelect ×2, SketchButton calendar, paper bg). |
| Left Portal Utility Rail | Glass panel → paper (`#F7F8F4`) + graphite edge + restrained shadow (no giant card). Blue band → paper with pencil-blue active underline. Tab buttons + pin sketch. `LeftRailToolsButton` → `SketchButton` with per-group muted colored-pencil accents. Tray wrapper → paper. Behavior preserved (peek/pin/modes/narrow/drag). |
| Right Work Queue Rail | Glass-tile → paper + graphite edge. Blue sticky header → paper. `WorkspaceModeSwitcher` dark tabs → paper tabs with pencil active underline + accent count chips (tabular-nums). Consent/count `Badge` → `SketchBadge`. Row cards → paper with pencil left-accent. `CallRowQuickActions` → paper circular buttons. |
| WorkspaceSettingsDialog | `SketchDialog` + `SketchSelect` + `SketchButton`. |
| CalendarQuickScheduleDialog | `SketchDialog` shell + `SketchSelect` (time/service) + `SketchButton` footer. |
| SchedulePatientDialog | `SketchDialog` + `SketchPopover` (date picker) + `SketchButton` footer. |

### Readability
Numbers kept `tabular-nums` + graphite; patient names / times / labels stay
Inter. Sketch effect is on shells + accents only.

### Remaining non-SketchUI in Team Portal (explicit disclosure)
1. **DispositionSheet** (`outreach/DispositionSheet.tsx`) — its Radix `Sheet`
   shell + inner buttons/inputs are still shadcn. NOT converted because it ALSO
   renders on `pages/outreach-scheduler-portal.tsx` (a non-Team-Portal page);
   hard-converting would leak sketch there. Needs a context-aware pass (like
   CallWorkspace) or a dedicated decision. Its draft-dirty signaling is already
   context-aware.
2. **shadcn `Switch`** in WorkspaceSettingsDialog — kept (no SketchSwitch built;
   §34 was optional). Functional + accessible.
3. **`Label`** text elements in header/dialogs — text-only, not styled controls;
   left as-is.
4. **Inner form inputs** in CalendarQuickScheduleDialog / SchedulePatientDialog —
   the dialog SHELLS, selects, and primary buttons are sketch; some interior
   `Input`/custom typeahead controls remain shadcn/raw. Opened surfaces read as
   sketch (the §9/§40 requirement); full input conversion is a follow-up.
5. **Hidden legacy center** in TeamPortalShell (`display:none`) — dead code with
   shadcn Cards; excluded (slated for deletion per AQ.8).

### Excluded by design (untouched)
- GlobalDock + its popups (`dock/**`) — Liquid Glass.
- Plexus EHR content (`patient-directory/**`) — clinical UI.

### STOP
Convergence pass complete. EHR NOT migrated; GlobalDock NOT changed. Awaiting
user visual review at http://localhost:5050 (VALIDATION PENDING).

---

## AT. Winter / Ice-Blue SketchUI Recolor

Recolored the SketchUI system to a winter / ice-blue palette (token-first).
SketchUI concept, structure, roughness, and hand-drawn language are unchanged —
only hues changed. EHR untouched; GlobalDock architecture unchanged.
`npm run check` = 0.

### Tokens (`sketchTokens.ts` — source of truth)
`SKETCH_COLORS` retuned, keys kept stable so no consumer broke:
- Ink → blue-graphite: `graphite #24324A`, `graphiteSoft #52627B`, `graphiteLight #8292AA`.
- Pencil blues: `blue #5F83C5`, `blueDeep #365B93`, `blueLight #AFCBF1`, `indigo #526FA7`.
- Cool paper family: `snow #FFFFFF`, `paper #F7FAFF`, `paperSoft #EEF5FF`, `paperDeep #E4EEFC`, `ice #DDEBFA`.
- Winter status: `green #6F9E8A`, `gold #B49B62`, `red #A96C78`, `violet #7C86B8`.
- `paperWarm` key retained as a back-compat alias but now cool (`#EEF5FF`) — no tan anywhere.
`SKETCH_CSS_VARS` extended with `--sketch-graphite-soft`, `--sketch-blue-deep/-light`,
`--sketch-indigo`, `--sketch-snow`, `--sketch-paper-soft/-deep`, `--sketch-ice`,
and `--sketch-border: rgba(36,50,74,0.5)` (cool blue-graphite border).

### Patched surfaces (hardcoded literals → cool)
- `SketchOverlays.tsx`: surface/tooltip/checkbox/radio borders `rgba(31,41,55)` → `rgba(36,50,74)`; shadows cooled; dialog scrim → cool navy; content text → `--sketch-graphite`.
- `SketchPrimitives.tsx`: `SketchBadge` tones → winter hues; `SketchButton` primary/active wash → `rgba(95,131,197,0.14)`.
- `TeamPortalShell.tsx`: header + continuous canvas `#FAFBF8` → `#F7FAFF`; both rail bodies `#F7F8F4` → `#EEF5FF`; rail borders/shadows cooled.
- `WorkspaceModeSwitcher.tsx`: active tab bg → cool paper; chip bg cooled.
- `CallRowQuickActions.tsx`: `#FAFBFD` → `#F7FAFF`; border cooled.
- `PlaygroundHomeArtwork.tsx` (bicycle): dark parts `#374151` → `#2F405C`; tree green → cool green; fence ochre → faint cool blue-graphite (no warm ochre); main linework/accent already winter via tokens.

### Not changed (by design)
- `#4863A0` (Plexus blue) left as-is — already cool, pre-existing, and used on non-SketchUI surfaces (PortalShell, dock icons) out of scope.
- GlobalDock (`dock/**`) architecture unchanged (still Liquid Glass); a cool recolor of its tint was not applied this pass.
- Plexus EHR (`patient-directory/**`) untouched.
- shadcn `Switch` in WorkspaceSettingsDialog unchanged.

### Audit result
No `#FAFBF8` / `#F7F8F4` / `#FAFBFD` / `#F6F4EE` / cream / beige literals remain in
any Team Portal or Playground SketchUI file. Only `paperWarm` references remain,
and that token is now cool. Dev server (localhost:5050) rebuilt clean, HTTP 200.
VALIDATION PENDING user runtime review.

---

## AU. Team Portal SketchUI Convergence Audit (post-revert)

Plus: colored-pencil rail edges added — `SketchRailEdge` traces the left rail's
right boundary and the right rail's left boundary (Rough.js, stable seed,
absolute + pointer-events-none, moves with the rail, no layout width). Not a box.

| Component | Location | Current UI | Owner | Should be Sketch? | Status |
|-----------|----------|-----------|-------|-------------------|--------|
| Top header (selectors, calendar) | TeamPortalShell header | SketchSelect / SketchButton | Team Portal | yes | ✅ done |
| Left Portal Utility Rail | TeamPortalShell | paper + graphite edge + pencil edge | Team Portal | yes | ✅ done |
| Right Work Queue Rail | TeamPortalShell | paper + graphite edge + pencil edge | Team Portal | yes | ✅ done |
| Tab strip + tabs | PlaygroundTabBar | SketchTab | Playground | yes | ✅ done |
| Tab context menu | PlaygroundTabBar | radix ContextMenu (default styling) | Playground | yes | ⚠️ default shadcn — GAP |
| Tool launchers | LeftRailToolsButton/ToolDock | SketchButton | Team Portal | yes | ✅ done |
| Mode switcher (Clinic/Ancillary/Calls) | WorkspaceModeSwitcher | sketch paper tabs | Team Portal | yes | ✅ done |
| Queue rows + quick actions | TeamPortalShell/CallRowQuickActions | paper + pencil accents | Team Portal | yes | ✅ done |
| DirtyCloseDialog | Playground | SketchButton | Playground | yes | ✅ done |
| WorkspaceSettingsDialog | tools/ | SketchDialog + SketchSelect + SketchButton | Team Portal | yes | ✅ done (Switch below) |
| CalendarQuickScheduleDialog | portal/ | SketchDialog + SketchSelect + SketchButton | Team Portal | yes | ✅ shell + selects + primary buttons |
| SchedulePatientDialog | portal/ | SketchDialog + SketchPopover + SketchButton | Team Portal | yes | ✅ shell + popover + buttons |
| shadcn `Switch` | WorkspaceSettingsDialog | shadcn Switch | Team Portal | optional (§34) | ⚠️ generic — GAP (low) |
| Toast (`useToast` → Toaster) | global | shadcn toast | shared (Team Portal + other pages) | yes for TP (§14) | ⚠️ shared surface — deferred |
| PatientMiniCalendar | left-rail popover | Card + Button | Team Portal | yes | ⚠️ generic — GAP |
| DispositionSheet | Sheet | shadcn Sheet + inner controls | dual (Team Portal + outreach-scheduler page) | yes for TP | ⏸ deferred (dual-portal; draft signaling already context-aware) |
| CommunicationTray / PortalMessagesPanel / PortalMessagesWindow / LeftRailCompactCalendar | left rail | raw markup (no shadcn) | Team Portal | light-touch | ◻ inherit paper; not explicitly sketch-styled |
| Center tool tabs (Email/QuickNote/Contacts/TeamOps/PatientSearch/Reports/InvoiceDesk/Scripts/Proof) | Playground workspaces | shadcn | Playground | yes | → S6 (next) |
| Hidden legacy center | TeamPortalShell (`display:none`) | shadcn Cards | dead code | n/a | ◻ excluded (delete per AQ.8) |
| GlobalDock + popups | dock/** | Liquid Glass | GlobalDock | NO | ✅ intentionally excluded |
| Plexus EHR content | patient-directory/** | clinical UI | EHR | NO | ✅ intentionally excluded |

### Gaps to close now (Team-Portal-only, low-risk)
- shadcn `Switch` → sketch switch (WorkspaceSettingsDialog).
- Tab context menu → sketch (route through `SketchDropdownMenuContent`/`SketchMenuItem` styling, or restyle the radix ContextMenu content).
- PatientMiniCalendar Card/Button → SketchSurface/SketchButton.

### Deferred (disclosed, not silently skipped)
- Toast renderer (shared with non-Team-Portal pages) — needs a scoped decision.
- DispositionSheet (dual-portal) — context-aware pass or dedicated decision.

## AV. S6 — Remaining Playground Workspaces: Wire + Sketch Report (Option A)

Scope of this pass (authorized as Option A = REAL FUNCTIONAL WORKSPACE + PLAYGROUND WIRING + SKETCHUI PRESENTATION): migrate the remaining Playground workspaces off `PlaceholderWorkspace` by (1) wiring the registry to the real component and (2) sketch-migrating that component — one workspace end-to-end before the next. No business-logic fork. GlobalDock (Liquid Glass), Nova (particle), and Plexus EHR clinical content excluded by constraint. `npm run check` = 0. STOP after S6 (no Engagement/Notes/Messaging rebuild).

### Rail edge (carried from tasks 1–2, for completeness)
`SketchRailEdge` (Rough.js vertical pencil-blue + faint graphite pass, stable seed, `absolute inset-0 pointer-events-none z-[1]`) mounted inside both transforming rail bodies (left rail → right edge, right rail → left edge). Moves with peek/pin, hides with the rail, no layout width change.

### S6 status table

| WORKSPACE | REAL COMPONENT | WIRED | SKETCHUI | CANONICAL / MOCK / SCAFFOLD | DIRTY-STATE | PATIENT-AWARE | KEEPALIVE | PORTALED UI AUDITED | GAPS |
|---|---|---|---|---|---|---|---|---|---|
| Patient Search (`patient_search`) | `PortalPatientSearchTab` (97L) | ✅ dedicated type | ✅ Surface/Input/Button/Badge, no tile | Canonical (live search) | n/a (stateless query) | ✅ opens `patient_ehr` on select (dedupe, EHR stays clinical) | ✅ | ✅ | — |
| Scripts (`scripts`) | `PortalTemplatesResourcesTab` (200L) | ✅ dedicated type (legacy kind `resources` EXACT) | ✅ | Canonical | none | no | ✅ | ✅ | — |
| Proof/PDFs (`proof_pdfs`) | `PortalMarketingTab` (223L) | ✅ dedicated type (legacy kind `marketing`) | ✅ | Canonical (same comp the left rail always used) | none | no | ✅ | ✅ | **Naming mismatch**: label "Proof/PDFs" vs component = patient-facing Marketing materials. DISCLOSED, not silently aliased. |
| Email (`email`) | `PortalEmailComposerTab` (344L) | ✅ wrapper | ✅ hard-sketched | Canonical composer over mock threads | composer state self-contained | contextual | ✅ | ✅ | Hard-sketched (not context-aware) — safe because legacy center that also renders it is `display:none` dead code. |
| Quick Note (`quick_note`) | `QuickNoteTool` (161L) | ✅ wrapper | ✅ | Canonical | ⚠️ self-contained `body` state; keepAlive preserves draft + save works, **but NOT wired to Playground Save/Discard-close contract** | no | ✅ | ✅ | Dirty-state not integrated with tab-close prompt. DISCLOSED. |
| Contacts (`contacts`) | `InternalContactsTool` (140L) | ✅ wrapper | ✅ | Canonical | none | no | ✅ | ✅ | — |
| Invoice Desk (`invoice_desk`) | `InvoiceDeskPanel` (385L) | ✅ wrapper | ⚠️ **shallow** — outer `bg-white` → `bg-transparent` + header border softened only | Mock (Plexus Bank mock data) | create-form local state | no | ✅ | partial | Deep control-by-control sketch DEFERRED: 385L mock panel, bespoke styling (`#0d1b3e`, `inputCls`, status tones), high churn / low value. Sits transparent on canvas (no full-workspace tile). DISCLOSED. |
| Team Ops (`team_ops`) | **none** (no file exists) | scaffold | sketch empty-state | Scaffold | — | — | — | — | No real component. Left scaffold + honest "scaffolded" empty-state. NOT fabricated / NOT aliased. |
| Reports (`report`) | only `ReportUploadPanel` (per-case upload widget) | scaffold | sketch empty-state | Scaffold | — | — | — | — | No standalone Reports workspace exists; `ReportUploadPanel` is an in-case upload widget, not a center workspace. Aliasing it would misrepresent the product. Left scaffold. DISCLOSED. |
| Team Chat (`team_chat`) | `CommunicationTray` / `PortalMessagesPanel` (mock) | scaffold | sketch empty-state | Scaffold (mock messaging) | — | — | — | — | Real surfaces are mock-backed rail/floating UI, not center workspaces. Not forced into a center tab. Left scaffold. DISCLOSED. |
| Messages (`message_thread`) | `PortalMessagesWindow` (mock, `mockPortalMessages.ts`) | scaffold | sketch empty-state | Scaffold (mock messaging) | — | — | — | — | Same as Team Chat: mock, floating/rail surface. Left scaffold. DISCLOSED. |

### PlaceholderWorkspace → sketch empty-state
`PlaceholderWorkspace` (registry.tsx) now renders a `SketchSurface` with honest copy ("This workspace is scaffolded — no functional implementation is wired yet.") + the workspace type + patient id when present. `bg-transparent` root (no full-workspace tile). This covers all 10 remaining scaffold types (task/message_thread/team_chat/document/report/sticky_notes/team_ops/custom_tool/whiteboard/game) — they no longer show a generic gray block, and they do not pretend a feature exists.

### Primitives used across S6
`SketchSurface`, `SketchInput`, `SketchButton`, `SketchBadge` (from `playground/sketch/SketchPrimitives`). No full-workspace tile on any migrated workspace (transparent roots so content sits on the canvas). `keepAlive` workspaces stay mounted (`display:none`) in `PlaygroundCanvas` for draft persistence + context isolation.

### Standard (non-sketch) UI still present after S6
- Invoice Desk interior controls (mock panel) — shallow-sketched only (see table).
- Scaffold workspaces have no interior UI (empty-state only).
- Carried-over deferrals from section AU: PatientMiniCalendar (Card/Button popover), global Toast renderer (shared), DispositionSheet (dual-portal), one shadcn `Switch` residual styling.
- Hidden legacy center still exists as `display:none` dead code — recommend delete per AQ.8 (not done this pass to avoid scope creep).

### Verification
- `npm run check` (tsc) = **0 errors**.
- Dev server restarted clean on port 5050 (5000 blocked by macOS AirPlay; `.env` not auto-loaded by dev script) → app returns HTTP 200.
- Registry: 3 dedicated types resolve with no leftover `custom_tool` dispatch; session-restore persists `type: PlaygroundWorkspaceType` for all S6 types (no unknown-type fallback); `singletonDedupeKey` distinct per type.

### Explicitly NOT done (STOP boundary honored)
Engagement, Sticky Notes, Messaging rebuild, PCS/ACS — not started. Palette/winter recolor — not touched. GlobalDock architecture — unchanged.
