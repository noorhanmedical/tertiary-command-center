-- Plexus IQ runtime hardening — analysis_jobs.metadata column.
--
-- Adds a single jsonb column to analysis_jobs so the runner can durably
-- store: target patient id set, chunk progress, per-category counters,
-- rolling chunk timings, rate-limit + ai-batch-fallback event counts.
--
-- Default '{}'::jsonb keeps every existing row valid; the runner reads
-- metadata defensively (treats null/empty as "no metadata yet, fall
-- back to flat columns") so this column is safe to roll forward and
-- back. No data backfill required.
--
-- This migration is one-way safe: dropping the column would lose
-- chunk-cursor history but does not break any other table. Schemas
-- and types in shared/schema/analysisJobs.ts are aligned.

ALTER TABLE "analysis_jobs"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
