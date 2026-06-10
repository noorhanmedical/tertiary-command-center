# Patient Directory read-only envelope — readiness

**Status:** Docs-only (Bundle 49). No runtime code. No new endpoint. No DB.
**Date:** 2026-06-10.
**Scope:** Pin the safe envelope a future Team Portal / Playground PR may consume from the Patient Directory module, plus the gates that PR must satisfy. Anchored on the existing dormant module (`server/modules/patient-directory/`, PR #65) and the Bundle 20 shadow-read contract.
**Cross-references:**
- `patient-directory-design.md` (Bundle 5 / PR #65).
- `patient-directory-shadow-read-contract.md` (Bundle 20 / PR #104).
- `team-portal-playground-wiring-contract.md` §12 + §22 (Bundle 11).
- `playground-design-system-implementation-plan.md` Step E (Bundle 32).
- `billing-invoice-hard-stop-map.md` (Bundle 29).
- `do-not-touch.md`, `protected-flows.md`.

This document does NOT ship a route. It pins what the future read-only envelope MAY surface and what it MUST EXCLUDE.

---

## 1. What a future read-only endpoint may expose

A future `GET /api/team-portal/patient/:canonicalId/directory-envelope` (path reserved; not created in this bundle) MAY return a single response body composed only of these surfaces:

- `canonicalPatientId` — Patient Directory's SHA-256 derived id.
- `primaryScreeningId` — the freshest contributing screening row id.
- `screeningIds` — all contributing screening row ids (sorted newest first).
- `name`, `dob`, `phoneNumber`, `email`, `facility` — the freshest demographic snapshot per Bundle 5 §3.
- `totalScreenings`, `hasDeletedScreening` — derived counts.
- `emrSourceLinks[]` — array of `EmrSourceLink` envelopes per Bundle 42 (one row per vendor / facility), with `manualReviewRequired` and `conflictFlag` surfaced.
- `shadowReadVerdict` — when the future shadow-read flag is ON, the Bundle 48 verdict (`match` / `drift_minor` / `drift_major` / `conflict` / `not_resolvable`).

That's it. Anything outside this list is OUT OF SCOPE for the envelope.

---

## 2. What the envelope MUST EXCLUDE

The envelope MUST NOT carry any of the following (mirrors `team-portal-playground-wiring-contract.md` §22 + `billing-invoice-hard-stop-map.md` §3):

- Billing — `billing_records`, `billing_document_requests`, claim ids, money amounts, payment status, payment dates.
- Invoices — invoice ids, line items, totals, tax, discounts, net amounts.
- Revenue share — splits, partner amounts, contractor amounts.
- Unrestricted Admin Review internals — raw `reasoning.adminReview:<id>` blobs, full evidence payloads, model output text, model id / prompt hash combinations.
- Raw EMR notes — `ClinicalDocument` body text, `ImagingReport.findings` / `impression` text, lab text values beyond the canonical row fields.
- Unauthorised PHI — anything beyond what the viewer's tenant + facility RBAC scope already grants (per `team-portal-playground-wiring-contract.md` §21).
- Company financials — payroll, partner contracts, facility-level revenue.
- Cross-team employee data — other employees' PTO, performance, schedule details.
- Raw ICD codes in patient-facing display surfaces (preserved from `pdf-protection-contract.md`).

A future PR that adds any of the above to the envelope is non-compliant and must be paused.

---

## 3. Hard wiring rules for the future PR

A PR introducing this read-only endpoint MUST:

1. Delegate to the existing Patient Directory module's read helpers:
   - `getCanonicalPatientByScreeningId(id)` from `server/modules/patient-directory/service.ts`.
   - `listCanonicalPatients({ facility, limit, offset })` for facility-scoped lists.
2. NOT introduce a parallel canonical-id computation. The module's `computeCanonicalPatientId` is the source of truth (per Bundle 21).
3. Be feature-flag-gated: `USE_PATIENT_DIRECTORY_ENVELOPE_READ` (reserved; default OFF). The route returns 404 when the flag is OFF.
4. Be auth-gated: the endpoint reuses `/api/auth/me` + the facility scope from `/api/portal/my-facilities`. No new auth surface.
5. Be RBAC-scoped: the response NEVER includes a patient outside the viewer's tenant + facility scope.
6. Be append-only on its audit emission — every successful read writes a counts-only journey event (per `journey-event-standardization-design.md`).
7. Honour the Bundle 8 PHI-safe logger: no patient identifiers in info / warn / error logs; only counts at observability level.

---

## 4. Hard stops for the future PR

The PR MUST stop and ask if it would:

1. Write to ANY table. The envelope is strictly read-only.
2. Adopt the dormant projection module from PR #96 (that's a separate cutover with its own gate, `portal-cutover-readiness-checklist.md`).
3. Surface any field listed in §2.
4. Flip `USE_PATIENT_DIRECTORY_ENVELOPE_READ` default in any environment.
5. Change the `patient_screenings` table or any schema (`do-not-touch.md`).
6. Change `routes/patients.ts`, `routes/patientDatabase.ts`, or any Admin Review route.
7. Add a UI surface. The envelope is the data; the UI is its own PR (Bundle 32 Step E for Playground; a separate PR for any other consumer).
8. Mutate the Patient Directory module's helpers. The module is sealed; the endpoint is a thin delegate.
9. Cross tenants on any read (Bundle 37 §15).
10. Include money math anywhere (Bundle 29).

---

## 5. QA gates the future PR must pass

- `npm run check` clean.
- `npm run build` clean.
- All `scripts/qa-*.mjs` pass, including:
  - `qa-patient-directory-parity-fixture.mjs` (Bundle 21) — canonical id rule.
  - `qa-patient-directory-emr-source-link-fixture.mjs` (Bundle 42) — source-link envelope.
  - `qa-patient-directory-shadow-read-fixture.mjs` (Bundle 48) — shadow-read verdict.
  - A new `qa-patient-directory-envelope-route.mjs` shipped by the future PR that asserts:
    - The route file imports only `getCanonicalPatientByScreeningId` / `listCanonicalPatients` and the flag accessor.
    - The route does not import any billing / invoice / Admin Review service.
    - The response body, when the flag is OFF, returns 404.
    - The route emits a PHI-safe counts-only journey event on success.

---

## 6. Rollback plan

- The flag is the kill switch. Flipping `USE_PATIENT_DIRECTORY_ENVELOPE_READ=0` returns the route to 404 without a code change.
- The legacy patient-screening routes (`/api/patient-screenings/:id`, `/api/patient-database`, etc.) remain primary throughout — the envelope is additive.
- If a regression appears post-deploy, flip the flag, then open an incident-retro PR.

---

## 7. Visual rules for the Playground (per Bundle 32 Step E)

When the envelope is consumed by a Playground patient tab:

- Demographics → pencil-tab section per Bundle 11 §10.
- EMR source links → pencil-tile per vendor with a `manualReviewRequired` badge.
- Shadow-read verdict (when present) → small pencil-bubble annotation; never a banner that asserts identity.
- No financial section. No admin-only audit content.
- No raw EMR note bodies.

The Playground UI itself ships in Bundle 32's Step E PR, not here.

---

## 8. Non-promises

- No production deploy date.
- No commitment that the envelope ships in any particular release.
- No commitment to a specific path under `/api/team-portal/` — the future PR may choose any additive path.
- No commitment that the shadow-read verdict is surfaced from day one; it MAY be omitted on the initial endpoint and added later.
- No commitment that the envelope covers every Patient Directory field — fields not listed in §1 are EXCLUDED.

End of readiness doc.
