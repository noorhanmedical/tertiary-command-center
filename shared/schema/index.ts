// Domain-modular schema barrel. New code should prefer importing from a
// specific domain (e.g. `import { users } from "@shared/schema/users"`) so
// dependencies are explicit. The legacy flat path `@shared/schema` continues
// to work via this barrel — every existing call-site keeps compiling.
//
// ─── ID conventions (single source of truth) ────────────────────────────────
// • `users.id`             — varchar (UUID), default `gen_random_uuid()`.
//   All cross-domain user-owner FKs use varchar and must reference users.id.
// • Every other domain table — serial integer primary key (`id`).
// • Per-table insert schemas use `createInsertSchema(<table>)` from
//   drizzle-zod, with `.omit({ id: true, createdAt: true, ... })` for
//   server-managed columns and `.extend({ ... })` for stricter constraints.
// • Per-table types follow the `<Name>` / `Insert<Name>` naming pair, where
//   `<Name> = typeof <table>.$inferSelect` and
//   `Insert<Name> = z.infer<typeof insert<Name>Schema>`.
// • Status / enum-like literals are exported as `<DOMAIN>_STATUSES` const
//   tuples plus a `<Domain>Status = typeof <DOMAIN>_STATUSES[number]` alias
//   so route validation can `.enum(...)` from a single source.
//
// The shared internal helper `_common.ts` re-exports drizzle/zod primitives
// for the per-domain files but is intentionally NOT re-exported here:
// drizzle's relational extractor iterates the schema namespace and would
// crash on the zod `z` object's null prototype.
export * from "./appSettings";
export * from "./session";
export * from "./clinics";
export * from "./users";
export * from "./screening";
export * from "./patientHistory";
export * from "./notes";
export * from "./patientNotes";
export * from "./contacts";
export * from "./invoiceReadiness";
export * from "./invoiceBatches";
export * from "./invoiceDelivery";
export * from "./invoiceFinancialEvents";
export * from "./billing";
export * from "./appointments";
export * from "./analysisJobs";
export * from "./plexus";
export * from "./audit";
export * from "./outreach";
export * from "./invoices";
export * from "./documents";
export * from "./outbox";
export * from "./pto";
export * from "./executionCase";
export * from "./engagement";
export * from "./globalSchedule";
export * from "./schedulingTriage";
export * from "./insuranceEligibility";
export * from "./cooldown";
export * from "./adminSettings";
export * from "./documentReadiness";
export * from "./procedureEvents";
export * from "./generatedNotes";
export * from "./billingReadiness";
export * from "./billingDocuments";
export * from "./completedBillingPackages";
export * from "./cashPricing";
export * from "./projectedInvoices";
export * from "./ancillaryDocumentTemplates";
export * from "./clinicalIntelligence";
// Team Portal — backend-persisted widget/layout prefs (schema for the
// TeamPortalShell tool dock + floating widget layer).
export * from "./portalWidgets";
export * from "./portalPrefs";
// Phase 1 (Team Ops) — first-class internal team messaging: canonical
// conversations + members + team_messages replacing the mock inbox and the
// orphaned direct_messages path. Migration 0065.
export * from "./messaging";
// Phase 3C (Team Ops) — first-class call handoffs (K6): ownership transfer /
// request between team members with P1..P5 priority, acknowledgement, and
// provenance. Live ownership stays on patient_execution_cases; this is the
// transfer source of truth. Migration 0067.
export * from "./callHandoffs";
// Phase 3D (Team Ops) — structured NEEDS COVERAGE state (K8): records WHY a
// case is currently uncovered (category + reason). NOT a second ownership
// store; the case stays canonically unassigned. Migration 0068.
export * from "./needsCoverage";
// Phase 4 (Team Ops) — canonical organizational model (K4): teams,
// team_memberships (multi-team), manager_relationships (team-level authority),
// and a relationship-change audit ledger. Admin Settings is the authoritative
// management surface; Engagement/messaging/tasks consume these. Migration 0069.
export * from "./teams";
// Phase 2A — Global Plexus patient identity (six new tables). Every
// write path is guarded by FEATURE_PLEXUS_IDENTITY_WRITE (default OFF)
// and the SQL migration (migrations/0049_add_plexus_identity.sql) is
// not applied automatically.
export * from "./plexusIdentity";
// Phase 2B — Canonical per-service ancillary case model. Every write
// path is guarded by FEATURE_ANCILLARY_CASE_WRITE (default OFF) and
// the SQL migration (migrations/0050_add_patient_ancillary_cases.sql)
// is not applied automatically.
export * from "./ancillaryCases";
// Phase 2C — Service-specific Admin Review (append-only history) and
// Engagement list identity. Every write path is guarded by four
// flags (all default OFF); migration 0051 is not applied automatically.
export * from "./adminReviewEvents";
export * from "./engagementLists";
// Phase 2D — Canonical ancillary appointments in global_schedule_events.
// Additive columns added to globalScheduleEvents; new failures ledger.
// Guarded by FEATURE_CANONICAL_APPOINTMENT (default OFF); migration
// 0052 is not applied automatically.
export * from "./canonicalAppointments";
// Phase 2E — Unified Ancillary Documents reference index + Order Note
// foundation. Guarded by FEATURE_UNIFIED_ANCILLARY_DOCUMENTS /
// FEATURE_CANONICAL_ORDER_NOTE (default OFF); migration 0053 is not
// applied automatically.
export * from "./ancillaryDocuments";
// Phase 3 — Plexus Clinical Findings (structured AI-found clinical findings
// with provenance). Migration 0057; no feature flag gate at schema level.
export * from "./plexusClinicalFindings";
// Phase 4 — Ancillary Service Registry (centralized service definitions,
// CPT codes, qualification criteria, cooldown rules). Migration 0058.
export * from "./ancillaryServiceRegistry";
// Phase 5 — Note Addenda (traceable addenda for signed clinical documents).
// Migration 0059.
export * from "./noteAddenda";
// Phase 10 — Plexus Bank Events (append-only financial reconciliation ledger).
// Migration 0060.
export * from "./plexusBankEvents";
// Phase 11 — Canonical clinical reference domains (providers, allergies, labs,
// imaging, vitals, encounters) that back the Patient EHR chart. Additive;
// migration 0061. Replaces the client-side demo enrichment for these six
// sections with real DB-backed rows.
export * from "./clinicalData";
export * from "../models/chat";
