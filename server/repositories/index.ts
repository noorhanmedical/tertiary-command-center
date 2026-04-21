/**
 * Per-domain repository layer.
 *
 * Each repository owns the raw drizzle calls for a single domain table or
 * cluster of related tables. Routes and services should prefer importing a
 * specific repository (e.g. `import { usersRepository } from "@/repositories/users.repo"`)
 * over reaching into the legacy `storage` god-object. The legacy `DatabaseStorage`
 * delegates to these repositories so existing call-sites keep compiling
 * during the incremental migration.
 */
export * from "./users.repo";
export * from "./audit.repo";
export * from "./pto.repo";
