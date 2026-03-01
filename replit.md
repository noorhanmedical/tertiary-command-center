# Ancillary Patient Screening System

## Overview
AI-powered patient screening application that analyzes clinical data (schedules, past medical history, medications, notes) to qualify patients for diagnostic tests: BrainWave (EEG), VitalWave (ABI), Bilateral Carotid Duplex (93880), Echocardiogram TTE (93306), Renal Artery Doppler (93975), Lower Extremity Arterial Doppler (93925), Upper Extremity Arterial Doppler (93930), Abdominal Aortic Aneurysm Duplex (93978), Stress Echocardiogram (93350), Lower Extremity Venous Duplex (93971), and Upper Extremity Venous Duplex (93970). The system uses OpenAI GPT-5.2 for aggressive qualification - it qualifies patients for every test with any reasonable clinical justification.

## Recent Changes
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
- **Home page**: Clean centered layout with "New Schedule" button; sidebar trigger to view schedule history
- **Sidebar**: Collapsible left panel (Shadcn Sidebar) showing schedule history; starts collapsed, user can expand/retract
- **Build Schedule page**: Step timeline at top, input cards (Upload/Paste/Manual), Schedule Generator list below
- **Final Schedule page**: Step timeline at top, expandable patient result cards with ancillary details

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI (including Sidebar component)
- **Backend**: Express.js with file parsing (xlsx, csv-parse) and OpenAI integration
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI GPT-5.2 via Replit AI Integrations (no API key needed)
- **File Parsing**: xlsx for Excel, csv-parse for CSV, line-by-line for .txt files
- **Validation**: Zod schemas on all API routes

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

## Key Files
- `shared/schema.ts` - Data models (screeningBatches, patientScreenings, patientTestHistory, testReasoningSchema)
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
