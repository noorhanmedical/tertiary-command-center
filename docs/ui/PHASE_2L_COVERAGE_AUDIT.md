# Phase 2L — Mechanical Coverage Audit (Step 17)

**Status:** Documentation-only. No application source created, edited, or deleted.
**Repository HEAD:** `08a78978` (branch `phase/2l-ui-discovery`).
**Purpose:** Mechanically verify the discovery doc set is internally complete and consistent before the independent reviewer passes (Steps 18–20). This file records the automated cross-checks and their results.

## Document set (13 discovery docs under `docs/ui/`)

| Doc | Lines | Role |
|---|---|---|
| PHASE_2L_FUNCTIONAL_FREEZE.md | 300 | Behavioral contract to preserve |
| PHASE_2L_ROUTE_ROLE_MAP.md | 182 | Every route → roles/guards/APIs (RT###) |
| PHASE_2L_SURFACE_INVENTORY.md | 792 | Every UI surface (S001–S361) |
| PHASE_2L_COMPONENT_PATTERN_INVENTORY.md | 252 | 34 UI primitives, shared vs bespoke |
| PHASE_2L_PATIENT_JOURNEY_MAP.md | 530 | 18 stages + 21 exception paths |
| PHASE_2L_ROLE_JOURNEYS.md | 123 | 6 roles + role×portal matrix |
| PHASE_2L_UI_ARCHITECTURE_MAP.md | 309 | 22 domains, UI→API→service→schema→repo→table |
| PHASE_2L_REPLIT_REFERENCE_AUDIT.md | 187 | REF-HOME/REF-DOCK catalogs + comparison |
| PHASE_2L_USER_REFERENCE_REGISTER.md | 92 | User-preferred refs; USER_DECISION_REQUIRED |
| PHASE_2L_UI_DEBT_MAP.md | 33 findings | Duplication/debt, classified |
| PHASE_2L_INFORMATION_ARCHITECTURE_FACTS.md | 258 | Current IA facts + 15 user questions |
| PHASE_2L_VISUAL_EVIDENCE_INDEX.md | 76 | Screenshot/asset index (branch:path) |
| PHASE_2L_COVERAGE_AUDIT.md | — | This file |

## Mechanical checks (Step 17 A–J)

| # | Check | Method | Result |
|---|---|---|---|
| A | Every App.tsx route represented in ROUTE_ROLE_MAP | `grep -c path= client/src/App.tsx` (72) + NotFound/wrapper vs 73 `RT###` rows | **PASS** |
| B | Every active/conditional route has ≥1 surface | Surface inventory groups every routed page as a PAGE surface (S-ids); 361 surfaces span all active routes | **PASS** |
| C | Every journey stage cites surface IDs OR BACKEND_ONLY | Journey map: 85 distinct S-refs + 14 BACKEND_ONLY annotations across 18 stages; 5 stages explicitly BACKEND_ONLY (canonical Procedure Note, Billing Document, Claim, Refund/Reversal, Model-B merge) | **PASS** |
| D | Every surface references a real file/symbol | Surface inventory rows each cite a source file + React symbol; S-namespace S001–S361 sequential (S121 merged into S099) | **PASS** (after fixing a stray "S001–S400" header typo → S001–S361) |
| E | Every role in auth/guards exists in ROLE_JOURNEYS | 6 roles (admin, clinician, scheduler, biller, technician, liaison) all present | **PASS** |
| F | Every major domain present in UI_ARCHITECTURE_MAP | 22/22 domains matched (Home … Settings) | **PASS** |
| G | Every Home/Dock reference file represented in REPLIT_REFERENCE_AUDIT | REF-HOME-001/002; REF-DOCK-001/002/003; DOCK_ITEMS + PORTAL_DOCK_ITEMS + PORTAL_DOCK_ROLES transcribed | **PASS** |
| H | Every Home*/Dock*/screenshot asset catalogued or excluded | 37 relevant screenshots catalogued + 21 lower-relevance excluded-with-reason; 46 rows in Visual Evidence Index | **PASS** |
| I | No design choice made | grep for recommendation/winner language across docs/ui → none (all such strings negated: "no winner", "user decides") | **PASS** |
| J | No application source changed | `git diff --name-only` empty; `git diff --cached` empty; working tree shows only `docs/ui/` (new) + pre-existing baseline untracked files; `git diff --check` clean | **PASS** |

## Cross-document ID integrity

- Surface IDs referenced by Journey / Role Journeys / Debt / IA / Component docs: **all within S001–S361** (0 out-of-range references).
- Route IDs: RT001–RT072 (+RT032b) — 73 rows, one per App.tsx route/redirect.
- Reference IDs: REF-HOME-001/002, REF-DOCK-001/002/003.
- Debt IDs: DEBT-001–DEBT-033, each with a single classification.

## Corrections applied during this audit (docs-only)

1. `PHASE_2L_SURFACE_INVENTORY.md` line 22: header said the S-namespace was `S001–S400`; corrected to `S001–S361` to match the doc's actual definitions and its own footer (line 792).
2. `PHASE_2L_REPLIT_REFERENCE_AUDIT.md` (Reviewer-B round-1 finding): added a "Complete home code-file inventory" table cataloguing all six home code files (`HomeDashboard`, `HomeDashboardPreview`, `HomeLiveDashboard`, `HomeLiveDashboardPreview`, `HomeSidebar`, `HomeWorldClocks`) with their canonical-parity diff. `HomeSidebar.tsx` was previously uncatalogued; verified it is byte-identical to canonical HEAD and imported by `pages/home.tsx`/`pages/home-preview.tsx` (not by `HomeDashboard.tsx` as the reviewer surmised). All supporting components; no reference-unique home code exists.
3. **Six-role dock assignment correction** (user factual review): dock selection is deterministic — `dockItems = PORTAL_DOCK_ROLES.has(me.role) ? PORTAL_DOCK_ITEMS : DOCK_ITEMS` (`GlobalFloatingDock.tsx:194-195`) with `PORTAL_DOCK_ROLES = {scheduler, clinician}` (`navigationRegistry.ts:142`). Therefore `scheduler`/`clinician` → `PORTAL_DOCK_ITEMS` (REF-DOCK-002); `admin`/`biller`/`technician`/`liaison` → `DOCK_ITEMS` (REF-DOCK-001). Corrected every stale statement that described `DOCK_ITEMS` as admin/biller-only or that marked technician/liaison dock as `UNKNOWN_NEEDS_VERIFICATION`, across: `ROLE_JOURNEYS`, `REPLIT_REFERENCE_AUDIT`, `USER_REFERENCE_REGISTER`, `COMPONENT_PATTERN_INVENTORY`, `UI_DEBT_MAP`, `INFORMATION_ARCHITECTURE_FACTS`, and this audit. The current implementation is unchanged; future dock role-assignment remains `USER_DECISION_REQUIRED`. (Billing-access `admin/biller` statements — e.g. `/invoices` RoleGuard, billing surfaces — are correct and were left intact; they are not dock statements.)

## Known residual UNKNOWN_NEEDS_VERIFICATION items (carried to reviewers, not resolved as design)

- Production source-of-truth: `patient_directory` vs `global_plexus_patients`.
- `refund` vs `reversal` business distinction; `adjustment` allocation command path.
- Scheduler/biller server-side gating beyond auth + clinic scope.
- `POST /api/settings/qualification-modes` lacking a role guard.
- Component inventory cited "FilterBar in 6 files"; grep found 5 at this HEAD (6th flagged UNKNOWN).

> **Resolved (no longer UNKNOWN):** "Exact dock served to `technician`/`liaison`" — resolved to `DOCK_ITEMS` by direct source reading of the deterministic `PORTAL_DOCK_ROLES.has(me.role)` branch (see Correction #3 above).

**Verdict:** mechanical coverage audit PASS. Proceeding to independent Reviewer A (discovery/architecture completeness) and Reviewer B (Replit reference accounting).
