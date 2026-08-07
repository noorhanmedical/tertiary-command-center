# Post-2K Technical Notes (MINOR / HARDENING)

Genuine non-blocking findings reserved for a later pass. Mandatory Phase 2K work is NOT
recorded here — it lives in `PHASE_2K_EXECUTION_MATRIX.md` (all 25 MANDATORY rows VERIFIED).

1. **Clinician Portal `docByCase` uses last-write-wins for a duplicate-current billing
   document.** `server/services/clinicianPortal/canonicalOverview.ts` collapses a
   duplicate current `billing_document_requests` row per case via a Map (last write
   wins) for the operational pending/generated counts, rather than the fail-closed
   dedup applied to readiness in K12. This affects only operational document counts
   (not financial truth or identity), and the Phase 2G supersede-on-write invariant
   prevents a duplicate current document in practice. Suggested (HARDENING): mirror the
   K12 dedup (exclude / flag a duplicate-current document) for symmetry and robustness
   to an upstream invariant violation.

Resolved in the closeout (no longer deferred):
- **K18 PCS identity/display separation** — the earlier note that "the K18 implementation
  preserves verified IDs" described the *coupled* pre-fix code and was inaccurate as a
  guarantee. K18 is now a mandatory, tested contract: a REQUIRED identity loader
  (`loadIdentities`) drives verified/unresolved classification and fails closed on an
  ordinary failure; a separate OPTIONAL display loader (`loadDisplays`) degrades to
  `patientDisplay/patientDob = null` with an `identity_display_degraded` warning while
  preserving verified status, IDs, episodes, and `identityAvailable=true`. The
  `identity_display_degraded` warning is part of the mandatory K18 contract, not a
  deferred hardening item.

See `PHASE_2K_EXECUTION_MATRIX.md` (25/25 MANDATORY VERIFIED) and
`POST_2K_PRODUCT_DECISIONS.md` (deferred product/semantic decisions).
