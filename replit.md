# Ancillary Patient Screening System

## Overview
This project is an AI-powered patient screening application designed to analyze clinical data to qualify patients for diagnostic tests. It aims to aggressively qualify patients for a predefined set of tests based on AI model justifications. The system automates screening, generates clinical notes, and integrates with Google Workspace for data synchronization and document management, streamlining medical practice workflows and improving patient care efficiency. The business vision is to enhance patient care and operational efficiency in medical practices by automating and intelligently streamlining the diagnostic test qualification process.

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
The application features a React, Vite, Tailwind CSS, and Shadcn UI frontend, providing an iOS-style card layout and a modern user experience with a clean, icy blue-white theme. The backend is built with Express.js, handling file parsing, OpenAI integration, and API routing. PostgreSQL, managed with Drizzle ORM, serves as the database, utilizing explicit indexes for optimized performance.

The system employs a 3-step draft workflow: build schedule, edit clinical data, and analyze for ancillaries. Core features include tab-based navigation for schedules, a collapsible sidebar for schedule history, and an expandable patient result card view. A service layer encapsulates AI client interactions, data ingestion, and screening logic. Operational robustness is ensured through health checks, graceful shutdown mechanisms, and schema management via Drizzle migrations. Documents are generated client-side and can be exported.

A pluggable file storage layer (`IFileStorage` interface) supports both Google Drive and AWS S3, allowing for flexible clinical document uploads. The system includes robust analysis job durability with status polling, ensuring long-running analysis processes are resilient to interruptions and provide real-time feedback. Database pool and transaction safety are prioritized for data integrity during bulk operations and critical state changes.

**Plexus Tasks** is the canonical task and project management system built into the platform. It consists of 6 DB tables (`plexus_projects`, `plexus_tasks`, `plexus_task_collaborators`, `plexus_task_messages`, `plexus_task_events`, `plexus_task_reads`), a full CRUD storage layer, RESTful API routes at `/api/plexus/*`, and a `/plexus-tasks` frontend page with My Work / Projects / Sent views plus a persistent Urgent Panel. All state changes produce immutable audit log events. A GlobalNav tile shows the unread task message count as a badge.

**Central Document Library**: Admin-only library at `/document-library` for uploading any file once, tagging it with a `kind` (informed_consent, screening_form, marketing, training, reference, clinician_pdf, report, other), a `signatureRequirement` (none, patient, clinician, both), and a set of `surfaces` it should appear on (`tech_consent_picker`, `scheduler_resources`, `patient_chart`, `liaison_drawer`, `marketing_hub`, `training_library`, `internal_reference`). Uploading a new version "supersedes" the old document — the old row stays for audit/version history but is hidden from current views, and the new version inherits all surface assignments and bumps `version` (locked with `SELECT … FOR UPDATE` to prevent racey duplicate version numbers). Schema lives in two new tables — `documents` and `document_surface_assignments` (unique on documentId+surface). API is at `/api/document-library/*` (POST/DELETE require admin). File bytes reuse the existing `documentBlobs` pipeline with ownerType `library_document`. Frontend is one page (`client/src/pages/document-library.tsx`); GlobalNav exposes the link only to admins. Foundation for the upcoming technician/liaison portal signature flow.

**Smart Scheduler Assignment**: When a schedule (batch) is created, the system automatically assigns it to the scheduler mapped to that clinic in `outreach_schedulers`. For future-dated schedules, assignment is automatic and a `scheduler_assignment` Plexus task is created immediately. For same-day schedules, a blocking modal forces the creator to manually select a scheduler before proceeding. If no scheduler is configured for a clinic, the schedule is saved without assignment and an urgent Plexus task is created. The assigned scheduler's name is displayed in `BatchHeader` alongside a warning badge and "Assign" button if unassigned. The `screening_batches` table has an `assigned_scheduler_id` column (FK to `outreach_schedulers`). New endpoint: `POST /api/batches/:id/assign-scheduler` accepts `{ schedulerId }`. The assignment service lives in `server/services/schedulerAssignmentService.ts`.

Canonical platform navigation is implemented with a persistent `GlobalNav` left-rail, organizing the application into key domains (Schedule, Outreach Center, Ancillary Docs, Billing, Team Ops, Patient Database, Task Brain, Admin). A connected scheduling system allows for managing ancillary appointments across multiple clinic locations, with a shared `ancillary_appointments` database table and integrated booking functionalities. The Outreach Page provides a daily call-list workflow for clinic coverage teams, aggregating data from existing schedules.

Authentication and session management are implemented using per-user login sessions with `express-session` and `connect-pg-simple`, replacing API key-based authentication. Passwords are securely hashed with bcrypt, and an admin-only user management system is in place.

**Role-Based Access Control (RBAC)**: The `users` table includes a `role` column supporting four roles: `admin`, `clinician`, `scheduler`, `biller`. A `requireRole(...roles)` middleware factory enforces access on sensitive server routes (e.g., `DELETE /api/screening-batches/:id` is admin-only; `DELETE /api/billing-records/:id` requires admin or biller). The `GlobalNav` filters navigation items by the logged-in user's role and displays the role label beneath the username. Role is stored in the session and returned by `GET /api/auth/me`. Admins can create users with a specific role via `POST /api/users` and update existing user roles via `PATCH /api/users/:id/role`.

Frontend component structure has been modularized, breaking down a monolithic `home.tsx` into focused, reusable components like `PatientCard.tsx`, `ClinicalDataEditor.tsx`, and `ResultsView.tsx`, improving maintainability and development efficiency.

**Server directory structure** is organized into distinct layers: `server/integrations/` holds external system adapters (Google Drive, Google Sheets, S3, file storage factory); `server/middleware/` holds cross-cutting concerns (error handler, OpenAI concurrency rate limiter — capped at `OPENAI_MAX_CONCURRENT`, default 10); `server/parsers/` holds file-format-specific parsers (`excel.ts`, `csv.ts`, `pdf.ts`, `plainText.ts`, `types.ts`). `server/services/ingest.ts` is the orchestrator/dispatcher — it exports `parseFileBuffer(buffer, filename, mimetype?)` for single-call file dispatch by extension, plus re-exports all individual parser APIs for backward compatibility with existing call sites in routes.

## External Dependencies
- **OpenAI GPT-5.2**: For AI-powered patient qualification and clinical note generation.
- **Google Workspace (Google Sheets, Google Drive)**: For synchronizing patient and billing data, and exporting clinical notes as Google Docs.
- **AWS S3**: Optional cloud storage for clinical documents via a pluggable adapter.
- **xlsx**: For parsing Excel files.
- **csv-parse**: For parsing CSV files.
- **pdf-parse**: For extracting patient names from PDF documents.
- **Zod**: For schema validation on all API routes.
- **Drizzle ORM**: For interacting with the PostgreSQL database.