# Ancillary Patient Screening System

## Overview
AI-powered patient screening application that analyzes clinical data (schedules, past medical history, medications, notes) to qualify patients for diagnostic tests including BrainWave (EEG), VitalWave (ABI), Carotid Ultrasound, Echocardiogram, Renal Artery Ultrasound, AAA Ultrasound, Thyroid Ultrasound, and Venous/Arterial Duplex studies. The system uses OpenAI GPT-5.2 for aggressive qualification - it qualifies patients for every test with any reasonable clinical justification.

## Recent Changes
- 2026-02-17: Initial MVP built with full screening pipeline

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI
- **Backend**: Express.js with file parsing (xlsx, csv-parse) and OpenAI integration
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI GPT-5.2 via Replit AI Integrations (no API key needed)
- **File Parsing**: xlsx for Excel, csv-parse for CSV, raw text for .txt files

## Key Files
- `shared/schema.ts` - Data models (screeningBatches, patientScreenings)
- `server/routes.ts` - API routes with file upload, AI screening, export
- `server/storage.ts` - Database CRUD operations
- `client/src/pages/home.tsx` - Main UI with upload, results, history tabs

## User Preferences
- Aggressive qualification: qualify for everything unless glaringly inappropriate
- Support all input formats: Excel, CSV, text files, free text paste
- Output format: TIME, NAME, AGE, GENDER, Dx, Hx, Rx, QUALIFYING TESTS
