---
name: Plexus IQ running state
description: How to decide whether a screening batch is "qualification running" on /plexus-iq
---

The operating list on `/plexus-iq` shows a per-batch "Running" status (date-tree tone, row spinner, list-bar badge, Generate-button disable). That state must be driven by **live, non-terminal job status**, not by whether the job is still listed in the active-jobs strip.

**Why:** `activeQualificationJobs` (backed by localStorage) keeps a job entry until the user explicitly hides/dismisses it. A completed/failed job therefore lingers in that list. If you derive "running" purely from list membership, batches stay stuck showing "Qualification Running" after qualification has actually finished.

**How to apply:** Poll each job's status (queryKey `["plexus-iq-qualification-job", jobId]`, the same key the status strip uses — React Query dedups by key and auto-stops polling at terminal). Treat `completed | failed | cancelled` as terminal; include a batchId in the running set only while its job is non-terminal (plus the in-session `analyzingBatchId`).
