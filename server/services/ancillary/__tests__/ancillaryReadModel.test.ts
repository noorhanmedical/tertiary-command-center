import assert from "node:assert/strict";
import {
  getAncillarySnapshot,
  isAncillaryReadModelEnabled,
  type AncillaryReadModelDeps,
} from "../ancillaryReadModel";

function makeDeps(overrides: Partial<AncillaryReadModelDeps> = {}): AncillaryReadModelDeps {
  return {
    async loadAppointment(_id) {
      return { id: 1, facility: "Plexus Cary", procedureStatus: "Scheduled", startsAt: "2026-07-01T10:00:00Z" };
    },
    async loadDocuments(_id) {
      return [];
    },
    ...overrides,
  };
}

async function main() {
  // Flag default-OFF.
  assert.equal(isAncillaryReadModelEnabled({}), false);
  assert.equal(isAncillaryReadModelEnabled({ USE_ANCILLARY_READ_MODEL: "0" }), false);
  assert.equal(isAncillaryReadModelEnabled({ USE_ANCILLARY_READ_MODEL: "1" }), true);
  assert.equal(isAncillaryReadModelEnabled({ USE_ANCILLARY_READ_MODEL: "true" }), true);
  assert.equal(isAncillaryReadModelEnabled({ USE_ANCILLARY_READ_MODEL: "yes" }), true);

  // Empty documents -> all three required kinds blocked.
  {
    const snap = await getAncillarySnapshot(42, makeDeps());
    assert.equal(snap.patientScreeningId, 42);
    assert.equal(snap.appointment.facility, "Plexus Cary");
    const blockerKinds = snap.blockers.map((b) => b.kind).sort();
    assert.deepEqual(blockerKinds, ["order_note", "post_procedure_note", "report"]);
  }

  // Some docs present.
  {
    const snap = await getAncillarySnapshot(43, makeDeps({
      async loadDocuments() {
        return [
          { kind: "report", present: true, latestAt: "2026-07-02T09:00:00Z" },
          { kind: "order_note", present: false, latestAt: null },
        ];
      },
    }));
    assert.deepEqual(snap.blockers.map((b) => b.kind).sort(), ["order_note", "post_procedure_note"]);
    assert.equal(snap.documents.length, 2);
  }

  // Null appointment falls back cleanly.
  {
    const snap = await getAncillarySnapshot(44, makeDeps({
      async loadAppointment() { return null; },
    }));
    assert.equal(snap.appointment.id, null);
    assert.equal(snap.appointment.facility, null);
  }

  console.log("Ancillary read-model test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
