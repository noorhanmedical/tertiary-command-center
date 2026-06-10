# QA index + regression coverage map

**Status:** Docs-only (Bundle 36). No QA script added by this bundle. No runtime change.
**Date:** 2026-06-10.
**Purpose:** Single source of truth for every `scripts/qa-*.mjs` invariant the repo ships, what it protects, and where the architecture program still relies on manual + downstream test coverage. The doc is the regression map the strict validation loop (`for s in scripts/qa-*.mjs; do node "$s" || exit 1; done`) is anchored on.

**Cross-references:**
- `protected-flows.md` — flows the QA loop is supposed to keep working.
- `do-not-touch.md` + `billing-invoice-hard-stop-map.md` — files/columns out of bounds for safe bundles.
- `team-portal-playground-wiring-contract.md` + `playground-design-system-implementation-plan.md`.
- `operational-queue-call-list-projection-design.md` + `shadow-read-parity-log-analyzer-design.md` + `operational-queue-staging-runbook.md` + `portal-cutover-readiness-checklist.md`.
- `plexus-iq-read-model-contract.md` + `patient-directory-shadow-read-contract.md`.
- `admin-review-approval-commit-inventory.md` + `qualification-structure-cleanup-design.md`.
- `aws-readiness-checklist.md` + `aws-readiness-design.md` + `background-jobs-design.md` + `documents-storage-design.md`.

---

## 0. How to read this index

Each row lists:

- **Script** — relative path under `scripts/`.
- **Surface** — what the script protects (route / module / doc / fixture / contract).
- **Style** — `source-invariant` (text checks only), `runtime-test` (spawns tsx + asserts), `helper-smoke` (runs a script with controlled env), `combined` (both).
- **Stops on** — the specific drift a failure indicates.

The strict validation loop runs all rows in alphabetical order (the shell glob order). Any row exiting non-zero aborts the loop and the current safe-bundle PR is blocked.

---

## 1. Architecture / docs

| Script | Surface | Style | Stops on |
|---|---|---|---|
| `qa-docs-architecture-integrity.mjs` | `docs/architecture/` index | source-invariant | A doc the program depends on was deleted (hard requireFile) or a soft `info()` doc was re-deleted after promotion. |
| `qa-playground-contract-references.mjs` | `team-portal-playground-wiring-contract.md` + `playground-design-system-implementation-plan.md` | source-invariant | The wiring contract drops a load-bearing surface name (PortalShell, TeamPortalShell, CommandPlayground, Patient Directory, Operational Queue, Team Task, Journey Event, RBAC) or a visual rule (blank white, no grid, pencil, sketchbook, black pencil, clinical, EMR). |

---

## 2. Operational Queue / call-list projection

| Script | Surface | Style | Stops on |
|---|---|---|---|
| `qa-operational-queue-call-list-flag.mjs` | `USE_OPERATIONAL_QUEUE_CALL_LIST` flag contract + the shadow-read block in `routes/schedulerAssignments.ts` | source-invariant | Flag default flipped, flag accessor moved off the pure module, shadow-read block leaked PHI, the gated block lost its log-emission count of 3. |
| `qa-operational-queue-projection-parity.mjs` | The pure projection module + inline reference + design doc | combined | Pure module gained a DB/schema import, the gap-mapping changed (5 lossy fields), the missing-row log shape drifted, the inline reference and the real module disagree on any fixture. |
| `qa-scheduler-assignment-projection-dormancy.mjs` | Whole-tree import graph | source-invariant | Any non-test file outside the projections directory imports the projection or the default fetcher, or the legacy route adopts either without going through the cutover gate. |
| `qa-shadow-read-parity-log-schema.mjs` | `routes/schedulerAssignments.ts` shadow-read block + `operational-queue-call-list-projection-design.md` §6 | source-invariant | Canonical field set drifted (`parityMatch`, `legacyCount`, `queueCount`, `inLegacyOnly`, `inQueueOnly`), PHI identifier leaked into the block, a non-canonical `[USE_OPERATIONAL_QUEUE_CALL_LIST]` log variant was added. |
| `qa-shadow-read-parity-log-analyzer.mjs` | `scripts/parity-log-analyzer.mjs` + the PHI-free fixture | combined | Analyzer dropped its PHI redactor, gained a network call, dropped a verdict label, or stopped recognising a canonical log line variant. |

---

## 3. Engagement Center

| Script | Surface | Style | Stops on |
|---|---|---|---|
| `qa-engagement-assignment-runtime.mjs` | `routes/engagementAssignmentBoard.ts` runtime contract | source-invariant | The legacy GET handler lost the canonical projection, the conflict guard, or the bulk-assign envelope. |
| `qa-engagement-board-v2-parity-fixture.mjs` | The v2 projection algorithm pinned in a no-DB test | combined | Field mapping drifted from the legacy projection at lines 274-319. |
| `qa-engagement-board-dormant-service.mjs` | `server/modules/engagement-board/service.ts` | source-invariant | The dormant service gained a DB import, or the legacy route adopted a helper before the cutover gate. |
| `qa-shared-engagement-board-contract.mjs` | `@shared/contracts/engagementBoard` row shape | source-invariant | A field was renamed, retyped, or dropped from the row contract. |

---

## 4. Patient Directory + Patient Packet

| Script | Surface | Style | Stops on |
|---|---|---|---|
| `qa-patient-directory-parity-fixture.mjs` | Canonical-id derivation + grouping rule | combined | The lower/trim normalization, the SHA-256 derivation, or the freshest-screening-wins demographic selection moved. |
| `qa-patient-packet-aliases.mjs` | Patient packet alias resolution + lookup precedence | source-invariant | An alias mapping changed in a way that would reorder the packet's source lookup. |
| `qa-shared-patient-packet-contract.mjs` | `@shared/contracts/patientPacket` shape | source-invariant | A packet contract field was renamed, retyped, or dropped. |
| `qa-pdf-protection-invariants.mjs` | `lib/pdfGeneration.ts` + `lib/pdfPacketGrouping.ts` | source-invariant | A protected PDF surface gained a runtime branch that changes ICD chip omission, header rendering, or page layout. |

---

## 5. Plexus IQ

| Script | Surface | Style | Stops on |
|---|---|---|---|
| `qa-plexus-iq-backend.mjs` | Backend AI services + service module boundaries | source-invariant | An AI service file moved out of the canonical directory or lost a load-bearing export. |
| `qa-plexus-iq-interior.mjs` | Interior workspace + sidebar wiring | source-invariant | A workspace surface lost a `data-testid` or a load-bearing import. |
| `qa-plexus-iq-clinical-import-fixture.mjs` | Bundle 6 canned fixture + Bundle 24 expansion | source-invariant | Either fixture's totals changed, or the expansion lost its outreach group / schema-rejection coverage. |

Open coverage gap: a runtime parity wrapper that asserts the legacy `POST /api/plexus-iq/clinical-import` produces the totals locked by the two fixtures. The wrapper is the PIQ-3b.1 PR (referenced from Bundle 24); the architecture-program does not yet ship it.

---

## 6. Admin Review + Qualification

| Script | Surface | Style | Stops on |
|---|---|---|---|
| (none yet — surface is hard-stop) | | | |

Open coverage gap: A parity inventory at the runtime level — currently we only ship the docs inventory (Bundle 30) and the cleanup design (Bundle 31). The runtime cover ships when the qualification cleanup PR-series (§6 of Bundle 31) lands.

---

## 7. Team Portal + Playground

| Script | Surface | Style | Stops on |
|---|---|---|---|
| `qa-navigation-dock-home-tiles.mjs` | Navigation dock + home tiles markup | source-invariant | A tile lost its `data-testid` or a load-bearing import. |
| `qa-command-center-architecture.mjs` | Command-center top-level wiring | source-invariant | The command-center shell lost its canonical module imports. |
| `qa-team-portal-workspace-engine.mjs` | Team Portal workspace engine | source-invariant | The workspace engine lost a load-bearing import or `data-testid`. |
| `qa-team-portals-restore.mjs` | Team Portal restore + role resolution | source-invariant | A role gate or restore surface drifted. |
| `qa-visit-outreach-tile-parity.mjs` | Visit + Outreach tile parity | source-invariant | The two tiles diverged in the markup the home dock renders. |
| `qa-playground-contract-references.mjs` | (see §1) | | |

Open coverage gap: Playground data-envelope (Bundle 32 Step G) — adds when the design-system PR-series starts.

---

## 8. Billing / readiness

| Script | Surface | Style | Stops on |
|---|---|---|---|
| `qa-document-readiness-parity-fixture.mjs` | `REQUIRED_DOC_RULES` evaluator in `billingReadiness.repo.ts` | combined | A required doc type dropped, a passing status changed, or the verdict shape drifted. |
| `qa-documents-dormant-module.mjs` | `server/modules/documents/` | source-invariant | A legacy repo adopted the dormant module's helpers, or the pure module gained a DB import. |
| `qa-billing-packet-architecture-fixture.mjs` | `BILLING_READINESS_STATUSES` lifecycle | combined | A status was added, the transition graph changed, or a money-bearing field was reintroduced. |

Open coverage gap: A money-PR-only suite that locks claim / remittance / invoice calculations. That suite is OUT OF SCOPE for any safe bundle (`billing-invoice-hard-stop-map.md` §4) and ships only with a money-PR.

---

## 9. Infrastructure

| Script | Surface | Style | Stops on |
|---|---|---|---|
| `qa-phi-safe-logger.mjs` | PHI-safe logger contract | source-invariant | A logger consumer leaked a PHI shape. |
| `qa-background-jobs-dormant-module.mjs` | Background-jobs module + design doc | source-invariant | The skeleton gained runtime side effects, lost a JobKind, or any non-test file adopted the module. |
| `qa-aws-staging-readiness-helper.mjs` | `scripts/aws-staging-readiness-helper.mjs` | combined | The helper gained an AWS SDK / network call / env-value-logging shape, or lost the strict/json/list-only modes. |

Open coverage gap: A live-deploy CI gate that exercises §1 and §2 of the AWS checklist on a staging environment. Out of scope for the architecture program; lives in the production-cutover PR.

---

## 10. Recommended next test coverage (not yet implemented)

These are the surfaces the architecture program has CONTRACTED (via docs) but not yet caught with a runtime invariant. Each is a candidate bundle for the next round if it lands inside the safe-bundle envelope.

1. **Patient Directory shadow-read parity-fixture test** — Bundle 20 contracted the schema; a no-DB parity test for the shadow-read row pinning would mirror Bundle 12's pattern.
2. **Plexus IQ aggregate read forwarding test** — Bundle 25 contracted the forwarding rule; a no-DB test that asserts every §3 field round-trips on a canned fixture.
3. **Playground data-envelope QA** — Bundle 32 Step G; ships when the UI PR-series starts.
4. **Admin Review approval pipeline runtime parity** — Bundle 30 documented the steady state; a runtime parity wrapper that asserts the step order under a canned input.
5. **Operational queue + team-task projection parity for the unified `TeamTask` shape** — mirrors Bundle 12 for the team-task module.
6. **Engagement Center cancel-many invariant** — the bulk cancel endpoint's lifecycleStatus + engagementStatus write pattern is load-bearing for the operational-queue filter; a parity fixture that pins it would complement Bundle 22.

Each candidate respects the safe-bundle rules: no runtime change, no UI change, no API change, no money math.

---

## 11. Maintenance rules

A safe bundle that adds or removes a QA script MUST:

- Add a row to the appropriate §1–§9 table in this document.
- If the script is a combined or runtime-test style, document its tsx target path in the row's notes.
- If the script's style would change (source-invariant → combined), update the Style column in this row in the same PR.

A safe bundle that promotes an `info()` entry in `qa-docs-architecture-integrity.mjs` from soft to hard MUST also update the table row to note the promotion.

A safe bundle that REMOVES a QA script MUST link a replacement script or document the deliberate gap in §10.

---

## 12. Non-promises

- This index does NOT lock the script contents. The QA scripts evolve; this index tracks intent, not implementation.
- This index does NOT specify ordering beyond "alphabetical via the shell glob". A future runner PR may add `--parallel` or `--bail-on-first` modes; that PR updates this section.
- This index does NOT cover end-to-end UI tests (Playwright, Cypress). That coverage is a separate test layer the architecture program does not own.
- This index does NOT cover database migration tests; migrations are explicitly out of safe-bundle scope.

End of index.
