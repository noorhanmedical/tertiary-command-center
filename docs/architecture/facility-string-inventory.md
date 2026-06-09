# Facility string inventory (Batch 6)

**Branch:** `architecture/batch-6-facility-canonicalization-design`
**Date:** 2026-06-09
**Scope:** READ-ONLY inventory. Companion to `facilities-design.md`.
**Purpose:** Enumerate every place facility identity is used as a string so the future `facilities` master table and `facility_id` rollout can be staged safely.

> Cross-reference: `docs/architecture/facilities-design.md` (the rollout plan), `docs/architecture/canonical-spine.md` §3.3, `docs/architecture/full-21-batch-orchestrator-review.md` Batch 6.

---

## 0. Headline numbers

- **3** canonical facility names today, hard-coded in `shared/plexus.ts:1`:
  `"Taylor Family Practice"`, `"NWPG - Spring"`, `"NWPG - Veterans"`.
- **71** references to the `VALID_FACILITIES` constant across `shared/`, `server/`, `client/`, `scripts/`.
- **27** schema columns that store facility identity. **Zero are real foreign keys.** Two naming styles coexist:
  - Older: `facility: text("facility")`
  - Newer: `facilityId: text("facility_id")`
  - Both are plain `text` columns — the column name implies a FK but no `references()` clause exists.
- **45** hardcoded references to one of the three canonical facility names **outside** the `VALID_FACILITIES` constant (parser canonicalization, page styling, fallback defaults, etc.).
- **198** total files mention `"facility"` in some form.

The orchestrator's Batch 6 stop condition was *"If the inventory reveals undocumented uses of facility strings, STOP and add a section on that risk before approving the implementation batch."* Three undocumented uses were found and are flagged below in §5.

---

## 1. The canonical source — `shared/plexus.ts`

```ts
// shared/plexus.ts:1-2
export const VALID_FACILITIES = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"] as const;
export type ValidFacility = typeof VALID_FACILITIES[number];
```

This is the **only** place the three canonical names are declared. Every server/client validation that wants to accept "the right names" imports `VALID_FACILITIES`. Notable consumers (representative; 71 total):

| File | What it uses VALID_FACILITIES for |
| --- | --- |
| `server/routes/settings.ts:3,16,58` | `z.enum(VALID_FACILITIES)` validation on POST; iteration to set per-facility settings. |
| `server/routes/google.ts:4,19,90` | Type-narrowing predicate + Drive folder allow-list. |
| `server/routes/outreach.ts:4` | Imported for filter validation. |
| `server/routes/helpers.ts:119` | Default `"NWPG"` for `clinic` (NOT one of the three; see §5.1). |
| `client/src/pages/team-ops.tsx`, `client/src/pages/billing.tsx`, multiple client pages | Render filter chips / lookups. |

**Risk:** `VALID_FACILITIES` is a TS const — adding/removing a facility requires a code change. Multi-tenant or multi-clinic onboarding requires this to become a runtime registry. That's the target end-state.

---

## 2. Schema columns (27 total)

### 2.1 `facility: text("facility")` — older style, no FK

| Schema file | Column | Nullability |
| --- | --- | --- |
| `shared/schema/appointments.ts:8` | `facility` | `.notNull()` |
| `shared/schema/billing.ts:9` | `facility` | nullable |
| `shared/schema/documents.ts:10` | `facility` | `.notNull()` |
| `shared/schema/documents.ts:106` | `facility` (`documentSurfaceAssignments`) | nullable |
| `shared/schema/invoices.ts:17` | `facility` | `.notNull()` |
| `shared/schema/notes.ts:8` | `facility` | nullable |
| `shared/schema/outbox.ts:17` | `facility` | nullable |
| `shared/schema/outreach.ts:11` (`outreach_schedulers`) | `facility` | `.notNull()` |
| `shared/schema/plexus.ts:10` (`plexus_projects`) | `facility` | nullable |
| `shared/schema/screening.ts:13` (`screening_batches`) | `facility` | nullable |
| `shared/schema/screening.ts:42` (`patient_screenings`) | `facility` | nullable |
| `shared/schema/patientHistory.ts:10` | `clinic` (NOT `facility`; see §5.1) | `.notNull().default("NWPG")` |

### 2.2 `facilityId: text("facility_id")` — newer style, still no FK

| Schema file | Column | Notes |
| --- | --- | --- |
| `shared/schema/adminSettings.ts:34` | `facilityId` | Newer naming; column type still plain `text`. |
| `shared/schema/ancillaryDocumentTemplates.ts:34` | `facilityId` | — |
| `shared/schema/billingDocuments.ts:27` | `facilityId` | — |
| `shared/schema/billingReadiness.ts:25` | `facilityId` | — |
| `shared/schema/cashPricing.ts:9` | `facilityId` | — |
| `shared/schema/completedBillingPackages.ts:41` | `facilityId` | — |
| `shared/schema/cooldown.ts:31` | `facilityId` | — |
| `shared/schema/documentReadiness.ts:46,74` | `facilityId` (× 2) | — |
| `shared/schema/executionCase.ts:34` (`patient_execution_cases`) | `facilityId` | — |
| `shared/schema/globalSchedule.ts:52` | `facilityId` | — |
| `shared/schema/insuranceEligibility.ts:41` | `facilityId` | — |
| `shared/schema/procedureEvents.ts:27` | `facilityId` | — |
| `shared/schema/projectedInvoices.ts:27` | `facilityId` | — |
| `shared/schema/schedulingTriage.ts:46` | `facilityId` | — |

**Observation:** the naming difference (`facility` vs `facilityId`) is **purely cosmetic at the schema level today.** Both store the same kind of value: the canonical text name like `"NWPG - Spring"`. A future `facility_id` FK would mean these columns store an integer / UUID; this batch documents the path to that without making any change.

### 2.3 What's missing

There is **no `facilities` (or `facility_master`) table** anywhere in `shared/schema/`. The orchestrator's Batch 6 target is to introduce one.

---

## 3. Hardcoded facility names (45 occurrences outside `VALID_FACILITIES`)

These references hard-code one of the three canonical names directly, rather than going through the constant. They are categorized below.

### 3.1 Client-side parser canonicalization

`client/src/lib/plexusIqClinicalImportParser.ts:178–186`:

```ts
{ aliases: [...], canonical: "Taylor Family Practice" },
{ aliases: [...], canonical: "NWPG - Spring" },
{ aliases: [...], canonical: "NWPG - Veterans" },
```

The Plexus IQ clinical import parser normalizes operator-typed aliases (e.g., `"TFP"`, `"Taylor"`, `"Spring"`) to the canonical strings. This is the **only place** the alias → canonical mapping lives.

**Implication:** Renaming a facility today requires a code change here, NOT just in `VALID_FACILITIES`. A future `facilities` table needs an `aliases` column (or an `aliases` join table) to absorb this responsibility.

### 3.2 Client-side display fallbacks

| File | Fallback | Why |
| --- | --- | --- |
| `client/src/components/AppointmentModal.tsx:46` | `(patient.facility as string) \|\| "Taylor Family Practice"` | Last-resort default when patient has no facility set. |
| `client/src/components/portal/TeamPortalShell.tsx:974` | `facility \|\| "NWPG - Spring"` | Portal default. |
| `client/src/components/portal/PortalShell.tsx:760` | `facility \|\| "NWPG - Spring"` | Portal default. |

**Implication:** Three different files independently chose a different facility as a "default" (`"Taylor Family Practice"` in AppointmentModal vs `"NWPG - Spring"` in the two portal shells). This is a code smell — the fallback should be config-driven, not hard-coded.

### 3.3 Substring-based styling (`client/src/pages/team-ops.tsx`)

```ts
// team-ops.tsx:76-77, 83-84
if (facility.includes("Taylor")) return "bg-blue-600/10 …";
if (facility.includes("Spring")) return "bg-emerald-600/10 …";
if (facility.includes("Taylor")) return "bg-blue-600";
if (facility.includes("Spring")) return "bg-emerald-600";
```

Substring matching on facility name to choose colors. **Renaming `"NWPG - Spring"` would break the styling** if the new name doesn't contain `"Spring"`. This is a hidden coupling.

### 3.4 Default `clinic` (NOT `facility`) values

| File | Default | Surface |
| --- | --- | --- |
| `shared/schema/patientHistory.ts:10` | `.default("NWPG")` | Test-history table default. |
| `server/routes/helpers.ts:119` | `clinic: z.string().default("NWPG")` | Default for a Zod input. |
| `server/routes/patients.ts:151` | `const clinic = batch?.facility \|\| "NWPG"` | Fallback during auto test-history capture. |

**`"NWPG"` is NOT one of the three canonical facility names.** This is a separate, looser "clinic" identifier used in the test-history domain. See §5.1.

### 3.5 Drive folder + scheduler-team mapping

`shared/platformSettings.ts:19–47` declares per-facility scheduler-team mappings using the canonical names:

```ts
{ id: "taylor-scheduler", name: "Taylor Scheduler", ... },
…
{ clinicLabel: "NWPG - Spring", … },
{ clinicLabel: "NWPG - Veterans", … },
{ clinicLabel: "Taylor Family Practice", … },
```

`resolveClinicKey(facility)` (lines 64–69) does its own lowercase normalization but does NOT canonicalize aliases — it expects already-canonical input. This is fine **only** if every caller has already gone through the parser canonicalization in §3.1.

---

## 4. Routes that accept `facility` as a query / body parameter

A non-exhaustive sample — there are many. Each one accepts a string and does not validate against `VALID_FACILITIES`:

| Route | File | Validation |
| --- | --- | --- |
| `GET /api/portal/today-schedule` | `server/routes/portal.ts:131` | Free-form string. |
| `GET /api/portal/month-summary` | `server/routes/portal.ts:247` | Free-form string. |
| `GET /api/global-schedule-events` | `server/routes/globalSchedule.ts:42` | Free-form string. |
| `GET /api/engagement/assignment-board?facility=…` | `server/routes/engagementAssignmentBoard.ts:170` | Free-form string. |
| `POST /api/engagement/assignment-board/assign` | (body — uses scheduler-id, not facility) | n/a |
| `GET /api/patients/database?clinic=…` | `server/routes/patientDatabase.ts:110` | Free-form string. |
| `POST /api/billing-records/import-from-sheet` | `server/routes/billing.ts` | Free-form string per row. |
| `GET /api/invoices?facility=…` | `server/routes/invoices.ts` | Free-form string. |

**Risk:** A typo in the query parameter silently returns zero results (`facility = "NWPG - Spring "` with a trailing space ≠ `"NWPG - Spring"`). The future implementation should canonicalize at the route boundary.

---

## 5. Risks flagged for the orchestrator's stop condition

The Batch 6 orchestrator entry's stop condition was triggered by three undocumented uses found in this inventory.

### 5.1 The `clinic` vs `facility` naming split

The codebase uses **two different names** for the same concept: `facility` and `clinic`. They are **NOT synonyms** in every code path:

- `patient_history.clinic` defaults to `"NWPG"` — a value NOT in `VALID_FACILITIES`. This appears to be the umbrella clinic name (NWPG = North West Physician Group), of which both `"NWPG - Spring"` and `"NWPG - Veterans"` are sub-locations.
- `server/routes/patients.ts:151` falls back to `"NWPG"` when `batch?.facility` is absent.
- `shared/platformSettings.ts:64` calls its accessor `resolveClinicKey` and works on facility strings.

**Implication for Batch 6 implementation:** The future `facilities` table must clarify whether `"NWPG"` is a parent-org concept (with `"NWPG - Spring"` and `"NWPG - Veterans"` as children) or a deprecated alias that should be migrated to one of the canonical names. **Until that decision is made, the implementation batch cannot ship — the wrong choice will silently miscategorize historical test-history rows.**

### 5.2 Substring-based styling

`client/src/pages/team-ops.tsx:76-84` uses `facility.includes(...)` for color selection. Any rename that loses the substring breaks styling. The implementation batch must convert this to a typed-id lookup BEFORE renaming any facility.

### 5.3 Three different "default facility" fallbacks

§3.2 above. The implementation batch must pick a single default (probably configurable per environment) and replace all three fallbacks atomically.

---

## 6. Drive folder coupling

`server/routes/google.ts:90` uses `KNOWN_FACILITIES = [...VALID_FACILITIES]` to enforce which facilities have Drive folders. A future facility added to `VALID_FACILITIES` without a corresponding Drive folder would either fail silently or default to a wrong folder. The `facilities` master table must carry the Drive folder id (or null = no Drive sync).

---

## 7. What this inventory does NOT cover

- Per-route status enums that include facility-derived discriminators (out of scope; status enums are Batch 17's concern).
- Backfill SQL — that lives in `facilities-design.md` §5.
- Test fixtures — the QA scripts use real facility names from `VALID_FACILITIES`; updating them is part of Batch 21.

---

## 8. Cross-references

- `shared/plexus.ts:1` — the canonical declaration.
- `shared/platformSettings.ts:19–47` — the scheduler-team mapping.
- `client/src/lib/plexusIqClinicalImportParser.ts:178–186` — the alias canonicalization.
- `docs/architecture/canonical-spine.md` §3.3 — the original "facilities — MISSING" gap.
- `docs/architecture/facilities-design.md` — the rollout plan that consumes this inventory.

End of inventory.
