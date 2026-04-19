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

Canonical platform navigation is implemented with a persistent `GlobalNav` left-rail, organizing the application into key domains (Schedule, Outreach Center, Ancillary Docs, Billing, Team Ops, Patient Database, Task Brain, Admin). A connected scheduling system allows for managing ancillary appointments across multiple clinic locations, with a shared `ancillary_appointments` database table and integrated booking functionalities. The Outreach Page provides a daily call-list workflow for clinic coverage teams, aggregating data from existing schedules.

Authentication and session management are implemented using per-user login sessions with `express-session` and `connect-pg-simple`, replacing API key-based authentication. Passwords are securely hashed with bcrypt, and an admin-only user management system is in place.

Frontend component structure has been modularized, breaking down a monolithic `home.tsx` into focused, reusable components like `PatientCard.tsx`, `ClinicalDataEditor.tsx`, and `ResultsView.tsx`, improving maintainability and development efficiency.

## External Dependencies
- **OpenAI GPT-5.2**: For AI-powered patient qualification and clinical note generation.
- **Google Workspace (Google Sheets, Google Drive)**: For synchronizing patient and billing data, and exporting clinical notes as Google Docs.
- **AWS S3**: Optional cloud storage for clinical documents via a pluggable adapter.
- **xlsx**: For parsing Excel files.
- **csv-parse**: For parsing CSV files.
- **pdf-parse**: For extracting patient names from PDF documents.
- **Zod**: For schema validation on all API routes.
- **Drizzle ORM**: For interacting with the PostgreSQL database.