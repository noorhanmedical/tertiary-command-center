// Unit test for the shared packet-ordering helper.
import assert from "node:assert/strict";
import { orderPacketPatientsForDisplayAndPdf } from "../../client/src/lib/patientPacketOrdering";

async function main() {
  // Outreach raw: Zimmerman, Brown, Adams, Miller → A, B, M, Z.
  const outreach = orderPacketPatientsForDisplayAndPdf([
    { id: 1, name: "Zimmerman, Sara",  patientType: "outreach", time: null },
    { id: 2, name: "Brown, Kevin",     patientType: "outreach", time: null },
    { id: 3, name: "Adams, Carla",     patientType: "outreach", time: null },
    { id: 4, name: "Miller, Dawn",     patientType: "outreach", time: null },
  ]);
  assert.deepEqual(outreach.map((p) => p.name), [
    "Adams, Carla", "Brown, Kevin", "Miller, Dawn", "Zimmerman, Sara",
  ]);

  // Visit raw: 10:00, 8:30, 9:15 → 8:30, 9:15, 10:00.
  const visit = orderPacketPatientsForDisplayAndPdf([
    { id: 1, name: "Ten",   patientType: "visit", time: "2026-06-12T10:00:00Z" },
    { id: 2, name: "Eight", patientType: "visit", time: "2026-06-12T08:30:00Z" },
    { id: 3, name: "Nine",  patientType: "visit", time: "2026-06-12T09:15:00Z" },
  ]);
  assert.deepEqual(visit.map((p) => p.time), [
    "2026-06-12T08:30:00Z", "2026-06-12T09:15:00Z", "2026-06-12T10:00:00Z",
  ]);

  // Mixed: outreach alphabetical first, visit appointment time second.
  const mixed = orderPacketPatientsForDisplayAndPdf([
    { id: 1, name: "Visit-Z",    patientType: "visit",    time: "2026-06-12T10:00:00Z" },
    { id: 2, name: "Outreach-Z", patientType: "outreach", time: null },
    { id: 3, name: "Outreach-A", patientType: "outreach", time: null },
    { id: 4, name: "Visit-A",    patientType: "visit",    time: "2026-06-12T08:00:00Z" },
  ]);
  assert.deepEqual(mixed.map((p) => p.name), [
    "Outreach-A", "Outreach-Z", "Visit-A", "Visit-Z",
  ]);

  // Length-0 and length-1 pass through.
  assert.deepEqual(orderPacketPatientsForDisplayAndPdf([]), []);
  const one = orderPacketPatientsForDisplayAndPdf([{ id: 1, name: "Solo", patientType: "outreach", time: null }]);
  assert.equal(one.length, 1);

  // Helper never mutates the input.
  const input = [
    { id: 1, name: "Zimmerman, Sara", patientType: "outreach", time: null },
    { id: 2, name: "Adams, Carla",    patientType: "outreach", time: null },
  ];
  const snapshot = JSON.stringify(input);
  orderPacketPatientsForDisplayAndPdf(input);
  assert.equal(JSON.stringify(input), snapshot);

  console.log("Packet ordering helper test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
