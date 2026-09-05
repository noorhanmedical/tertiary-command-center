-- 0077 — Seed canonical ancillary_service_prerequisite_config platform defaults.
--
-- WHY
-- ----
-- ancillary_service_prerequisite_config (migration 0054) shipped with ZERO
-- rows. The canonical billing-readiness evaluator
-- (server/services/billingLifecycle/billingReadinessEvaluator.ts) resolves the
-- Order Note SIGNATURE requirement from this table via
-- resolveOrderNoteSignatureRequirement():
--
--     • a row (requirement_code='order_note_signature', active) with
--       required=TRUE   → signature REQUIRED   (signed Order Note gates billing)
--     • the same row with required=FALSE        → signature NOT required
--     • NO row                                  → "unresolved"  (FAIL CLOSED:
--       never assume a signature is unnecessary) → billing blocker
--       `order_note_signature_unresolved`
--
-- With the table empty every service fails closed to `order_note_signature_
-- unresolved`, so NO case can ever reach billing_document generation. This
-- migration seeds the canonical platform defaults so billing readiness resolves
-- deterministically. Behaviour is CONFIG-DRIVEN, never inferred from the
-- service display name.
--
-- FIELD SEMANTICS (see shared/schema/procedurePrerequisites.ts)
-- ------------------------------------------------------------
--   clinic_id               NULL = platform default (a clinic row overrides it).
--   service_type            Canonical service identity (registry internal_code).
--   requirement_code        The prerequisite this row configures. Seeded here:
--                             • order_note_signature  — a SIGNED Order Note is a
--                               billing-readiness prerequisite.
--   blocker_category        How an unmet requirement is classified. billing_blocker
--                           = blocks Billing Document generation (not the procedure
--                           itself).
--   blocks_stage            Lifecycle stage the requirement gates. The billing
--                           evaluator reads stage='billing_readiness'.
--   required                TRUE = the requirement must be satisfied.
--   override_allowed        Whether an authorized role may override (FALSE here —
--                           a signed order is not overrideable for billing).
--   override_roles          Comma-separated roles allowed to override (none).
--   override_audit_required Whether an applied override must be audited.
--   active                  Soft on/off for the row.
--
-- SAFETY
-- ------
--   • Idempotent: ON CONFLICT DO NOTHING against the partial-unique default
--     index uq_aspc_default; re-running never duplicates or mutates existing
--     configuration (including any clinic-specific overrides).
--   • Non-destructive: inserts platform defaults only; never deletes/updates.
--   • Compatible: the CHECK-constraint refresh below only ADDS 'billing_readiness'
--     to the allowed blocks_stage set (the evaluator already uses it); it never
--     removes an existing allowed value.

BEGIN;

-- The billing-readiness evaluator queries blocks_stage='billing_readiness', a
-- value the original 0054 CHECK omitted. Refresh the CHECK idempotently so a
-- fresh environment (0054 applied verbatim) accepts the seed rows below. This
-- only widens the allowed set; existing rows remain valid.
ALTER TABLE ancillary_service_prerequisite_config
  DROP CONSTRAINT IF EXISTS chk_aspc_blocks_stage;
ALTER TABLE ancillary_service_prerequisite_config
  ADD CONSTRAINT chk_aspc_blocks_stage CHECK (blocks_stage IN (
    'scheduling','check_in','procedure_start','billing','billing_readiness','claim_submission'));

-- Platform-default Order Note signature requirement for every supported service.
-- clinic_id NULL = default; a clinic may later override per uq_aspc_clinic.
INSERT INTO ancillary_service_prerequisite_config
  (clinic_id, service_type, requirement_code, blocker_category, blocks_stage,
   required, override_allowed, override_audit_required, active)
SELECT NULL, s, 'order_note_signature', 'billing_blocker', 'billing_readiness',
       TRUE, FALSE, TRUE, TRUE
FROM (VALUES
  ('BrainWave'),
  ('VitalWave'),
  ('Echocardiogram TTE'),
  ('Bilateral Carotid Duplex'),
  ('Renal Artery Doppler'),
  ('Lower Extremity Arterial Doppler'),
  ('Lower Extremity Venous Duplex')
) AS v(s)
ON CONFLICT (service_type, requirement_code, blocks_stage)
  WHERE clinic_id IS NULL
  DO NOTHING;

COMMIT;
