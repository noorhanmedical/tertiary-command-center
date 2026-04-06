# Ancillary Patient Screening System

## Overview
AI-powered patient screening application that analyzes clinical data (schedules, past medical history, medications, notes) to qualify patients for diagnostic tests: BrainWave (EEG), VitalWave (ABI), Bilateral Carotid Duplex (93880), Echocardiogram TTE (93306), Renal Artery Doppler (93975), Lower Extremity Arterial Doppler (93925), Upper Extremity Arterial Doppler (93930), Abdominal Aortic Aneurysm Duplex (93978), Stress Echocardiogram (93350), Lower Extremity Venous Duplex (93971), and Upper Extremity Venous Duplex (93970). The system uses OpenAI GPT-5.2 for aggressive qualification - it qualifies patients for every test with any reasonable clinical justification.

## Recent Changes
- 2026-04-06: Task #71 - Document Upload page: `uploaded_documents` DB table added; `POST /api/documents/ocr-name` extracts patient name from PDF via pdf-parse + GPT-4o; `POST /api/documents/upload` uploads PDF to correct Drive subfolder (Report or Informed Consent) and saves record to DB; `GET /api/documents/uploaded` lists all uploads; `/document-upload` page with two cards (Upload Report / Upload Informed Consent), OCR auto-fill of patient name; Drive folder tree extended with `informedConsentFolderId`; home tile + sidebar link added; old upload-report dialog removed from Ancillary Documents page (replaced by link to /document-upload)
- 2026-04-06: Task #65 - Google Workspace integration: Google Sheets connector (`server/googleSheets.ts`) and Google Drive connector (`server/googleDrive.ts`) using Replit OAuth connections with direct googleapis calls; `GET /api/google/status` endpoint checks connection status; `POST /api/google/sync/patients` pushes all `patient_reference_data` and `patient_test_history` to a Google Sheet (two tabs, creates sheet if not exists, uses GOOGLE_SHEETS_PATIENTS_ID env var); `POST /api/google/sync/billing` pushes all `billing_records` to a separate Google Sheet (GOOGLE_SHEETS_BILLING_ID); `POST /api/google/drive/export-note` exports a generated note as a Google Doc; `POST /api/google/drive/export-all` bulk-exports all unsynced notes; `generatedNotes` schema extended with `driveFileId` and `driveWebViewLink` columns (migration applied); "Sync to Sheets" button added to Patient Directory and Billing page headers with last-synced timestamps and sheet links; "Save to Drive" / "Drive" link buttons on each note card in Documents page; "Sync All to Drive" bulk button in Documents header; "Save to Drive" button in billing document modal
- 2026-04-06: Task #60 - Architecture hardening: extracted service layer (server/services/aiClient.ts, ingest.ts, screening.ts); routes.ts reduced from 1804→~450 lines; AI calls now have 60s timeout + 3-attempt exponential backoff; failed AI calls set patient status to "error" instead of hanging; 10 DB indexes added (batchId, status, appointmentStatus, patientName, dateOfService); startup DDL removed from server/index.ts; migration 0001_add_indexes.sql created; GET /healthz endpoint returns DB connectivity status; SIGTERM handler drains HTTP then closes DB pool gracefully
- 2026-04-06: Task #53 - Patient Directory: repurposed "Patient References" tile/tab/sidebar as "Patient Directory"; new card-based view grouped by patient showing completed tests, DOS, insurance type, and "Next Eligible" date (PPO +6mo, Medicare +12mo) with green/amber eligibility status; DOB field added to patientTestHistory schema (db:push applied); DOB extracted in AI and CSV history imports; import controls (file/paste) remain in directory view for adding test history; removed Dx/Hx/Rx auto-populate behavior from patient add/import routes
- 2026-04-05: Task #51 - Auto-generate clinical notes on Completed status + Documents page: generatedNotes DB table/storage/routes; ULTRASOUND_CONFIG expanded with Echo TTE, Stress Echo, UE Arterial, UE Venous; autoGeneratePatientNotes() helper maps qualifying tests → plexus generate functions; appointment status change to "Completed" auto-generates and saves notes to DB; inline Clinical Notes section in expanded patient card with Copy + Regenerate buttons; new /documents route (DocumentsPage) with facility→date→patient folder hierarchy; Clinical Notes tile on home + sidebar link
- 2026-04-05: Task #52 - PDF date-of-service uses schedule date not today
- 2026-04-03: Task #50 - Plexus Documents tile + page: new "Plexus Documents" tile on home page navigates to /plexus; multi-step form (Patient Info → Service → Screening → Documents) for generating Pre-Procedure Order, Post-Procedure Note, and Billing Document for VitalWave, Ultrasound, BrainWave, and PGx services; shared/plexus.ts library with configs, generate functions, and clinician-to-clinic resolution; all documents generated client-side with Print and Copy buttons; no backend required
- 2026-04-03: Task #49 - Per-patient appointment status tracking (Completed/No Show/Rescheduled/Scheduled Different Day/Cancelled/Pending dropdown in Results view); patient type label (Outreach/Visit clickable toggle badge); facility assignment per batch (dropdown in New Schedule dialog); Archive page at /archive grouped by facility then date; access code gate 1234 for file upload and paste-list import (manual Add Patient always accessible); three new manual entry fields on PatientCard: DOB, Phone Number, Insurance; Archive nav link in sidebar
- 2026-03-09: Patient Reference Database: upload CSV/Excel or paste clinical data (Dx, Hx, Rx, Age, Gender, Insurance) per patient; auto-fills fields when patients are added to schedules via fuzzy name matching; new "Patient References" tab, tile, and sidebar entry
- 2026-03-09: Cooldown info surfaced in results view with amber warning badges and expandable details
- 2026-03-09: Removed ICD-10 codes from all UI views; shared schedule page redesigned with premium branded layout
- 2026-03-06: Tab-based navigation: multiple schedules open simultaneously as tabs; tab bar below banner with close buttons; Home/Patient History/schedules as tab types; delete buttons on sidebar schedule items; no background image; solid icy blue-white background
- 2026-03-06: Winter theme: CSS variables updated to icy blue-white palette (bg 210 35% 96%, primary 212 72% 40%); deep navy banner bg-[#1a365d]; dark mode deep navy tones; no background image overlay
- 2026-03-06: Bigger text/tiles: banner title text-lg, home tiles p-6 with w-7 icons and text-base titles, patient name text-base, build section headers text-base, results view patient names text-base, Dx/Hx/Rx labels text-sm
- 2026-03-06: Redesigned Final Schedule (results view) with iOS-style card layout; removed table in favor of expandable patient cards; hid COOLDOWN column; grouped ultrasounds into single "Ultrasound Studies (N)" badge; added Share button that copies /schedule/:id link; created read-only shared schedule page at /schedule/:id route; 10% side padding; frosted glass header; rounded-2xl cards
- 2026-03-01: Redesigned home page with tile grid (New Schedule, Patient Database, Billing with NWPG + Taylor Family Practice); added clinic column to patient test history
- 2026-03-01: Added patient test history database with cooldown enforcement (6mo PPO, 12mo Medicare); OpenAI-powered name matching and history import parsing; COOLDOWN column in final schedule; Patient History management UI in sidebar
- 2026-03-01: Integrated richer AI qualification logic: confidence levels (high/medium/low), qualifying factors, ICD-10 codes per test; rewritten prompt with explicit lenient qualification rules; temperature 0.2; frontend displays confidence badges, factor pills, and ICD-10 badges
- 2026-02-18: Renamed all user-facing "batch" references to "schedule"; redesigned home page with collapsible sidebar for schedule history
- 2026-02-17: Reworked to 3-step draft workflow: (1) Build schedule by adding patients, (2) Edit Dx/Hx/Rx per patient, (3) Analyze for ancillaries
- 2026-02-17: iOS-style redesign with colored ancillary cards and split reasoning (Clinician Understanding + Patient Talking Points)
- 2026-02-17: Initial MVP built with full screening pipeline

## Workflow
1. **New Schedule** - Create a new schedule from the clean home page
2. **Add Patients** - Add patients via upload file, paste list, or manual entry (all visible simultaneously)
3. **Edit Clinical Data** - Fill in Dx (diagnoses), Hx (history/PMH), Rx (medications) per patient
4. **Generate** - Click "Generate All" or generate per-patient to run AI screening
5. **Review Results** - View Final Schedule with color-coded ancillary cards (Clinician Understanding + Patient Talking Points)

## UI Structure
- **Tab bar**: Horizontal tab bar below banner; tabs for Home, Patient History, and open schedules; close buttons on tabs; "+" button creates new schedule
- **Home tab**: Clean centered layout with tile grid (New Schedule, Patient Database, Billing); solid icy blue-white background
- **Sidebar**: Collapsible left panel (Shadcn Sidebar) showing schedule history with delete buttons; starts collapsed, user can expand/retract
- **Build Schedule tab**: Step timeline at top, input cards (Upload/Paste/Manual), Schedule Generator list below
- **Final Schedule tab**: Step timeline at top, expandable patient result cards with ancillary details

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI (including Sidebar component)
- **Backend**: Express.js with file parsing (xlsx, csv-parse) and OpenAI integration
- **Database**: PostgreSQL with Drizzle ORM; explicit indexes on batchId, status, appointmentStatus, patient name, and date columns
- **AI**: OpenAI GPT-5.2 via Replit AI Integrations (no API key needed); 60s timeout + 3-attempt exponential-backoff retry wrapper on every call
- **File Parsing**: xlsx for Excel, csv-parse for CSV, line-by-line for .txt files
- **Validation**: Zod schemas on all API routes
- **Service Layer**: `server/services/aiClient.ts` (OpenAI instance + retry helper), `server/services/ingest.ts` (file parsing, AI parse), `server/services/screening.ts` (AI qualification, cooldown, reference enrichment)
- **Operational**: `GET /healthz` → `{status, db}`; SIGTERM drains HTTP connections then closes DB pool; startup DDL removed (schema managed via Drizzle migrations in `migrations/`)

## API Routes
- `POST /api/batches` - Create a new draft schedule
- `POST /api/batches/:id/patients` - Add a patient to a schedule
- `POST /api/batches/:id/import-file` - Import patients from uploaded file(s)
- `POST /api/batches/:id/import-text` - Import patients from pasted text
- `PATCH /api/patients/:id` - Update patient clinical data (Dx, Hx, Rx, etc.)
- `DELETE /api/patients/:id` - Remove a patient
- `POST /api/batches/:id/analyze` - Run AI screening on schedule
- `GET /api/screening-batches` - List all schedules
- `GET /api/screening-batches/:id` - Get schedule with patients
- `DELETE /api/screening-batches/:id` - Delete a schedule
- `GET /api/screening-batches/:id/export` - Export results as CSV
- `GET /api/test-history` - List all test history records
- `POST /api/test-history` - Add a single test history record
- `POST /api/test-history/import` - Import test history from file or pasted text (AI-parsed)
- `DELETE /api/test-history/:id` - Delete a test history record
- `DELETE /api/test-history` - Clear all test history
- `GET /api/patient-references` - List all patient reference records
- `POST /api/patient-references/import` - Import references from file or pasted text (AI-parsed)
- `DELETE /api/patient-references/:id` - Delete a single reference record
- `DELETE /api/patient-references` - Clear all reference data

## Key Files
- `shared/schema.ts` - Data models (screeningBatches, patientScreenings, patientTestHistory, patientReferenceData, testReasoningSchema)
- `server/routes.ts` - API routes with file upload, Zod validation, AI screening, export
- `server/storage.ts` - Database CRUD operations
- `client/src/pages/home.tsx` - Main UI with sidebar, schedule builder, patient editing, results view
- `client/src/App.tsx` - App shell with SidebarProvider wrapping

## User Preferences
- Aggressive qualification: qualify for everything unless glaringly inappropriate
- UI terminology: "schedule" not "batch"
- Schedule history in collapsible sidebar, not on the home page
- Support all input formats: Excel, CSV, text files, free text paste
- Input card order: Upload File, Paste List, Manual Entry
- Patient list section titled "Schedule Generator"
- 3-step workflow: add patients -> add clinical data -> generate
- Output format: TIME, NAME, AGE, GENDER, Dx, Hx, Rx, QUALIFYING TESTS, QUALIFYING IMAGING, COOLDOWN
- Cooldown enforcement: 6 months for PPO, 12 months for Medicare insurance
- Patient test history: importable from files/paste, managed via sidebar "Patient History" section
- Color-coded ancillary cards: BrainWave=purple, VitalWave=red, Ultrasounds=green
- 11 qualifying tests: BrainWave, VitalWave, Bilateral Carotid Duplex (93880), Echocardiogram TTE (93306), Renal Artery Doppler (93975), Lower Extremity Arterial Doppler (93925), Upper Extremity Arterial Doppler (93930), Abdominal Aortic Aneurysm Duplex (93978), Stress Echocardiogram (93350), Lower Extremity Venous Duplex (93971), Upper Extremity Venous Duplex (93970)
- No FibroScan, no Thyroid US
- All ultrasounds grouped under one card in expanded view
- Split reasoning: Clinician Understanding + Patient Talking Points (prominent headers)
- Manual Entry: just "Add Patient" button, name/time editable on patient card
