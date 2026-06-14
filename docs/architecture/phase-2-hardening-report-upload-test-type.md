# Phase 2 hardening — Report upload test type (item 3)

## Goal

Remove the hardcoded `serviceType = "general"` fallback from
`ReportUploadPanel`. Threads the real test type through from the
canonical canvas sources or shows an honest disabled state.

## Resolution order in `PatientCommandCanvas`

`resolveActiveTestType(data)`:

1. First `documentReadiness` row with a non-empty `serviceType`.
2. First entry in `clinicalProfile.qualifyingTests`.
3. `null` — let the panel render the honest disabled state.

## Panel behavior

`client/src/components/portal/ReportUploadPanel.tsx`:

- Prop type changed from `serviceType: string` to
  `serviceType: string | null`.
- When `serviceType === null`: renders a separate disabled card
  (`data-testid="report-upload-panel-disabled"`) with the message
  "Select or attach a test type before uploading a report. No
  active test was found from document readiness rows or qualifying
  tests for this patient."
- When non-null: renders an active card with an
  "Active test type: …" label and the upload button.
- Mutation throws if `!serviceType` so a future regression where
  the panel renders with null but the button is somehow enabled
  fails loudly instead of silently uploading as "general".

## No silent default

Previously the panel passed `serviceType: "general"` to both
`/api/portal/uploads` and `/api/case-document-readiness/complete`.
After hardening item 3, the only way `general` reaches those
writers is if the resolved canonical source actually says
`general`. The honest pending state surfaces the gap to the
operator.
