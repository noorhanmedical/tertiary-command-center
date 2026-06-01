import type { PatientScreening } from "@shared/schema";

type CompletenessInput = Pick<
  PatientScreening,
  | "name"
  | "dob"
  | "phoneNumber"
  | "insurance"
  | "diagnoses"
  | "history"
  | "medications"
  | "time"
>;

export interface CompletenessResult {
  isComplete: boolean;
  missing: string[];
}

const BASE_FIELDS: { key: keyof CompletenessInput; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "dob", label: "DOB" },
  { key: "insurance", label: "Insurance" },
  { key: "phoneNumber", label: "Phone" },
  { key: "history", label: "Hx" },
  { key: "diagnoses", label: "Dx" },
  { key: "medications", label: "Rx" },
];

const VISIT_EXTRA: { key: keyof CompletenessInput; label: string } = {
  key: "time",
  label: "Time",
};

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function getPatientCompleteness(
  patient: Partial<CompletenessInput> | null | undefined,
  opts: { isVisit: boolean },
): CompletenessResult {
  if (!patient) return { isComplete: false, missing: BASE_FIELDS.map((f) => f.label) };
  const missing: string[] = [];
  const fields = opts.isVisit ? [...BASE_FIELDS, VISIT_EXTRA] : BASE_FIELDS;
  for (const f of fields) {
    if (!isPresent(patient[f.key])) missing.push(f.label);
  }
  return { isComplete: missing.length === 0, missing };
}
