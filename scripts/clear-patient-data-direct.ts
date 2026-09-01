#!/usr/bin/env tsx
/**
 * DIRECT patient data clear - NO CONFIRMATION PROMPTS
 * Only use this when you've already confirmed the operation
 */

import { Pool } from "pg";

async function clearPatientDataDirect() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("❌ DATABASE_URL not found in environment");
    process.exit(1);
  }

  const dbHost = new URL(databaseUrl).host;
  console.log(`\n🗑️  Clearing patient data from: ${dbHost}\n`);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query("BEGIN");
    await pool.query("SET CONSTRAINTS ALL DEFERRED");

    const deletionOrder = [
      "patient_screenings",
      "patient_test_history",
      "patient_reference_data",
      "patient_notes",
      "plexus_patient_services",
      "plexus_patient_insurance",
      "plexus_patient_contacts",
      "plexus_patient_demographics",
      "plexus_patient_identifiers",
      "plexus_patients",
      "patient_ancillary_cases",
      "admin_review_events",
      "engagement_list_items",
      "engagement_lists",
      "patient_journey_events",
      "patient_execution_cases",
      "outreach_activity",
      "outreach_batch_patients",
      "outreach_assignments",
      "outreach_patients",
      "outreach_lists",
      "outreach_batches",
      "call_handoffs",
      "needs_coverage_records",
      "canonical_appointment_reconciliation_failures",
      "global_schedule_events",
      "scheduling_triage_queue",
      "insurance_eligibility_reviews",
      "cooldown_records",
      "plexus_clinical_findings",
      "patient_providers",
      "patient_allergies",
      "patient_lab_results",
      "patient_imaging_studies",
      "patient_vital_signs",
      "patient_encounters",
      "ancillary_document_references",
      "case_documents",
      "signed_documents",
      "case_document_readiness",
      "procedure_events",
      "generated_notes",
      "note_addenda",
      "billing_readiness",
      "billing_documents",
      "completed_billing_packages",
      "remittance_events",
      "invoice_denials",
      "invoice_adjustments",
      "invoice_delivery_events",
      "invoice_batch_patients",
      "invoice_batches",
      "invoices",
      "invoice_readiness_checks",
      "projected_invoice_rows",
      "canonical_payment_allocations",
      "canonical_payments",
      "billing_records",
      "analysis_jobs",
      "notes",
      "patient_directory",
    ];

    let totalDeleted = 0;

    for (const table of deletionOrder) {
      try {
        const result = await pool.query(`DELETE FROM ${table}`);
        const count = result.rowCount || 0;
        if (count > 0) {
          console.log(`  ✓ ${table}: ${count.toLocaleString()} rows`);
          totalDeleted += count;
        }
      } catch (error: any) {
        if (error.code === "42P01") {
          // Table doesn't exist
        } else {
          console.error(`  ✗ ${table}: ${error.message}`);
        }
      }
    }

    // Patient-related conversations
    await pool.query(`
      DELETE FROM team_messages WHERE conversation_id IN (
        SELECT id FROM team_conversations WHERE patient_id IS NOT NULL
      )
    `);
    await pool.query(`
      DELETE FROM team_conversation_members WHERE conversation_id IN (
        SELECT id FROM team_conversations WHERE patient_id IS NOT NULL
      )
    `);
    const convResult = await pool.query(`
      DELETE FROM team_conversations WHERE patient_id IS NOT NULL
    `);
    if (convResult.rowCount && convResult.rowCount > 0) {
      console.log(`  ✓ team_conversations: ${convResult.rowCount}`);
      totalDeleted += convResult.rowCount;
    }

    // CI evidence
    const ciResult = await pool.query(`
      DELETE FROM ci_evidence_records WHERE patient_id IS NOT NULL
    `);
    if (ciResult.rowCount && ciResult.rowCount > 0) {
      console.log(`  ✓ ci_evidence_records: ${ciResult.rowCount}`);
      totalDeleted += ciResult.rowCount;
    }

    await pool.query("COMMIT");

    console.log(`\n✅ Deleted ${totalDeleted.toLocaleString()} total records\n`);

    // Verification
    const verification = await pool.query(`
      SELECT 'patient_screenings' as t, COUNT(*) as c FROM patient_screenings
      UNION ALL SELECT 'patient_directory', COUNT(*) FROM patient_directory
      UNION ALL SELECT 'plexus_patients', COUNT(*) FROM plexus_patients
      UNION ALL SELECT 'patient_execution_cases', COUNT(*) FROM patient_execution_cases
      UNION ALL SELECT 'global_schedule_events', COUNT(*) FROM global_schedule_events
      UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
    `);

    console.log("📊 Remaining records:");
    verification.rows.forEach((row) => {
      const status = parseInt(row.c) === 0 ? "✓" : "⚠️";
      console.log(`  ${status} ${row.t}: ${row.c}`);
    });

    console.log("\n🎉 Complete!\n");
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    await pool.query("ROLLBACK");
    console.log("🔄 Rolled back\n");
    process.exit(1);
  } finally {
    await pool.end();
  }
}

clearPatientDataDirect();
