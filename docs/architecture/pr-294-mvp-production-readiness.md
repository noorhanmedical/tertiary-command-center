# PR #294 — MVP production-readiness pass

Branch: `enterprise-ui-demo-tiles-2026-06-21`
Status: **MVP production-readiness ready, not full production complete.**

This doc summarizes the hardening pass that turned PR #294 from a demo
into something safe to ship behind an admin route — without fake
persistence, without exposed dev controls, and without leaking mock
data as live production state.

---

## 1. What is MVP-ready now

- The four enterprise tiles render on dedicated routes:
  `/mission-control`, `/imaging-central`, `/clinic-analytics`,
  `/analytics`, `/clinic-onboarding`.
- All five routes are wrapped in `AdminGuard`. Non-admin sessions
  redirect to `/home`.
- Compatibility redirects `/ultrasound-central` → `/imaging-central`
  and `/technician-central` → `/imaging-central` preserved.
- Every page mounts a single, consistent **Demo fallback banner**
  (`DemoFallbackBanner` component) telling operators the data is
  illustrative.
- Every action button surfaces an honest **"Backend endpoint pending"**
  toast via `enterpriseBackendPendingToast(...)`. No fake success copy
  anywhere.
- Mock data + types live under `client/src/lib/enterprise-demo/`. Pages
  are orchestration only.
- Mission Control workbench is its own component
  (`client/src/components/mission-control/MissionControlWorkbench.tsx`).
- Business boundaries are documented at the file-header level:
  - Mission Control = monitoring only; no qualify / approve / reject.
  - Imaging Central = imaging execution; ultrasound only.
  - Clinic Analytics = due diligence + revenue opportunity; not execution.
  - Clinic Onboarding = implementation + go-live readiness; not live ops.

---

## 2. What is still demo fallback

- All four tiles still render from `client/src/lib/enterprise-demo/*`
  mock arrays. There is no TanStack Query reading the real spine yet.
- The demo banner labels this honestly at the top of every page.
- Counters, KPIs, and tables show mock numbers — never zeros styled
  as live state.

---

## 3. APIs discovered

The wider repo has well-developed React Query infrastructure
(`client/src/lib/queryClient.ts` → `apiRequest`, `client/src/hooks/api/<domain>.ts`
per-domain hooks). PR #294's pages currently do NOT use them — they
read from mock data. This is by design for MVP foundation, not an
oversight.

Existing API surfaces the four tiles could plug into when the time
comes:

- **Mission Control** lane feed candidates: `/api/screening-batches/...`,
  `/api/engagement/assignment-board/...`, `/api/plexus/tasks/...`,
  `/api/billing-readiness/...`. No single "Mission Control" endpoint
  exists yet — Phase 2 will compose one.
- **Imaging Central** candidates: `/api/case-document-readiness/...`,
  the existing scheduler / technician portal data. No "Imaging
  Central work queue" endpoint yet.
- **Clinic Analytics**: no `clinic-analytics` endpoint exists. Phase 2
  must compose payor mix + financial health + procedure / medication /
  ICD aggregates from existing tables.
- **Clinic Onboarding**: no `clinic-onboarding` endpoint exists.

---

## 4. APIs missing (Phase 2)

| Tile | Endpoint(s) to add |
|---|---|
| Mission Control | `GET /api/mission-control/snapshot` (lanes + queues + alerts + ops sections) + mutations (`POST /api/mission-control/lanes/:id/mark-ready`, etc.) |
| Imaging Central | `GET /api/imaging-central/work-queue`, `GET /coverage`, `GET /technicians`, plus mutations for upload / QC / billing handoff |
| Clinic Analytics | `GET /api/clinic-analytics/profiles`, `GET /clinic-analytics/medications`, `/icd`, `/cpt`, plus export endpoint |
| Clinic Onboarding | `GET /api/clinic-onboarding/clinics`, `GET /clinic-onboarding/checklist`, `POST /checklist/:itemId` (update status / signoff / etc.) |

---

## 5. Which actions are real (Phase 1)

- **Route navigation** — every "Open X" link routes to a real existing
  page (e.g., Clinic Analytics → "View Billing" links to `/billing`).
- **Filter state** — the search + dropdown filters in each table
  filter the mock data in-memory.
- **Tab / section switching** — internal nav (e.g., Field Mapping
  resource picker) works without backend.
- **Mission Control workbench drawer** — opens, displays lane detail,
  closes.

---

## 6. Which actions are disabled / backend-pending (Phase 1)

Every persistence-shaped action surfaces `enterpriseBackendPendingToast`
copy: "Backend endpoint pending — [action] is wired in the UI but
does not persist yet. The backend mutation for this action ships
separately."

Mission Control:
- Mark Ready
- Mark Blocked
- Assign Owner
- Send to Engagement
- Send to Scheduler
- Send to Billing
- View Documents

Imaging Central:
- Upload Imaging Report
- Upload Ultrasound Report
- Attach Report Metadata
- Register Report Binary
- QC Review
- Complete Procedure
- Mark No Show
- Needs Reschedule
- Cancelled
- Send to Billing
- View Document Package

Clinic Analytics:
- Export Clinic Report

Clinic Onboarding:
- Run batch patient intake
- Admin signoff
- Owner signoff

---

## 7. Route guards added

`client/src/App.tsx` now wraps every PR #294 route in `AdminGuard`:

```
/mission-control     → AdminGuard
/imaging-central     → AdminGuard
/clinic-analytics    → AdminGuard
/analytics           → AdminGuard (renders Clinic Analytics)
/clinic-onboarding   → AdminGuard
```

Non-admin sessions are redirected to `/home`. Finer role-level
authorization (clinician + biller read access to Clinic Analytics,
etc.) is intentionally NOT in this PR — it requires the role matrix
review that hasn't happened yet. AdminGuard is the safe default until
that lands.

Compatibility redirects (`/ultrasound-central`, `/technician-central`
→ `/imaging-central`) stay unguarded — they're pass-through redirects.

---

## 8. Demo fallback behavior

Single source of truth: `client/src/lib/enterprise-demo/demoMode.ts`.

```ts
isEnterpriseDemoFallbackEnabled()
  // true only when localStorage.enterpriseDemoMode === "1"
```

When the flag is OFF (production default):
- Demo state switchers (Live data / Loading / Empty / Error) are
  HIDDEN. Only the success view renders.
- The Demo fallback banner is shown at the top of every page.
- Action buttons render the same honest "Backend endpoint pending"
  toast regardless of flag.

When the flag is ON (developer preview):
- Demo state switchers appear in the page header with a
  "Developer preview controls" badge.
- The banner still shows (the data is still mock; nothing changes
  about that).

The flag is intentionally not exposed via any normal UI control. It's
a devtools-only affordance.

---

## 9. Remaining risks

1. **Bundle size.** All four tiles add to the client bundle even when
   not visited. The existing Vite advisory about chunks > 500 kB is
   pre-existing.
2. **Type duplication** between `enterprise-demo/types.ts` and any
   future `@shared/contracts/<tile>.ts` — when the backend ships,
   `enterprise-demo/types.ts` should re-export from the shared
   contracts to avoid drift.
3. **Role granularity.** Today every PR #294 route is AdminGuard-gated.
   Real-world use likely needs clinician + biller read access to
   Clinic Analytics, and scheduler read access to Imaging Central.
   Documented; not blocking MVP.
4. **No real audit trail** for any action a user clicks. The honest
   toast is the only feedback. Phase 2 must wire each mutation into
   the existing audit-log surface.
5. **Mock data freshness.** The dates / lane states / clinic stats
   are static. They never go stale because they're never refetched —
   but they also never reflect reality. The banner makes this clear.
6. **eCW Sync Health panel is NOT present** on Mission Control in this
   PR. That panel ships via the API Integration Station foundation
   (separate PR) and is wired to a Phase 2 backend.

---

## 10. Next steps to full production

1. **Build the Mission Control snapshot endpoint** + mutation
   endpoints. Swap `client/src/pages/mission-control.tsx` to call
   them via TanStack Query.
2. **Build the Imaging Central work-queue endpoint** + per-row
   mutations. Tighten the ultrasound-only enforcement on the server.
3. **Compose the Clinic Analytics profiles endpoint** + export
   endpoint that streams PDF/CSV server-side.
4. **Build the Clinic Onboarding checklist endpoints** + signoff
   persistence + the real batch-intake API.
5. **Run the role-matrix review** and lift `AdminGuard` to
   `RoleGuard(["admin","clinician","biller"])` (or similar)
   per-page.
6. **Remove the demo fallback banner + flag** once at least one tile
   is wired to live data. Replace the banner with per-section
   "Loading…" / "Connection error" states from React Query.

---

## Honest final status

**PR #294 is MVP production-readiness ready, not full production complete.**

Safe to ship behind admin routes. Not safe to claim is live operational
data. Not safe to expect any user click to persist. Banner + honest
toasts make this self-evident in the UI.

Reviewer (Amazon Q / Kiro): the four tiles render in isolation, with
admin-only routing, with honest framing, with extracted mock data, and
with no fake successes. The follow-up Phase 2 PR will replace the
mock-data imports with TanStack Query hooks one tile at a time.
