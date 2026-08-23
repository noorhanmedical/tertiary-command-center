// FHIR Import Pipeline — NDJSON parser
//
// Reads raw NDJSON text (one JSON object per line) from one or more files,
// classifies each line by resourceType, and groups the clinical resources
// against their Patient by FHIR id reference ("Patient/{id}").
//
// PHI-safe: no patient names or DOBs are logged. Errors include only the
// S3 key, line number, and error message.

import type {
  FhirPatient,
  FhirCondition,
  FhirMedicationRequest,
  FhirEncounter,
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

function isFhirCondition(r: Record<string, unknown>): r is FhirCondition {
  return r["resourceType"] === "Condition";
}

function isFhirMedicationRequest(r: Record<string, unknown>): r is FhirMedicationRequest {
  return r["resourceType"] === "MedicationRequest";
}

function isFhirEncounter(r: Record<string, unknown>): r is FhirEncounter {
  return r["resourceType"] === "Encounter";
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

// ─── Bundle builder ───────────────────────────────────────────────────────

function emptyBundle(patient: FhirPatient): FhirPatientBundle {
  return {
    patient,
    conditions: [],
    medications: [],
    encounters: [],
    diagnosticReports: [],
  };
}

function ensureBundle(
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

// ─── Ingest a single NDJSON file's content into the shared bundles map ────

/**
 * Processes one NDJSON file's content string.
 *
 * Patients encountered here register a new bundle slot. Clinical resources
 * are attached to whichever bundle holds their patient ref. Resources whose
 * patient ref is not yet in the map are deferred — once a second pass
 * processes Patient resources from a different file, the dangling refs won't
 * be resolved. In practice the S3 structure emits all Patients first (one
 * dedicated subfolder), so the multi-pass strategy used by the orchestrator
 * (process Patient files first, then clinical files) guarantees correctness.
 *
 * @param content   Raw NDJSON string (newline-separated JSON objects).
 * @param sourceKey S3 key — used only in error logs.
 * @param bundles   Mutable shared map to accumulate results into.
 * @returns         { linesRead, parseErrors } for the caller to accumulate.
 */
export function ingestNdjsonContent(
  content: string,
  sourceKey: string,
  bundles: Map<string, FhirPatientBundle>,
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
        // Patient already seen (e.g. from a previous file) — update demographics
        // in place so the latest record wins without losing attached clinical data.
        const existing = bundles.get(patientId)!;
        existing.patient = resource;
      }
      continue;
    }

    if (isFhirCondition(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = ensureBundle(bundles, pid);
      if (bundle) bundle.conditions.push(resource);
      continue;
    }

    if (isFhirMedicationRequest(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = ensureBundle(bundles, pid);
      if (bundle) bundle.medications.push(resource);
      continue;
    }

    if (isFhirEncounter(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = ensureBundle(bundles, pid);
      if (bundle) bundle.encounters.push(resource);
      continue;
    }

    if (isFhirDiagnosticReport(resource)) {
      const pid = extractPatientIdFromReference(resource.subject?.reference);
      if (!pid) continue;
      const bundle = ensureBundle(bundles, pid);
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
 * `files` should be ordered so Patient files come before clinical files to
 * avoid dangling references (the S3 reader handles this ordering).
 *
 * @param files  Array of { key, content } tuples in preferred processing order.
 * @returns      ParsedFhirExport with the bundles map + aggregate counters.
 */
export function parseFhirNdjsonFiles(
  files: Array<{ key: string; content: string }>,
): ParsedFhirExport {
  const bundles = new Map<string, FhirPatientBundle>();
  let totalLines = 0;
  let parseErrors = 0;

  for (const file of files) {
    const { linesRead, parseErrors: fileErrors } = ingestNdjsonContent(
      file.content,
      file.key,
      bundles,
    );
    totalLines += linesRead;
    parseErrors += fileErrors;
  }

  return { bundles, totalLines, parseErrors };
}
