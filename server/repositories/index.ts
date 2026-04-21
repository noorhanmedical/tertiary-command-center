/**
 * Per-domain repository layer.
 *
 * Each repository owns the raw drizzle calls for a single domain table or
 * cluster of related tables. Routes and services should prefer importing a
 * specific repository (e.g. `import { usersRepository } from "@/repositories/users.repo"`)
 * over reaching into the legacy `storage` god-object. The legacy `DatabaseStorage`
 * delegates to these repositories so existing call-sites keep compiling.
 */
export * from "./users.repo";
export * from "./audit.repo";
export * from "./pto.repo";
export * from "./screening.repo";
export * from "./patientHistory.repo";
export * from "./notes.repo";
export * from "./billing.repo";
export * from "./invoices.repo";
export * from "./uploadedDocuments.repo";
export * from "./appointments.repo";
export * from "./outreach.repo";
export * from "./schedulerAssignments.repo";
export * from "./analysisJobs.repo";
export * from "./plexus.repo";
export * from "./marketingMaterials.repo";
export * from "./documentLibrary.repo";
