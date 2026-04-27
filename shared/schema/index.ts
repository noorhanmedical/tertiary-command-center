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
export * from "./users";
export * from "./screening";
export * from "./patientHistory";
export * from "./notes";
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
export * from "./globalSchedule";
export * from "./schedulingTriage";
export * from "./insuranceEligibility";
export * from "./cooldown";
export * from "./adminSettings";
export * from "../models/chat";
