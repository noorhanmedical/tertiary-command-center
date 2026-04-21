// Shared imports re-exported so domain schema files have a single source for
// drizzle/zod primitives. Keep this file dependency-free.
export { sql } from "drizzle-orm";
export {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  boolean,
  numeric,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
export { createInsertSchema } from "drizzle-zod";
export { z } from "zod";
