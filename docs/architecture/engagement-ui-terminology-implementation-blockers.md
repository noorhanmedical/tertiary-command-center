# Engagement UI terminology implementation — BLOCKERS

**Status:** Docs-only (Batch 19 of Engagement completion run). **No UI label changes shipped.** STOP.
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-ui-terminology-implementation-blockers.mjs`.

## 1. Why STOP

Per Batch 18 (#218) — operator-visible UI label renames cannot ship in this run because:

- **#181 Batch 22 §3 of split-brain run** explicitly states: any rename of "Scheduler" → "Team Member" / "PCS" / "ACS" in UI strings is "an Ali-approved standalone PR series so operators can be notified."
- **#164 Batch 5 UI wiring audit §9** requires Ali approval for "any UI-string label change touching 'Scheduler' / 'Outreach'."
- **#180 Batch 21 source wiring readiness §9** requires Ali approval for "changing any UI string visible to operators."

The Engagement completion run's user instructions for Batch 19 explicitly say: "If unsafe: Create blocker doc and STOP."

The change is **architecturally simple** (find/replace + visual QA) but **operationally risky** without:
- Coordination with the support / training team so operators are notified BEFORE seeing the new vocabulary.
- A communication window for operators to adjust.
- A rollback path that does NOT require an emergency revert.

## 2. Specific blockers

### B1 — Operator notification window not available in this run

The engagement-board, Patient Card, and Plexus IQ patient surfaces collectively render the literal string "Scheduler" today. An untracked change to "Team Member" would surprise operators mid-shift. Without a coordinated comms window, support tickets are likely.

### B2 — String coverage incomplete

A grep for `"Scheduler` / `"Outreach` in `client/src` returns 10+ files. Each file likely has multiple occurrences. A full sweep requires:
- Per-file string audit (per occurrence — is it referring to the legacy DB-pinned identifier or the operator-facing label?).
- Triage of mixed occurrences (e.g. labels for `outreach_schedulers` roster table — should the table label stay because the table name stays?).

### B3 — Test surface coverage

The repo's existing UI snapshot tests (if any) capture the current strings. A label sweep would require updating those tests too — out of scope for this run.

### B4 — Plexus IQ surface coupling

Several Plexus IQ component files reference "Scheduler" / "Outreach" in patient-context labels. Per Plexus IQ hard-stop, those files must not be modified without explicit Plexus IQ approval — even for label changes.

### B5 — Rollback path

A label sweep is not flag-gated by default (strings are literal JSX). Reverting would require a code revert. Risk-tolerant rollback requires either:
- A flag-gated label resolver (out of scope — major UI refactor).
- A dedicated revert-ready commit that is easy to find and roll back.

## 3. Proposed unblock path (out of scope for this run)

A future Ali-approved PR series:

1. Audit pass per file — list every operator-visible "Scheduler" / "Outreach" / "Disposition" / "callback time" occurrence.
2. Triage legacy-DB-pinned occurrences vs operator-facing labels.
3. Build label-resolver helpers (centralized, testable).
4. Coordinate operator comms window with support/training.
5. Ship the sweep behind a feature flag if possible (or as an atomic PR if not).
6. Smoke test + operator feedback window.
7. Remove the flag (if used) after stabilization.

## 4. What this batch actually delivers

- This blockers doc.
- `scripts/qa-engagement-ui-terminology-implementation-blockers.mjs` asserting:
  - The doc exists with each blocker B1-B5 explanation present.
  - No client/src file has been edited by Batch 19 (the legacy strings are still present).
  - No Plexus IQ file has been edited.

## 5. Plexus IQ

Untouched.

## 6. Hard-stops respected

- No client/src file edited.
- No label rename.
- No directory rename.
- No flag added.
- No Plexus IQ runtime touched.
- No API change.

End of blockers.
