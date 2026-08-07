# Post-2K Technical Notes (MINOR / HARDENING)

Non-blocking findings from the Phase 2K fresh-context adversarial review
(0 BLOCKER, 0 MAJOR, 0 MINOR). Recorded per the Phase 2K gate — these are
HARDENING-only observations, not correctness/reliability defects, and do not block
Phase 2K PASS. Reserved for a later pass.

1. **Clinician Portal `docByCase` uses last-write-wins for a duplicate-current billing
   document.** `server/services/clinicianPortal/canonicalOverview.ts` collapses a
   duplicate current `billing_document_requests` row per case via a Map (last write
   wins) for the operational pending/generated counts, rather than the fail-closed
   dedup applied to readiness in K12. This affects only operational document counts
   (not financial truth), and the Phase 2G supersede-on-write invariant prevents a
   duplicate current document in practice. Suggested: mirror the K12 dedup (exclude /
   flag a duplicate-current document) for symmetry and robustness to an upstream
   invariant violation.

2. **PCS display-degradation lacks a per-page operator warning.** `pcsCanonicalView.ts`
   `loadGpps` correctly degrades an ordinary (non-migration) display read failure to an
   empty map (fail-closed: affected memberships are excluded from verified groups, no
   demographic fallback, verified IDs preserved) — but it does not thread a per-page
   `identity_display_degraded` warning through the assemble functions, so an operator
   cannot distinguish "no verified patients" from "the display read failed." Purely an
   operator-visibility improvement; canonical truth is already correct and tested.

Neither changes accepted behavior. See `PHASE_2K_EXECUTION_MATRIX.md` (all
MANDATORY_HARDENING VERIFIED) and `POST_2K_PRODUCT_DECISIONS.md` (deferred semantics).
