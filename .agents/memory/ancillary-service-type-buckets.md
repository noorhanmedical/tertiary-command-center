---
name: Ancillary service-type buckets vs canonical values
description: Why funnel-by-service metrics must bucket service_type, and what canonical values actually look like
---

# Ancillary service-type values are full test names, not Plexus buckets

`patient_execution_cases.selected_services[]` and most per-stage tables
(`procedure_events.service_type`, `case_document_readiness.service_type`,
`billing_readiness_checks.service_type`) store the **full ancillary test name**,
e.g. `"Echocardiogram TTE (93306)"`, `"Lower Extremity Venous Duplex (93971)"`,
`"Renal Artery Doppler"`. Only `"BrainWave"` / `"VitalWave"` (and rarely
`"Ultrasound"` / `"PGx"`) match the marketing "Plexus service" labels.

**Why this matters:** any "metrics by service type" / funnel surface that groups
on the raw `service_type` produces dozens of single-test rows. To present the
four canonical Plexus buckets (BrainWave, VitalWave, Ultrasound, PGx) plus an
"other" catch-all, you must bucket: keep the value if it's one of the four,
otherwise fold into `other`. The physician portal's `ancillary-metrics` endpoint
does exactly this.

**Also:** `cash_price_settings` typically has **no rows** for the Plexus bucket
names, so any gross-revenue estimate keyed on those names degrades to $0 unit
price — handle the empty price map gracefully rather than assuming a price exists.
