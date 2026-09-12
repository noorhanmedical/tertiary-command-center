// Integration test: bulk-import global column-mapping correction + per-row
// override. Synthetic; cleaned up. npx tsx --env-file=.env script/testBulkMappingCorrection.ts
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { randomUUID } from "node:crypto";
import { db } from "../server/db"; import { sql } from "drizzle-orm";
import { createImportJob, getImportJob, updateImportJob } from "../server/repositories/importJobs.repo";
import { runAnalysis } from "../server/services/largeImport/importJobRunner";
import { parseLargeFile } from "../server/services/largeImport/streamingParsers";

let pass = 0, fail = 0;
const check = (c: boolean, m: string) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };

async function main() {
  const TMP = path.join(os.tmpdir(), "zzmap"); fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, randomUUID() + ".csv");
  // "Account #" and "Medical Record #" BOTH auto-map to mrn → auto-detect
  // (first-wins) wrongly picks Account #. Manager will correct it.
  fs.writeFileSync(p,
    "Name,DOB,Account #,Medical Record #,Facility\n" +
    "ZZMAP Alice,1980-01-01,883912,221944,Taylor Family Practice\n" +
    "ZZMAP Bob,1975-02-02,111111,222222,Taylor Family Practice\n");

  const job = await createImportJob({ clinicId: 1, status: "uploaded", kind: "large_file", fileFormat: "csv", tempPath: p, facility: "Taylor Family Practice", isTest: true } as never);

  // 1) initial auto-detect maps Account # → mrn (the wrong column)
  await runAnalysis(job.id);
  const auto = await parseLargeFile(p, "csv", {});
  check(auto.rows[0].mrn === "883912", `auto-detect wrongly maps Account # to MRN (got ${auto.rows[0].mrn})`);

  // 2) manager global correction: ignore Account #, map Medical Record # → mrn
  await updateImportJob(job.id, { columnOverrides: { "Account #": "ignore", "Medical Record #": "mrn" } as never });
  await runAnalysis(job.id);
  const j2 = await getImportJob(job.id);
  const corrected = await parseLargeFile(p, "csv", { columnOverrides: (j2!.columnOverrides ?? {}) as never });
  check(corrected.rows[0].mrn === "221944", `global correction re-maps MRN to Medical Record # (got ${corrected.rows[0].mrn})`);
  check(corrected.rows[1].mrn === "222222", "correction applies to ALL rows");
  check(j2!.status === "preview_ready", "job returns to preview_ready after re-analysis");

  // 3) per-row override wins for that row only
  await updateImportJob(job.id, { rowOverrides: { "1": { mrn: "ROWFIX" } } as never });
  const j3 = await getImportJob(job.id);
  const withRow = await parseLargeFile(p, "csv", { columnOverrides: (j3!.columnOverrides ?? {}) as never, rowOverrides: (j3!.rowOverrides ?? {}) as never });
  check(withRow.rows[0].mrn === "ROWFIX", "row override wins for row 1");
  check(withRow.rows[1].mrn === "222222", "row override does NOT affect other rows");

  // 4) NO patients written before confirm
  const cnt = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM patient_screenings WHERE name LIKE 'ZZMAP%'`);
  check(Number((cnt as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0) === 0, "no patients written before confirmation");

  // cleanup
  await db.execute(sql`DELETE FROM import_jobs WHERE id=${job.id}`);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
