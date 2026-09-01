# Phase 2L — Visual Evidence Index (Primary Branch)

Status: **DISCOVERY / DOCUMENTATION-ONLY.** Index of screenshots / visual assets on the PRIMARY branch `plexus-iq-admin-review-persistence-fix` (SHA `66f1c04b`).

## How to read this index

- Every asset is referenced by **`branch:path`**. **No binaries were copied** into the working tree.
- These assets exist on the PRIMARY branch but **not** on canonical HEAD `08a78978` (HEAD carries 0 files under `attached_assets/screenshots/`). They are the PRIMARY branch's unique visual contribution.
- The `mockup_preview_*` PNGs are **design mockups / explorations**, not necessarily captures of wired code. Treat them as `VISUAL_REFERENCE_ONLY — REBIND TO CURRENT CANONICAL DATA`.
- To view an asset without copying: `git show plexus-iq-admin-review-persistence-fix:<path> > /tmp/preview.png` (scratch only), or open via a read-only git viewer.
- Confidence = confidence that the named component/route association is correct.

Common path prefix for the mockup set:
`attached_assets/screenshots/b21176dd-0ceb-4762-ade6-ccb10fdb1fcc-00-3gngrwi3yke2s_kirk_replit_dev_mockup_preview_<Name>.png`
(the host segment `…kirk_replit_dev…` indicates a Replit dev-host mockup export — historical origin).

## A. Homepage / cockpit design mockups (Home / Cockpit / TodayAtGlance)

| # | File (branch:path) | Associated component | Associated route | Category | Confidence | Notes |
|---|--------------------|----------------------|------------------|----------|-----------|-------|
| 1 | `plexus-iq-admin-review-persistence-fix:attached_assets/screenshots/…mockup_preview_CockpitDashboard.png` | none (mockup) | none | Cockpit | HIGH (is a mockup) / LOW (maps to code) | Cockpit-style dashboard exploration |
| 2 | `…mockup_preview_HomeAestheticEditorial.png` | none | none | Home | LOW | Editorial aesthetic |
| 3 | `…mockup_preview_HomeAestheticMidnight.png` | none | none | Home | LOW | Dark/midnight aesthetic |
| 4 | `…mockup_preview_HomeAestheticTactile.png` | none | none | Home | LOW | Tactile aesthetic |
| 5 | `…mockup_preview_HomeAgendaToday.png` | none | none | TodayAtGlance | LOW | Agenda/today framing |
| 6 | `…mockup_preview_HomeApproachAgenda.png` | none | none | Home | LOW | Approach: agenda |
| 7 | `…mockup_preview_HomeApproachClinicHub.png` | none | none | Home | LOW | Approach: clinic hub |
| 8 | `…mockup_preview_HomeApproachCockpit.png` | none | none | Cockpit | LOW | Approach: cockpit |
| 9 | `…mockup_preview_HomeApproachCommand.png` | none | none | Home | LOW | Approach: command |
| 10 | `…mockup_preview_HomeBandFlow.png` | none | none | Home | LOW | Banded flow layout |
| 11 | `…mockup_preview_HomeBento.png` | none | none | Home | LOW | Bento grid |
| 12 | `…mockup_preview_HomeCenteredColumn.png` | none | none | Home | LOW | Centered column (resembles REF-HOME-001 structure) |
| 13 | `…mockup_preview_HomeCommandFirst.png` | none | none | Home | LOW | Command-first |
| 14 | `…mockup_preview_HomeCommandRail.png` | none | none | Home | LOW | Command rail |
| 15 | `…mockup_preview_HomeFocusColumn.png` | none | none | Home | LOW | Focus column |
| 16 | `…mockup_preview_HomeHeroBand.png` | none | none | Home | LOW | Hero band |
| 17 | `…mockup_preview_HomeHorizontalDeck.png` | none | none | Home | LOW | Horizontal deck |
| 18 | `…mockup_preview_HomeLayoutBento.png` | none | none | Home | LOW | Layout: bento |
| 19 | `…mockup_preview_HomeLayoutGroupedList.png` | none | none | Home | LOW | Layout: grouped list |
| 20 | `…mockup_preview_HomeLayoutSidebarRail.png` | none | none | Home | LOW | Layout: sidebar rail |
| 21 | `…mockup_preview_HomeLeftRail.png` | none | none | Home | LOW | Left rail |
| 22 | `…mockup_preview_HomeRefinedBalanced.png` | none | none | Home | LOW | Refined balanced |
| 23 | `…mockup_preview_HomeRefinedEditorial.png` | none | none | Home | LOW | Refined editorial |
| 24 | `…mockup_preview_HomeSplitGrid.png` | none | none | Home | LOW | Split grid |
| 25 | `…mockup_preview_HomeTriCockpit.png` | none | none | Cockpit | LOW | Tri-cockpit |
| 26 | `…mockup_preview_HomeTriageQueue.png` | none | none | Home | LOW | Triage queue |
| 27 | `…mockup_preview_HomeUniformMatrix.png` | none | none | Home | LOW | Uniform matrix (resembles REF-HOME-002 uniform tiles) |
| 28 | `…mockup_preview_HomeUsabilityAccessible.png` | none | none | Home | LOW | Usability: accessible |
| 29 | `…mockup_preview_HomeUsabilityAffordance.png` | none | none | Home | LOW | Usability: affordance |
| 30 | `…mockup_preview_HomeUsabilityHierarchy.png` | none | none | Home | LOW | Usability: hierarchy |
| 31 | `…mockup_preview_HomeVibePlayful.png` | none | none | Home | LOW | Vibe: playful |
| 32 | `…mockup_preview_HomeVibeQuiet.png` | none | none | Home | LOW | Vibe: quiet |
| 33 | `…mockup_preview_HomeVibeWarm.png` | none | none | Home | LOW | Vibe: warm |
| 34 | `…mockup_preview_HomeWeightedBento.png` | none | none | Home | LOW | Weighted bento |
| 35 | `…mockup_preview_TodayAtGlance.png` | none | none | TodayAtGlance | LOW | "Today at a glance" panel concept |

## B. Deployed-app captures (mission-control / other)

| # | File (branch:path) | Associated component | Associated route | Category | Confidence | Notes |
|---|--------------------|----------------------|------------------|----------|-----------|-------|
| 36 | `plexus-iq-admin-review-persistence-fix:attached_assets/screenshots/xmmqmqjp27_us-west-2_awsapprunner_com.png` | likely `HomeDashboard` (REF-HOME-001) | likely `/home` (app root) | Home | MEDIUM | Capture of the deployed AWS App Runner root; closest real capture of the live home |
| 37 | `plexus-iq-admin-review-persistence-fix:attached_assets/screenshots/xmmqmqjp27_us-west-2_awsapprunner_com_mission-control.png` | `mission-control.tsx` | `/mission-control` | mission-control | MEDIUM | Capture of the deployed `/mission-control` route |

## C. Other visual assets (lower relevance to home/dock)

- `attached_assets/targeted_element_<ts>.png` — **14 files** (timestamps: `1781997457488`, `1781997479956`, `1782010912225`, `1782011106495`, `1782011670195`, `1782011748224`, `1782012027543`, `1783195401576`, `1783195445376`, `1783196147386`, `1783196536743`, `1783196835947`, `1783198159766`, `1783198784940`). Category: **other** (targeted UI element captures, mostly admin-review / panel work per adjacent `Pasted-*` prompt logs). Confidence LOW for home/dock relevance. Not individually mapped.
- `attached_assets/image_<ts>.png` — **7 files** (`1781994970958`, `1781997860048`, `1782008660218`, `1782009669026`, `1782067332226`, `1782101106341`, `1783021684092`). Category: **other**. Confidence LOW for home/dock relevance.

## Counts

- **Relevant screenshots found (home/cockpit/today/mission mockups + deployed captures):** **37** (all under `attached_assets/screenshots/`).
- **Catalogued in Sections A + B:** **37** (35 mockups + 2 deployed captures).
- **Excluded from the home/dock catalog (Section C, low relevance):** 14 `targeted_element_*` + 7 `image_*` = **21** listed but not individually mapped.
- Canonical HEAD `08a78978` carries **0** of the `attached_assets/screenshots/` assets — these are unique to the reference branches.

**No winner homepage or dock has been chosen. All homepage mockups are `VISUAL_REFERENCE_ONLY — REBIND TO CURRENT CANONICAL DATA` and each remains `USER_DECISION_REQUIRED` (see `PHASE_2L_USER_REFERENCE_REGISTER.md`).**
