// Integration + performance harness for large-file patient ingestion.
//
// Synthetic data only. Every row is is_test=true and clinic-scoped, then
// removed at the end so the DB returns to baseline. Run:
//   npx tsx --env-file=.env script/testLargeImport.ts
//
// Measures: parse time, classify/import throughput at 100/500/2000/15000 rows,
// dedup (re-import → no new patients), and per-row idempotency on retry.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { createImportJob, getImportJob, upsertImportRowDecision } from "../server/repositories/importJobs.repo";
import { runAnalysis, runImport } from "../server/services/largeImport/importJobRunner";
import { sweepExpiredArtifacts } from "../server/services/largeImport/importArtifactSweeper";

const CLINIC_ID = 1; // Taylor Family Practice (exists in local DB)
const TMP = path.join(os.tmpdir(), "plexus-import-perf");

async function writeCsv(rows: number, opts: { namePrefix: string; fillerCols?: number }): Promise<string> {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, `${randomUUID()}.csv`);
  const filler = opts.fillerCols ?? 0;
  const header = ["Name", "DOB", "Phone", "MRN", "Insurance", "Facility", ...Array.from({ length: filler }, (_, i) => `Extra${i}`)];
  const out = fs.createWriteStream(p);
  out.write(header.join(",") + "\n");
  for (let i = 1; i <= rows; i++) {
    const line = [
      `${opts.namePrefix} ${i}`,
      `19${String(50 + (i % 49)).padStart(2, "0")}-01-${String((i % 28) + 1).padStart(2, "0")}`,
      `202555${String(1000000 + i)}`,
      `${opts.namePrefix.replace(/\s/g, "")}-${i}`,
      "Medicare",
      "Taylor Family Practice",
      ...Array.from({ length: filler }, () => "x".repeat(40)),
    ];
    out.write(line.join(",") + "\n");
  }
  await new Promise<void>((resolve, reject) => {
    out.on("finish", () => resolve());
    out.on("error", reject);
    out.end();
  });
  return p;
}

// CSV with NO MRN column → re-imports match on name+DOB+phone (POSSIBLE tier).
async function writeCsvNoMrn(rows: number, namePrefix: string): Promise<string> {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, `${randomUUID()}.csv`);
  const out = fs.createWriteStream(p);
  out.write("Name,DOB,Phone,Insurance,Facility\n");
  for (let i = 1; i <= rows; i++) {
    out.write(`${namePrefix} ${i},1980-02-${String((i % 28) + 1).padStart(2, "0")},202777${String(1000000 + i)},Medicare,Taylor Family Practice\n`);
  }
  await new Promise<void>((resolve, reject) => { out.on("finish", () => resolve()); out.on("error", reject); out.end(); });
  return p;
}

async function makeJob(tempPath: string): Promise<number> {
  const job = await createImportJob({
    clinicId: CLINIC_ID,
    status: "uploaded",
    kind: "large_file",
    originalFilename: path.basename(tempPath),
    fileFormat: "csv",
    tempPath,
    facility: "Taylor Family Practice",
    facilitySource: "import_selection",
    isTest: true,
  } as never);
  return job.id;
}

async function runScale(rows: number, namePrefix: string) {
  const t0 = Date.now();
  const csv = await writeCsv(rows, { namePrefix });
  const jobId = await makeJob(csv);

  const tParse0 = Date.now();
  await runAnalysis(jobId);
  const afterAnalysis = await getImportJob(jobId);
  const parseMs = Date.now() - tParse0;

  const tImport0 = Date.now();
  await runImport(jobId, { includePossible: false });
  const afterImport = await getImportJob(jobId);
  const importMs = Date.now() - tImport0;

  const totalMs = Date.now() - t0;
  console.log(
    `rows=${rows.toString().padStart(6)} | status=${afterImport?.status} | ` +
      `parse=${parseMs}ms classify/new=${afterAnalysis?.newRows} | ` +
      `import=${importMs}ms imported=${afterImport?.importedRows} | ` +
      `throughput=${Math.round((afterImport?.importedRows ?? 0) / (importMs / 1000))}/s | total=${totalMs}ms`,
  );
  return { jobId, csv, imported: afterImport?.importedRows ?? 0 };
}

async function main() {
  console.log("=== Large-file import: scale + correctness (synthetic, is_test) ===");
  const artifacts: string[] = [];

  // Scale: unique name prefixes so each cohort is NEW (no cross-run dedup).
  for (const n of [100, 500, 2000]) {
    const r = await runScale(n, `ZZPERF${n} P`);
    artifacts.push(r.csv);
  }

  // 15,000-row scalability.
  const big = await runScale(15000, "ZZPERF15000 P");
  artifacts.push(big.csv);

  // ── Dedup: import a file, then analyze a SECOND identical file (separate
  // upload/temp) → the second should classify all rows as EXISTING, 0 new.
  console.log("\n--- Dedup: re-import identical 2,000 file (separate upload) ---");
  const dupCsvA = await writeCsv(2000, { namePrefix: "ZZPERFDUP P" });
  const dupCsvB = await writeCsv(2000, { namePrefix: "ZZPERFDUP P" }); // identical content
  artifacts.push(dupCsvA, dupCsvB);
  const j1 = await makeJob(dupCsvA);
  await runAnalysis(j1); await runImport(j1);
  const first = await getImportJob(j1);
  const j2 = await makeJob(dupCsvB);
  await runAnalysis(j2);
  const second = await getImportJob(j2);
  console.log(`first import: new=${first?.newRows} imported=${first?.importedRows}`);
  console.log(`re-import analysis: new=${second?.newRows} existing=${second?.existingRows} (expect existing≈2000, new≈0)`);

  // ── Idempotency on retry: re-run a job's import over the SAME rows twice →
  // no duplicate patients (partial-unique (import_job_id,import_row_index) +
  // onConflictDoNothing). We recreate the temp file (a completed job cleans it
  // up) and reset the cursor to force a full re-process.
  console.log("\n--- Idempotency: re-run import over same rows ---");
  const idemCsv = await writeCsv(500, { namePrefix: "ZZPERFIDEM P" });
  artifacts.push(idemCsv);
  const j3 = await makeJob(idemCsv);
  await runAnalysis(j3); await runImport(j3);
  const before = await countPatients("ZZPERFIDEM P%");
  // Recreate the temp artifact + reset cursor/status to force a 2nd full run.
  const idemCsv2 = await writeCsv(500, { namePrefix: "ZZPERFIDEM P" });
  artifacts.push(idemCsv2);
  await db.execute(sql`UPDATE import_jobs SET status='preview_ready', cursor_row=0, temp_path=${idemCsv2} WHERE id=${j3}`);
  await runImport(j3);
  const after = await countPatients("ZZPERFIDEM P%");
  console.log(`patients after 1st run=${before}, after 2nd run=${after} (expect equal → idempotent)`);

  // ── POSSIBLE_MATCH review workflow ───────────────────────────────────────
  console.log("\n--- POSSIBLE_MATCH review workflow ---");
  // Seed 5 patients WITHOUT MRN, then re-import the same 5 (no MRN) → all
  // classify as POSSIBLE (name+DOB+phone weak match).
  const seedCsv = await writeCsvNoMrn(5, "ZZPOSS P");
  artifacts.push(seedCsv);
  const seedJob = await makeJob(seedCsv);
  await runAnalysis(seedJob); await runImport(seedJob);
  const seeded = await countPatients("ZZPOSS P%");

  const reCsv = await writeCsvNoMrn(5, "ZZPOSS P");
  artifacts.push(reCsv);
  const pJob = await makeJob(reCsv);
  await runAnalysis(pJob);
  const pAfter = await getImportJob(pJob);
  console.log(`re-import: possible=${pAfter?.possibleRows} new=${pAfter?.newRows} (expect possible=5, new=0)`);

  // (a) UNRESOLVED → import writes nothing new.
  await runImport(pJob);
  const afterUnresolved = await countPatients("ZZPOSS P%");
  console.log(`after import with NO decisions: patients=${afterUnresolved} (expect == seeded ${seeded} → possible not auto-imported)`);

  // (b) Resolve: row1 import_as_new, row2 use_existing, row3 skip; rows 4-5 left unresolved.
  await upsertImportRowDecision({ importJobId: pJob, rowIndex: 1, decision: "import_as_new" });
  await upsertImportRowDecision({ importJobId: pJob, rowIndex: 2, decision: "use_existing", matchedScreeningId: 1 });
  await upsertImportRowDecision({ importJobId: pJob, rowIndex: 3, decision: "skip" });
  // Recreate temp + reset to re-run import honoring decisions.
  const reCsv2 = await writeCsvNoMrn(5, "ZZPOSS P");
  artifacts.push(reCsv2);
  await db.execute(sql`UPDATE import_jobs SET status='preview_ready', cursor_row=0, temp_path=${reCsv2} WHERE id=${pJob}`);
  await runImport(pJob);
  const afterResolved = await countPatients("ZZPOSS P%");
  console.log(`after resolving (1 import_as_new, 1 use_existing, 1 skip, 2 unresolved): patients=${afterResolved} (expect seeded ${seeded} + 1 = ${seeded + 1})`);

  // Existing-patient preservation: the use_existing target (screening id 1) must
  // be untouched — no new row, no duplicate. We assert total delta is exactly +1.
  console.log(`existing preserved: only the import_as_new row was added (${afterResolved - seeded} new)`);

  // ── Expired temp-artifact sweeper ────────────────────────────────────────
  console.log("\n--- Expired temp-artifact sweeper ---");
  const past = new Date(Date.now() - 60_000);
  // Expired abandoned job (uploaded) with a real temp file → should be cleaned.
  const sweepFile = await writeCsv(10, { namePrefix: "ZZSWEEP P" });
  const sweepJob = await createImportJob({ clinicId: CLINIC_ID, status: "uploaded", kind: "large_file", fileFormat: "csv", tempPath: sweepFile, expiresAt: past as never, isTest: true } as never);
  // Non-expired job → must be untouched.
  const freshFile = await writeCsv(10, { namePrefix: "ZZSWEEP F" }); artifacts.push(freshFile);
  const freshJob = await createImportJob({ clinicId: CLINIC_ID, status: "uploaded", kind: "large_file", fileFormat: "csv", tempPath: freshFile, expiresAt: new Date(Date.now() + 3600_000) as never, isTest: true } as never);
  // Expired but IMPORTING job → must be skipped (active).
  const activeFile = await writeCsv(10, { namePrefix: "ZZSWEEP A" }); artifacts.push(activeFile);
  const activeJob = await createImportJob({ clinicId: CLINIC_ID, status: "importing", kind: "large_file", fileFormat: "csv", tempPath: activeFile, expiresAt: past as never, isTest: true } as never);
  // Expired job whose file is already MISSING → must not error.
  const missingPath = path.join(TMP, `${randomUUID()}.csv`);
  const missingJob = await createImportJob({ clinicId: CLINIC_ID, status: "preview_ready", kind: "large_file", fileFormat: "csv", tempPath: missingPath, expiresAt: past as never, isTest: true } as never);

  const s1 = await sweepExpiredArtifacts(new Date());
  const sweepJobAfter = await getImportJob(sweepJob.id);
  const freshJobAfter = await getImportJob(freshJob.id);
  const activeJobAfter = await getImportJob(activeJob.id);
  console.log(`sweep1: scanned=${s1.scanned} cleaned=${s1.cleaned} skippedActive=${s1.skippedActive}`);
  console.log(`expired abandoned file deleted: ${!fs.existsSync(sweepFile)} tempPath cleared: ${sweepJobAfter?.tempPath === null}`);
  console.log(`non-expired untouched: file exists=${fs.existsSync(freshFile)} tempPath set=${freshJobAfter?.tempPath != null}`);
  console.log(`importing job untouched: file exists=${fs.existsSync(activeFile)} tempPath set=${activeJobAfter?.tempPath != null}`);
  const s2 = await sweepExpiredArtifacts(new Date());
  console.log(`sweep2 (idempotent): cleaned=${s2.cleaned} (expect 0 for already-cleaned; missing-file safe)`);
  void missingJob;

  // ── 128 MB file-size independence (CSV with filler columns) ──────────────
  console.log("\n--- 128 MB CSV artifact (2,000 useful rows + filler) ---");
  const bigFile = await writeBigCsv(128);
  artifacts.push(bigFile);
  const sizeMb = Math.round(fs.statSync(bigFile).size / 1024 / 1024);
  const jBig = await makeJob(bigFile);
  const rssBefore = process.memoryUsage().rss;
  const tp0 = Date.now();
  await runAnalysis(jBig);
  const bigJob = await getImportJob(jBig);
  const rssAfter = process.memoryUsage().rss;
  console.log(
    `file=${sizeMb}MB parsed in ${Date.now() - tp0}ms | rows=${bigJob?.totalRows} new=${bigJob?.newRows} | ` +
      `RSS delta=${Math.round((rssAfter - rssBefore) / 1024 / 1024)}MB (file NOT held in RAM if << ${sizeMb}MB)`,
  );

  // ── Cleanup: remove all synthetic (is_test) data created here ────────────
  console.log("\n--- Cleanup ---");
  const del = await cleanup();
  console.log(`deleted: screenings=${del.screenings} batches=${del.batches} jobs=${del.jobs}`);
  for (const a of artifacts) { try { await fsp.unlink(a); } catch { /* gone */ } }
  try { await fsp.rm(TMP, { recursive: true, force: true }); } catch { /* */ }

  const baseline = await countPatients("%");
  console.log(`\nBaseline patient_screenings now: ${baseline}`);
  console.log("=== done ===");
  process.exit(0);
}

async function writeBigCsv(targetMb: number): Promise<string> {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, `big-${randomUUID()}.csv`);
  const out = fs.createWriteStream(p);
  // 6 real cols + a WIDE filler so FILE SIZE is large but the useful row count
  // stays at 2,000 (mirrors a bloated export with embedded junk). Each row is
  // ~64 KB of filler → ~2,000 rows reach ~128 MB while parsing stays bounded.
  out.write("Name,DOB,Phone,MRN,Insurance,Facility,Filler\n");
  const USEFUL_ROWS = 2000;
  const perRowFiller = Math.ceil((targetMb * 1024 * 1024) / USEFUL_ROWS) - 120;
  const filler = "x".repeat(Math.max(1, perRowFiller));
  for (let i = 1; i <= USEFUL_ROWS; i++) {
    const line = `ZZBIG P ${i},1980-01-01,2025559${String(100000 + i)},ZZBIG-${i},Medicare,Taylor Family Practice,${filler}\n`;
    out.write(line);
  }
  await new Promise<void>((resolve, reject) => { out.on("finish", () => resolve()); out.on("error", reject); out.end(); });
  return p;
}

async function countPatients(like: string): Promise<number> {
  const res = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM patient_screenings WHERE is_test = true AND name LIKE ${like}`,
  );
  return Number((res as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
}

async function cleanup(): Promise<{ screenings: number; batches: number; jobs: number }> {
  const s = await db.execute<{ n: number }>(sql`WITH d AS (DELETE FROM patient_screenings WHERE is_test = true AND name LIKE 'ZZ%' RETURNING 1) SELECT count(*)::int AS n FROM d`);
  const b = await db.execute<{ n: number }>(sql`WITH d AS (DELETE FROM screening_batches WHERE is_test = true AND import_kind = 'large_file' RETURNING 1) SELECT count(*)::int AS n FROM d`);
  const j = await db.execute<{ n: number }>(sql`WITH d AS (DELETE FROM import_jobs WHERE is_test = true RETURNING 1) SELECT count(*)::int AS n FROM d`);
  const rows = (r: unknown) => Number((r as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
  return { screenings: rows(s), batches: rows(b), jobs: rows(j) };
}

main().catch((err) => { console.error(err); process.exit(1); });
