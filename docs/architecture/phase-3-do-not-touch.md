# Phase 3 — Do Not Touch

## Off-limits surfaces

| Surface | Reason |
|---|---|
| PR #278 premium UI redesign | Open PR, untouched. |
| Mission Control product | Phase 7. |
| Standalone Scheduler Portal product | Never. |
| RingCentral live phone integration | Dormant. |
| SMS live integration | Dormant. |
| Clearinghouse / EHR / EMR integration | Phase 6. |
| Phase 5 AWS / staging / production wiring | Out of phase. |
| Phase 8 enterprise scale controls | Out of phase. |

## AI autonomy boundary (Phase 3 contract)

The following autonomous behaviors are forbidden:

- AI sending email or marketing material.
- AI sending SMS / text.
- AI scheduling patients.
- AI approving invoices.
- AI marking billing readiness.
- AI marking documentation complete.
- AI changing patient state without human review.
- AI changing engagement status without human review.
- AI executing payment / denial / remittance posts.
- AI executing schedule transitions (cancel / reschedule / no-show / confirm).
- AI executing delivery transitions (queue / send / reminder).
- AI executing approval transitions (approve / void).
- AI calling an external clearinghouse.
- AI calling external EHR/EMR.

Every Phase 3 recommendation is a proposed entry in
`ai_recommendation_logs` with `status = proposed`. An "accept"
transition only records the decision; it does **not** execute the
target action. Humans navigate to the canonical Phase 1/2/4 surface
and perform the action there.

## Honesty contract

- `confidenceLabel` must be one of `not_applicable | low | medium | high`.
  - `not_applicable` is the correct label for deterministic rule
    output.
  - `high` is forbidden for rule output unless the rule is
    deterministically true (e.g. "this invoice has `dueDate` in
    the past AND `status = Sent`" — that is `high`).
- `modelProvider` must be the literal provider that produced the
  recommendation: `rules_engine`, `openai`, `other`, or
  `not_configured`. Do not write `openai` when no model was called.
- `recommendationText` must be human-readable + reproducible from
  `inputSnapshot`.
- `safetyFlags` must be present (may be empty `{}`) so audits can
  attach future constraint metadata.

## Layout boundary (Phase 1/2/4 contract still applies)

- PCS / ACS share `TeamPortalShell`. Layout unchanged.
- Left rail = general tools. Center = patient canvas. Right rail =
  work queue.
- Patient facts in the center canvas, NOT the left rail.
- Global calendar isolated from right queues.

## Anti-patterns guarded by QA

- A POST route under `/api/ai/*` that calls a Phase 1/2/4 writer
  (no "AI executes the action" shortcut).
- A `toast({ title: "AI sent email" })` or similar fake-execution
  signal anywhere in the client.
- A new external SDK import (`twilio`, `ringcentral`, `openai`,
  `claude`, …) added to Phase 3 code without an explicit
  configuration check.
- A hardcoded threshold like `const MISSING_REPORT_HOURS = 24;` in
  detector code — should come from `admin_settings`.
