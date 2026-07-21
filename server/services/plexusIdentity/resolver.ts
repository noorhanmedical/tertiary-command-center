/**
 * Central Plexus identity resolver.
 *
 * The one entry point through which any incoming patient row
 * (screening import, engagement handoff, backfill) is reconciled
 * against the global registry.
 *
 * Outcomes (audit §3.2):
 *   A. definitive_match  — deterministic ID signal matched.
 *                          Reuse the existing global_plexus_patient
 *                          and existing membership.
 *   B. possible_match    — non-deterministic signals overlap.
 *                          Do NOT auto-merge. Queue a candidate for
 *                          Plexus-internal review.
 *   C. no_match          — nothing overlapped. Create a new global
 *                          patient + membership.
 *
 * Deterministic signals (definitive):
 *   • Prior Plexus ID (same or via alias)
 *   • Clinic MRN within the same clinic (uniqueness index enforces one hit)
 *
 * Non-deterministic signals (possible-match only; NEVER auto-merge):
 *   • Normalized (name, DOB) collision
 *   • Phone collision
 *   • Email collision
 *
 * Rules that are IMMUTABLE by policy:
 *   • Name + DOB alone are never a definitive match.
 *   • Fuzzy demographic similarity is never a definitive match.
 *   • A cross-clinic clinic-MRN collision is never a match (MRNs are
 *     scoped per clinic).
 *
 * This file performs NO writes on its own — it either returns a
 * resolution decision, or, when the write flag is ON, defers to
 * `plexusIdentity.repo` for the mutations.
 */

import {
  createGlobalPatient,
  createMatchCandidate,
  createMembership,
  findActiveMembership,
  findAlias,
  findExternalIdentifiersByMatchValue,
  findGlobalPatientById,
  findGlobalPatientByPlexusId,
  findMembershipByClinicMrn,
} from "../../repositories/plexusIdentity.repo";
import type { GlobalPlexusPatient, PatientClinicMembership } from "@shared/schema/plexusIdentity";
import { normalizeName, normalizeDob, normalizePhone, normalizeEmail, normalizeMrn } from "./normalization";

export type IdentityResolutionInput = {
  clinicId: number;
  displayName?: string | null;
  dob?: string | null;
  phone?: string | null;
  email?: string | null;
  clinicMrn?: string | null;
  priorPlexusId?: string | null;
  sourceSystem?: string | null;
  sourcePatientIdentifier?: string | null;
};

export type ResolutionMatchedSignal =
  | { type: "prior_plexus_id"; value: string }
  | { type: "prior_plexus_id_alias"; alias: string }
  | { type: "clinic_mrn"; clinicId: number; mrn: string }
  | { type: "name_dob"; normalizedName: string; dob: string }
  | { type: "phone"; normalizedPhone: string }
  | { type: "email"; normalizedEmail: string };

export type IdentityResolution =
  | {
      outcome: "definitive_match";
      globalPlexusPatientId: number;
      plexusId: string;
      membershipId: number | null;
      matchedSignal: ResolutionMatchedSignal;
    }
  | {
      outcome: "possible_match";
      candidates: Array<{
        globalPlexusPatientId: number;
        plexusId: string;
        matchedSignals: ResolutionMatchedSignal[];
      }>;
    }
  | {
      outcome: "no_match";
      normalizedName: string;
      normalizedDob: string;
    };

/**
 * Read-only resolution. Safe to call from anywhere. Does NOT mutate
 * even with the write flag ON — call `commitResolution` to persist.
 */
export async function resolveIdentity(
  input: IdentityResolutionInput,
): Promise<IdentityResolution> {
  // ── Step 1: prior Plexus ID (or alias) → definitive_match ────
  if (input.priorPlexusId) {
    const direct = await findGlobalPatientByPlexusId(input.priorPlexusId);
    if (direct) {
      const membership = await findActiveMembership({
        globalPlexusPatientId: direct.id,
        clinicId: input.clinicId,
      });
      return {
        outcome: "definitive_match",
        globalPlexusPatientId: direct.id,
        plexusId: direct.plexusId,
        membershipId: membership?.id ?? null,
        matchedSignal: { type: "prior_plexus_id", value: direct.plexusId },
      };
    }
    const alias = await findAlias(input.priorPlexusId);
    if (alias) {
      const surviving = await findGlobalPatientById(alias.survivingGlobalPatientId);
      if (surviving) {
        const membership = await findActiveMembership({
          globalPlexusPatientId: surviving.id,
          clinicId: input.clinicId,
        });
        return {
          outcome: "definitive_match",
          globalPlexusPatientId: surviving.id,
          plexusId: surviving.plexusId,
          membershipId: membership?.id ?? null,
          matchedSignal: { type: "prior_plexus_id_alias", alias: input.priorPlexusId },
        };
      }
    }
  }

  // ── Step 2: clinic MRN in the SAME clinic → definitive_match ─
  const normalizedMrn = normalizeMrn(input.clinicMrn);
  if (normalizedMrn) {
    const membership = await findMembershipByClinicMrn({
      clinicId: input.clinicId,
      clinicMrn: normalizedMrn,
    });
    if (membership) {
      const global = await findGlobalPatientById(membership.globalPlexusPatientId);
      if (global) {
        return {
          outcome: "definitive_match",
          globalPlexusPatientId: global.id,
          plexusId: global.plexusId,
          membershipId: membership.id,
          matchedSignal: {
            type: "clinic_mrn",
            clinicId: input.clinicId,
            mrn: normalizedMrn,
          },
        };
      }
    }
  }

  // ── Step 3: non-deterministic signals → possible_match queue ──
  const normalizedName = normalizeName(input.displayName);
  const normalizedDobValue = normalizeDob(input.dob);
  const normalizedPhoneValue = normalizePhone(input.phone);
  const normalizedEmailValue = normalizeEmail(input.email);

  const nonDeterministicHits = new Map<number, ResolutionMatchedSignal[]>();
  const record = (gpid: number, sig: ResolutionMatchedSignal) => {
    const existing = nonDeterministicHits.get(gpid) ?? [];
    existing.push(sig);
    nonDeterministicHits.set(gpid, existing);
  };

  // name + DOB match: only when both are present. Never merge on this
  // signal alone, only surface as a review candidate.
  if (normalizedName && normalizedDobValue) {
    const nameDobHits = await findExternalIdentifiersByMatchValue({
      identifierType: "external_import_id",
      normalizedOrHashedMatchValue: `${normalizedName}|${normalizedDobValue}`,
    });
    for (const h of nameDobHits) {
      record(h.globalPlexusPatientId, {
        type: "name_dob",
        normalizedName,
        dob: normalizedDobValue,
      });
    }
  }

  if (normalizedPhoneValue) {
    const phoneHits = await findExternalIdentifiersByMatchValue({
      identifierType: "external_import_id",
      normalizedOrHashedMatchValue: `phone:${normalizedPhoneValue}`,
    });
    for (const h of phoneHits) {
      record(h.globalPlexusPatientId, { type: "phone", normalizedPhone: normalizedPhoneValue });
    }
  }
  if (normalizedEmailValue) {
    const emailHits = await findExternalIdentifiersByMatchValue({
      identifierType: "external_import_id",
      normalizedOrHashedMatchValue: `email:${normalizedEmailValue}`,
    });
    for (const h of emailHits) {
      record(h.globalPlexusPatientId, { type: "email", normalizedEmail: normalizedEmailValue });
    }
  }

  if (nonDeterministicHits.size > 0) {
    const candidates: Array<{
      globalPlexusPatientId: number;
      plexusId: string;
      matchedSignals: ResolutionMatchedSignal[];
    }> = [];
    for (const [gpid, signals] of nonDeterministicHits) {
      const g = await findGlobalPatientById(gpid);
      if (g) {
        candidates.push({
          globalPlexusPatientId: g.id,
          plexusId: g.plexusId,
          matchedSignals: signals,
        });
      }
    }
    if (candidates.length > 0) {
      return { outcome: "possible_match", candidates };
    }
  }

  // ── Step 4: no_match ─────────────────────────────────────────
  return {
    outcome: "no_match",
    normalizedName,
    normalizedDob: normalizedDobValue,
  };
}

export type CommitResolutionResult = {
  globalPlexusPatientId: number;
  plexusId: string;
  membershipId: number;
  isNewGlobal: boolean;
  isNewMembership: boolean;
  queuedCandidateIds: number[];
};

/**
 * Persist the resolution. Requires FEATURE_PLEXUS_IDENTITY_WRITE. The
 * behavior per outcome:
 *   • definitive_match — reuse global; ensure clinic membership exists.
 *   • possible_match   — create the new global + membership (no merge),
 *                        record each candidate in the review queue.
 *   • no_match         — create new global + membership.
 */
export async function commitResolution(args: {
  input: IdentityResolutionInput;
  resolution: IdentityResolution;
}): Promise<CommitResolutionResult> {
  const { input, resolution } = args;

  const queuedCandidateIds: number[] = [];

  const ensureMembership = async (
    global: GlobalPlexusPatient,
  ): Promise<{ membership: PatientClinicMembership; created: boolean }> => {
    const existing = await findActiveMembership({
      globalPlexusPatientId: global.id,
      clinicId: input.clinicId,
    });
    if (existing) return { membership: existing, created: false };
    const created = await createMembership({
      globalPlexusPatientId: global.id,
      clinicId: input.clinicId,
      clinicMrn: normalizeMrn(input.clinicMrn) || null,
      sourceSystem: input.sourceSystem ?? null,
      sourcePatientIdentifier: input.sourcePatientIdentifier ?? null,
    });
    return { membership: created, created: true };
  };

  if (resolution.outcome === "definitive_match") {
    const global = await findGlobalPatientById(resolution.globalPlexusPatientId);
    if (!global) {
      throw new Error(
        `commitResolution: definitive_match referenced missing global_plexus_patient id=${resolution.globalPlexusPatientId}`,
      );
    }
    const { membership, created } = await ensureMembership(global);
    return {
      globalPlexusPatientId: global.id,
      plexusId: global.plexusId,
      membershipId: membership.id,
      isNewGlobal: false,
      isNewMembership: created,
      queuedCandidateIds,
    };
  }

  const created = await createGlobalPatient({
    displayName: input.displayName ?? null,
    normalizedName: normalizeName(input.displayName) || null,
    dob: normalizeDob(input.dob) || null,
    phone: normalizePhone(input.phone) || null,
    email: normalizeEmail(input.email) || null,
  });
  const { membership } = await ensureMembership(created);

  if (resolution.outcome === "possible_match") {
    for (const c of resolution.candidates) {
      const candidate = await createMatchCandidate({
        incomingMembershipId: membership.id,
        candidateGlobalPatientId: c.globalPlexusPatientId,
        matchedSignals: c.matchedSignals,
      });
      queuedCandidateIds.push(candidate.id);
    }
  }

  return {
    globalPlexusPatientId: created.id,
    plexusId: created.plexusId,
    membershipId: membership.id,
    isNewGlobal: true,
    isNewMembership: true,
    queuedCandidateIds,
  };
}
