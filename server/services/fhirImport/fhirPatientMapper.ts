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
  FhirProcedure,
} from "./types";

// ─── Demographic extractors ───────────────────────────────────────────────

/**
 * Extracts the MRN from a Patient's identifier array.
 *
 * ECW identifier layout:
 *   - use="usual"     → encrypted FHIR patient id (same as Patient.id) — NOT the MRN
 *   - use="secondary" → the human-readable MRN (e.g. "e35959")
 *
 * Fallback chain:
 *   1. use="secondary" identifier value  (ECW)
 *   2. identifier whose type.coding contains code="MR"  (standard FHIR)
 *   3. any identifier whose value differs from Patient.id  (last resort)
 */
export function extractMrn(patient: FhirPatient): string | null {
  if (!patient.identifier?.length) return null;

  // ECW: MRN is the identifier with use === "secondary"
  const secondary = patient.identifier.find((id) => id.use === "secondary" && id.value);
  if (secondary?.value) return secondary.value;

  // Standard FHIR: identifier with type.coding[].code === "MR"
  const mrIdentifier = patient.identifier.find((id) =>
    id.type?.coding?.some((c) => c.code === "MR"),
  );
  if (mrIdentifier?.value) return mrIdentifier.value;

  // Last resort: any identifier whose value doesn't look like the FHIR id
  // (ECW sets the "usual" identifier to the same encrypted patient id)
  const nonFhirId = patient.identifier.find(
    (id) => id.value && id.value !== patient.id,
  );
  return nonFhirId?.value ?? null;
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
 * Resolves the human-readable display name for a MedicationRequest.
 *
 * Resolution order:
 *   1. medicationCodeableConcept.text or first coding display  (standard FHIR)
 *   2. Lookup medicationReference.reference in the medication map  (ECW pattern)
 *
 * @param med     The MedicationRequest resource.
 * @param lookup  Optional Map<medicationId, displayName> built from
 *                standalone Medication resources. Pass the one from
 *                ParsedFhirExport.medicationLookup.
 */
export function resolveMedicationName(
  med: FhirMedicationRequest,
  lookup?: Map<string, string>,
): string {
  // 1. Standard FHIR: name embedded in medicationCodeableConcept
  if (med.medicationCodeableConcept?.text) return med.medicationCodeableConcept.text;
  const ccCoding = med.medicationCodeableConcept?.coding?.[0];
  if (ccCoding?.display) return ccCoding.display;
  if (ccCoding?.code) return ccCoding.code;

  // 2. ECW: resolve via medicationReference → lookup map
  if (med.medicationReference?.reference && lookup) {
    // Reference is either "Medication/xyz123" or just "xyz123"
    const raw = med.medicationReference.reference;
    const medId = raw.startsWith("Medication/") ? raw.slice("Medication/".length) : raw;
    const name = lookup.get(medId);
    if (name) return name;
  }

  return "Unknown medication";
}

/**
 * @deprecated Use resolveMedicationName(med, lookup) instead.
 * Kept for any legacy callers; internally delegates to resolveMedicationName.
 */
export function getMedicationDisplay(med: FhirMedicationRequest): string {
  return resolveMedicationName(med, undefined);
}

// ─── Procedure extractors ─────────────────────────────────────────────────

/**
 * Returns the human-readable display string for a Procedure.
 * Prefers code.text, then the first coding display, then the CPT/SNOMED code.
 */
export function getProcedureDisplay(procedure: FhirProcedure): string {
  if (procedure.code?.text) return procedure.code.text;
  const coding = procedure.code?.coding?.[0];
  if (coding?.display) return coding.display;
  if (coding?.code) return coding.code;
  return "Unknown procedure";
}

/**
 * Extracts the date a procedure was performed as a YYYY-MM-DD string.
 * Tries performedDateTime first, then performedPeriod.start.
 */
export function getProcedureDate(procedure: FhirProcedure): string | null {
  if (procedure.performedDateTime) return procedure.performedDateTime.slice(0, 10);
  if (procedure.performedPeriod?.start) return procedure.performedPeriod.start.slice(0, 10);
  return null;
}

// ─── Encounter helpers ────────────────────────────────────────────────────

/**
 * Determines whether any encounter represents an upcoming appointment
 * (period.start > today AND < today + 180 days).
 */
export function hasUpcomingEncounter(encounters: FhirEncounter[]): boolean {
  const now = Date.now();
  const maxFuture = now + 180 * 24 * 60 * 60 * 1000;
  return encounters.some((enc) => {
    const ms = Date.parse(enc.period?.start ?? "");
    return !isNaN(ms) && ms > now && ms < maxFuture;
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

/**
 * Builds a PHI-safe encounter summary string for the notes field.
 * Format: "32 visits, last: 2026-05-15"
 * (No patient names or DOBs — only counts and dates.)
 */
function buildEncounterNotes(encounters: FhirEncounter[]): string | null {
  if (encounters.length === 0) return null;

  const finishedEncounters = encounters.filter(
    (e) => e.status === "finished" || e.status === "completed",
  );
  const totalCount = finishedEncounters.length || encounters.length;

  // Most recent past encounter
  const now = Date.now();
  const past = encounters
    .map((e) => e.period?.start)
    .filter((s): s is string => !!s)
    .map((s) => Date.parse(s))
    .filter((ms) => !isNaN(ms) && ms <= now)
    .sort((a, b) => b - a); // newest first

  const lastVisitDate = past.length > 0
    ? new Date(past[0]).toISOString().slice(0, 10)
    : null;

  const parts: string[] = [`${totalCount} visit${totalCount !== 1 ? "s" : ""}`];
  if (lastVisitDate) parts.push(`last: ${lastVisitDate}`);

  return parts.join(", ");
}

// ─── Mapper: FhirPatientBundle → patient_directory row ────────────────────

/**
 * Maps a FhirPatientBundle to an InsertPatientDirectory record.
 * plexusId is omitted — the DB trigger auto-generates it on INSERT.
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
 * Maps a FhirPatientBundle to an InsertPatientScreening record.
 *
 * @param bundle           The patient's full FHIR data bundle.
 * @param clinicIdInt      Integer FK to clinics.id.
 * @param batchId          FK to screening_batches.id.
 * @param clinicName       Human-readable clinic name for the facility field.
 * @param medicationLookup Map<medicationId, displayName> from ParsedFhirExport.
 *                         Required for ECW exports where drug names live in
 *                         standalone Medication resources.
 */
export function mapFhirToScreening(
  bundle: FhirPatientBundle,
  clinicIdInt: number,
  batchId: number,
  clinicName: string,
  medicationLookup?: Map<string, string>,
): InsertPatientScreening {
  const { patient, conditions, medications, encounters, procedures } = bundle;
  const primaryName = patient.name?.[0];
  const lastName = primaryName?.family ?? "";
  const firstName = primaryName?.given?.join(" ") ?? "";
  const fullName =
    lastName && firstName
      ? `${lastName}, ${firstName}`
      : firstName || lastName || "Unknown";

  // ── Diagnoses ────────────────────────────────────────────────────────────
  const activeConditions = conditions.filter((c) => {
    const statusCode = c.clinicalStatus?.coding?.[0]?.code;
    return (
      !statusCode ||
      statusCode === "active" ||
      statusCode === "recurrence" ||
      statusCode === "relapse"
    );
  });
  const conditionsToUse = activeConditions.length > 0 ? activeConditions : conditions;
  const diagnosesText =
    conditionsToUse.length > 0
      ? conditionsToUse.map(getConditionDisplay).join("; ")
      : null;

  // ── Medications ──────────────────────────────────────────────────────────
  const activeMedications = medications.filter((m) => m.status === "active");
  const medsToUse = activeMedications.length > 0 ? activeMedications : medications;
  const medicationsText =
    medsToUse.length > 0
      ? medsToUse.map((m) => resolveMedicationName(m, medicationLookup)).join("; ")
      : null;

  // ── Procedures → previousTests ───────────────────────────────────────────
  // Populate previousTests with semicolon-separated procedure names and
  // previousTestsDate with the most recent procedure date.
  const procedureNames =
    procedures.length > 0
      ? procedures.map(getProcedureDisplay).join("; ")
      : null;

  const procedureDates = procedures
    .map(getProcedureDate)
    .filter((d): d is string => !!d)
    .sort()
    .reverse(); // newest first
  const mostRecentProcedureDate = procedureDates[0] ?? null;

  // ── Encounters → notes + patientType + time ───────────────────────────────
  const upcomingEncounter = hasUpcomingEncounter(encounters);
  const nextTime = getNextEncounterTime(encounters);
  const encounterNotes = buildEncounterNotes(encounters);

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
    // history mirrors diagnoses at import time — the AI enriches this during qualification
    history: diagnosesText,
    medications: medicationsText,
    previousTests: procedureNames,
    previousTestsDate: mostRecentProcedureDate,
    noPreviousTests: procedures.length === 0,
    notes: encounterNotes,
    qualifyingTests: [],
    reasoning: {},
    status: "draft",
    appointmentStatus: "pending",
    patientType: upcomingEncounter ? "visit" : "outreach",
    commitStatus: "Draft",
    adminApprovalStatus: "pending",
    // time holds the next appointment datetime string (for "visit" patients)
    time: nextTime ?? null,
    isTest: false,
  };
}
