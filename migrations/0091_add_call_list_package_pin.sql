-- Engagement Call List — OPTIONAL per-package share PIN (production hardening).
--
-- Adds an OPTIONAL second factor to the public tokenized share surface. When a
-- package has a PIN set, the token alone resolves only non-PHI metadata; the
-- frozen PHI snapshot + PDF remain inaccessible until the PIN is validated.
-- PINs are OPTIONAL and OFF by default (both columns null) — a package with no
-- PIN behaves exactly as the current secure-token flow.
--
-- SECURITY: only a bcrypt hash of the PIN is stored (share_pin_hash). The
-- plaintext PIN is never persisted and never logged. PIN validation attempts
-- are rate-limited (callListShareRateLimit). Additive + idempotent; NOT applied
-- automatically (gated by FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES like 0088).

ALTER TABLE call_list_packages
  ADD COLUMN IF NOT EXISTS share_pin_hash   text;

ALTER TABLE call_list_packages
  ADD COLUMN IF NOT EXISTS share_pin_set_at timestamp;
