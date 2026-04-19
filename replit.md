# Ancillary Patient Screening System

## Overview
This project is an AI-powered patient screening application designed to analyze clinical data (schedules, past medical history, medications, notes) to qualify patients for diagnostic tests. It aims to aggressively qualify patients for a predefined set of tests based on any reasonable clinical justification provided by an advanced AI model (OpenAI GPT-5.2). The system automates the screening process, generates clinical notes, and integrates with Google Workspace for data synchronization and document management, streamlining medical practice workflows and improving patient care efficiency.

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
- 8 AI-qualifying tests: BrainWave, VitalWave, Bilateral Carotid Duplex (93880), Echocardiogram TTE (93306), Renal Artery Doppler (93975), Lower Extremity Arterial Doppler (93925), Abdominal Aortic Aneurysm Duplex (93978), Lower Extremity Venous Duplex (93971)
- 3 manual-only tests (not AI-qualified): Stress Echocardiogram (93350), Upper Extremity Arterial Doppler (93930), Upper Extremity Venous Duplex (93970)
- No FibroScan, no Thyroid US
- All ultrasounds grouped under one card in expanded view
- Split reasoning: Clinician Understanding + Patient Talking Points (prominent headers)
- Manual Entry: "Add Patient" button + "Paste Info" collapsible box per patient card — paste any raw text (EHR note, demographics, insurance card) and AI (GPT-4o-mini) extracts name, DOB, phone, insurance, Dx, Hx, Rx, previous tests into the card fields
- Previous Tests field: required (red asterisk), paired with "Most Recent Date" input in the same section; "No previous tests" checkbox bypasses the requirement; `noPreviousTests` boolean persisted to DB

## System Architecture
The application features a React + Vite + Tailwind CSS + Shadcn UI frontend, providing an iOS-style card layout and a modern user experience with a clean, icy blue-white theme. The backend is built with Express.js, handling file parsing, OpenAI integration, and API routing. PostgreSQL, managed with Drizzle ORM, serves as the database, utilizing explicit indexes for optimized performance. The system employs a 3-step draft workflow: build schedule, edit clinical data, and analyze for ancillaries. Core features include tab-based navigation for schedules, a collapsible sidebar for schedule history, and an expandable patient result card view. A service layer encapsulates AI client interactions, data ingestion, and screening logic. Operational robustness is ensured through health checks, graceful shutdown mechanisms, and schema management via Drizzle migrations. Documents are generated client-side and can be exported.

### Frontend Component Structure (Task #144)
The originally monolithic `client/src/pages/home.tsx` (3,492 lines) has been split into focused components in `client/src/components/`:
- **PatientCard.tsx**: Patient card with form fields, clinical data entry, paste-to-fill, scheduling button
- **ClinicalDataEditor.tsx**: Dx/Hx/Rx/Previous Tests section with structured text editors
- **BatchHeader.tsx**: Schedule header bar with facility, date, clinician, and action buttons
- **AppointmentModal.tsx**: Calendar-based appointment booking modal
- **NotesPanelDrawer.tsx**: Completed-tests dialog for marking patients complete and generating ancillary docs
- **StepTimeline.tsx**: Three-step progress indicator (Add Patients → Clinical Data → Analyze)
- **ScheduleTile.tsx**: Schedule history tile component
- **PatientDirectoryView.tsx**: Full patient directory view with search and archive
- **ResultsView.tsx**: Results/analyze view with PDF export and status management
- **HomeSidebar.tsx**: Collapsible sidebar with navigation and schedule history
- **HomeDashboard.tsx**: Home tiles dashboard (New Schedule, Ancillary Docs, Document Upload, etc.)
- `home.tsx` is now 570 lines (down from 3,492) handling only tab state, shared state, and orchestration

### Ancillary Appointment Scheduling (Task #104)
A connected scheduling system with a single `ancillary_appointments` DB table shared across three surfaces:
1. **Home page tile** (`/`): "Upcoming Appointments" card showing next N appointments with click-through to `/appointments`
2. **`/appointments` page**: Three clinic tabs (Taylor Family Practice, NWPG - Spring, NWPG - Veterans), each with a monthly calendar (booking-dot indicators) and a side-by-side BrainWave (1hr) / VitalWave (30min) slot grid. Click a slot to book, click X to cancel.
3. **Patient card calendar icon**: A calendar button in every patient card's action bar opens a scheduling modal (pick test type, pick date, pick slot, confirm booking). Post-booking badge shows on card.
- DB table: `ancillary_appointments` (id, patientScreeningId nullable FK, patientName, facility, scheduledDate YYYY-MM-DD, scheduledTime HH:MM 24h, testType, status scheduled|cancelled, createdAt)
- API: `GET /api/appointments`, `POST /api/appointments`, `PATCH /api/appointments/:id`, `GET /api/appointments/patient/:patientId`
- Duplicate-slot check on create (409 if same facility+date+time+testType already scheduled)

### Outreach Page
A daily call-list workflow for clinic coverage teams, reading directly from the canonical schedule (no duplicate data):
- **`/outreach` page**: Five metric cards (Clinic Coverage, Calls Worked, Scheduled, Pending, Avg Conversion) + a left-panel of clinic coverage cards grouped by facility + a right-panel call list with search.
- **Server service** (`server/services/outreachService.ts`): `buildOutreachDashboard(storage, today)` — aggregates today's batches via `getAllScreeningBatches` + `getPatientScreeningsByBatch`, groups by `facility`, returns typed `OutreachDashboard`.
- **API**: `GET /api/outreach/dashboard` — returns `{ today, metrics, coverageCards }`. No new DB table; reads existing `screeningBatches` + `patientScreenings`.
- **Home tile** + **sidebar link** both wired up at `/outreach`.

## External Dependencies
- **OpenAI GPT-5.2**: Used for AI-powered patient qualification and clinical note generation.
- **Google Workspace (Google Sheets, Google Drive)**: Integrated for synchronizing patient and billing data, and for exporting generated clinical notes as Google Docs.
- **xlsx**: For parsing Excel files during patient data import.
- **csv-parse**: For parsing CSV files during patient data import.
- **pdf-parse**: For extracting patient names from uploaded PDF documents.
- **Zod**: For schema validation on all API routes.
- **Drizzle ORM**: For interacting with the PostgreSQL database.