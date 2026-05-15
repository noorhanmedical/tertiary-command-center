// Team Portal Patient Command Center QA.
//
// Run with: npm run qa:team-portal-command-center
//
// Verifies the read-model query layer + patient_communications repo
// against an active patient picked from the DB. We do not call HTTP
// routes (those need a live session); instead we exercise the
// underlying repository functions the route handlers use, so the
// canonical contract is covered without spinning up an app server.
//
// Skips gracefully when DATABASE_URL is missing.

if (!process.env.DATABASE_URL) {
  console.log(
    "[qa-team-portal-command-center] DATABASE_URL missing — skipping.",
  );
  process.exit(0);
}

let createdCommunicationId: number | null = null;

type Env = {
  db: typeof import("../server/db").db;
  storage: typeof import("../server/storage").storage;
  patientCommunications: typeof import("@shared/schema").patientCommunications;
  eq: typeof import("drizzle-orm").eq;
  createPatientCommunication: typeof import("../server/repositories/patientCommunications.repo").createPatientCommunication;
  listPatientCommunicationsByPatient: typeof import("../server/repositories/patientCommunications.repo").listPatientCommunicationsByPatient;
  getLatestPatientCommunication: typeof import("../server/repositories/patientCommunications.repo").getLatestPatientCommunication;
};

async function loadEnv(): Promise<Env> {
  const dbMod = await import("../server/db");
  const storageMod = await import("../server/storage");
  const schemaMod = await import("@shared/schema");
  const drizzleMod = await import("drizzle-orm");
  const repoMod = await import("../server/repositories/patientCommunications.repo");
  return {
    db: dbMod.db,
    storage: storageMod.storage,
    patientCommunications: schemaMod.patientCommunications,
    eq: drizzleMod.eq,
    createPatientCommunication: repoMod.createPatientCommunication,
    listPatientCommunicationsByPatient: repoMod.listPatientCommunicationsByPatient,
    getLatestPatientCommunication: repoMod.getLatestPatientCommunication,
  };
}

async function cleanup(env: Env | null) {
  if (!env || createdCommunicationId == null) return;
  try {
    await env.db
      .delete(env.patientCommunications)
      .where(env.eq(env.patientCommunications.id, createdCommunicationId));
  } catch (err) {
    console.error("[cleanup]", err);
  }
}

async function main() {
  let passes = 0;
  let failures = 0;
  const assert = (cond: unknown, label: string) => {
    if (cond) {
      passes++;
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.log(`  ✗ ${label}`);
    }
  };

  const env = await loadEnv();
  const { storage, createPatientCommunication, listPatientCommunicationsByPatient, getLatestPatientCommunication } = env;

  // Find an active patient_screening to test against.
  const allActive = await storage.getAllPatientScreenings();
  if (allActive.length === 0) {
    console.log(
      "[qa] No active patient_screenings in the DB — nothing to verify. Skipping.",
    );
    process.exit(0);
  }
  const target = allActive[0];
  console.log(`\n--- QA target: patient_screening #${target.id} (${target.name}) ---`);

  // Append a test communication.
  const created = await createPatientCommunication({
    patientScreeningId: target.id,
    communicationType: "internal_note",
    direction: "internal",
    status: "logged",
    summary: "[qa] team portal command-center smoke note",
    actorUserId: null,
    actorNameSnapshot: "qa-script",
    facility: target.facility ?? null,
    isTest: true,
  });
  createdCommunicationId = created.id;
  assert(typeof created.id === "number", "patient_communications insert returns id");
  assert(
    created.communicationType === "internal_note",
    "communicationType preserved",
  );
  assert(created.summary === "[qa] team portal command-center smoke note", "summary preserved");

  // List by patient.
  const rows = await listPatientCommunicationsByPatient(target.id, { limit: 10 });
  assert(rows.length > 0, "list returns rows");
  assert(rows.some((r) => r.id === created.id), "newly created row is in the list");

  // Latest.
  const latest = await getLatestPatientCommunication(target.id);
  assert(!!latest, "getLatestPatientCommunication returns row");
  if (latest) {
    assert(
      latest.id === created.id ||
        (latest.occurredAt ?? new Date()).getTime() >= (created.occurredAt ?? new Date()).getTime(),
      "latest is the most recent occurredAt",
    );
  }

  // Filter by type.
  const internalOnly = await listPatientCommunicationsByPatient(target.id, {
    types: ["internal_note"],
  });
  assert(
    internalOnly.every((r) => r.communicationType === "internal_note"),
    "type filter is honoured",
  );

  console.log(`\n=========================`);
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log(`=========================`);

  await cleanup(env);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
