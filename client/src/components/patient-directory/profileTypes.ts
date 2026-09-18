// Shared types + helpers for the EMR-style Patient EHR profile workspace.
// The canonical data source is GET /api/patients/database/:encodedKey, whose
// response shape is mirrored here as `DirectoryProfile`.

export type TestCooldown = {
  testName: string;
  lastDate: string;
  insuranceType: string;
  cooldownMonths: number;
  clearsAt: string;
  daysUntilClear: number;
  cleared: boolean;
  clinic: string | null;
  historyId: number;
};

export type DirectoryScreening = {
  id: number;
  batchId: number;
  batchName: string;
  facility: string | null;
  scheduleDate: string | null;
  createdAt: string;
  time: string | null;
  qualifyingTests: string[];
  appointmentStatus: string;
  patientType: string;
};

export type DirectoryGeneratedNote = {
  id: number;
  batchId: number;
  patientId: number;
  service: string;
  docKind: string;
  title: string;
  generatedAt: string;
  driveWebViewLink: string | null;
  facility: string | null;
  scheduleDate: string | null;
};

export type DirectoryProfile = {
  key: string;
  encodedKey: string;
  plexusId: string | null;
  identity: {
    name: string;
    dob: string | null;
    age: number | null;
    gender: string | null;
    phoneNumber: string | null;
    insurance: string | null;
    clinic: string;
  };
  clinical: {
    diagnoses: string | null;
    history: string | null;
    medications: string | null;
    notes: string | null;
  };
  testHistory: Array<{
    id: number;
    testName: string;
    dateOfService: string;
    insuranceType: string;
    clinic: string;
  }>;
  cooldowns: TestCooldown[];
  screenings: DirectoryScreening[];
  generatedNotes: DirectoryGeneratedNote[];
};

// The 8 AI-qualifying tests split into ancillary buckets so the header and the
// Plexus IQ tab can colour-code opportunities consistently with the rest of the
// app (BrainWave=purple, VitalWave=red, Ultrasounds=green).
export function testBucket(testName: string): "brainwave" | "vitalwave" | "ultrasound" {
  const n = testName.toLowerCase();
  if (n.includes("brainwave")) return "brainwave";
  if (n.includes("vitalwave")) return "vitalwave";
  return "ultrasound";
}

export function initials(name: string): string {
  return (
    name
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

// Canonical short date ("Oct 10, 1972"). Delegates to the platform formatter so
// the EHR never renders raw YYYY-MM-DD. Kept as a named export for existing
// callers across the patient-directory components.
export { formatDate as fmtDate } from "@/lib/format";

export function uniqueQualifyingTests(screenings: DirectoryScreening[]): string[] {
  const set = new Set<string>();
  for (const s of screenings) for (const t of s.qualifyingTests) set.add(t);
  return Array.from(set);
}
