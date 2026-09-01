# Clear Patient Data

This document describes how to safely clear all patient data from the Plexus Command Center database.

## ⚠️ WARNING

This operation will **PERMANENTLY DELETE** all patient-related data including:
- Patient records and demographics
- Appointments and schedules
- Clinical notes and documents
- Billing records and invoices
- Outreach and engagement history
- All related metadata

**This cannot be undone without a database backup.**

## Methods

### Method 1: Node.js Script (Recommended)

The TypeScript script provides safety checks and detailed logging:

```bash
# For local/dev database
npm run clear-patients

# For production database
npm run clear-patients:prod
```

**Safety features:**
- Requires typing "DELETE" to confirm
- Shows target database before proceeding
- Runs in a transaction (rolls back on error)
- Provides detailed deletion progress
- Verifies deletion completion

### Method 2: Direct SQL

For manual execution or debugging:

```bash
psql $DATABASE_URL -f scripts/clear-patient-data.sql
```

## Production Database Access

To run against production, you need the DATABASE_URL. Options:

### Option A: From RDS Directly

```bash
# Get the connection string from the ECS task definition
aws ecs describe-task-definition \
  --task-definition PlexusCommandCenterTaskDefA496C4F9:19 \
  --profile prod \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`DATABASE_URL`].value' \
  --output text

# Export it
export DATABASE_URL="<connection-string-from-above>"

# Run the script
npm run clear-patients:prod
```

### Option B: Via AWS Session Manager

If direct database access is restricted:

1. Start a session to the ECS task
2. Run the clear script from within the container

## What Gets Deleted

### Core Patient Data
- `patient_directory` - Patient directory entries
- `patient_screenings` - Screening records
- `patient_test_history` - Test history
- `patient_reference_data` - Reference data
- `patient_notes` - Patient notes

### Plexus Identity System
- `plexus_patients` - Global patient records
- `plexus_patient_identifiers` - Patient IDs
- `plexus_patient_demographics` - Demographics
- `plexus_patient_contacts` - Contact info
- `plexus_patient_insurance` - Insurance data
- `plexus_patient_services` - Service records

### Execution & Engagement
- `patient_execution_cases` - Active cases
- `patient_journey_events` - Journey tracking
- `patient_ancillary_cases` - Ancillary cases
- `engagement_lists` - Engagement lists
- `admin_review_events` - Review history

### Scheduling
- `global_schedule_events` - All appointments
- `scheduling_triage_queue` - Triage queue
- `insurance_eligibility_reviews` - Insurance reviews
- `cooldown_records` - Cooldown tracking

### Clinical Data
- `plexus_clinical_findings` - AI findings
- `patient_providers` - Provider associations
- `patient_allergies` - Allergy records
- `patient_lab_results` - Lab results
- `patient_imaging_studies` - Imaging
- `patient_vital_signs` - Vitals
- `patient_encounters` - Encounters

### Documents
- `case_documents` - Case documents
- `signed_documents` - Signed docs
- `generated_notes` - Generated notes
- `case_document_readiness` - Doc readiness
- `procedure_events` - Procedure events

### Billing & Invoicing
- `invoices` - All invoices
- `billing_records` - Billing records
- `canonical_payments` - Payments
- `invoice_batches` - Invoice batches
- `projected_invoice_rows` - Projections
- All related adjustments, denials, remittances

### Outreach
- `outreach_batches` - Outreach batches
- `outreach_patients` - Outreach records
- `outreach_activity` - Activity logs
- `outreach_assignments` - Assignments

## What is Preserved

The following data is **NOT** deleted:

- **Users & Authentication** - All user accounts remain
- **Clinics & Facilities** - Clinic and facility definitions
- **Clinicians** - Clinician records
- **Teams** - Team structure and memberships
- **Templates** - Document templates
- **System Configuration** - Admin settings, app settings
- **Non-patient Conversations** - Internal team chats
- **Audit Logs** - Historical audit trail (optional)

## After Clearing

Once patient data is cleared:

1. The application will be empty but fully functional
2. Users can log in as normal
3. All workflows are ready to accept new patients
4. You can import new patient data via:
   - Plexus AHR (manual patient entry)
   - Plexus IQ (batch import)
   - API integrations
   - Seed scripts

## Recovery

If you need to recover deleted data:

1. Restore from database backup (if available)
2. Or re-import patient data from source systems

**Always create a backup before running this in production!**

```bash
# Create backup first
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql

# Then clear data
npm run clear-patients:prod

# To restore if needed
psql $DATABASE_URL < backup-YYYYMMDD-HHMMSS.sql
```
