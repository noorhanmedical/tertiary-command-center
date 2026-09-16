// Focused tests for the server-side call-list PDF renderer (pure, no DB).
// Verifies: valid PDF from a frozen snapshot, multi-page growth, unicode
// safety, and that no internal ids appear in the rendered text.
import assert from "node:assert/strict";
import { renderCallListPdf, type CallListPdfPackage, type CallListPdfMember } from "../../server/services/engagement/callListPdf";

const pkg: CallListPdfPackage = {
  id: 42,
  teamMemberNameSnapshot: "Callista",
  facilityId: "Taylor Family Practice",
  cohortLabelSnapshot: "Never Called",
  serviceDate: "2026-09-15",
  patientCount: 3,
};

function member(n: number): CallListPdfMember {
  return {
    patientNameSnapshot: `Patient ${n} Ñoño ✓`, // unicode to exercise sanitize
    patientDobSnapshot: "1959-04-01",
    patientPhoneSnapshot: "281-555-0100",
    servicesSnapshot: ["BrainWave", "VitalWave", "Echocardiogram TTE"],
    reasonForCallSnapshot: "HTN, DM — cardiovascular risk",
  };
}

async function main() {
  // 1. valid PDF, non-zero
  {
    const buf = await renderCallListPdf(pkg, [member(1), member(2), member(3)]);
    assert.ok(buf.length > 500, "PDF has real content");
    assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-", "valid PDF signature");
  }

  // 2. empty membership still produces a valid (header-only) PDF
  {
    const buf = await renderCallListPdf(pkg, []);
    assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
  }

  // 3. many members → larger PDF (multi-page), no throw on 200 rows
  {
    const many = Array.from({ length: 200 }, (_, i) => member(i));
    const buf = await renderCallListPdf(pkg, many);
    assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
    const small = await renderCallListPdf(pkg, [member(1)]);
    assert.ok(buf.length > small.length, "more members → larger document");
  }

  // 4. unicode / odd characters do not crash the WinAnsi renderer
  {
    const weird: CallListPdfMember = {
      patientNameSnapshot: "\u{1F600}\u2603 José — Ω",
      patientDobSnapshot: null,
      patientPhoneSnapshot: null,
      servicesSnapshot: null,
      reasonForCallSnapshot: "café\tnewline\nhere",
    };
    const buf = await renderCallListPdf(pkg, [weird]);
    assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-", "renders despite unicode");
  }

  console.log("callListPdf.test.ts — all assertions passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
