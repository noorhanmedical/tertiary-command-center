// FHIR Import Pipeline — patient mapper
//
// Maps a FhirPatientBundle to the shapes needed for patient_directory and
// patient_screenings. No DB access here — pure data transformation.
//
// PHI-safe: this module performs transformations only. Callers are
// responsible for ensuring PHI-containing return values are never logged.

import type { InsertPatientDirectory } from "@shared/schema/patientDirectory";
import type { InsertPatientScreening } from "@shared/schema/screening";
import type {
  FhirPatientBundle,
  FhirPatient,
  FhirCondition,
  FhirMedicationRequest,
  FhirEncounter,
} from "./types";

// ─── Demographic extractors ───────────────────────────────────────────────

/**
 * Extracts the MRN from a Patient's identifier array.
 * Looks for an identifier whose type.coding contains code "MR".
 * Falls back to the first identifier value if no MR type is found.
 */
export function extractMrn(patient: FhirPatient): string | null {
  if (!patient.identifier?.length) return null;

  // Prefer the identifier explicitly typed as MR (Medical Record Number)
  const mrIdentifier = patient.identifier.find((id) =>
    id.type?.coding?.some((c) => c.code === "MR"),
  );
  if (mrIdentifier?.value) return mrIdentifier.value;

  // Fall back to first identifier with a value
  const first = patient.identifier.find((id) => id.value);
  return first?.value ?? null;
}

/**
 * Extracts the primary phone number from a Patient's telecom array.
 * Prefers use="mobile" then use="home", otherwise first "phone" entry.
 */
export function extractPhone(patient: FhirPatient): string | null {
  if (!patient.telecom?.length) return null;
  const phones = patient.telecom.filter((t) => t.system === "phone" && t.value);
  if (!phones.length) return null;
  const mobile = phones.find((t) => t.use === "mobile");
  if (mobile?.value) return mobile.value;
  const home = phones.find((t) => t.use === "home");
  if (home?.value) return home.value;
  return phones[0]?.value ?? null;
}

/**
 * Extracts the primary email address from a Patient's telecom array.
 */
export function extractEmail(patient: FhirPatient): string | null {
  if (!patient.telecom?.length) return null;
  const email = patient.telecom.find((t) => t.system === "email" && t.value);
  return email?.value ?? null;
}

/**
 * Calculates age in whole years from a YYYY-MM-DD birthDate string.
 * Returns null when the date is missing or unparseable.
 */
export function calculateAge(birthDate: string | undefined): number | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

// ─── Clinical data extractors ─────────────────────────────────────────────

/**
 * Returns the human-readable display string for a Condition.
 * Prefers the code.text, then the first coding display, then the ICD-10 code.
 */
export function getConditionDisplay(condition: FhirCondition): string {
  if (condition.code?.text) return condition.code.text;
  const coding = condition.code?.coding?.[0];
  if (coding?.display) return coding.display;
  if (coding?.code) return coding.code;
  return "Unknown condition";
}

/**
 * Returns the human-readable display string for a MedicationRequest.
 * Prefers the medicationCodeableConcept.text, then the first coding display.
 */
export function getMedicationDisplay(med: FhirMedicationRequest): string {
  if (med.medicationCodeableConcept?.text) return med.medicationCodeableConcept.text;
  const coding = med.medicationCodeableConcept?.coding?.[0];
  if (coding?.display) return coding.display;
  if (coding?.code) return coding.code;
  return "Unknown medication";
}

/**
 * Determines whether any encounter in the bundle represents an upcoming
 * appointment (period.start > today AND < today + 180 days).
 *
 * patientType = "visit"    when an upcoming encounter exists
 * patientType = "outreach" otherwise
 */
export function hasUpcomingEncounter(encounters: FhirEncounter[]): boolean {
  const now = Date.now();
  const maxFuture = now + 180 * 24 * 60 * 60 * 1000; // 180 days in ms

  return encounters.some((enc) => {
    const startStr = enc.period?.start;
    if (!startStr) return false;
    const startMs = Date.parse(startStr);
    if (isNaN(startMs)) return false;
    return startMs > now && startMs < maxFuture;
  });
}

/**
 * Returns the soonest upcoming encounter start datetime as an ISO string,
 * or null if no upcoming encounter exists.
 */
export function getNextEncounterTime(encounters: FhirEncounter[]): string | null {
  const now = Date.now();
  const maxFuture = now + 180 * 24 * 60 * 60 * 1000;

  const upcoming = encounters
    .map((enc) => enc.period?.start)
    .filter((s): s is string => !!s)
    .map((s) => ({ s, ms: Date.parse(s) }))
    .filter(({ ms }) => !isNaN(ms) && ms > now && ms < maxFuture)
    .sort((a, b) => a.ms - b.ms);

  return upcoming[0]?.s ?? null;
}

// ─── Mapper: FhirPatientBundle → patient_directory row ────────────────────

/**
 * Maps a FhirPatientBundle to an InsertPatientDirectory record.
 *
 * Note: plexusId is intentionally omitted — the DB trigger generates it on
 * INSERT. id, createdAt, and updatedAt are also omitted per the insert schema.
 */
export function mapFhirToPatientDirectory(
  bundle: FhirPatientBundle,
  clinicSlug: string,
): InsertPatientDirectory {
  const { patient } = bundle;
  const primaryName = patient.name?.[0];

  return {
    mrn: extractMrn(patient),
    firstName: primaryName?.given?.join(" ") ?? "",
    lastName: primaryName?.family ?? "",
    dob: patient.birthDate ?? null,
    gender: patient.gender ?? null,
    phone: extractPhone(patient),
    email: extractEmail(patient),
    insurance: null, // populated later from Coverage/Binary resources
    facilityId: clinicSlug,
    // patient_directory.clinicId is TEXT (tech debt) — store the slug
    clinicId: clinicSlug,
    status: "active",
  };
}

// ─── Mapper: FhirPatientBundle → patient_screenings row ──────────────────

/**
 * Maps a FhirPatientBundle to an InsertPatientScreening record ready for
 * bulk insertion into the patient_screenings table.
 *
 * status is "draft" so the AI qualification runner picks it up immediately.
 * commitStatus and adminApprovalStatus are left at their schema defaults
 * ("Draft" / "pending") — this row requires admin review before engagement.
 */
export function mapFhirToScreening(
  bundle: FhirPatientBundle,
  clinicIdInt: number,
  batchId: number,
  clinicName: string,
): InsertPatientScreening {
  const { patient, conditions, medications, encounters } = bundle;
  const primaryName = patient.name?.[0];
  const lastName = primaryName?.family ?? "";
  const firstName = primaryName?.given?.join(" ") ?? "";
  const fullName = lastName && firstName ? `${lastName}, ${firstName}` : firstName || lastName || "Unknown";

  const activeConditions = conditions.filter((c) => {
    const status = c.clinicalStatus?.coding?.[0]?.code;
    return !status || status === "active" || status === "recurrence" || status === "relapse";
  });

  const activeMedications = medications.filter((m) => m.status === "active");

  const diagnosesText =
    activeConditions.length > 0
      ? activeConditions.map(getConditionDisplay).join("; ")
      : conditions.map(getConditionDisplay).join("; ") || null;

  const medicationsText =
    activeMedications.length > 0
      ? activeMedications.map(getMedicationDisplay).join("; ")
      : medications.map(getMedicationDisplay).join("; ") || null;

  const upcomingEncounter = hasUpcomingEncounter(encounters);
  const nextTime = getNextEncounterTime(encounters);

  return {
    clinicId: clinicIdInt,
    batchId,
    name: fullName,
    dob: patient.birthDate ?? null,
    age: calculateAge(patient.birthDate),
    gender: patient.gender ?? null,
    phoneNumber: extractPhone(patient),
    email: extractEmail(patient),
    insurance: null,
    facility: clinicName,
    diagnoses: diagnosesText,
    // history mirrors diagnoses — the AI enriches this during qualification
    history: diagnosesText,
    medications: medicationsText,
    previousTests: null,
    previousTestsDate: null,
    noPreviousTests: false,
    notes: null,
    qualifyingTests: [],
    reasoning: {},
    status: "draft",
    appointmentStatus: "pending",
    patientType: upcomingEncounter ? "visit" : "outreach",
    commitStatus: "Draft",
    adminApprovalStatus: "pending",
    // time is the scheduled appointment time string (HH:MM or similar)
    time: nextTime ?? null,
    isTest: false,
  };
}
