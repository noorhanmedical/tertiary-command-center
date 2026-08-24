// FHIR Import Pipeline — NDJSON parser
//
// Reads raw NDJSON text (one JSON object per line) from one or more files,
// classifies each line by resourceType, and groups the clinical resources
// against their Patient by FHIR id reference ("Patient/{id}").
//
// Three-pass processing order (enforced in parseFhirNdjsonFiles):
//   1. Patient files    — creates bundle slots keyed by FHIR patient id
//   2. Medication files — builds the medicationLookup map (id → display name)
//   3. All other files  — attaches clinical resources to existing bundles
//
// PHI-safe: no patient names or DOBs are logged. Errors include only the
// S3 key, line number, and error message.

import type {
  FhirPatient,
  FhirMedication,
  FhirCondition,
  FhirMedicationRequest,
  FhirEncounter,
  FhirProcedure,
  FhirDiagnosticReport,
  FhirResource,
  FhirPatientBundle,
  ParsedFhirExport,
} from "./types";

// ─── Type guards ─────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFhirPatient(r: Record<string, unknown>): r is FhirPatient {
  return r["resourceType"] === "Patient";
}

function isFhirMedication(r: Record<string, unknown>): r is FhirMedication {
  return r["resourceType"] === "Medication";
}

function isFhirCondition(r: Record<string, unknown>): r is FhirCondition {
  return r["resourceType"] === "Condition";
}

function isFhirMedicationRequest(r: Record<string, unknown>): r is FhirMedicationRequest {
  return r["resourceType"] === "MedicationRequest";
}

function isFhirEncounter(r: Record<string, unknown>): r is FhirEncounter {
  return r["resourceType"] === "Encounter";
}

function isFhirProcedure(r: Record<string, unknown>): r is FhirProcedure {
  return r["resourceType"] === "Procedure";
}

function isFhirDiagnosticReport(r: Record<string, unknown>): r is FhirDiagnosticReport {
  return r["resourceType"] === "DiagnosticReport";
}

// ─── Patient id extraction from reference ────────────────────────────────

/**
 * Extracts the bare patient FHIR id from a reference string.
 * "Patient/12345" → "12345"
 * Returns null if the reference doesn't look like a patient reference.
 */
export function extractPatientIdFromReference(reference: string | undefined): string | null {
  if (!reference) return null;
  const match = reference.match(/^Patient\/(.+)$/);
  return match ? match[1] : null;
}

// ─── Medication display name resolution ──────────────────────────────────

/**
 * Extracts the best display name from a standalone Medication resource.
 * Prefers code.text, then the first coding display, then the coding code.
 */
function extractMedicationDisplayName(med: FhirMedication): string | null {
  if (med.code?.text) return med.code.text;
  const coding = med.code?.coding?.[0];
  if (coding?.display) return coding.display;
  if (coding?.code) return coding.code;
  return null;
}

// ─── Bundle builder ───────────────────────────────────────────────────────

function emptyBundle(patient: FhirPatient): FhirPatientBundle {
  return {
    patient,
    conditions: [],
    medications: [],
    encounters: [],
    procedures: [],
    diagnosticReports: [],
  };
}

function getBundle(
  bundles: Map<string, FhirPatientBundle>,
  patientId: string,
): FhirPatientBundle | null {
  return bundles.get(patientId) ?? null;
}

// ─── Parse a single NDJSON line ───────────────────────────────────────────

function parseLine(
  line: string,
): { ok: true; resource: FhirResource } | { ok: false; reason: string } {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, reason: "blank" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e: any) {
    return { ok: false, reason: `JSON parse error: ${e?.message ?? String(e)}` };
  }

  if (!isObject(parsed)) {
    return { ok: false, reason: "not a JSON object" };
  }
  if (typeof parsed["resourceType"] !== "string") {
    return { ok: false, reason: "missing resourceType" };
  }

  return { ok: true, resource: parsed as unknown as FhirResource };
}

// ─── Ingest a single NDJSON file ─────────────────────────────────────────

/**
 * Processes one NDJSON file's content string.
 *
 * - Patient resources create new bundle slots.
 * - Medication resources populate the medicationLookup map (id → display name).
 * - All other clinical resources are attached to existing bundle slots via
 *   their subject.reference ("Patient/{id}").
 *
 * @param content            Raw NDJSON string.
 * @param sourceKey          S3 key — used only in error logs.
 * @param bundles            Mutable shared bundles map.
 * @param medicationLookup   Mutable shared medication lookup map.
 * @returns                  { linesRead, parseErrors }
 */
export function ingestNdjsonContent(
  content: string,
  sourceKey: string,
  bundles: Map<string, FhirPatientBundle>,
  medicationLookup: Map<string, string>,
): { linesRead: number; parseErrors: number } {
  const lines = content.split("\n");
  let parseErrors = 0;

  for (let i = 0; i < lines.length; i++) {
    const result = parseLine(lines[i]);
    if (!result.ok) {
      if (result.reason !== "blank") {
        parseErrors += 1;
        console.error(`[fhirNdjsonParser] ${sourceKey}:${i + 1} — ${result.reason}`);
      }
      continue;
    }

    const resource = result.resource;

    // ── Patient ────────────────────────────────────────────────────────────
    if (isFhirPatient(resource)) {
      const patientId = resource.id;
      if (!patientId) {
        parseErrors += 1;
        console.error(`[fhirNdjsonParser] ${sourceKey}:${i + 1} — Patient missing id`);
        continue;
      }
      if (!bundles.has(patientId)) {
        bundles.set(patientId, emptyBundle(resource));
      } else {
        // Patient already seen (e.g. from a previous file) — refresh demographics
        // in place so the latest record wins without dropping attached clinical data.
        const existing = bundles.get(patientId)!;
        existing.patient = resource;
      }
      continue;
    }

    // ── Medication (standalone drug resource — ECW pattern) ────────────────
    // Has no subject reference; goes into the lookup map, not a bundle.
    if (isFhirMedication(resource)) {
      const medId = resource.id;
      if (medId) {
        const displayName = extractMedicationDisplayName(resource);
        if (displayName) {
          medicationLookup.set(medId, displayName);
        }
      }
      continue;
    }

    // ── Clinical resources — all require a subject.reference ───────────────

    if (isFhirCondition(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = getBundle(bundles, pid);
      if (bundle) bundle.conditions.push(resource);
      continue;
    }

    if (isFhirMedicationRequest(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = getBundle(bundles, pid);
      if (bundle) bundle.medications.push(resource);
      continue;
    }

    if (isFhirEncounter(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = getBundle(bundles, pid);
      if (bundle) bundle.encounters.push(resource);
      continue;
    }

    if (isFhirProcedure(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = getBundle(bundles, pid);
      if (bundle) bundle.procedures.push(resource);
      continue;
    }

    if (isFhirDiagnosticReport(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = getBundle(bundles, pid);
      if (bundle) bundle.diagnosticReports.push(resource);
      continue;
    }

    // Unknown / unhandled resource type — silently skip (not an error).
  }

  return { linesRead: lines.length, parseErrors };
}

// ─── Main parse entry point ───────────────────────────────────────────────

/**
 * Parses a set of NDJSON file contents into a unified export result.
 *
 * Three-pass ordering is applied regardless of the input file order:
 *   1. Patient files  → creates bundle slots
 *   2. Medication files → builds the medication lookup map
 *   3. Everything else  → attaches clinical resources to bundles
 *
 * This guarantees all bundle slots and the full drug-name lookup table
 * exist before MedicationRequests are processed.
 *
 * Medication-file detection uses path matching to avoid confusing
 * "/Medication/" with "/MedicationRequest/":
 *   - Medication:        key contains "/Medication/" but NOT "/MedicationRequest/"
 *   - MedicationRequest: key contains "/MedicationRequest/"
 *
 * @param files  Array of { key, content } tuples (any order).
 * @returns      ParsedFhirExport with bundles, medicationLookup, and counters.
 */
export function parseFhirNdjsonFiles(
  files: Array<{ key: string; content: string }>,
): ParsedFhirExport {
  const bundles = new Map<string, FhirPatientBundle>();
  const medicationLookup = new Map<string, string>();
  let totalLines = 0;
  let parseErrors = 0;

  // Classify files into three groups for ordered processing
  const patientFiles = files.filter((f) => f.key.includes("/Patient/"));
  const medicationFiles = files.filter(
    (f) => f.key.includes("/Medication/") && !f.key.includes("/MedicationRequest/"),
  );
  const clinicalFiles = files.filter(
    (f) =>
      !f.key.includes("/Patient/") &&
      !(f.key.includes("/Medication/") && !f.key.includes("/MedicationRequest/")),
  );

  for (const file of [...patientFiles, ...medicationFiles, ...clinicalFiles]) {
    const { linesRead, parseErrors: fileErrors } = ingestNdjsonContent(
      file.content,
      file.key,
      bundles,
      medicationLookup,
    );
    totalLines += linesRead;
    parseErrors += fileErrors;
  }

  console.log(
    `[fhirNdjsonParser] lookup built: ${medicationLookup.size} medication name(s) from ${medicationFiles.length} Medication file(s)`,
  );

  return { bundles, medicationLookup, totalLines, parseErrors };
}
