# PR #294 — Enterprise UI demo tiles · architecture

Branch: `enterprise-ui-demo-tiles-2026-06-21`
Status: demo-only; not wired to backend; safe to merge into demo branches but **not** production-ready as-is.

---

## What this PR adds

Four new enterprise-facing tiles on the Home grid + left rail:

| Tile | Route | Module purpose |
|---|---|---|
| Mission Control | `/mission-control` | Executive monitoring + workflow handoff. **Monitoring only — no qualify / approve / reject.** |
| Imaging Central | `/imaging-central` | Imaging execution. **Ultrasound only today.** No BrainWave / VitalWave / EKG / PGX / CGX / general ancillary docs. |
| Clinic Analytics | `/clinic-analytics` (also `/analytics`) | Clinic due diligence + revenue opportunity. **Not execution workflow.** |
| Clinic Onboarding | `/clinic-onboarding` | Implementation, SOPs, go-live readiness. **Not live production ops.** |

Plus compatibility redirects: `/ultrasound-central` → `/imaging-central`, `/technician-central` → `/imaging-central`.

---

## Routes

All in `client/src/App.tsx` inside the existing Wouter `<Switch>`. Verified working:

```
/mission-control          → MissionControlPage
/imaging-central          → ImagingCentralPage
/ultrasound-central       → Redirect /imaging-central
/technician-central       → Redirect /imaging-central
/clinic-analytics         → ClinicAnalyticsPage
/analytics                → ClinicAnalyticsPage
/clinic-onboarding        → ClinicOnboardingPage
```

Navigation:
- `client/src/components/GlobalNav.tsx` — Mission Control / Imaging Central / Clinic Analytics / Clinic Onboarding nav items (admin role for analytics + onboarding; admin+clinician+technician+liaison for imaging).
- `client/src/components/HomeDashboard.tsx` — four corresponding home tiles in the secondary tile grid.

The legacy "Ultrasound Central" and "Technician Central" main-tile labels are gone. "Technician Portal" remains as a separate role portal (different surface entirely).

---

## Page + component structure

Pages stay thin and orchestration-focused. Each owns state + filters + composition. Heavy data moved out.

```
client/src/pages/
  mission-control.tsx              541 lines (was 1032)
  imaging-central.tsx              776 lines (was 1352)
  clinic-analytics.tsx             710 lines (was 1017)
  clinic-onboarding.tsx            661 lines (was 797)

client/src/components/mission-control/
  MissionControlWorkbench.tsx      173 lines
    — extracted right-side detail Sheet (Mark Ready / Mark Blocked /
      Assign Owner / To Engagement / To Scheduler / To Billing /
      View Documents). Self-contained: takes (selected, onClose,
      onAction). Status + priority style maps inlined.

client/src/lib/enterprise-demo/
  types.ts                         428 lines
    — shared TypeScript domain types for all four tiles. When real
      APIs land, swap these for `@shared/contracts/<feature>` imports.
  missionControlDemoData.ts        366 lines
  imagingCentralDemoData.ts        545 lines
  clinicAnalyticsDemoData.ts       162 lines
  clinicOnboardingDemoData.ts      125 lines
```

Why this shape:
- **Pages are orchestration only** — state, filters, layout, prop wiring.
- **Demo data is isolated** — one file per tile, clearly named, banner comment at top. Productionizing one tile doesn't disturb the others.
- **Types are shared** — one `types.ts` is the single contract surface that backend + frontend will eventually agree on.
- **Component extraction was selective** — only the Mission Control workbench was extracted (clean self-contained interface, used twice in dev iteration). The other pages already have reasonable internal structure via small local render helpers (`SectionTitle`, `Kpi`, `RiskItem`, `StatusIcon`). Forcing more splits would add files without reducing real duplication.

---

## Where mock data lives

| Tile | Demo data file | Key exports |
|---|---|---|
| Mission Control | `client/src/lib/enterprise-demo/missionControlDemoData.ts` | `MISSION_CONTROL_CLINICS`, `MISSION_CONTROL_SERVICES`, `MISSION_CONTROL_QUEUE_DEFS`, `MISSION_CONTROL_QUEUE_LABEL`, `MISSION_CONTROL_LANES` (25 lane rows), `MISSION_CONTROL_ALERTS` (8 alerts), `MISSION_CONTROL_SECTIONS` (10 ops sections) |
| Imaging Central | `client/src/lib/enterprise-demo/imagingCentralDemoData.ts` | `IMAGING_CENTRAL_CLINICS`, `IMAGING_CENTRAL_TECHNICIANS`, `IMAGING_CENTRAL_ULTRASOUND_TYPES`, `IMAGING_CENTRAL_STATUSES`, `IMAGING_CENTRAL_WORK_QUEUE` (16 tasks), `IMAGING_CENTRAL_COVERAGE_ROWS` (5 rows), `IMAGING_CENTRAL_TECH_ROSTER` (4 techs) |
| Clinic Analytics | `client/src/lib/enterprise-demo/clinicAnalyticsDemoData.ts` | `CLINIC_ANALYTICS_SHARED_MEDS` (10), `CLINIC_ANALYTICS_SHARED_ICD` (8), `CLINIC_ANALYTICS_SHARED_CPT` (8), `CLINIC_ANALYTICS_PROFILES` (3 clinics, fully nested) |
| Clinic Onboarding | `client/src/lib/enterprise-demo/clinicOnboardingDemoData.ts` | `ONBOARDING_MATURITY_LABELS`, `ONBOARDING_OWNERS`, `ONBOARDING_SALES_SECTIONS`, `ONBOARDING_SECTION_DEFS` (25 sections × 6 items), `ONBOARDING_CLINICS` (4), `buildOnboardingChecklist(seed)` |

Each page imports its data with aliased names (`MISSION_CONTROL_LANES as LANES`, etc.) so the local code reads naturally while the file path makes the demo nature obvious at the import line.

Every page has a `// TODO API:` marker at the import block calling out the exact replacement target.

---

## What is intentionally demo-only

- All 4 pages render from static in-memory data. No fetch, no React Query, no toast routing to a real handler.
- Every action button (`Mark Ready`, `Send to Engagement`, `Send to Billing`, `Upload Imaging Report`, `Send to Clinic Onboarding`, `Run batch`, `Admin signoff`, etc.) currently fires a `toast()` only.
- View-state switchers on Mission Control + Imaging Central pages (loading / empty / error) are demo aids, not real state.
- `buildOnboardingChecklist(seed)` is deterministic per seed so the demo is stable without backend storage. In production a real API would replace it.
- Mission Control includes BrainWave / VitalWave / EKG / PGX / CGX as **monitored services** in lane mock data — Mission Control observes operations across all services. This is intentional and consistent with its monitoring-only boundary.

---

## Future productionization steps

Per tile, when the backend ships:

1. **Define the contract.** Add `shared/contracts/<feature>.ts` describing the API response. Re-use the existing `types.ts` shapes where they fit; tighten where the demo was loose.
2. **Add the API helper.** New file `client/src/lib/<feature>Api.ts` exposing typed `apiRequest` wrappers (follow the `billingAuditorApi.ts` pattern).
3. **Add the React Query hook.** New file `client/src/hooks/api/<feature>.ts` using `useQuery` + `qk.<feature>` keys (follow the `dashboard.ts` pattern).
4. **Swap the import.** Replace the `*DemoData` import in the page with the new hook. Convert `useMemo`-derived KPIs to derive from the live data instead.
5. **Delete the demo data file.** Once no consumer remains, remove `client/src/lib/enterprise-demo/<feature>DemoData.ts`. Update or trim `types.ts`.
6. **Remove the `// TODO API:` markers.**

The four pages can be productionized in any order; they share types but not data.

---

## Business boundaries (preserved + reaffirmed)

- **Mission Control** = monitoring only. Buttons are `Mark Ready / Mark Blocked / Assign Owner / Send to Engagement / Send to Scheduler / Send to Billing / View Documents`. **No qualify / approve / reject actions.** Qualification + Admin Review live in Plexus IQ.
- **Imaging Central** = imaging execution. Currently ultrasound-only by design. **No BrainWave / VitalWave / EKG / PGX / CGX / general ancillary document workflows.** "Technician" is a role label; "Ultrasound" is the study type. The module is always called "Imaging Central" (old "Ultrasound Central" / "Technician Central" main-tile labels are gone; compatibility redirects preserved).
- **Clinic Analytics** = due diligence + revenue opportunity. **Not execution workflow.** ICD/CPT/medication tables are for the financial assessment of a prospective clinic, not patient care.
- **Clinic Onboarding** = implementation + SOPs + go-live readiness. **Not live production ops.** Batch intake runner is a placeholder; admin/owner signoff fires a toast only.

`docs/architecture/do-not-touch.md` does not list any of the four PR files. This PR only adds new files + extends `App.tsx`, `GlobalNav.tsx`, `HomeDashboard.tsx`.

---

## Known risks

1. **No backend wiring yet.** Don't ship to customers expecting these surfaces to function. The mock data looks plausible but every action button is a no-op toast.
2. **Type duplication risk** when productionizing. If `types.ts` and `@shared/contracts/<feature>` ever drift, the demo and the real surface can diverge silently. Recommendation: when the backend lands, `types.ts` should re-export from `@shared/contracts/...` instead of carrying its own copies.
3. **Bundle size.** All four tiles add to the client bundle even when not visited (no route-level code-splitting today). The existing Vite warning about chunks > 500 kB is pre-existing, not caused by PR #294.
4. **Style-map duplication.** `MissionControlWorkbench.tsx` has private copies of `statusStyles` and `priorityStyles` because the parent page still uses them in the lanes table. If a third consumer appears, hoist them into a shared `client/src/components/mission-control/missionControlStyles.ts`.
5. **Clinic Analytics references ICD/CPT codes in the UI.** This conflicts with the project-wide convention "No ICD codes in UI text" — that convention is about clinical notes / patient-facing copy. Clinic Analytics is a financial assessment surface where ICD/CPT are first-class concepts. If a reviewer flags this, document the exception or guard the page with an admin role check (already the case in `GlobalNav.tsx`).
6. **Imaging Central uses `Waves` icon for "Ultrasound Tasks" KPI.** The `Waves` import previously caused an unused-import diff in `HomeDashboard.tsx`; verified to still be in use in `imaging-central.tsx`.

---

## What should NOT be merged blindly

- **Don't merge to main while the four pages are still demo-only** unless the team explicitly accepts a demo-quality enterprise tile band on the home grid. Recommendation: keep PR #294 on its feature branch until at least one of the four tiles has a real backend (likely Mission Control first, since its data overlaps the existing engagement/billing/scheduling reads).
- **Don't merge without removing or hiding the demo-state switchers** on Mission Control + Imaging Central (the dropdown that toggles loading / empty / error views). Those are dev affordances.
- **Don't claim "Send to Engagement" works.** The button fires a toast. The real wire-through would call something like `POST /api/engagement/assignment-board/route` and route through `patientCommitService`.
- **Don't merge `clinic-onboarding` without the explicit understanding that `buildOnboardingChecklist` is a deterministic mock**, not stored state. Saving an admin signoff is a toast.
- **Don't extend the demo to BrainWave / VitalWave / EKG / PGX / CGX in Imaging Central.** Adding modalities here breaks the imaging-execution boundary. New ancillary types belong in their own module.
- **Don't repurpose Mission Control to perform qualification or approval.** That breaks the operating-model boundary documented in this repo's PLATFORM_OPERATING_MODEL.md.

---

## File-by-file changelog (PR #294 architecture pass)

Created:
- `client/src/lib/enterprise-demo/types.ts`
- `client/src/lib/enterprise-demo/missionControlDemoData.ts`
- `client/src/lib/enterprise-demo/imagingCentralDemoData.ts`
- `client/src/lib/enterprise-demo/clinicAnalyticsDemoData.ts`
- `client/src/lib/enterprise-demo/clinicOnboardingDemoData.ts`
- `client/src/components/mission-control/MissionControlWorkbench.tsx`
- `docs/architecture/pr-294-enterprise-ui-demo-architecture.md` (this file)

Edited (extraction only — no behavior change):
- `client/src/pages/mission-control.tsx` (1032 → 541 lines)
- `client/src/pages/imaging-central.tsx` (1352 → 776 lines)
- `client/src/pages/clinic-analytics.tsx` (1017 → 710 lines)
- `client/src/pages/clinic-onboarding.tsx` (797 → 661 lines)

Unchanged:
- `client/src/App.tsx` (routes preserved)
- `client/src/components/GlobalNav.tsx` (nav items preserved)
- `client/src/components/HomeDashboard.tsx` (home tiles preserved)
- Every file on `docs/architecture/do-not-touch.md`
- Every file under `migrations/`, `server/`, or `shared/`
