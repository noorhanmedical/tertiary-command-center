# Phase 2H — Clinician Portal Canonical Live Data

Phase 2H replaces placeholder/mock operational data in the Clinician Portal's
three tiles with **live canonical data** from Phases 2A–2G. It is **data wiring**,
not a redesign: the product structure (Finance / Orders & Notes / Engagement),
navigation, tiles, and layout are preserved. Everything is behind flags that
default **OFF**; with the flag OFF the portal renders exactly as before and issues
zero canonical requests.

## Current-state audit

- **Page/route:** `client/src/pages/physician-portal.tsx` → `PhysicianPortalShell`
  → `ClinicianPortalShell`; Wouter route `/clinician-portal` guarded by
  `RoleGuard roles={["admin","clinician"]}`. Tile navigation is local context
  state (`portalContext.tsx` `activePage`), not Wouter.
- **Tiles:** `finance/FinancePage.tsx`, `orders/OrdersNotesPage.tsx`,
  `engagement/PlexusEngagementPage.tsx`.
- **Current data:** `usePortalData()` (`["/api/clinician-portal"]`) + hardcoded
  mock arrays in `mockData.ts`; the Finance tile currently renders **mock
  revenue/claims/invoices** (which Phase 2H must NOT reproduce).
- **Existing actions (UNCHANGED):** physician sign/return via
  `/api/physician-portal/signature-items/:id/{sign,return,bulk-sign}` and the
  portal's own `/api/clinician-portal/notes/*` + `/calls/*` mutations. Phase 2H
  adds NO new mutation and no second signing workflow.
- **Auth:** server `requireClinicianOrAdmin` (session role ∈ {clinician,admin}) +
  `requireClinicScope` (`req.clinicId` from `clinicContext` middleware, never
  body). Phase 2H reuses this exact boundary.
- **Protected UI (canonical manifest):** the tile files are hash-pinned in
  `docs/canonical-ui-manifest.json`. Phase 2H updates only the three tile hashes
  for the exact wiring change (below); every other protected file is unchanged.

## Per-tile contract (retained vs. replaced)

| Tile | Current source | Canonical source (flag ON) | Fields retained | Removed |
|---|---|---|---|---|
| **Finance** | mock revenue/claims/invoices | canonical billing-readiness + Billing Document (Phase 2G) | evaluated / ready / missing / pending / generated / claim-blocked-only / superseded counts, billing+claim blockers by code, last evaluated | **all revenue/collection/claim-amount/paid/balance/clinic-share/invoice/remittance/payer figures** |
| **Orders & Notes** | mock notes/orders | Unified Ancillary Documents spine (Phase 2E/2F) | current Order Notes / Procedure Notes / reports, pending signatures, returned-for-correction, generated, missing-evidence counts | mock rows |
| **Engagement** | mock call list | service-specific ancillary cases + Admin Review (Phase 2B–2C) | active cases, Admin Review status buckets | invented outreach; no Twilio/SMS |

Each tile is READ-ONLY. Tile meaning is unchanged; the canonical panel is added
above the existing content and renders only when the flag is ON.

## Canonical endpoint + DTO

- **Endpoint:** `GET /api/clinician-portal/canonical-overview` — one batched,
  clinic-scoped, read-only read model
  (`server/services/clinicianPortal/canonicalOverview.ts`). Flag OFF → explicit
  disabled contract before any canonical read. Migration missing → 503. No
  writes, no retry records, no document bytes, no clinic/actor from body.
- **DTO:** `shared/clinicianPortalOverview.ts` — one serialized contract shared by
  server and client. Each section carries its OWN `availability`
  (available / disabled_flag_off / upstream_flag_off / migration_missing /
  unavailable) + warnings + bounded counts/rows, so a failed/disabled section is
  reported truthfully (never a silent zero). No global Plexus identity ids — only
  opaque `ancillaryCaseId` + existing display fields (patient display left null
  to avoid PHI/extra joins).

## Tenancy & episode identity

Every query is exact-clinic-scoped (SQL predicate AND in-memory defense), bounded
(scan cap + 50-row cap), deterministically ordered by `ancillaryCaseId`. One
ancillary case is one episode; there is no patient/service grouping that merges
episodes, no first/newest fallback, no cross-clinic disclosure. Superseded
readiness/documents are excluded from current counts.

## Flags (default OFF)

- Server: `FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA`
  (`featureFlags.clinicianPortalCanonicalData`). Does NOT auto-enable upstream
  flags; each section checks its own upstream runtime gate
  (`billingReadinessRuntimeEnabled` / `unifiedAncillaryDocuments` /
  `ancillaryCaseWrite`) and is marked `upstream_flag_off` when that is OFF.
- Client: `VITE_FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA`
  (`client/src/lib/clinicianPortalCanonicalFlag.ts`). OFF ⇒ the query never runs
  (no network request); the panel renders nothing; existing tiles are unchanged.

## No migration

Phase 2H reads existing canonical tables (Phases 2A–2G) only; it requires **no
migration**. Migration 0055 remains unapplied; no migration 0056.
