process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";
import assert from "node:assert/strict";
import { identitySummary, projectDocumentPatientIdentity } from "../../shared/documentPatientIdentity";
import { runWithDb, type TableSpec } from "../support/canonicalHarness";
import { patientScreenings } from "../../shared/schema/screening";
import { ancillaryDocumentReferences } from "../../shared/schema/ancillaryDocuments";
import { patientAncillaryCases } from "../../shared/schema/ancillaryCases";
import { storage } from "../../server/storage";
import { registerGeneratedNotesRoutes } from "../../server/routes/generatedNotes";
import { registerAncillaryDocumentsRoutes } from "../../server/routes/ancillaryDocuments";

function row(id: number, clinicId = 1) {
  return { screeningId: id, clinicId, batchId: 9, globalPatientId: id + 100, membershipId: id + 200,
    membership: { clinicId, globalPlexusPatientId: id + 100, membershipStatus: "active", clinicMrn: `MRN-${id}` },
    patient: { id: id + 100, dob: "1980-04-04", plexusId: `PLX-TEST-${id}`, identityStatus: "active" } };
}
const verified = projectDocumentPatientIdentity(row(1));
assert.deepEqual(verified, { mrn: "MRN-1", dob: "1980-04-04", plexusId: "PLX-TEST-1", status: "verified" });
for (const changed of [
  { ...row(1), membership: null },
  { ...row(1), membership: { ...row(1).membership, clinicId: 2 } },
  { ...row(1), globalPatientId: 222 },
  { ...row(1), patient: { ...row(1).patient, identityStatus: "merged" } },
  { ...row(1), membership: { ...row(1).membership, membershipStatus: "inactive" } },
]) {
  assert.deepEqual(projectDocumentPatientIdentity(changed), { mrn: null, dob: null, plexusId: null, status: "stale" });
}
const absent = projectDocumentPatientIdentity({ clinicId: 1, globalPatientId: null, membership: null, patient: null });
assert.equal(identitySummary(absent), "DOB: Unavailable · MRN: Unavailable · Plexus ID: Unavailable");
assert.equal(identitySummary(), "Patient identity unavailable");
const local = projectDocumentPatientIdentity({ clinicId: 1, globalPatientId: null, membership: null, patient: null,
  screeningDob: "1970-01-01", screeningMrn: "REAL-MRN" });
assert.equal(local.plexusId, null);
assert.equal(local.mrn, "REAL-MRN");
assert.equal(local.dob, "1970-01-01");

const routes: Record<string, any> = {};
const app: any = { get(path: string, ...handlers: any[]) { routes[path] = handlers.at(-1); }, post() {}, delete() {} };
registerGeneratedNotesRoutes(app);
registerAncillaryDocumentsRoutes(app);
function response() {
  return { statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; } };
}
const notes = [1, 2, 3, 4, 5].map(id => ({ id, patientId: id, patientName: "Same Name", batchId: 9,
  clinicId: id === 5 ? 2 : 1, facility: "Clinic", sections: [{ heading: "Signed content", body: "Preserve" }] }));
const original = storage.getAllGeneratedNotes;
storage.getAllGeneratedNotes = async () => notes as any;
try {
  const rows = [row(1), row(2), row(3, 2), { ...row(4), batchId: 10 }, row(5)];
  const spec = new Map<unknown, TableSpec>([[patientScreenings, { select: () => rows }]]);
  const res = response();
  const snapshot = JSON.stringify(notes);
  await runWithDb(spec, {}, async fake => {
    await routes["/api/generated-notes"]({ tenant: { kind: "clinic", clinicId: 1 } }, res);
    assert(fake.every(c => c.op === "select"), "identity reads must not mutate signed records or create patients");
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.map((n: any) => n.patientId), [1, 2]);
  assert.notEqual(res.body[0].patientIdentity.mrn, res.body[1].patientIdentity.mrn, "identical names remain distinct");
  assert.equal(JSON.stringify(notes), snapshot, "stored content unchanged");
  for (const tenant of [undefined, { kind: "denied", reason: "no_clinic_assigned" }]) {
    const denied = response();
    await routes["/api/generated-notes"]({ tenant }, denied);
    assert.equal(denied.statusCode, 403);
  }
  const ref = { id: 10, clinicId: 1, ancillaryCaseId: 8, patientScreeningId: 1, globalPlexusPatientId: 101,
    serviceType: "BrainWave", sourceId: 10, sourceTable: "documents", documentKind: "report", sourceSystem: "test",
    actualCreatedAt: new Date("2026-10-09T12:00:00Z"), effectiveClinicalDate: null, signedAt: null, supersededAt: null,
    documentStatus: "signed", metadata: {} };
  for (const scenario of [
    { globalPlexusPatientId: 101, caseMembershipId: 201, clinicId: 1, expected: "verified" },
    { globalPlexusPatientId: 999, caseMembershipId: 201, clinicId: 1, expected: "stale" },
    { globalPlexusPatientId: 101, caseMembershipId: 999, clinicId: 1, expected: "stale" },
    { globalPlexusPatientId: 101, caseMembershipId: 201, clinicId: 2, expected: "stale" },
  ]) {
    const { globalPlexusPatientId } = scenario;
    const canonical = response();
    const canonicalSpec = new Map<unknown, TableSpec>([
      [patientScreenings, { select: () => [row(1, scenario.clinicId)] }],
      [patientAncillaryCases, { select: () => [{ id: 8, clinicId: 1, globalPatientId: 101, membershipId: scenario.caseMembershipId }] }],
      [ancillaryDocumentReferences, { select: () => [{ ...ref, globalPlexusPatientId }] }],
    ]);
    await runWithDb(canonicalSpec, { unifiedAncillaryDocuments: true }, async fake => {
      await routes["/api/ancillary-documents"]({ clinicId: 1, query: {} }, canonical);
      assert(fake.every(c => c.op === "select"));
    });
    assert.equal(canonical.statusCode, 200);
    assert.equal(canonical.body.items[0].patientIdentity.status, scenario.expected);
    assert.equal(canonical.body.items[0].documentStatus, "signed");
    if (scenario.expected === "stale") assert.equal(canonical.body.items[0].patientIdentity.plexusId, null);
  }
} finally { storage.getAllGeneratedNotes = original; }
const { buildWorkspaceModel } = await import("../../client/src/pages/documents");
const model = buildWorkspaceModel([
  { ...notes[0], patientIdentity: verified, service: "BrainWave", scheduleDate: null },
  { ...notes[1], patientIdentity: { ...verified, mrn: "MRN-2" }, service: "BrainWave", scheduleDate: null },
] as any);
assert.equal(model[0].patients.length, 2, "same-name patients must not collapse in the UI");
assert.equal(model[0].patients[0].patientIdentity?.mrn, "MRN-1");
assert.equal(model[0].patients[1].patientIdentity?.mrn, "MRN-2");
console.log("ancillaryDocumentPatientIdentity: all checks passed");
