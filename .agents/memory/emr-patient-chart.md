---
name: EMR patient chart architecture
description: How the /patient-directory full-page EMR chart is structured and where to extend it
---

The Patient Directory profile (right area of `client/src/pages/patient-database.tsx`,
deep-linked via `?patientId=`) renders a full-page EMR chart, NOT tabs.

Key pieces (all under `client/src/components/patient-directory/`):
- `PatientChart.tsx` — sticky header + left-rail section nav (xl+) / horizontal pill
  nav (mobile). Active section via manual scroll-position scan on the scroll
  container (not IntersectionObserver), with a `manualScrollUntil` guard so a click's
  smooth-scroll doesn't fight the spy.
- `PatientChartSections.tsx` — shared primitives (SectionCard, EmptyState, KV, Table,
  local `Pill`) + 20 section components + the `CHART_SECTIONS` registry
  (`{id,label,icon,Component}`). To add/reorder a section, edit this registry; the nav
  is generated from it. NOTE: lucide's `Pill` icon is imported `as PillIcon` to avoid
  colliding with the local `Pill` pill-badge component.
- `emrModel.ts` — `buildEmrChart(inputs)` projects raw API rows into an `EmrChart`
  (data-only; no JSX). Section components read only from `chart`.
- `types/emr.ts` — `EmrChart` shape + `deriveCooldownState`/`deriveAdAutomation` +
  COOLDOWN_STATE_LABELS/TONES.

Data fetching lives in `PatientProfileWorkspace.tsx`. Every secondary endpoint
(execution case, cooldown records, insurance reviews, appointments, calls, documents,
billing, screening detail) uses `fetchJsonOrEmpty` which degrades to []/null on 404 —
several of these legitimately 404 when there's no data, so never let them throw.

**Why:** sections must show clean API-ready empty states for unconnected data (labs,
imaging, vitals, RingCentral calls, ad campaigns) rather than erroring.
