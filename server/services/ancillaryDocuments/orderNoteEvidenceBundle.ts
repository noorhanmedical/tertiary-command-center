// Order Note standard — SLICE AI-1: shared, all-service, case-scoped,
// provenance-tagged evidence bundle.
//
// Assembles ONE normalized evidence bundle for any ancillary service from the
// exact patient's canonical, clinic-scoped chart data. Every factual item
// carries provenance (source type + record id + evidence class + date) so the
// downstream compliance validator can trace each AI statement back to a real
// source. Bounded/relevance-limited — never dumps the whole chart. Contains NO
// ICD/CPT (codes are deliberately excluded from anything shown to the model).
//
// DB-backed reads only; NOT DB-VERIFIED until staging. Pure of AI.

import crypto from "node:crypto";
import { db } from "../../db";
import { and, eq, desc } from "drizzle-orm";
import { patientScreenings, screeningBatches } from "@shared/schema/screening";
import {
  patientLabs, patientVitals, patientImagingStudies, patientEncounters,
} from "@shared/schema/clinicalData";
import { plexusClinicalFindings } from "@shared/schema/plexusClinicalFindings";
import { clinics } from "@shared/schema/clinics";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { getCurrentScreeningEvidence } from "../screening/screeningEvidenceService";
import { screeningConceptDisplay } from "@shared/schema/screeningEvidence";
import { orderNoteServiceConfig, type OrderedComponent } from "./orderNoteServiceConfig";

export const ORDER_NOTE_EVIDENCE_BUNDLE_VERSION = "order_note_evidence_bundle_v1";

// Bounds — keep the bundle focused; the model selects the relevant subset.
const MAX_LABS = 14;
const MAX_VITALS = 8;
const MAX_IMAGING = 6;
const MAX_ENCOUNTERS = 4;
const MAX_FINDINGS = 20;

export type OrderNoteEvidenceClass =
  | "chart_documented_diagnosis"
  | "chart_documented_history"
  | "clinician_entered_finding"
  | "patient_reported_symptom"
  | "patient_reported_condition_history"
  | "patient_reported_diagnosis_history"
  | "patient_reported_event_history"
  | "patient_reported_medication_use"
  | "medication_evidence_from_chart"
  | "laboratory_result"
  | "vital_sign"
  | "prior_imaging_result"
  | "clinical_note_evidence"
  | "qualification_evidence";

export type EvidenceFact = {
  factId: string;
  concept: string;
  displayText: string;
  value?: string | number | boolean | null;
  date?: string | null;
  sourceType: string;
  sourceRecordId: string | null;
  evidenceClass: OrderNoteEvidenceClass;
};

export type ScreeningFindingFact = {
  questionId: string;
  concept: string;
  displayText: string;
  value: number | boolean;
  normalizedMeaning?: string | null;
  evidenceClass: string;
  section: string;
};

export type OrderNoteEvidenceBundle = {
  bundleVersion: string;
  service: string;
  serviceLabel: string;
  orderedComponents: OrderedComponent[];
  patient: {
    name: string;
    dob: string | null;
    age: number | null;
    sex: string | null;
    plexusId: string | null;
    clinicName: string | null;
  };
  orderingClinician: { name: string; npi: string | null };
  orderDate: string | null;
  diagnoses: EvidenceFact[];
  history: EvidenceFact[];
  medications: EvidenceFact[];
  labs: EvidenceFact[];
  vitals: EvidenceFact[];
  priorImaging: EvidenceFact[];
  clinicalNotes: EvidenceFact[];
  clinicianFindings: EvidenceFact[];
  structuredScreening: {
    questionnaire: string;
    version: string;
    completedAt: string | null;
    findings: ScreeningFindingFact[];
  } | null;
  qualification: { factors: string[]; clinicianUnderstanding: string | null };
  adminReview: { status: string | null };
  screeningEvidenceVersion: string | null;
  sourceRecordIds: string[];
};

function ageFromDob(dob: string | null | undefined, explicit?: number | null): number | null {
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const md = now.getMonth() - d.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < d.getDate())) a -= 1;
  return a;
}

function splitFreeText(v: string | null | undefined): string[] {
  if (!v) return [];
  return v.split(/[\n;,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function isPositiveScreening(responseType: string, value: unknown): boolean {
  if (responseType === "boolean") return value === true;
  return typeof value === "number" && value >= 1; // 0 = explicit N/A
}

/**
 * Assemble the full Order Note evidence bundle for an exact ancillary case.
 * Fully clinic-scoped; returns null on missing case / cross-clinic mismatch.
 */
export async function assembleOrderNoteEvidenceBundle(input: {
  clinicId: number;
  ancillaryCaseId: number;
}): Promise<OrderNoteEvidenceBundle | null> {
  const acase = await getAncillaryCaseById(input.ancillaryCaseId);
  if (!acase || acase.clinicId !== input.clinicId) return null;

  const serviceType = acase.serviceType;
  const cfg = orderNoteServiceConfig(serviceType);
  const screeningId = (acase as { originatingScreeningId?: number | null }).originatingScreeningId ?? null;
  const sourceRecordIds: string[] = [];

  // Patient screening (DX/HX/RX free text + reasoning + identity).
  let ps: typeof patientScreenings.$inferSelect | undefined;
  if (screeningId != null) {
    [ps] = await db.select().from(patientScreenings).where(eq(patientScreenings.id, screeningId)).limit(1);
    if (ps) sourceRecordIds.push(`patient_screening:${ps.id}`);
  }

  // Ordering clinician (from the screening batch).
  let clinicianName: string | null = null;
  if (ps?.batchId != null) {
    const [batch] = await db.select().from(screeningBatches).where(eq(screeningBatches.id, ps.batchId)).limit(1);
    clinicianName = batch?.clinicianName ?? null;
  }

  // Real clinic name.
  let clinicName: string | null = null;
  {
    const [c] = await db.select().from(clinics).where(eq(clinics.id, input.clinicId)).limit(1);
    clinicName = (c as { name?: string } | undefined)?.name ?? null;
  }

  // ── DX ──
  const diagnoses: EvidenceFact[] = splitFreeText(ps?.diagnoses).map((t, i) => ({
    factId: `dx_${i}`,
    concept: t.toLowerCase(),
    displayText: t,
    date: null,
    sourceType: "patient_screening.diagnoses",
    sourceRecordId: ps ? String(ps.id) : null,
    evidenceClass: "chart_documented_diagnosis",
  }));

  // ── HX ──
  const history: EvidenceFact[] = splitFreeText(ps?.history).map((t, i) => ({
    factId: `hx_${i}`,
    concept: t.toLowerCase(),
    displayText: t,
    date: null,
    sourceType: "patient_screening.history",
    sourceRecordId: ps ? String(ps.id) : null,
    evidenceClass: "chart_documented_history",
  }));

  // ── RX / medications ──
  const medications: EvidenceFact[] = splitFreeText(ps?.medications).map((t, i) => ({
    factId: `rx_${i}`,
    concept: t.toLowerCase(),
    displayText: t,
    date: null,
    sourceType: "patient_screening.medications",
    sourceRecordId: ps ? String(ps.id) : null,
    evidenceClass: "medication_evidence_from_chart",
  }));

  // Clinical-reference tables (all keyed by patient_screening_id + clinic).
  let labs: EvidenceFact[] = [];
  let vitals: EvidenceFact[] = [];
  let priorImaging: EvidenceFact[] = [];
  let clinicalNotes: EvidenceFact[] = [];
  let clinicianFindings: EvidenceFact[] = [];

  if (screeningId != null) {
    // ── Labs (prefer abnormal + most recent) ──
    const labRows = await db.select().from(patientLabs)
      .where(and(eq(patientLabs.patientScreeningId, screeningId), eq(patientLabs.clinicId, input.clinicId)))
      .orderBy(desc(patientLabs.collectedAt)).limit(60);
    const abnormalFirst = [...labRows].sort((a, b) => {
      const aAb = a.flag && a.flag !== "normal" ? 0 : 1;
      const bAb = b.flag && b.flag !== "normal" ? 0 : 1;
      return aAb - bAb;
    }).slice(0, MAX_LABS);
    labs = abnormalFirst.map((l) => ({
      factId: `lab_${l.id}`,
      concept: (l.name ?? "").toLowerCase(),
      displayText: `${l.name}${l.value != null ? ` ${l.value}` : ""}${l.unit ? ` ${l.unit}` : ""}${l.referenceRange ? ` (ref ${l.referenceRange})` : ""}${l.flag && l.flag !== "normal" ? ` [${l.flag}]` : ""}`,
      value: l.value ?? null,
      date: l.collectedAt ?? null,
      sourceType: `patient_labs${l.panel ? `.${l.panel}` : ""}`,
      sourceRecordId: String(l.id),
      evidenceClass: "laboratory_result",
    }));
    for (const l of abnormalFirst) sourceRecordIds.push(`patient_lab:${l.id}`);

    // ── Vitals (most recent) ──
    const vitalRows = await db.select().from(patientVitals)
      .where(and(eq(patientVitals.patientScreeningId, screeningId), eq(patientVitals.clinicId, input.clinicId)))
      .orderBy(desc(patientVitals.measuredAt)).limit(MAX_VITALS);
    vitals = vitalRows.map((v) => ({
      factId: `vital_${v.id}`,
      concept: (v.label ?? "").toLowerCase(),
      displayText: `${v.label}${v.value != null ? `: ${v.value}` : ""}${v.unit ? ` ${v.unit}` : ""}`,
      value: v.value ?? null,
      date: v.measuredAt ?? null,
      sourceType: "patient_vitals",
      sourceRecordId: String(v.id),
      evidenceClass: "vital_sign",
    }));
    for (const v of vitalRows) sourceRecordIds.push(`patient_vital:${v.id}`);

    // ── Prior imaging / diagnostic results (prefer final + report available) ──
    const imgRows = await db.select().from(patientImagingStudies)
      .where(and(eq(patientImagingStudies.patientScreeningId, screeningId), eq(patientImagingStudies.clinicId, input.clinicId)))
      .orderBy(desc(patientImagingStudies.performedAt)).limit(40);
    const finalFirst = [...imgRows].sort((a, b) => {
      const aF = (a.status ?? "").toLowerCase() === "final" ? 0 : 1;
      const bF = (b.status ?? "").toLowerCase() === "final" ? 0 : 1;
      return aF - bF;
    }).slice(0, MAX_IMAGING);
    priorImaging = finalFirst.map((im) => ({
      factId: `img_${im.id}`,
      concept: (im.study ?? "").toLowerCase(),
      displayText: `${im.study}${im.modality ? ` (${im.modality})` : ""}${im.performedAt ? ` ${im.performedAt}` : ""}${im.impression ? ` — impression: ${im.impression}` : ""}${im.status ? ` [${im.status}]` : ""}`,
      value: im.impression ?? null,
      date: im.performedAt ?? null,
      sourceType: `patient_imaging_studies${im.reportDocumentReferenceId != null ? `#ref${im.reportDocumentReferenceId}` : ""}`,
      sourceRecordId: String(im.id),
      evidenceClass: "prior_imaging_result",
    }));
    for (const im of finalFirst) sourceRecordIds.push(`patient_imaging:${im.id}`);

    // ── Clinical notes / encounters (structured summary only — never raw body) ──
    const encRows = await db.select().from(patientEncounters)
      .where(and(eq(patientEncounters.patientScreeningId, screeningId), eq(patientEncounters.clinicId, input.clinicId)))
      .orderBy(desc(patientEncounters.occurredAt)).limit(MAX_ENCOUNTERS);
    clinicalNotes = encRows
      .filter((e) => (e.summary ?? "").trim().length > 0)
      .map((e) => ({
        factId: `enc_${e.id}`,
        concept: (e.title ?? "").toLowerCase(),
        displayText: `${e.title}${e.occurredAt ? ` (${e.occurredAt})` : ""}: ${e.summary}`,
        value: e.summary ?? null,
        date: e.occurredAt ?? null,
        sourceType: `patient_encounters${e.category ? `.${e.category}` : ""}`,
        sourceRecordId: String(e.id),
        evidenceClass: "clinical_note_evidence",
      }));
    for (const e of encRows) sourceRecordIds.push(`patient_encounter:${e.id}`);

    // ── Clinician-entered structured findings (exclude ICD fields) ──
    const findingRows = await db.select().from(plexusClinicalFindings)
      .where(and(eq(plexusClinicalFindings.patientScreeningId, screeningId), eq(plexusClinicalFindings.clinicId, input.clinicId)))
      .orderBy(desc(plexusClinicalFindings.sourceDate)).limit(MAX_FINDINGS);
    clinicianFindings = findingRows
      .filter((f) => f.reviewStatus !== "rejected")
      .map((f) => ({
        factId: `finding_${f.id}`,
        concept: (f.normalizedConcept ?? f.displayName ?? "").toLowerCase(),
        displayText: `${f.displayName}${f.sourceValue ? `: ${f.sourceValue}` : ""}${f.sourceExcerpt ? ` — "${f.sourceExcerpt}"` : ""}`,
        value: f.sourceValue ?? null,
        date: f.sourceDate ?? null,
        sourceType: `plexus_clinical_findings.${f.findingType}/${f.sourceType}`,
        sourceRecordId: String(f.id),
        evidenceClass: "clinician_entered_finding",
      }));
    for (const f of findingRows) sourceRecordIds.push(`clinical_finding:${f.id}`);
  }

  // ── Structured screening (A0) ──
  const current = await getCurrentScreeningEvidence({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, serviceType });
  let structuredScreening: OrderNoteEvidenceBundle["structuredScreening"] = null;
  if (current) {
    sourceRecordIds.push(`screening_evidence:${current.readinessId}`);
    const findings: ScreeningFindingFact[] = current.evidence.responses
      .filter((r) => isPositiveScreening(r.responseType, (r as { value: unknown }).value))
      .map((r) => {
        const anyR = r as unknown as { questionId: string; concept: string; value: number | boolean; normalizedMeaning?: string; evidenceClass: string; section: string };
        return {
          questionId: anyR.questionId,
          concept: anyR.concept,
          displayText: screeningConceptDisplay(anyR.concept),
          value: anyR.value,
          normalizedMeaning: anyR.normalizedMeaning ?? null,
          evidenceClass: anyR.evidenceClass,
          section: anyR.section,
        };
      });
    structuredScreening = {
      questionnaire: current.evidence.questionnaire,
      version: current.version,
      completedAt: current.evidence.capture?.documentedAt ?? null,
      findings,
    };
  }

  // ── Qualification reasoning for THIS service ──
  const qualification = qualificationForService((ps?.reasoning as Record<string, unknown> | null) ?? null, serviceType);

  const age = ageFromDob(ps?.dob ?? null, (ps as { age?: number | null } | undefined)?.age ?? null);

  return {
    bundleVersion: ORDER_NOTE_EVIDENCE_BUNDLE_VERSION,
    service: serviceType,
    serviceLabel: cfg.serviceLabel,
    orderedComponents: cfg.orderedComponents,
    patient: {
      name: ps?.name ?? "Patient",
      dob: ps?.dob ?? null,
      age,
      sex: (ps as { gender?: string | null } | undefined)?.gender ?? null,
      plexusId: (acase as { globalPlexusPatientId?: number | null }).globalPlexusPatientId?.toString() ?? null,
      clinicName,
    },
    orderingClinician: { name: clinicianName ?? "Ordering Clinician", npi: null },
    orderDate: null,
    diagnoses,
    history,
    medications,
    labs,
    vitals,
    priorImaging,
    clinicalNotes,
    clinicianFindings,
    structuredScreening,
    qualification,
    adminReview: { status: (acase as { adminReviewStatus?: string | null }).adminReviewStatus ?? null },
    screeningEvidenceVersion: current?.version ?? null,
    sourceRecordIds,
  };
}

function qualificationForService(
  reasoning: Record<string, unknown> | null,
  service: string,
): { factors: string[]; clinicianUnderstanding: string | null } {
  if (!reasoning) return { factors: [], clinicianUnderstanding: null };
  const s = (service || "").toLowerCase();
  const key = Object.keys(reasoning).find((k) => {
    const kl = k.toLowerCase();
    return (s.includes("brain") && kl.includes("brain")) || (s.includes("vital") && kl.includes("vital")) || kl === s || kl.includes(s) || s.includes(kl);
  });
  const r = key ? (reasoning[key] as Record<string, unknown> | undefined) : undefined;
  if (!r || typeof r !== "object") return { factors: [], clinicianUnderstanding: null };
  const factors = Array.isArray(r["qualifying_factors"]) ? (r["qualifying_factors"] as unknown[]).map(String) : [];
  const cu = typeof r["clinician_understanding"] === "string" ? (r["clinician_understanding"] as string) : null;
  return { factors, clinicianUnderstanding: cu };
}

/** Stable provenance fingerprint of the exact evidence sent to the model. */
export function orderNoteEvidenceBundleFingerprint(bundle: OrderNoteEvidenceBundle): string {
  const facts = [
    ...bundle.diagnoses, ...bundle.history, ...bundle.medications, ...bundle.labs,
    ...bundle.vitals, ...bundle.priorImaging, ...bundle.clinicalNotes, ...bundle.clinicianFindings,
  ].map((f) => `${f.evidenceClass}|${f.sourceRecordId ?? ""}|${f.concept}|${String(f.value ?? "")}`).sort();
  const screening = (bundle.structuredScreening?.findings ?? [])
    .map((f) => `${f.questionId}=${typeof f.value === "boolean" ? (f.value ? "T" : "F") : f.value}`).sort();
  const components = bundle.orderedComponents.map((c) => c.key).sort();
  return crypto.createHash("sha256").update(JSON.stringify({
    service: bundle.service, facts, screening, components,
    factors: [...bundle.qualification.factors].sort(),
  })).digest("hex").slice(0, 40);
}
