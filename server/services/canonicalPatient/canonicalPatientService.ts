// Canonical Patient write boundary.
//
// THE single service every patient source converges through: manual Add,
// smart paste, bulk import, and Plexus IQ. It owns — in one place — the write
// semantics that were previously scattered and inconsistent:
//
//   normalize → derive clinic from facility → duplicate/identity resolution
//     → canonical persistence (via screening.repo) → provenance stamp
//     → existing identity link (flag-gated, preserved) → audit
//
// It does NOT create execution cases / engagement journeys — that stays
// deferred to commit/approval (createOrUpdateExecutionCaseFromScreening), so
// re-import / edit / IQ re-entry never resets outreach or engagement history.
//
// No new patient table: patients still live in `patient_screenings`. The
// canonical identity registry (global_plexus_patients + patient_clinic_
// memberships) is reused via the existing resolveAndLinkPlexusIdentity link.

import type { Request } from "express";
import { storage } from "../../storage";
import { logAudit } from "../auditService";
import { createFacilityResolver } from "../facilityResolver";
import { resolveAndLinkPlexusIdentityForScreening } from "../plexusIdentity/screeningIntegration";
import {
  buildPatientIdentityIndex,
  lookupPatientInIndex,
  type PatientIdentityIndex,
  type PatientMatchTier,
} from "@shared/patientIdentity";
import {
  normalizePatientDraft,
  draftToIdentityInput,
  isIdentitySensitiveChange,
  buildScreeningInsertValues,
  type CanonicalPatientDraft,
  type PatientDraftPatch,
  type PatientProvenance,
} from "@shared/canonicalPatientDraft";
import type { PatientScreening } from "@shared/schema";

export type DuplicateCandidate = {
  screeningId: number;
  name: string;
  dob: string | null;
  mrn: string | null;
  facility: string | null;
  phone: string | null;
  matchTier: PatientMatchTier;
};

type ExistingRef = DuplicateCandidate;

/** Derive the integer clinic tenant from a facility name (Admin Settings →
 *  legacy allowlist). Returns null when the facility isn't a clinics row. */
export async function deriveClinicIdFromFacility(
  facility: string | null | undefined,
): Promise<{ clinicId: number | null; canonicalFacility: string | null }> {
  const { resolve } = await createFacilityResolver();
  const hit = resolve(facility);
  return { clinicId: hit?.clinicId ?? null, canonicalFacility: hit?.name ?? null };
}

/** Build a duplicate index over existing (non-deleted) patients in scope.
 *  Uses the SAME shared matcher as bulk dedup, so single-add / paste / IQ all
 *  classify identically — regardless of the identity feature flag. */
export async function loadDuplicateIndex(
  clinicId: number | null,
): Promise<PatientIdentityIndex<ExistingRef>> {
  const all = await storage.getAllPatientScreenings();
  const scoped = clinicId == null ? all : all.filter((p) => p.clinicId === clinicId);
  const refs: ExistingRef[] = scoped.map((p) => ({
    screeningId: p.id,
    name: p.name,
    dob: p.dob ?? null,
    mrn: (p as { mrn?: string | null }).mrn ?? null,
    facility: p.facility ?? null,
    phone: p.phoneNumber ?? null,
    matchTier: "name_dob_phone",
  }));
  return buildPatientIdentityIndex(refs, (r) => ({
    name: r.name, dob: r.dob, mrn: r.mrn, facility: r.facility, phoneNumber: r.phone,
  }));
}

/** Resolve duplicate candidates for a draft against existing patients.
 *  Returns the strongest match (if any). Never mutates anything. */
export async function resolveCanonicalPatientCandidates(
  draft: CanonicalPatientDraft,
  clinicId: number | null,
  opts: { excludeScreeningId?: number } = {},
): Promise<DuplicateCandidate | null> {
  const index = await loadDuplicateIndex(clinicId);
  const hit = lookupPatientInIndex(index, draftToIdentityInput(draft));
  if (!hit) return null;
  if (opts.excludeScreeningId && hit.row.screeningId === opts.excludeScreeningId) return null;
  return { ...hit.row, matchTier: hit.tier };
}

export type CreateCanonicalPatientResult = {
  status: "created" | "duplicate_blocked";
  patient?: PatientScreening;
  duplicate?: DuplicateCandidate;
  identityStatus?: string;
};

/**
 * Create ONE canonical patient from a draft + provenance. All sources call
 * this. `force` bypasses the duplicate block (authorized "create as new").
 * `req` (optional) enables session-scoped audit.
 */
export async function createCanonicalPatient(args: {
  draft: CanonicalPatientDraft;
  provenance: PatientProvenance;
  batchId: number;
  force?: boolean;
  req?: Request;
}): Promise<CreateCanonicalPatientResult> {
  const draft = normalizePatientDraft(args.draft);
  if (!draft.name) throw new Error("Patient name is required");

  // Derive clinic from facility unless provenance already fixed it.
  let clinicId = args.provenance.clinicId ?? null;
  let facility = draft.facility ?? args.provenance.facility ?? null;
  if (clinicId == null && facility) {
    const derived = await deriveClinicIdFromFacility(facility);
    clinicId = derived.clinicId;
    facility = derived.canonicalFacility ?? facility;
  }

  // Duplicate resolution (shared matcher, NOT flag-gated).
  if (!args.force) {
    const dup = await resolveCanonicalPatientCandidates(draft, clinicId);
    if (dup) return { status: "duplicate_blocked", duplicate: dup };
  }

  // Canonical persistence via the SINGLE shared insert-value builder +
  // screening.repo. Every source builds its insert through buildScreeningInsertValues.
  const patient = await storage.createPatientScreening(
    buildScreeningInsertValues(draft, {
      batchId: args.batchId,
      sourceType: args.provenance.sourceType,
      clinicId,
      facility,
      importJobId: args.provenance.importJobId ?? null,
      importRowIndex: args.provenance.importRowIndex ?? null,
    }) as never,
  );

  // Existing identity link (reuse-or-create global identity). Flag-gated inside;
  // never throws fatally — a link failure must not lose the patient.
  let identityStatus = "unknown";
  try {
    const link = await resolveAndLinkPlexusIdentityForScreening({
      screeningId: patient.id,
      clinicId,
      sourceSystem: args.provenance.sourceSystem ?? args.provenance.sourceType,
      clinicMrn: draft.mrn ?? null,
      demographics: {
        displayName: draft.name,
        dob: draft.dob ?? null,
        phone: draft.phoneNumber ?? null,
        email: draft.email ?? null,
      },
    });
    identityStatus = link.status;
  } catch (err) {
    console.error("[canonicalPatient] identity link failed:", (err as Error)?.message);
  }

  if (args.req) {
    void logAudit(args.req, "create", "patient", patient.id, {
      sourceType: args.provenance.sourceType,
      facility,
      clinicId,
      forced: !!args.force,
    });
  }

  return { status: "created", patient, identityStatus };
}

export type UpdateCanonicalPatientResult = {
  status: "updated" | "not_found" | "identity_collision";
  patient?: PatientScreening;
  collision?: DuplicateCandidate;
  changedFields?: string[];
};

/**
 * Update an existing canonical patient. Identity-sensitive changes (name / dob
 * / mrn / phone / facility) rerun duplicate resolution and BLOCK on a collision
 * with a DIFFERENT existing patient (never silently merge/overwrite). Audited.
 * Does not touch execution cases / outreach history.
 */
export async function updateCanonicalPatient(args: {
  screeningId: number;
  updates: PatientDraftPatch;
  force?: boolean;
  req?: Request;
}): Promise<UpdateCanonicalPatientResult> {
  const current = await storage.getPatientScreening(args.screeningId);
  if (!current) return { status: "not_found" };

  // Only the provided fields change.
  const changedFields = Object.keys(args.updates).filter((k) => {
    const v = (args.updates as Record<string, unknown>)[k];
    return v !== undefined;
  });

  // Build the post-edit draft for identity re-resolution.
  const mergedFacility = args.updates.facility ?? current.facility ?? null;
  let clinicId = current.clinicId ?? null;
  if (args.updates.facility && args.updates.facility !== current.facility) {
    const derived = await deriveClinicIdFromFacility(args.updates.facility);
    if (derived.clinicId != null) clinicId = derived.clinicId;
  }

  if (!args.force && isIdentitySensitiveChange(changedFields)) {
    const postDraft = normalizePatientDraft({
      name: args.updates.name ?? current.name,
      dob: args.updates.dob ?? current.dob,
      mrn: args.updates.mrn ?? (current as { mrn?: string | null }).mrn ?? null,
      facility: mergedFacility,
      phoneNumber: args.updates.phoneNumber ?? current.phoneNumber,
    });
    const collision = await resolveCanonicalPatientCandidates(postDraft, clinicId, {
      excludeScreeningId: args.screeningId,
    });
    if (collision) return { status: "identity_collision", collision, changedFields };
  }

  const patch: Record<string, unknown> = {};
  const map: Record<string, string> = {
    name: "name", dob: "dob", gender: "gender", age: "age", phoneNumber: "phoneNumber",
    email: "email", mrn: "mrn", insurance: "insurance", facility: "facility",
    diagnoses: "diagnoses", medications: "medications", history: "history",
    notes: "notes", patientType: "patientType",
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (args.updates as Record<string, unknown>)[k];
    if (v !== undefined) patch[col] = v === "" ? null : v;
  }
  if (args.updates.facility && clinicId != null) patch.clinicId = clinicId;

  const patient = await storage.updatePatientScreening(args.screeningId, patch as never);
  if (!patient) return { status: "not_found" };

  if (args.req) {
    void logAudit(args.req, "update", "patient", args.screeningId, {
      changedFields,
      identitySensitive: isIdentitySensitiveChange(changedFields),
    });
  }
  return { status: "updated", patient, changedFields };
}
