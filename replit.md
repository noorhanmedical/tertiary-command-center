# Ancillary Patient Screening System

## Overview
AI-powered patient screening application that analyzes clinical data (schedules, past medical history, medications, notes) to qualify patients for diagnostic tests including BrainWave (EEG), VitalWave (ABI), Carotid Ultrasound, Echocardiogram, Renal Artery Ultrasound, AAA Ultrasound, Thyroid Ultrasound, and Venous/Arterial Duplex studies. The system uses OpenAI GPT-5.2 for aggressive qualification - it qualifies patients for every test with any reasonable clinical justification.

## Recent Changes
- 2026-02-17: Reworked to 3-step draft workflow: (1) Build schedule by adding patients, (2) Edit Dx/Hx/Rx per patient, (3) Analyze for ancillaries
- 2026-02-17: iOS-style redesign with colored ancillary cards and split reasoning (Clinician Understanding + Patient Talking Points)
- 2026-02-17: Initial MVP built with full screening pipeline

## Workflow
1. **Create Batch** - Start a new batch from the Schedule tab
2. **Add Patients** - Add patients via manual entry (name + time), paste a list, or upload a file (.xlsx, .csv, .txt)
3. **Edit Clinical Data** - Click on any patient row to add their Dx (diagnoses), Hx (history/PMH), Rx (medications), age, gender
4. **Analyze** - Click "Analyze for Ancillaries" to run AI screening on the whole batch
5. **Review Results** - Expand patient rows to see color-coded ancillary cards with Clinician Understanding and Patient Talking Points

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI
- **Backend**: Express.js with file parsing (xlsx, csv-parse) and OpenAI integration
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI GPT-5.2 via Replit AI Integrations (no API key needed)
- **File Parsing**: xlsx for Excel, csv-parse for CSV, line-by-line for .txt files
- **Validation**: Zod schemas on all API routes

## API Routes
- `POST /api/batches` - Create a new draft batch
- `POST /api/batches/:id/patients` - Add a patient to a batch
- `POST /api/batches/:id/import-file` - Import patients from uploaded file(s)
- `POST /api/batches/:id/import-text` - Import patients from pasted text
- `PATCH /api/patients/:id` - Update patient clinical data (Dx, Hx, Rx, etc.)
- `DELETE /api/patients/:id` - Remove a patient
- `POST /api/batches/:id/analyze` - Run AI screening on batch
- `GET /api/screening-batches` - List all batches
- `GET /api/screening-batches/:id` - Get batch with patients
- `DELETE /api/screening-batches/:id` - Delete a batch
- `GET /api/screening-batches/:id/export` - Export results as CSV

## Key Files
- `shared/schema.ts` - Data models (screeningBatches, patientScreenings, testReasoningSchema)
- `server/routes.ts` - API routes with file upload, Zod validation, AI screening, export
- `server/storage.ts` - Database CRUD operations
- `client/src/pages/home.tsx` - Main UI with schedule builder, patient editing, results view

## User Preferences
- Aggressive qualification: qualify for everything unless glaringly inappropriate
- Support all input formats: Excel, CSV, text files, free text paste
- 3-step workflow: add patients -> add clinical data -> generate
- Output format: TIME, NAME, AGE, GENDER, Dx, Hx, Rx, QUALIFYING TESTS
- Color-coded ancillary cards: BrainWave=purple, VitalWave=red, Ultrasounds=green, FibroScan=yellow
- Split reasoning: Clinician Understanding + Patient Talking Points
