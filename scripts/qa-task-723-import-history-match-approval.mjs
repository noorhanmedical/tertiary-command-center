// QA — task #723: Patient Directory import history, smart profile
// matching & admin approval.
//
// Spins up a side server instance with USE_PATIENT_DIRECTORY_ACTIVATION=1
// on a scratch port, seeds temp admin + scheduler users, then exercises:
//   1. full-field import preview/confirm (regression — must keep working)
//   2. minimal-field preview → fuzzy match candidates (score >= 0.75, <= 3)
//   3. non-admin confirm without submitForApproval → 403 IMPORT_APPROVAL_REQUIRED
//   4. non-admin submitForApproval → pending batch with payload
//   5. GET /import-batches shows both batches ("Waiting for approval" data)
//   6. admin commit of pending batch with approvedMatches → visit/procedure
//      linked events on the existing profile, no duplicate rows
//   7. non-admin DELETE import batch → 403; admin DELETE → soft-deletes rows,
//      batch leaves the list, batch_deleted event written
// Cleans up all temp rows at the end.
//
// Run: node scripts/qa-task-723-import-history-match-approval.mjs

import { spawn } from "node:child_process";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const PORT = 5123;
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const TAG = `qa723_${Date.now()}`;
const ADMIN = { id: randomUUID(), username: `${TAG}_admin`, password: "Passw0rd!qa", role: "admin" };
const SCHED = { id: randomUUID(), username: `${TAG}_sched`, password: "Passw0rd!qa", role: "scheduler" };

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

async function seedUsers() {
  const hash = await bcrypt.hash(ADMIN.password, 12);
  for (const u of [ADMIN, SCHED]) {
    await pool.query(
      `INSERT INTO users (id, username, password, role) VALUES ($1,$2,$3,$4)`,
      [u.id, u.username, hash, u.role],
    );
  }
}

async function seedExistingPatient() {
  const b = await pool.query(
    `INSERT INTO screening_batches (name, schedule_date, status, patient_count) VALUES ($1, CURRENT_DATE::text, 'draft', 1) RETURNING id`,
    [`${TAG}_seed_batch`],
  );
  const batchId = b.rows[0].id;
  const p = await pool.query(
    `INSERT INTO patient_screenings (batch_id, name, dob, facility) VALUES ($1,$2,$3,$4) RETURNING id`,
    [batchId, `${TAG} Johnathan Smithers`, "1955-03-02", "Plexus Cary"],
  );
  const p2 = await pool.query(
    `INSERT INTO patient_screenings (batch_id, name, dob, facility) VALUES ($1,$2,$3,$4) RETURNING id`,
    [batchId, `${TAG} Marguerite Delacroix`, "1948-11-20", "Plexus Cary"],
  );
  return { batchId, patientId: p.rows[0].id, patientId2: p2.rows[0].id };
}

async function login(user) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });
  if (!res.ok) throw new Error(`login ${user.username} failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("no session cookie");
  return cookie;
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    if (serverReady) {
      try {
        const res = await fetch(`${BASE}/api/health`);
        if (res.status < 600) return;
      } catch { /* listening not yet accepting */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

async function cleanup() {
  await pool.query(`DELETE FROM patient_directory_events WHERE payload::text LIKE '%${TAG}%' OR related_entity_id IN (SELECT id FROM screening_batches WHERE name LIKE '%${TAG}%' OR name LIKE 'Service Import%' AND created_at > now() - interval '10 minutes')`).catch(() => {});
  await pool.query(`DELETE FROM patient_directory_events WHERE patient_screening_id IN (SELECT id FROM patient_screenings WHERE name LIKE '${TAG}%')`).catch(() => {});
  await pool.query(`DELETE FROM patient_screenings WHERE name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM patient_directory_events WHERE related_entity_type = 'screening_batch' AND related_entity_id IN (SELECT id FROM screening_batches WHERE import_created_by IN ($1,$2) OR name LIKE '${TAG}%')`, [ADMIN.id, SCHED.id]).catch(() => {});
  await pool.query(`DELETE FROM patient_screenings WHERE batch_id IN (SELECT id FROM screening_batches WHERE import_created_by IN ($1,$2))`, [ADMIN.id, SCHED.id]);
  await pool.query(`DELETE FROM screening_batches WHERE import_created_by IN ($1,$2) OR name LIKE '${TAG}%'`, [ADMIN.id, SCHED.id]);
  await pool.query(`DELETE FROM session WHERE sess::text LIKE '%${ADMIN.id}%' OR sess::text LIKE '%${SCHED.id}%'`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [ADMIN.id, SCHED.id]);
}

const server = spawn("npx", ["tsx", "server/index.ts"], {
  env: { ...process.env, PORT: String(PORT), USE_PATIENT_DIRECTORY_ACTIVATION: "1", NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverReady = false;
server.stdout.on("data", (d) => { const s = String(d); if (s.includes("serving on port")) serverReady = true; });
server.stderr.on("data", (d) => { const s = String(d); if (s.includes("Error") || s.includes("error")) console.error("[server]", s.slice(0, 400)); });
server.on("exit", (code) => { if (!serverReady) console.error(`[server] exited early with code ${code}`); });

try {
  await seedUsers();
  const seed = await seedExistingPatient();
  await waitForServer(server);
  const adminCookie = await login(ADMIN);
  const schedCookie = await login(SCHED);

  // ── 1. Full-field import (regression) ─────────────────────────────
  console.log("\n1. Full-field import (existing two-step flow)");
  const fullCsv = `name,dob,phone,facility\n${TAG} Maria Fullfield,1960-01-15,9195550142,Plexus Cary`;
  const prevFull = await api(adminCookie, "POST", "/api/patient-directory/import-preview", { format: "csv", text: fullCsv });
  check("preview 200", prevFull.status === 200);
  check("minimal=false for full-field", prevFull.json?.minimal === false);
  check("sourceFields detected", JSON.stringify(prevFull.json?.sourceFields) === JSON.stringify(["name", "dob", "phoneNumber", "facility"]), JSON.stringify(prevFull.json?.sourceFields));
  const confFull = await api(adminCookie, "POST", "/api/patient-directory/import-confirm", {
    selected: prevFull.json.rows.map((r) => ({ identity: r.identity })),
    sourceFields: prevFull.json.sourceFields,
    importKind: "full",
    batchName: `${TAG} full batch`,
  });
  check("confirm 200", confFull.status === 200, JSON.stringify(confFull.json));
  check("1 created", confFull.json?.createdIds?.length === 1);
  const fullBatchId = confFull.json?.batchId;
  check("auto-created batchId", Number(fullBatchId) > 0);

  // ── 2. Minimal-field preview → fuzzy matching ─────────────────────
  console.log("\n2. Minimal-field preview (name + DOS + procedure)");
  const minCsv = `patient,date of service,procedure\n${TAG} Jonathan Smithers,2026-06-20,Echocardiogram TTE\n${TAG} Zebulon Nomatch,2026-06-21,VitalWave\n${TAG} Margarite Delacroix,2026-06-22,BrainWave`;
  const prevMin = await api(schedCookie, "POST", "/api/patient-directory/import-preview", { format: "csv", text: minCsv });
  check("preview 200", prevMin.status === 200);
  check("minimal=true", prevMin.json?.minimal === true);
  const row0 = prevMin.json?.rows?.[0];
  const row1 = prevMin.json?.rows?.[1];
  const row2 = prevMin.json?.rows?.[2];
  check("row0 has fuzzy candidate (Johnathan≈Jonathan)", (row0?.matchCandidates?.length ?? 0) >= 1, JSON.stringify(row0?.matchCandidates));
  check("row2 has fuzzy candidate (Marguerite≈Margarite)", (row2?.matchCandidates?.length ?? 0) >= 1, JSON.stringify(row2?.matchCandidates));
  check("row2 candidate is 2nd seeded patient", row2?.matchCandidates?.[0]?.patientScreeningId === seed.patientId2);
  check("candidate is the seeded patient", row0?.matchCandidates?.[0]?.patientScreeningId === seed.patientId);
  check("score >= 0.75", (row0?.matchCandidates?.[0]?.score ?? 0) >= 0.75, String(row0?.matchCandidates?.[0]?.score));
  check("<= 3 candidates", (row0?.matchCandidates?.length ?? 0) <= 3);
  check("row1 no candidates", (row1?.matchCandidates?.length ?? 0) === 0);
  check("extras carried (DOS)", row0?.extras?.dateOfService === "2026-06-20", JSON.stringify(row0?.extras));
  check("extras carried (procedure)", row0?.extras?.procedure === "Echocardiogram TTE");

  // ── 3. Non-admin direct commit → 403 ──────────────────────────────
  console.log("\n3. Non-admin direct commit blocked");
  const forbidden = await api(schedCookie, "POST", "/api/patient-directory/import-confirm", {
    importKind: "service",
    sourceFields: prevMin.json.sourceFields,
    selected: [{ identity: row1.identity, extras: row1.extras }],
    approvedMatches: [{ importRowIndex: 0, existingPatientId: seed.patientId }],
  });
  check("403", forbidden.status === 403, String(forbidden.status));
  check("code IMPORT_APPROVAL_REQUIRED", forbidden.json?.code === "IMPORT_APPROVAL_REQUIRED");

  // ── 4. Non-admin submit for approval ──────────────────────────────
  console.log("\n4. Non-admin submit-for-approval");
  const submitted = await api(schedCookie, "POST", "/api/patient-directory/import-confirm", {
    importKind: "service",
    sourceFields: prevMin.json.sourceFields,
    selected: [],
    submitForApproval: true,
    previewRows: prevMin.json.rows,
    batchName: `${TAG} service pending`,
  });
  check("200", submitted.status === 200, JSON.stringify(submitted.json));
  check("pending=true", submitted.json?.pending === true);
  check("nothing created", submitted.json?.createdIds?.length === 0);
  const pendingBatchId = submitted.json?.batchId;
  const liveRows = await pool.query(`SELECT count(*)::int AS n FROM patient_screenings WHERE batch_id = $1`, [pendingBatchId]);
  check("no patient rows written", liveRows.rows[0].n === 0);

  // ── 4b. Bypass attempts on the pending batch (authorization) ──────
  console.log("\n4b. Non-admin bypass attempts blocked (server-side batch state)");
  const bypassFull = await api(schedCookie, "POST", "/api/patient-directory/import-confirm", {
    batchId: pendingBatchId,
    importKind: "full",
    sourceFields: ["name", "dob"],
    selected: [{ rowIndex: 0, identity: { name: `${TAG} Bypass Attempt`, dob: "1970-01-01" } }],
  });
  check("relabel-as-full commit → 403", bypassFull.status === 403, String(bypassFull.status));
  check("code IMPORT_APPROVAL_REQUIRED", bypassFull.json?.code === "IMPORT_APPROVAL_REQUIRED");
  const bypassResubmit = await api(schedCookie, "POST", "/api/patient-directory/import-confirm", {
    batchId: pendingBatchId,
    importKind: "full",
    sourceFields: ["name"],
    selected: [],
    submitForApproval: true,
    previewRows: [],
  });
  check("re-submit tamper on pending batch → 403", bypassResubmit.status === 403, String(bypassResubmit.status));
  const bypassRows = await pool.query(`SELECT count(*)::int AS n FROM patient_screenings WHERE batch_id = $1`, [pendingBatchId]);
  check("still no rows in pending batch", bypassRows.rows[0].n === 0);
  const payloadIntact = await pool.query(`SELECT pending_import_payload IS NOT NULL AS p FROM screening_batches WHERE id = $1`, [pendingBatchId]);
  check("pending payload untouched", payloadIntact.rows[0].p === true);
  const bogusBatch = await api(adminCookie, "POST", "/api/patient-directory/import-confirm", {
    batchId: 99999999,
    importKind: "full",
    sourceFields: ["name", "dob"],
    selected: [],
  });
  check("nonexistent batchId → 404", bogusBatch.status === 404, String(bogusBatch.status));

  // ── 5. Recent imports list ────────────────────────────────────────
  console.log("\n5. GET /import-batches");
  const list = await api(schedCookie, "GET", "/api/patient-directory/import-batches");
  check("200", list.status === 200);
  const pendingEntry = list.json?.batches?.find((b) => b.id === pendingBatchId);
  const fullEntry = list.json?.batches?.find((b) => b.id === fullBatchId);
  check("pending batch listed", !!pendingEntry);
  check("non-admin sees pending flag", pendingEntry?.pending === true);
  check("non-admin does NOT see pendingPayload", pendingEntry?.pendingPayload == null, JSON.stringify(pendingEntry?.pendingPayload)?.slice(0, 120));
  check("full batch listed with names", !!fullEntry && fullEntry.patientNames.some((n) => n.includes("Maria Fullfield")));
  check("full batch createdBy username", fullEntry?.createdByUsername === ADMIN.username);
  const adminList = await api(adminCookie, "GET", "/api/patient-directory/import-batches");
  const adminPendingEntry = adminList.json?.batches?.find((b) => b.id === pendingBatchId);
  check("admin sees pendingPayload", !!adminPendingEntry?.pendingPayload);
  check("submittedBy username recorded (admin view)", adminPendingEntry?.pendingPayload?.submittedByUsername === SCHED.username);

  // ── 6. Admin commit of pending batch with approvedMatches ─────────
  // Row 0 (Jonathan) → approved link; row 1 (Zebulon) → new profile;
  // row 2 (Margarite, matched) → SKIPPED by the admin — must be omitted
  // from both `selected` and `approvedMatches` and produce nothing.
  console.log("\n6. Admin approve & commit (with one matched row skipped)");
  const beforeCount = (await pool.query(`SELECT count(*)::int AS n FROM patient_screenings WHERE deleted_at IS NULL`)).rows[0].n;
  const commit = await api(adminCookie, "POST", "/api/patient-directory/import-confirm", {
    batchId: pendingBatchId,
    importKind: "service",
    sourceFields: prevMin.json.sourceFields,
    selected: [{ rowIndex: 1, identity: row1.identity, extras: row1.extras }],
    approvedMatches: [{ importRowIndex: 0, existingPatientId: seed.patientId, dateOfService: "2026-06-20", procedure: "Echocardiogram TTE", name: row0.identity.name }],
  });
  check("200", commit.status === 200, JSON.stringify(commit.json));
  check("1 created (Zebulon)", commit.json?.createdIds?.length === 1);
  check("1 linked", commit.json?.linked?.length === 1);
  check("linked eventKind procedure_linked", commit.json?.linked?.[0]?.eventKind === "procedure_linked");
  const afterCount = (await pool.query(`SELECT count(*)::int AS n FROM patient_screenings WHERE deleted_at IS NULL`)).rows[0].n;
  check("exactly 1 new row (skipped matched row created nothing)", afterCount === beforeCount + 1, `${beforeCount} -> ${afterCount}`);
  const skippedEvt = await pool.query(
    `SELECT 1 FROM patient_directory_events WHERE patient_screening_id = $1 AND kind IN ('visit_linked','procedure_linked')`,
    [seed.patientId2],
  );
  check("skipped matched row produced NO link event", skippedEvt.rows.length === 0);
  const skippedDup = await pool.query(
    `SELECT count(*)::int AS n FROM patient_screenings WHERE name ILIKE '%Margarite Delacroix%' AND deleted_at IS NULL`,
  );
  check("skipped matched row produced NO new profile", skippedDup.rows[0].n === 0, String(skippedDup.rows[0].n));
  const linkEvt = await pool.query(
    `SELECT kind, payload FROM patient_directory_events WHERE patient_screening_id = $1 AND kind = 'procedure_linked'`,
    [seed.patientId],
  );
  check("procedure_linked event on existing profile", linkEvt.rows.length === 1, JSON.stringify(linkEvt.rows));
  check("event payload has DOS", linkEvt.rows[0]?.payload?.dateOfService === "2026-06-20");
  const pendingCleared = await pool.query(`SELECT pending_import_payload FROM screening_batches WHERE id = $1`, [pendingBatchId]);
  check("pending payload cleared", pendingCleared.rows[0].pending_import_payload === null);
  const list2 = await api(adminCookie, "GET", "/api/patient-directory/import-batches");
  const entry2 = list2.json?.batches?.find((b) => b.id === pendingBatchId);
  check("batch no longer pending in list", entry2?.pending === false);

  // ── 7. Delete import batch ────────────────────────────────────────
  console.log("\n7. DELETE import batch");
  const delForbidden = await api(schedCookie, "DELETE", `/api/patient-directory/import-batches/${fullBatchId}`);
  check("non-admin delete → 403", delForbidden.status === 403);
  const del = await api(adminCookie, "DELETE", `/api/patient-directory/import-batches/${fullBatchId}`);
  check("admin delete 200", del.status === 200, JSON.stringify(del.json));
  check("1 row soft-deleted", del.json?.affected === 1);
  const softDel = await pool.query(`SELECT deleted_at, delete_expires_at, delete_reason FROM patient_screenings WHERE batch_id = $1`, [fullBatchId]);
  check("deleted_at set + 14d expiry", softDel.rows.every((r) => r.deleted_at != null && r.delete_expires_at != null));
  const delEvt = await pool.query(`SELECT 1 FROM patient_directory_events WHERE kind = 'batch_deleted' AND related_entity_id = $1`, [fullBatchId]);
  check("batch_deleted event", delEvt.rows.length === 1);
  const list3 = await api(adminCookie, "GET", "/api/patient-directory/import-batches");
  check("deleted batch gone from list", !list3.json?.batches?.some((b) => b.id === fullBatchId));

  console.log(failures === 0 ? "\n🎉 ALL CHECKS PASSED" : `\n💥 ${failures} CHECK(S) FAILED`);
} catch (e) {
  failures++;
  console.error("FATAL:", e);
} finally {
  server.kill("SIGTERM");
  await cleanup().catch((e) => console.error("cleanup error:", e.message));
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}
