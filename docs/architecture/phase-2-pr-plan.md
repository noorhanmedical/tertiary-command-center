# Phase 2 — PR-sized chunk plan

| PR | Scope | Status |
|---|---|---|
| 2.0 | Guardrails + audit baseline. Roadmap docs + 4 new guardrail QA scripts. | landed |
| 2.1 | Admin Settings Center page + `/api/admin-settings/effective` API + effective-settings precedence resolver. Runtime reads effective settings. | landed |
| 2.2 | Call operations runtime + settings-driven routing. `applyCallResultRouting` consumes effective settings. View-as identity audit preserved. | landed |
| 2.3 | Follow-up / triage runtime filters in Engagement Center + Team Portal right panel. **No Scheduler Portal product.** | landed |
| 2.4 | Scheduling runtime hardening — cancel / reschedule / no-show / confirm endpoints; conflict service; no local-only events. | landed |
| 2.5 | ACS ancillary workflow runtime. Each status surfaced honestly. No fake completion. | landed |
| 2.6 | Patient notes canonical source + Quick Note tool. | landed |
| 2.7 | Internal contacts canonical directory + tool. | landed |
| 2.8 | Communication-logging timeline. | landed |
| 2.9 | Document workflow expansion. | landed |
| 2.10 | DB-backed live probes (honest skip when DATABASE_URL absent). | landed |

## Sequencing rules

- Each PR commits independently.
- No PR depends on a future PR.
- Every PR ends with `npm run check` and `npm run build` clean.
- Every PR adds at least one QA script and one smoke (or extends an
  existing one).
- No PR touches PR #278.
- No PR creates a "Mission Control" or standalone "Scheduler Portal"
  product surface.

## Forbidden in every Phase 2 PR

- Premium UI redesign.
- New top-level navigation items beyond the existing tools rail +
  workspace tabs.
- Splitting PCS / ACS into separate layouts.
- Hiding work queue functionality from either portal.
- Faking completed states or "scheduled" rows that don't persist
  through the canonical writer.
- Hardcoded behavior where an admin setting should control it.
