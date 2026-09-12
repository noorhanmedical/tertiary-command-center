// Large-file patient ingestion — durable import job ledger.
//
// Tracks the PROCESSING of an uploaded patient-source file (128 MB+): upload →
// parse → validate → preview → import. Patients still land in the canonical
// `patient_screenings` (one `screening_batches` row per job); this table only
// records job lifecycle, progress, counts, detected structure, and errors so
// the upload can return immediately and the frontend can poll. NOT a second
// patient system. Backing migration: 0086_add_import_jobs.sql.

import {
  sql,
  pgTable,
  serial,
  text,
  varchar,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";
import { users } from "./users";
import { screeningBatches } from "./screening";

export const IMPORT_JOB_STATUSES = [
  "uploaded",
  "parsing",
  "validating",
  "preview_ready",
  "importing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const IMPORT_FILE_FORMATS = [
  "csv",
  "tsv",
  "xlsx",
  "pdf",
  "image",
  "unknown",
] as const;
export type ImportFileFormat = (typeof IMPORT_FILE_FORMATS)[number];

export const IMPORT_FACILITY_SOURCES = ["column", "import_selection"] as const;
export type ImportFacilitySource = (typeof IMPORT_FACILITY_SOURCES)[number];

export const importJobs = pgTable(
  "import_jobs",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id").references(() => clinics.id, {
      onDelete: "set null",
    }),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("uploaded"),
    kind: text("kind").notNull().default("large_file"),
    idempotencyKey: text("idempotency_key"),

    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    // bigint — file bytes (up to ~250 MB); numeric mode "number" keeps TS simple.
    byteSize: numeric("byte_size"),
    fileFormat: text("file_format"),
    tempPath: text("temp_path"),

    facility: text("facility"),
    facilitySource: text("facility_source"),

    detectedSheet: text("detected_sheet"),
    detectedColumns: jsonb("detected_columns").notNull().default(sql`'{}'::jsonb`),
    workbookInfo: jsonb("workbook_info").notNull().default(sql`'{}'::jsonb`),

    chunkSize: integer("chunk_size").notNull().default(500),
    totalChunks: integer("total_chunks").notNull().default(0),
    processedChunks: integer("processed_chunks").notNull().default(0),
    cursorRow: integer("cursor_row").notNull().default(0),

    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    newRows: integer("new_rows").notNull().default(0),
    existingRows: integer("existing_rows").notNull().default(0),
    possibleRows: integer("possible_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),

    preview: jsonb("preview").notNull().default(sql`'[]'::jsonb`),
    warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),

    errorType: text("error_type"),
    errorMessage: text("error_message"),
    retryable: boolean("retryable").notNull().default(true),

    batchId: integer("batch_id").references(() => screeningBatches.id, {
      onDelete: "set null",
    }),

    expiresAt: timestamp("expires_at"),
    isTest: boolean("is_test").notNull().default(false),

    startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_import_jobs_status").on(table.status),
    index("idx_import_jobs_clinic").on(table.clinicId),
    index("idx_import_jobs_created_by").on(table.createdByUserId),
    index("idx_import_jobs_batch").on(table.batchId),
    uniqueIndex("uq_import_jobs_idempotency")
      .on(table.clinicId, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  ],
);

export const insertImportJobSchema = createInsertSchema(importJobs).omit({
  id: true,
  startedAt: true,
  updatedAt: true,
  completedAt: true,
});

export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = z.infer<typeof insertImportJobSchema>;

// ─── import_row_decisions ─────────────────────────────────────────
// Durable manager resolutions for POSSIBLE_MATCH rows. A dedicated small
// table (rather than a fat JSON blob on the job) because decisions are
// per-row, updated individually, must be queried/joined at write time, and
// need a unique (import_job_id, row_index) guard for idempotent upserts. It
// is decision METADATA on the existing import job — NOT a second patient
// system. Backing migration: 0087_add_import_row_decisions.sql.
export const IMPORT_ROW_DECISIONS = ["use_existing", "import_as_new", "skip"] as const;
export type ImportRowDecision = (typeof IMPORT_ROW_DECISIONS)[number];

export const importRowDecisions = pgTable(
  "import_row_decisions",
  {
    id: serial("id").primaryKey(),
    importJobId: integer("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    decision: text("decision").notNull(),
    // The existing patient this row was resolved TO (only for use_existing).
    matchedScreeningId: integer("matched_screening_id"),
    resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_ird_job").on(table.importJobId),
    uniqueIndex("uq_ird_job_row").on(table.importJobId, table.rowIndex),
  ],
);

export const insertImportRowDecisionSchema = createInsertSchema(importRowDecisions).omit({
  id: true,
  resolvedAt: true,
});
export type ImportRowDecisionRow = typeof importRowDecisions.$inferSelect;
export type InsertImportRowDecision = z.infer<typeof insertImportRowDecisionSchema>;
