-- 0078 — Seed the PROCEDURE-ELIGIBILITY signed-Order-Note prerequisite.
--
-- WHY
-- ----
-- The signed Order Note is the clinician authorization that makes a procedure
-- eligible to be performed — a CLINICAL/procedure gate that is SEPARATE from
-- (and earlier than) the billing-readiness signature verification seeded in
-- migration 0077.
--
-- Two independent enforcement points, both keyed on the SAME requirement code
-- but at DIFFERENT lifecycle stages:
--
--   0077  blocks_stage = 'billing_readiness'   → billing independently
--         re-verifies the signed Order Note before a Billing Document.
--   0078  blocks_stage = 'procedure_start'      → the procedure is not eligible
--         to start until the exact current Order Note is signed.
--
-- The procedure-note generator is the fail-closed backstop regardless of these
-- config rows (it will not generate a Procedure Note without the exact current
-- signed Order Note for any service whose config declares
-- signedOrderNoteForProcedure=true). This migration wires the EARLIER
-- procedure-eligibility gate so an unsigned order also blocks procedure start
-- (evaluateProcedurePrerequisites, stage='procedure_start').
--
-- procedurePrerequisites resolves requirement_code='order_note_signature'
-- semantically (applySemanticPrerequisites → currentOrderNoteSigned): the
-- requirement is satisfied ONLY by a current, non-superseded, same-clinic
-- SIGNED Order Note; otherwise it stays a hard procedure blocker.
--
-- This migration is ADDITIVE and does NOT touch migration 0077's rows
-- (a different blocks_stage → a disjoint partial-unique key).
--
-- SAFETY: idempotent (ON CONFLICT DO NOTHING on the platform-default
-- partial-unique index uq_aspc_default), non-destructive, single transaction.
-- 'procedure_start' is already an allowed blocks_stage (0054 CHECK), so no
-- constraint change is needed.

BEGIN;

INSERT INTO ancillary_service_prerequisite_config
  (clinic_id, service_type, requirement_code, blocker_category, blocks_stage,
   required, override_allowed, override_audit_required, active)
SELECT NULL, s, 'order_note_signature', 'hard_procedure_blocker', 'procedure_start',
       TRUE, FALSE, TRUE, TRUE
-- All canonical ordered ancillary services (ancillary_service_registry
-- internal_code). Every one requires a signed Order Note before the procedure
-- is eligible, so the procedure-eligibility gate covers the full catalog — not
-- only the seven headline services.
FROM (VALUES
  ('BrainWave'),
  ('VitalWave'),
  ('Bilateral Carotid Duplex'),
  ('Echocardiogram TTE'),
  ('Renal Artery Doppler'),
  ('Lower Extremity Arterial Doppler'),
  ('Upper Extremity Arterial Doppler'),
  ('Lower Extremity Venous Duplex'),
  ('Upper Extremity Venous Duplex'),
  ('Stress Echocardiogram'),
  ('Abdominal Aortic Aneurysm Duplex')
) AS v(s)
ON CONFLICT (service_type, requirement_code, blocks_stage)
  WHERE clinic_id IS NULL
  DO NOTHING;

COMMIT;
