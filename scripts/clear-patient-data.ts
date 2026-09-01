#!/usr/bin/env tsx
/**
 * Clear all patient data from the Plexus Command Center database.
 * 
 * WARNING: This is a DESTRUCTIVE operation that will permanently delete
 * all patient records, appointments, invoices, and related data.
 * 
 * Usage:
 *   npm run clear-patients        # Runs against DATABASE_URL from .env
 *   npm run clear-patients --prod # Connects to production (requires confirmation)
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const rl = readline.createInterface({ input, output });

async function confirm(message: string): Promise<boolean> {
  const answer = await rl.question(`${message} (type 'DELETE' to confirm): `);
  return answer.trim() === "DELETE";
}

async function clearPatientData() {
  const isProd = process.argv.includes("--prod");
  
  // Get database URL
  let databaseUrl = process.env.DATABASE_URL;
  
  if (isProd) {
    console.log("\n🚨 PRODUCTION MODE DETECTED 🚨\n");
    
    // For production, get credentials from AWS Secrets Manager or environment
    if (!databaseUrl) {
      console.error("❌ DATABASE_URL not set. Set it or configure AWS Secrets Manager.");
      process.exit(1);
    }
  } else {
    console.log("\n📍 Running against local/dev database\n");
  }

  if (!databaseUrl) {
    console.error("❌ DATABASE_URL not found in environment");
    process.exit(1);
  }

  // Show which database we're targeting
  const dbHost = new URL(databaseUrl).host;
  console.log(`Target database: ${dbHost}\n`);

  // Require explicit confirmation
  const confirmed = await confirm(
    "⚠️  This will PERMANENTLY DELETE all patient data. Are you absolutely sure?"
  );

  if (!confirmed) {
    console.log("❌ Operation cancelled.");
    rl.close();
    process.exit(0);
  }

  console.log("\n🗑️  Starting patient data deletion...\n");

  // Connect to database
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    // Execute the deletion in a transaction
    await pool.query("BEGIN");
    await pool.query("SET CONSTRAINTS ALL DEFERRED");

    const deletionOrder = [
      // Patient core
      { table: "patient_screenings", description: "Patient screening records" },
      { table: "patient_directory", description: "Patient directory" },
      { table: "patient_test_history", description: "Patient test history" },
      { table: "patient_reference_data", description: "Patient reference data" },
      { table: "patient_notes", description: "Patient notes" },
      
      // Plexus Identity
      { table: "plexus_patient_services", description: "Patient services" },
      { table: "plexus_patient_insurance", description: "Patient insurance" },
      { table: "plexus_patient_contacts", description: "Patient contacts" },
      { table: "plexus_patient_demographics", description: "Patient demographics" },
      { table: "plexus_patient_identifiers", description: "Patient identifiers" },
      { table: "plexus_patients", description: "Plexus patients" },
      
      // Ancillary & Engagement
      { table: "patient_ancillary_cases", description: "Ancillary cases" },
      { table: "admin_review_events", description: "Admin review events" },
      { table: "engagement_list_items", description: "Engagement list items" },
      { table: "engagement_lists", description: "Engagement lists" },
      
      // Execution
      { table: "patient_journey_events", description: "Journey events" },
      { table: "patient_execution_cases", description: "Execution cases" },
      
      // Outreach
      { table: "outreach_activity", description: "Outreach activity" },
      { table: "outreach_batch_patients", description: "Outreach batch patients" },
      { table: "outreach_assignments", description: "Outreach assignments" },
      { table: "outreach_patients", description: "Outreach patients" },
      { table: "outreach_lists", description: "Outreach lists" },
      { table: "outreach_batches", description: "Outreach batches" },
      
      // Call management
      { table: "call_handoffs", description: "Call handoffs" },
      { table: "needs_coverage_records", description: "Needs coverage records" },
      
      // Scheduling
      { table: "canonical_appointment_reconciliation_failures", description: "Appointment failures" },
      { table: "global_schedule_events", description: "Schedule events" },
      { table: "scheduling_triage_queue", description: "Scheduling triage" },
      { table: "insurance_eligibility_reviews", description: "Insurance reviews" },
      { table: "cooldown_records", description: "Cooldown records" },
      
      // Clinical data
      { table: "plexus_clinical_findings", description: "Clinical findings" },
      { table: "patient_providers", description: "Patient providers" },
      { table: "patient_allergies", description: "Patient allergies" },
      { table: "patient_lab_results", description: "Lab results" },
      { table: "patient_imaging_studies", description: "Imaging studies" },
      { table: "patient_vital_signs", description: "Vital signs" },
      { table: "patient_encounters", description: "Patient encounters" },
      
      // Documents
      { table: "ancillary_document_references", description: "Document references" },
      { table: "case_documents", description: "Case documents" },
      { table: "signed_documents", description: "Signed documents" },
      { table: "case_document_readiness", description: "Document readiness" },
      { table: "procedure_events", description: "Procedure events" },
      { table: "generated_notes", description: "Generated notes" },
      { table: "note_addenda", description: "Note addenda" },
      
      // Billing
      { table: "billing_readiness", description: "Billing readiness" },
      { table: "billing_documents", description: "Billing documents" },
      { table: "completed_billing_packages", description: "Completed billing packages" },
      { table: "remittance_events", description: "Remittance events" },
      { table: "invoice_denials", description: "Invoice denials" },
      { table: "invoice_adjustments", description: "Invoice adjustments" },
      { table: "invoice_delivery_events", description: "Invoice delivery" },
      { table: "invoice_batch_patients", description: "Invoice batch patients" },
      { table: "invoice_batches", description: "Invoice batches" },
      { table: "invoices", description: "Invoices" },
      { table: "invoice_readiness_checks", description: "Invoice readiness" },
      { table: "projected_invoice_rows", description: "Projected invoices" },
      { table: "canonical_payment_allocations", description: "Payment allocations" },
      { table: "canonical_payments", description: "Canonical payments" },
      { table: "billing_records", description: "Billing records" },
      
      // Analysis
      { table: "analysis_jobs", description: "Analysis jobs" },
      { table: "notes", description: "Notes" },
    ];

    let totalDeleted = 0;

    for (const { table, description } of deletionOrder) {
      try {
        const result = await pool.query(`DELETE FROM ${table}`);
        const count = result.rowCount || 0;
        if (count > 0) {
          console.log(`  ✓ Deleted ${count.toLocaleString()} rows from ${description}`);
          totalDeleted += count;
        }
      } catch (error: any) {
        // Table might not exist in this database version
        if (error.code === "42P01") {
          console.log(`  ⊘ Skipped ${table} (table does not exist)`);
        } else {
          console.error(`  ✗ Error deleting from ${table}:`, error.message);
        }
      }
    }

    // Delete patient-related conversations
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
      console.log(`  ✓ Deleted ${convResult.rowCount} patient conversations`);
      totalDeleted += convResult.rowCount;
    }

    // Delete patient-related CI evidence
    const ciResult = await pool.query(`
      DELETE FROM ci_evidence_records WHERE patient_id IS NOT NULL
    `);
    
    if (ciResult.rowCount && ciResult.rowCount > 0) {
      console.log(`  ✓ Deleted ${ciResult.rowCount} CI evidence records`);
      totalDeleted += ciResult.rowCount;
    }

    await pool.query("COMMIT");

    console.log(`\n✅ Successfully deleted ${totalDeleted.toLocaleString()} total records\n`);

    // Verify deletion
    const verification = await pool.query(`
      SELECT 'patient_screenings' as table_name, COUNT(*) as remaining FROM patient_screenings
      UNION ALL
      SELECT 'patient_directory', COUNT(*) FROM patient_directory
      UNION ALL
      SELECT 'plexus_patients', COUNT(*) FROM plexus_patients
      UNION ALL
      SELECT 'patient_execution_cases', COUNT(*) FROM patient_execution_cases
      UNION ALL
      SELECT 'global_schedule_events', COUNT(*) FROM global_schedule_events
      UNION ALL
      SELECT 'invoices', COUNT(*) FROM invoices
    `);

    console.log("📊 Verification (remaining records):");
    verification.rows.forEach((row) => {
      const status = parseInt(row.remaining) === 0 ? "✓" : "⚠️";
      console.log(`  ${status} ${row.table_name}: ${row.remaining}`);
    });

    console.log("\n🎉 Patient data cleared successfully!\n");
  } catch (error: any) {
    console.error("\n❌ Error during deletion:", error.message);
    console.log("\n🔄 Rolling back changes...");
    await pool.query("ROLLBACK");
    console.log("✓ Rollback complete. No data was deleted.\n");
    process.exit(1);
  } finally {
    await pool.end();
    rl.close();
  }
}

// Run the script
clearPatientData().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
