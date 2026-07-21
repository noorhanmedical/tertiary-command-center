// Physician-facing PDF hotfix spec assertions:
// no Run language, canonical titles/filenames, no browser artifacts,
// Patient ID (PS-<patientScreeningId>) on every patient section,
// no MRN fabrication, identifier parity between Clinician and Plexus
// output, preview/download parity, clinical content intact.
import { describe, it, expect } from "vitest";
import type { PatientScreening } from "@shared/schema";
import {
  stripRunLanguage,
  buildPhysicianReportTitles,
  buildClinicianPdfBody,
  buildPlexusPdfBody,
  buildPatientDemoBlock,
  extractRealMrn,
} from "../pdfGeneration";

const RUN_RE = /\bRun\s*\d+\b|\(\s*Run\b/i;

function fakePatient(id: number, name: string): PatientScreening {
  return {
    id,
    batchId: 1,
    time: "9:00 AM",
    name,
    age: 71,
    gender: "F",
    dob: "1955-03-02",
    phoneNumber: "555-0101",
    email: null,
    insurance: "Medicare",
    facility: "Taylor Family Practice",
    diagnoses: "HTN, T2DM",
    history: "CVA 2019",
    medications: "Lisinopril",
    previousTests: null,
    previousTestsDate: null,
    noPreviousTests: true,
    notes: null,
    qualifyingTests: ["BrainWave", "Bilateral Carotid Duplex (93880)"],
    reasoning: {
      BrainWave: {
        clinician_understanding: "Cognitive risk factors present.",
        patient_talking_points: "This checks brain function.",
        qualifying_factors: ["CVA history"],
      },
    },
    cooldownTests: null,
    status: "completed",
    appointmentStatus: "pending",
    patientType: "visit",
    commitStatus: "Draft",
    committedAt: null,
    committedByUserId: null,
    deletedAt: null,
    deletedByUserId: null,
    deleteExpiresAt: null,
    deleteReason: null,
    adminApprovalStatus: "pending",
    adminApprovedAt: null,
    adminApprovedByUserId: null,
    adminApprovalNote: null,
    createdAt: new Date("2026-07-20T12:00:00Z"),
    isTest: false,
  } as unknown as PatientScreening;
}

const BATCH = "Taylor Family Practice - 2026-07-20 (Run 2)";
const PATIENTS = [fakePatient(101, "Smith, Alice"), fakePatient(202, "Jones, Bob")];

describe("stripRunLanguage", () => {
  it("strips (Run N) suffixes and variants", () => {
    expect(stripRunLanguage(BATCH)).toBe("Taylor Family Practice - 2026-07-20");
    expect(stripRunLanguage("Clinic - 2026-01-01 (run 3)")).toBe("Clinic - 2026-01-01");
    expect(stripRunLanguage("Clinic - 2026-01-01 (Run)")).toBe("Clinic - 2026-01-01");
    expect(stripRunLanguage("Clinic — Run 4")).toBe("Clinic");
  });
  it("leaves ordinary names untouched", () => {
    expect(stripRunLanguage("Taylor Family Practice - 2026-07-20")).toBe(
      "Taylor Family Practice - 2026-07-20",
    );
  });
});

describe("canonical titles and filenames", () => {
  it("builds the clinician title and filename without Run language", () => {
    const t = buildPhysicianReportTitles("clinician", BATCH);
    expect(t.docTitle).toBe("Clinician Report — Taylor Family Practice — July 20, 2026");
    expect(t.filenameBase).toBe("Clinician Report — Taylor Family Practice — 2026-07-20");
    expect(t.docTitle).not.toMatch(RUN_RE);
    expect(t.filenameBase).not.toMatch(RUN_RE);
  });
  it("builds the Plexus title and filename without Run language", () => {
    const t = buildPhysicianReportTitles("plexus", BATCH);
    expect(t.docTitle).toBe("Plexus Report — Taylor Family Practice — July 20, 2026");
    expect(t.filenameBase).toBe("Plexus Report — Taylor Family Practice — 2026-07-20");
  });
  it("falls back to scheduleDate when the batch name has no date", () => {
    const t = buildPhysicianReportTitles("clinician", "Taylor Family Practice (Run 2)", "2026-07-20");
    expect(t.filenameBase).toBe("Clinician Report — Taylor Family Practice — 2026-07-20");
  });
  it("is deterministic so preview and download titles match", () => {
    const a = buildPhysicianReportTitles("clinician", BATCH, "2026-07-20");
    const b = buildPhysicianReportTitles("clinician", BATCH, "2026-07-20");
    expect(a).toEqual(b);
  });
});

describe("clinician PDF body", () => {
  const body = buildClinicianPdfBody(BATCH, PATIENTS, "2026-07-20", null);

  it("contains no Run language", () => {
    expect(body).not.toMatch(RUN_RE);
  });
  it("contains no browser artifacts", () => {
    expect(body).not.toContain("about:blank");
    expect(body).not.toContain("Generated at");
  });
  it("shows Patient ID: PS-<id> for every patient", () => {
    expect(body).toContain("Patient ID: PS-101");
    expect(body).toContain("Patient ID: PS-202");
  });
  it("renders no MRN row when the patient has no real MRN", () => {
    expect(body).not.toMatch(/MRN/i);
    expect(body).not.toContain("MRN: N/A");
  });
  it("renders the real clinic MRN from BatchFlow import notes when present", () => {
    const withMrn = {
      ...fakePatient(303, "Hilton, Deann"),
      notes: "[plexus-iq-clinical-import]\nsource: plexus-iq-clinical-import\nrowIndex: 237\nMRN: e34811",
    } as unknown as PatientScreening;
    const b = buildClinicianPdfBody(BATCH, [withMrn], "2026-07-20", null);
    expect(b).toContain("MRN: e34811");
    expect(b).toContain("Patient ID: PS-303");
    const px = buildPlexusPdfBody(BATCH, [withMrn], "2026-07-20", null);
    expect(px).toContain("MRN: e34811");
  });
  it("keeps clinical content intact (Dx/Hx/Rx, insurance, facility)", () => {
    expect(body).toContain("HTN, T2DM");
    expect(body).toContain("CVA 2019");
    expect(body).toContain("Lisinopril");
    expect(body).toContain("Insurance: Medicare");
    expect(body).toContain("Facility: Taylor Family Practice");
  });
  it("renders one hard-break page per patient with the one-page class", () => {
    const pages = body.match(/class="page clinician-page"/g) ?? [];
    expect(pages.length).toBe(PATIENTS.length);
  });
});

describe("plexus PDF body", () => {
  const body = buildPlexusPdfBody(BATCH, PATIENTS, "2026-07-20", null);

  it("contains no Run language and no browser artifacts", () => {
    expect(body).not.toMatch(RUN_RE);
    expect(body).not.toContain("about:blank");
  });
  it("shows the same Patient ID as the clinician PDF for every patient", () => {
    const clinician = buildClinicianPdfBody(BATCH, PATIENTS, "2026-07-20", null);
    for (const p of PATIENTS) {
      const idLabel = `Patient ID: PS-${p.id}`;
      expect(body).toContain(idLabel);
      expect(clinician).toContain(idLabel);
    }
  });
  it("never labels the screening ID as MRN when no real MRN exists", () => {
    expect(body).not.toMatch(/MRN/i);
  });
  it("carries patient identity data attributes on plexus pages", () => {
    expect(body).toContain('data-patient-id="PS-101"');
    expect(body).toContain('data-patient-name="Smith, Alice"');
    expect(body).toContain('data-dob="1955-03-02"');
  });
});

describe("extractRealMrn", () => {
  it("pulls the MRN out of BatchFlow import notes", () => {
    expect(
      extractRealMrn({ notes: "[plexus-iq-clinical-import]\nsource: plexus-iq-clinical-import\nrowIndex: 238\nMRN: e37073" }),
    ).toBe("e37073");
    expect(extractRealMrn({ notes: "MRN: 25165" })).toBe("25165");
  });
  it("returns null for missing, empty, or placeholder MRNs", () => {
    expect(extractRealMrn({ notes: null })).toBeNull();
    expect(extractRealMrn({ notes: "" })).toBeNull();
    expect(extractRealMrn({ notes: "some free-text note" })).toBeNull();
    expect(extractRealMrn({ notes: "MRN: N/A" })).toBeNull();
    expect(extractRealMrn({ notes: "MRN: none" })).toBeNull();
    expect(extractRealMrn({ notes: "MRN: Not specified" })).toBeNull();
  });
});

describe("patient demo block", () => {
  it("leads with the Patient ID row", () => {
    const html = buildPatientDemoBlock(PATIENTS[0]);
    expect(html.indexOf("Patient ID: PS-101")).toBeGreaterThan(-1);
    expect(html.indexOf("Patient ID: PS-101")).toBeLessThan(html.indexOf("DOB:"));
    expect(html).not.toMatch(/MRN/i);
  });
});
