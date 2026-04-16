import { z } from "zod";

export const VALID_FACILITIES = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"] as const;

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export function resolveGeneratedNoteFolderId(
  tree: {
    clinicalDocsFolderId: string;
    screeningFormFolderId: string;
    orderNoteFolderId: string;
    procedureNoteFolderId: string;
    billingDocFolderId: string;
  },
  note: { docKind?: string | null; title?: string | null }
): string {
  const docKind = (note.docKind || "").trim();
  const title = (note.title || "").trim().toLowerCase();

  if (docKind === "screening") return tree.screeningFormFolderId;
  if (docKind === "billing") return tree.billingDocFolderId;
  if (docKind === "postProcedureNote") return tree.procedureNoteFolderId;
  if (docKind === "preProcedureOrder") return tree.orderNoteFolderId;

  if (title.includes("billing")) return tree.billingDocFolderId;
  if (title.includes("procedure")) return tree.procedureNoteFolderId;
  if (title.includes("order")) return tree.orderNoteFolderId;
  if (title.includes("screening")) return tree.screeningFormFolderId;

  return tree.clinicalDocsFolderId;
}

export function extractDateFromPrevTests(text: string | null | undefined): string | null {
  if (!text) return null;

  const dates: Date[] = [];
  let m: RegExpExecArray | null;

  const p0 = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = p0.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }

  const p1 = /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/g;
  while ((m = p1.exec(text)) !== null) {
    const yr = parseInt(m[3]);
    const fullYr = yr >= 0 && yr <= 30 ? 2000 + yr : 1900 + yr;
    const d = new Date(fullYr, parseInt(m[1]) - 1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }

  const p2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = p2.exec(text)) !== null) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    if (!isNaN(d.getTime())) dates.push(d);
  }

  const p3 = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  while ((m = p3.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), MONTH_MAP[m[1].toLowerCase()], parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }

  const p4 = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi;
  while ((m = p4.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), MONTH_MAP[m[2].toLowerCase()], parseInt(m[1]));
    if (!isNaN(d.getTime())) dates.push(d);
  }

  const p5 = /(?<!\/)\b(\d{1,2})\/(\d{4})\b/g;
  while ((m = p5.exec(text)) !== null) {
    const mo = parseInt(m[1]);
    const yr = parseInt(m[2]);
    if (mo >= 1 && mo <= 12) {
      const d = new Date(yr, mo - 1, 1);
      if (!isNaN(d.getTime())) dates.push(d);
    }
  }

  if (dates.length === 0) return null;

  const latest = dates.reduce((a, b) => (b > a ? b : a));
  const mm = String(latest.getMonth() + 1).padStart(2, "0");
  const dd = String(latest.getDate()).padStart(2, "0");
  return `${latest.getFullYear()}-${mm}-${dd}`;
}

export function facilityToSettingKey(facility: string): string {
  return `QUALIFICATION_MODE_${facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export async function getQualificationMode(
  facility: string | null
): Promise<import("../services/screening").QualificationMode> {
  if (!facility) return "permissive";
  const { getSetting } = await import("../dbSettings");
  const val = await getSetting(facilityToSettingKey(facility));
  if (val === "standard" || val === "conservative") return val;
  return "permissive";
}

export const createBatchSchema = z.object({
  name: z.string().optional(),
  facility: z.enum(VALID_FACILITIES),
  scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const addTestHistorySchema = z.object({
  patientName: z.string(),
  dob: z.string().optional(),
  testName: z.string(),
  dateOfService: z.string(),
  insuranceType: z.string().default("ppo"),
  clinic: z.string().default("NWPG"),
  notes: z.string().optional(),
});

export const addPatientSchema = z.object({
  name: z.string().default(""),
  time: z.string().optional(),
  age: z.union([z.string(), z.number()]).optional(),
  gender: z.string().optional(),
  dob: z.string().optional(),
  phoneNumber: z.string().optional(),
  diagnoses: z.string().optional(),
  history: z.string().optional(),
  medications: z.string().optional(),
  notes: z.string().optional(),
});

export const updatePatientSchema = z.object({
  name: z.string().optional(),
  time: z.string().nullable().optional(),
  age: z.union([z.string(), z.number()]).nullable().optional(),
  gender: z.string().nullable().optional(),
  dob: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  insurance: z.string().nullable().optional(),
  diagnoses: z.string().nullable().optional(),
  history: z.string().nullable().optional(),
  medications: z.string().nullable().optional(),
  previousTests: z.string().nullable().optional(),
  previousTestsDate: z.string().nullable().optional(),
  noPreviousTests: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  qualifyingTests: z.array(z.string()).optional(),
  selectedCompletedTests: z.array(z.string()).optional(),
  appointmentStatus: z.string().nullable().optional(),
  patientType: z.string().nullable().optional(),
});

export const importTextSchema = z.object({
  text: z.string().min(1, "Text is required"),
});

export const saveGeneratedNoteSchema = z.object({
  patientId: z.number().int(),
  batchId: z.number().int(),
  facility: z.string().nullable().optional(),
  scheduleDate: z.string().nullable().optional(),
  patientName: z.string(),
  service: z.string(),
  docKind: z.string(),
  title: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
});
