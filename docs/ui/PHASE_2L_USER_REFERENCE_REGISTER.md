# Phase 2L — User Reference Register

Status: **DISCOVERY / DOCUMENTATION-ONLY.** Records the user's stated preferences and the explicit decisions still open. **Makes zero assumptions about the final choice.**

## Primary user-preferred reference

- **PRIMARY USER-PREFERRED REFERENCE BRANCH:** `plexus-iq-admin-review-persistence-fix` (SHA `66f1c04b`).
- **USER EXPLICITLY LIKES:**
  - the **new front page / home direction** (the home surface on the PRIMARY branch), AND
  - the **floating dock direction** (the bottom-center `GlobalFloatingDock` on the PRIMARY branch).
- **Secondary (restoration reference):** `integration/restore-replit-ui-ux-canonical` (SHA `7c875fe9`). Recorded as a restoration reference only; not stated as a preferred design.

> Archaeology note (informational, not a decision): the home + dock **code** on the PRIMARY branch is already essentially identical to current canonical HEAD `08a78978` (see `PHASE_2L_REPLIT_REFERENCE_AUDIT.md`). The user's stated liking is consistent with what canonical 2K already ships. This note does **not** decide anything; it only prevents a false assumption that the liked direction is missing from canonical.

## What must NOT be inferred (explicit non-assumptions)

No implementer may assume any of the following. Each is a user decision, still open:

- **Exact final homepage variant** — REF-HOME-001 (production `HomeDashboard`) vs REF-HOME-002 (`HomeDashboardPreview`) vs any screenshot mockup direction. **Not decided.**
- **Colors / palette** — e.g. starfield/black-gradient Plexus IQ tile vs flat navy tile; indigo accents vs navy/slate; red badge vs navy badge. **Not decided.**
- **Layout** — centered single column vs bento vs sidebar-rail vs command-rail vs cockpit vs triage-queue, etc. **Not decided.**
- **Dock contents** — item set, order, labels, icons, full-vs-portal split, and whether Chat is ever enabled. **Not decided.**
- **Typography** — sizes, weights, tracking, eyebrow treatment. **Not decided.**

## Homepage variants discovered (every one carries USER_DECISION_REQUIRED)

### Wired code variants (reachable via `App.tsx` on PRIMARY)

| Ref | Variant | Source | Route | Status |
|-----|---------|--------|-------|--------|
| REF-HOME-001 | Production Home (`HomeDashboard`) | `…:client/src/components/HomeDashboard.tsx` via `pages/home.tsx` | `/home` | **USER_DECISION_REQUIRED** |
| REF-HOME-002 | Preview Home (`HomeDashboardPreview`, navy/uniform-tile) | `…:client/src/components/HomeDashboardPreview.tsx` via `pages/home-preview.tsx` | `/home-preview` | **USER_DECISION_REQUIRED** |

### Static screenshot mockup "home" variants (NOT wired code — visual references only)

Each is a PNG under `plexus-iq-admin-review-persistence-fix:attached_assets/screenshots/` (`…mockup_preview_<name>.png`). None is a coded homepage in this branch. All are `VISUAL_REFERENCE_ONLY — REBIND TO CURRENT CANONICAL DATA`. Full paths in `PHASE_2L_VISUAL_EVIDENCE_INDEX.md`.

| Mockup name | Status |
|-------------|--------|
| CockpitDashboard | **USER_DECISION_REQUIRED** |
| HomeAestheticEditorial | **USER_DECISION_REQUIRED** |
| HomeAestheticMidnight | **USER_DECISION_REQUIRED** |
| HomeAestheticTactile | **USER_DECISION_REQUIRED** |
| HomeAgendaToday | **USER_DECISION_REQUIRED** |
| HomeApproachAgenda | **USER_DECISION_REQUIRED** |
| HomeApproachClinicHub | **USER_DECISION_REQUIRED** |
| HomeApproachCockpit | **USER_DECISION_REQUIRED** |
| HomeApproachCommand | **USER_DECISION_REQUIRED** |
| HomeBandFlow | **USER_DECISION_REQUIRED** |
| HomeBento | **USER_DECISION_REQUIRED** |
| HomeCenteredColumn | **USER_DECISION_REQUIRED** |
| HomeCommandFirst | **USER_DECISION_REQUIRED** |
| HomeCommandRail | **USER_DECISION_REQUIRED** |
| HomeFocusColumn | **USER_DECISION_REQUIRED** |
| HomeHeroBand | **USER_DECISION_REQUIRED** |
| HomeHorizontalDeck | **USER_DECISION_REQUIRED** |
| HomeLayoutBento | **USER_DECISION_REQUIRED** |
| HomeLayoutGroupedList | **USER_DECISION_REQUIRED** |
| HomeLayoutSidebarRail | **USER_DECISION_REQUIRED** |
| HomeLeftRail | **USER_DECISION_REQUIRED** |
| HomeRefinedBalanced | **USER_DECISION_REQUIRED** |
| HomeRefinedEditorial | **USER_DECISION_REQUIRED** |
| HomeSplitGrid | **USER_DECISION_REQUIRED** |
| HomeTriCockpit | **USER_DECISION_REQUIRED** |
| HomeTriageQueue | **USER_DECISION_REQUIRED** |
| HomeUniformMatrix | **USER_DECISION_REQUIRED** |
| HomeUsabilityAccessible | **USER_DECISION_REQUIRED** |
| HomeUsabilityAffordance | **USER_DECISION_REQUIRED** |
| HomeUsabilityHierarchy | **USER_DECISION_REQUIRED** |
| HomeVibePlayful | **USER_DECISION_REQUIRED** |
| HomeVibeQuiet | **USER_DECISION_REQUIRED** |
| HomeVibeWarm | **USER_DECISION_REQUIRED** |
| HomeWeightedBento | **USER_DECISION_REQUIRED** |
| TodayAtGlance | **USER_DECISION_REQUIRED** |

> The user stated a liking for the *direction* on the PRIMARY branch. That statement does **not** select any specific mockup above, nor does it select REF-HOME-001 over REF-HOME-002. Treat all as open.

## Dock / navigation variants discovered (every one carries USER_DECISION_REQUIRED)

| Ref | Variant | Source | Roles | Status |
|-----|---------|--------|-------|--------|
| REF-DOCK-001 | Full dock (`DOCK_ITEMS`, 7 items) | `…:client/src/lib/navigation/navigationRegistry.ts` | admin / biller (default) | **USER_DECISION_REQUIRED** |
| REF-DOCK-002 | Portal dock (`PORTAL_DOCK_ITEMS`, 6 items) | same file | scheduler / clinician (`PORTAL_DOCK_ROLES`) | **USER_DECISION_REQUIRED** |
| REF-DOCK-003 | Role assignment (`PORTAL_DOCK_ROLES = {scheduler, clinician}`) | same file | — | **USER_DECISION_REQUIRED** |

Open dock sub-decisions (none decided): item set, order, labels, icons, full-vs-portal split, badge behavior, sheet-vs-inline-panel treatment, and whether Chat (`CHAT_ROUTE_AVAILABLE`) is ever enabled.

## Summary

- One primary preferred reference branch recorded; one secondary restoration reference recorded.
- Two wired homepage variants + 35 static mockup "home" variants + three dock/nav variants, **all** flagged `USER_DECISION_REQUIRED`.
- **No favorite, no winner, no palette, no layout, no dock contents, and no typography has been inferred or selected.**
