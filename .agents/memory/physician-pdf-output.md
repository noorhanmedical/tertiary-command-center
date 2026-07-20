---
name: Physician-facing PDF output rules
description: No Run language, PS- patient IDs, browser-artifact suppression, and injected layout fixups for clinician/Plexus PDFs
---
- Batch names in the DB may carry "(Run N)" suffixes; physician-facing PDFs must strip them display-side only via `stripRunLanguage` + `buildPhysicianReportTitles` in `client/src/lib/pdfGeneration.ts`. Canonical titles: "Clinician Report — <Facility> — <long date>", filenames use the ISO date; Plexus uses the "Plexus Report" prefix (internal Plexus IQ run selectors keep run labels).
- **Why:** clinicians saw internal processing metadata ("Run 2", about:blank footers) on distributed reports.
- Browser print header/footer artifacts (about:blank URL, timestamp, page numbers) render only in the @page margin band — set `@page { margin: 0 }` and restore the 0.5in as `.page` print padding to suppress them entirely.
- Print-preview popups can't import modules: shared DOM post-processing (`applyPacketLayoutFixups` — clinician one-page-per-patient zoom shrink, Plexus repeat headers at controlled breaks) is injected via `fn.toString()`, so it must stay fully self-contained (no outer-scope refs, no TS-emitted helpers). Measure with getBoundingClientRect (zoom-aware), not scrollHeight.
- Patient identifier is "Patient ID: PS-<patientScreeningId>". patient_screenings has NO mrn column, but REAL clinic MRNs exist: the BatchFlow clinical import stores them as an "MRN: <value>" line inside the notes field. PDFs show "MRN: <value>" only when extractRealMrn finds one there; never label the screening ID as MRN, never render "MRN: N/A".
