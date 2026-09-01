-- ============================================================================
-- CLEAR ALL PATIENT DATA FROM PLEXUS COMMAND CENTER
-- ============================================================================
-- WARNING: This will permanently delete ALL patient and clinical data.
-- Only run this in a development/staging environment or with full backup.
-- ============================================================================

BEGIN;

-- Disable foreign key checks temporarily for easier deletion
SET CONSTRAINTS ALL DEFERRED;

-- ============================================================================
-- PATIENT CORE DATA
-- ============================================================================

-- Main patient records (screening system)
DELETE FROM patient_screenings;
DELETE FROM patient_directory;

-- Patient history and reference data
DELETE FROM patient_test_history;
DELETE FROM patient_reference_data;

-- Patient notes
DELETE FROM patient_notes;
DELETE FROM notes;

-- ============================================================================
-- PLEXUS IDENTITY & ANCILLARY CASES (Phase 2)
-- ============================================================================

-- Plexus Identity system (global patient identity)
DELETE FROM plexus_patient_services;
DELETE FROM plexus_patient_insurance;
DELETE FROM plexus_patient_contacts;
DELETE FROM plexus_patient_demographics;
DELETE FROM plexus_patient_identifiers;
DELETE FROM plexus_patients;

-- Ancillary cases
DELETE FROM patient_ancillary_cases;

-- Admin review events
DELETE FROM admin_review_events;

-- Engagement lists
DELETE FROM engagement_list_items;
DELETE FROM engagement_lists;

-- ============================================================================
-- EXECUTION & ENGAGEMENT
-- ============================================================================

-- Patient execution cases and journey
DELETE FROM patient_journey_events;
DELETE FROM patient_execution_cases;

-- Outreach and engagement
DELETE FROM outreach_lists;
DELETE FROM outreach_patients;
DELETE FROM outreach_assignments;
DELETE FROM outreach_activity;
DELETE FROM outreach_batch_patients;
DELETE FROM outreach_batches;

-- Call handoffs
DELETE FROM call_handoffs;

-- Needs coverage
DELETE FROM needs_coverage_records;

-- ============================================================================
-- SCHEDULING & APPOINTMENTS
-- ============================================================================

-- Global schedule events (appointments)
DELETE FROM canonical_appointment_reconciliation_failures;
DELETE FROM global_schedule_events;

-- Scheduling triage
DELETE FROM scheduling_triage_queue;

-- Insurance eligibility
DELETE FROM insurance_eligibility_reviews;

-- Cooldown records
DELETE FROM cooldown_records;

-- ============================================================================
-- CLINICAL DATA & DOCUMENTATION
-- ============================================================================

-- Clinical findings
DELETE FROM plexus_clinical_findings;

-- Clinical data (EHR chart components)
DELETE FROM patient_providers;
DELETE FROM patient_allergies;
DELETE FROM patient_lab_results;
DELETE FROM patient_imaging_studies;
DELETE FROM patient_vital_signs;
DELETE FROM patient_encounters;

-- Documents
DELETE FROM ancillary_document_references;
DELETE FROM case_documents;
DELETE FROM signed_documents;

-- Document readiness
DELETE FROM case_document_readiness;

-- Procedure events
DELETE FROM procedure_events;

-- Generated notes
DELETE FROM generated_notes;

-- Note addenda
DELETE FROM note_addenda;

-- ============================================================================
-- BILLING & INVOICING
-- ============================================================================

-- Billing records
DELETE FROM billing_records;

-- Billing readiness
DELETE FROM billing_readiness;

-- Billing documents
DELETE FROM billing_documents;

-- Completed billing packages
DELETE FROM completed_billing_packages;

-- Invoice-related tables
DELETE FROM remittance_events;
DELETE FROM invoice_denials;
DELETE FROM invoice_adjustments;
DELETE FROM invoice_delivery_events;
DELETE FROM invoice_batch_patients;
DELETE FROM invoice_batches;
DELETE FROM invoices;
DELETE FROM invoice_readiness_checks;

-- Projected invoices
DELETE FROM projected_invoice_rows;

-- Canonical payments & allocations
DELETE FROM canonical_payment_allocations;
DELETE FROM canonical_payments;

-- ============================================================================
-- MESSAGING & NOTIFICATIONS
-- ============================================================================

-- Team messages (only patient-related conversations)
-- Note: This preserves internal team conversations not tied to patients
DELETE FROM team_messages WHERE conversation_id IN (
  SELECT id FROM team_conversations WHERE patient_id IS NOT NULL
);
DELETE FROM team_conversation_members WHERE conversation_id IN (
  SELECT id FROM team_conversations WHERE patient_id IS NOT NULL
);
DELETE FROM team_conversations WHERE patient_id IS NOT NULL;

-- Notifications related to patients
DELETE FROM notifications WHERE reference_id IN (
  SELECT id FROM patient_execution_cases
) AND reference_type = 'case';

-- ============================================================================
-- ANALYSIS & INTELLIGENCE
-- ============================================================================

-- Analysis jobs
DELETE FROM analysis_jobs;

-- Clinical intelligence evidence (patient-related)
DELETE FROM ci_evidence_records WHERE patient_id IS NOT NULL;

-- ============================================================================
-- AUDIT LOG (Optional - preserves audit trail if commented out)
-- ============================================================================

-- Uncomment the line below to also clear audit logs related to patients
-- DELETE FROM audit_log WHERE entity_type IN ('patient', 'screening', 'case', 'appointment', 'invoice');

-- ============================================================================
-- VERIFY & COMMIT
-- ============================================================================

-- Show counts of remaining records (should be 0 for patient tables)
SELECT 'patient_screenings' as table_name, COUNT(*) as remaining FROM patient_screenings
UNION ALL
SELECT 'patient_directory', COUNT(*) FROM patient_directory
UNION ALL
SELECT 'plexus_patients', COUNT(*) FROM plexus_patients
UNION ALL
SELECT 'patient_execution_cases', COUNT(*) FROM patient_execution_cases
UNION ALL
SELECT 'patient_ancillary_cases', COUNT(*) FROM patient_ancillary_cases
UNION ALL
SELECT 'global_schedule_events', COUNT(*) FROM global_schedule_events
UNION ALL
SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL
SELECT 'billing_records', COUNT(*) FROM billing_records;

-- If everything looks good, commit the transaction
COMMIT;

-- If something went wrong, you can ROLLBACK instead:
-- ROLLBACK;
