// Post-signature Order Note freshness — canonical, service-agnostic.
//
// A signed Order Note is IMMUTABLE, but its authorization is not permanently
// valid: if the material canonical evidence that justified the order changes
// before the procedure, the signed note becomes STALE and must be re-reviewed.
//
// The authoritative freshness signal is the SAME canonical evidence fingerprint
// the note was generated with — orderNoteEvidenceBundleFingerprint over
// assembleOrderNoteEvidenceBundle (the one canonical evidence universe shared by
// the deterministic and AI generators). It is:
//   • service-agnostic — works for BrainWave, VitalWave, and every vascular /
//     echo / renal / LE service (screening findings contribute WHEN present but
//     are not the universal mechanism);
//   • deterministic — capture timestamps, transcription identity, row-insertion
//     time, re-submission of identical answers, and serialization order do NOT
//     move it (only clinically material evidence does);
//   • relevance-scoped — the fingerprint is computed from the case+service
//     canonical bundle (this exact ancillary case's evidence for this exact
//     ordered service), not a blind hash of every fact in the chart.
//
// This module is READ-ONLY (no writes). Regeneration of a fresh v2 lives in
// orderNoteRefresh; the fail-closed gates (procedure_start, procedure-note
// generation) consume evaluateSignedOrderNoteFreshness.

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes, type ProcedureNote } from "@shared/schema/generatedNotes";
import {
  assembleOrderNoteEvidenceBundle,
  orderNoteEvidenceBundleFingerprint,
} from "./orderNoteEvidenceBundle";

/**
 * Recompute the CURRENT canonical Order Note evidence fingerprint for an exact
 * ancillary case from live evidence. Returns null when the bundle cannot be
 * assembled (missing case / cross-clinic) — callers FAIL CLOSED on null.
 */
export async function computeCurrentOrderNoteFingerprint(input: {
  clinicId: number;
  ancillaryCaseId: number;
}): Promise<string | null> {
  const bundle = await assembleOrderNoteEvidenceBundle({
    clinicId: input.clinicId,
    ancillaryCaseId: input.ancillaryCaseId,
  });
  return bundle ? orderNoteEvidenceBundleFingerprint(bundle) : null;
}

export type SignedOrderNoteFreshness = {
  // A current (non-superseded), same-clinic, SIGNED order note exists.
  hasSignedCurrent: boolean;
  // The signed current note is fresh against current canonical evidence.
  // Meaningful only when hasSignedCurrent is true.
  fresh: boolean;
  // The exact current signed note id (or null).
  signedNoteId: number | null;
  // Fingerprint frozen on the signed note at signature time.
  signedFingerprint: string | null;
  // Current recomputed canonical fingerprint (null ⇒ could not assemble).
  currentFingerprint: string | null;
  // True when freshness could NOT be determined (no current evidence bundle).
  // Callers must FAIL CLOSED (treat as not-fresh) when a signed note exists.
  indeterminate: boolean;
};

/**
 * Evaluate whether the CURRENT active signed Order Note for a case is still
 * fresh against current canonical evidence. Pure read; never mutates the note.
 *
 * Fail-closed contract:
 *   • no signed current note        → hasSignedCurrent=false (caller handles the
 *                                     "unsigned / missing" case via its own rule)
 *   • signed + fingerprints equal   → fresh=true
 *   • signed + fingerprints differ  → fresh=false (STALE — re-review required)
 *   • signed + current unresolvable → fresh=false, indeterminate=true (fail closed)
 */
export async function evaluateSignedOrderNoteFreshness(input: {
  clinicId: number;
  ancillaryCaseId: number;
}): Promise<SignedOrderNoteFreshness> {
  const [note] = await db
    .select()
    .from(procedureNotes)
    .where(
      and(
        eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId),
        eq(procedureNotes.noteType, "order_note"),
        isNull(procedureNotes.supersededAt),
      ),
    )
    .limit(1);

  const base: SignedOrderNoteFreshness = {
    hasSignedCurrent: false, fresh: false, signedNoteId: null,
    signedFingerprint: null, currentFingerprint: null, indeterminate: false,
  };

  if (!note) return base;
  if (note.clinicId != null && note.clinicId !== input.clinicId) return base;
  if (note.signatureStatus !== "signed") return base;

  const currentFingerprint = await computeCurrentOrderNoteFingerprint(input);
  if (currentFingerprint == null) {
    // Cannot prove freshness → fail closed (not fresh) for a signed note.
    return { ...base, hasSignedCurrent: true, fresh: false, signedNoteId: note.id, signedFingerprint: note.evidenceFingerprint ?? null, indeterminate: true };
  }
  const fresh = (note.evidenceFingerprint ?? null) === currentFingerprint;
  return {
    hasSignedCurrent: true,
    fresh,
    signedNoteId: note.id,
    signedFingerprint: note.evidenceFingerprint ?? null,
    currentFingerprint,
    indeterminate: false,
  };
}

/** Pure freshness comparison for a specific note (used by portal-state derivation). */
export function isSignedNoteStale(note: Pick<ProcedureNote, "signatureStatus" | "evidenceFingerprint">, currentFingerprint: string | null): boolean {
  if (note.signatureStatus !== "signed") return false;
  if (currentFingerprint == null) return true; // fail closed
  return (note.evidenceFingerprint ?? null) !== currentFingerprint;
}
