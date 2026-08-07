/**
 * Phase 2I — PCS (Patient Care Specialist) canonical read model.
 *
 * Two independently-paginated streams over EXACT clinic data (§2/§3):
 *
 *  1. VERIFIED patients — page exact ACTIVE clinic memberships by a stable
 *     membership-id cursor; resolve each patient THROUGH the verified membership
 *     (§3 identity boundary); batch-load that patient's episodes. A patient's
 *     episodes are never split across pages; a patient with more episodes than the
 *     per-patient bound carries an `episodesNextCursor` (bounded nested episode
 *     continuation via `episodeMembershipId` + `episodeCursor`).
 *
 *  2. IDENTITY-UNRESOLVED — page same-clinic cases by an exact ancillaryCaseId
 *     cursor and surface EVERY case whose membership is invalid (null / missing /
 *     inactive / wrong-clinic / merged / conflicting patient / non-current global
 *     patient). No same-clinic case is ever silently dropped; PHI is null; each
 *     unresolved case stays separate by ancillaryCaseId. Membership rows are
 *     resolved internally by the exact ids the bounded case page carries; cross-
 *     clinic membership PHI is never returned.
 *
 * READ-ONLY, clinic-scoped in SQL AND re-filtered in memory, bounded.
 */

import { db } from "../../db";
import { and, eq, gt, inArray, asc } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { globalPlexusPatients, patientClinicMemberships } from "@shared/schema/plexusIdentity";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../../lib/featureFlags";
import { buildStageVectors, MigrationMissingError } from "../canonicalStage/caseStageVector";
import { verifyCaseIdentity } from "./pcsIdentity";
import {
  PCS_CANONICAL_VIEW_VERSION, PCS_DEFAULT_LIMIT, PCS_MAX_LIMIT, PCS_MAX_EPISODES_PER_PATIENT,
  PCS_UNRESOLVED_DEFAULT_LIMIT, PCS_UNRESOLVED_MAX_LIMIT,
  type PcsCanonicalView, type PcsPatientGroup,
} from "@shared/pcsCanonicalView";
import { decodeCursor, encodeCursor, loadCaseFilters, type CanonicalViewFilters } from "../canonicalStage/viewQuery";

export { MigrationMissingError };

// Bounded shared fetch window for the verified-patient episode page. The
// completeness algorithm below makes it LOSSLESS: any membership not fully
// represented in the window is NOT returned this page and the membership cursor
// stops before it, so it is retrieved on a later page (never permanently lost).
const PCS_VERIFIED_EPISODE_WINDOW = 5000;
// Bounded per-request continuation scan (raw cases, so it advances past invalid
// early cases to reach valid later episodes).
const PCS_CONTINUATION_SCAN = 2000;

export type PcsViewInput = {
  clinicId: number; cursor?: string | null; limit?: number; filters?: CanonicalViewFilters;
  unresolvedCursor?: string | null;
  // Nested episode continuation for ONE verified patient.
  episodeMembershipId?: number | null; episodeCursor?: string | null;
};

export async function getPcsCanonicalView(input: PcsViewInput): Promise<PcsCanonicalView> {
  const generatedAt = new Date().toISOString();
  const limit = clampLimit(input.limit, PCS_DEFAULT_LIMIT, PCS_MAX_LIMIT);
  const base = { disabled: false, generatedAt, dataVersion: PCS_CANONICAL_VIEW_VERSION, clinicScoped: true as const };
  if (!featureFlags.ancillaryCaseWrite) {
    return { ...base, availability: "upstream_flag_off", warnings: ["ancillary_case_flag_off"], rows: [], pageInfo: { limit, nextCursor: null, returned: 0 }, unresolved: { rows: [], pageInfo: { limit: PCS_UNRESOLVED_DEFAULT_LIMIT, nextCursor: null, returned: 0 } } };
  }
  const filters = loadCaseFilters(input.filters);

  // ── Mode: nested episode continuation for a single verified patient ──
  if (input.episodeMembershipId != null) {
    const group = await loadPatientEpisodeContinuation(input.clinicId, input.episodeMembershipId, decodeCursor(input.episodeCursor), filters);
    return { ...base, availability: "available", warnings: [], rows: group ? [group] : [], pageInfo: { limit, nextCursor: null, returned: group ? 1 : 0 }, unresolved: { rows: [], pageInfo: { limit: PCS_UNRESOLVED_DEFAULT_LIMIT, nextCursor: null, returned: 0 } } };
  }

  const verified = await loadVerifiedStream(input.clinicId, decodeCursor(input.cursor), limit, filters);
  const unresolved = await loadUnresolvedStream(input.clinicId, decodeCursor(input.unresolvedCursor), clampLimit(undefined, PCS_UNRESOLVED_DEFAULT_LIMIT, PCS_UNRESOLVED_MAX_LIMIT), filters);
  return { ...base, availability: "available", warnings: [], rows: verified.rows, pageInfo: verified.pageInfo, unresolved };
}

// ─── verified patient stream (lossless window + completeness) ────────────────
async function loadVerifiedStream(clinicId: number, afterMemberId: number | null, limit: number, filters: ReturnType<typeof loadCaseFilters>) {
  const memConds = [eq(patientClinicMemberships.clinicId, clinicId), eq(patientClinicMemberships.membershipStatus, "active")];
  if (afterMemberId != null) memConds.push(gt(patientClinicMemberships.id, afterMemberId));
  const raw = await db.select().from(patientClinicMemberships).where(and(...memConds)).orderBy(asc(patientClinicMemberships.id)).limit(limit + 1);
  const filtered = raw.filter((m) => m.clinicId === clinicId && m.membershipStatus === "active" && (afterMemberId == null || m.id > afterMemberId)).sort((a, b) => a.id - b.id);
  const memberHasMore = filtered.length > limit;
  const members = filtered.slice(0, limit);
  const memberIds = members.map((m) => m.id);
  if (!memberIds.length) return { rows: [] as PcsPatientGroup[], pageInfo: { limit, nextCursor: null, returned: 0 } };
  const gppById = await loadGpps([...new Set(members.map((m) => m.globalPlexusPatientId).filter((x): x is number => x != null))]);

  // Bounded shared window over the paged memberships' cases, ordered by
  // (membership, id). The completeness/lossless guarantee below is contingent on
  // the DB honoring THIS deterministic ordering + LIMIT (a non-deterministic scan
  // must never silently reshape the window). The fake db ignores ORDER BY/LIMIT,
  // so re-order + slice in memory to mirror production and expose the SAME
  // truncation boundary.
  const caseConds = [eq(patientAncillaryCases.clinicId, clinicId), inArray(patientAncillaryCases.patientClinicMembershipId, memberIds)];
  applyCaseFilters(caseConds, filters);
  const casesRaw = await db.select().from(patientAncillaryCases).where(and(...caseConds)).orderBy(asc(patientAncillaryCases.patientClinicMembershipId), asc(patientAncillaryCases.id)).limit(PCS_VERIFIED_EPISODE_WINDOW + 1);
  const sorted = casesRaw.filter((c) => c.clinicId === clinicId && c.patientClinicMembershipId != null && memberIds.includes(c.patientClinicMembershipId) && matchesFilters(c, filters))
    .sort((a, b) => (a.patientClinicMembershipId! - b.patientClinicMembershipId!) || (a.id - b.id));
  const windowFull = sorted.length > PCS_VERIFIED_EPISODE_WINDOW;
  const windowed = sorted.slice(0, PCS_VERIFIED_EPISODE_WINDOW);
  const byMember = new Map<number, PatientAncillaryCase[]>();
  for (const c of windowed) { const arr = byMember.get(c.patientClinicMembershipId!) ?? []; arr.push(c); byMember.set(c.patientClinicMembershipId!, arr); }
  const lastPresent = byMember.size ? Math.max(...byMember.keys()) : null;

  // Completeness: without a full window every paged membership is fully covered.
  // With a full window, only memberships up to `lastPresent` are represented; the
  // tail member `lastPresent` may be truncated (later episodes beyond the window)
  // and gets a forced continuation cursor; memberships beyond `lastPresent` are
  // NOT returned and the membership cursor stops at `lastPresent` so they are
  // retrieved next page (never lost).
  const returnMembers = windowFull && lastPresent != null ? members.filter((m) => m.id <= lastPresent) : members;
  const membershipNextCursor = windowFull && lastPresent != null
    ? encodeCursor(lastPresent)
    : (memberHasMore && members.length ? encodeCursor(members[members.length - 1].id) : null);

  // First pass: per returned membership, resolve its verified identity + bounded
  // first page of VALID episodes + continuation cursor. NO canonical source reads
  // here — collect every valid episode case for ALL returned memberships so the
  // stage vectors can be built in ONE batched call (no per-membership / per-case
  // N+1).
  type Plan = { m: typeof members[number]; gpp: typeof globalPlexusPatients.$inferSelect; pageValid: PatientAncillaryCase[]; episodesNextCursor: string | null };
  const plans: Plan[] = [];
  const allValidCases: PatientAncillaryCase[] = [];
  for (const m of returnMembers) {
    const gpp = m.globalPlexusPatientId != null ? gppById.get(m.globalPlexusPatientId) : undefined;
    // A membership yields a VERIFIED patient only when its global patient is
    // current (active, not merged). Otherwise its cases flow to the unresolved
    // stream (never a verified group with fabricated identity).
    if (!isCurrentPatient(gpp, m.globalPlexusPatientId)) continue;
    const memberCases = byMember.get(m.id) ?? []; // raw window cases (id order)
    const validCases = memberCases.filter((c) => c.globalPlexusPatientId === m.globalPlexusPatientId); // exact episodes
    const pageValid = validCases.slice(0, PCS_MAX_EPISODES_PER_PATIENT);
    const memberTruncated = windowFull && m.id === lastPresent; // later cases beyond window
    const episodesNextCursor = validCases.length > PCS_MAX_EPISODES_PER_PATIENT
      ? encodeCursor(pageValid[pageValid.length - 1].id)                          // more valid beyond the shown page
      : (memberTruncated && memberCases.length ? encodeCursor(memberCases[memberCases.length - 1].id) : null); // scan past the window for later valid episodes
    // Only materialize a patient with at least one in-window episode OR a
    // continuation to its later valid episodes (never a permanently empty group).
    if (pageValid.length === 0 && !episodesNextCursor) continue;
    plans.push({ m, gpp: gpp!, pageValid, episodesNextCursor });
    allValidCases.push(...pageValid);
  }

  // ONE batched stage-vector build for the entire verified PCS page (at most one
  // read per canonical source total — never scaling with the patient-group count).
  const vectors = await buildStageVectors({ clinicId, cases: allValidCases });
  const vectorByCase = new Map(vectors.map((v) => [v.ancillaryCaseId, v]));

  const rows: PcsPatientGroup[] = plans.map((p) => assembleVerifiedGroup(p.m, p.gpp, p.pageValid, vectorByCase, p.episodesNextCursor));
  return { rows, pageInfo: { limit, nextCursor: membershipNextCursor, returned: rows.length } };
}

// Assemble a verified patient group from PRE-BUILT stage vectors (no DB reads).
function assembleVerifiedGroup(m: typeof patientClinicMemberships.$inferSelect, gpp: typeof globalPlexusPatients.$inferSelect, pageValid: PatientAncillaryCase[], vectorByCase: Map<number, PcsPatientGroup["episodes"][number]>, episodesNextCursor: string | null): PcsPatientGroup {
  const episodes: PcsPatientGroup["episodes"] = [];
  for (const c of pageValid) {
    const v = vectorByCase.get(c.id);
    if (!v) continue;
    v.identity.patientDisplay = gpp.displayName ?? null; v.identity.patientDob = gpp.dob ?? null; v.identity.clinicMrn = m.clinicMrn ?? null; v.identity.available = true; v.identity.warnings = [];
    episodes.push(v);
  }
  return {
    globalPlexusPatientId: m.globalPlexusPatientId, patientClinicMembershipId: m.id,
    patientDisplay: gpp.displayName ?? null, patientDob: gpp.dob ?? null, clinicMrn: m.clinicMrn ?? null,
    identityAvailable: true, identityWarnings: [], episodes, episodesNextCursor,
  };
}

// Per-patient episode continuation — scans RAW cases past the cursor (so it moves
// past invalid early cases to reach later valid episodes) for ONE exact active
// this-clinic membership; returns the next bounded page of VALID episodes.
async function loadPatientEpisodeContinuation(clinicId: number, membershipId: number, afterCaseId: number | null, filters: ReturnType<typeof loadCaseFilters>): Promise<PcsPatientGroup | null> {
  const memRaw = await db.select().from(patientClinicMemberships).where(and(eq(patientClinicMemberships.clinicId, clinicId), eq(patientClinicMemberships.id, membershipId))).limit(2);
  const m = memRaw.find((x) => x.id === membershipId && x.clinicId === clinicId && x.membershipStatus === "active");
  if (!m) return null;
  const gpp = m.globalPlexusPatientId != null ? (await loadGpps([m.globalPlexusPatientId])).get(m.globalPlexusPatientId) : undefined;
  if (!isCurrentPatient(gpp, m.globalPlexusPatientId)) return null;
  const conds = [eq(patientAncillaryCases.clinicId, clinicId), eq(patientAncillaryCases.patientClinicMembershipId, membershipId)];
  if (afterCaseId != null) conds.push(gt(patientAncillaryCases.id, afterCaseId));
  applyCaseFilters(conds, filters);
  const raw = await db.select().from(patientAncillaryCases).where(and(...conds)).orderBy(asc(patientAncillaryCases.id)).limit(PCS_CONTINUATION_SCAN + 1);
  const scanned = raw.filter((c) => c.clinicId === clinicId && c.patientClinicMembershipId === membershipId && (afterCaseId == null || c.id > afterCaseId) && matchesFilters(c, filters)).sort((a, b) => a.id - b.id);
  const scanFull = scanned.length > PCS_CONTINUATION_SCAN;
  const window = scanned.slice(0, PCS_CONTINUATION_SCAN);
  const validCases = window.filter((c) => c.globalPlexusPatientId === m.globalPlexusPatientId);
  const pageValid = validCases.slice(0, PCS_MAX_EPISODES_PER_PATIENT);
  const next = validCases.length > PCS_MAX_EPISODES_PER_PATIENT
    ? encodeCursor(pageValid[pageValid.length - 1].id)
    : (scanFull && window.length ? encodeCursor(window[window.length - 1].id) : null); // more raw cases to scan for later valid episodes
  return buildVerifiedGroup(clinicId, m, gpp!, pageValid, next);
}

function isCurrentPatient(gpp: typeof globalPlexusPatients.$inferSelect | undefined, expectedId: number | null): boolean {
  return !!gpp && expectedId != null && gpp.id === expectedId && gpp.identityStatus === "active" && gpp.mergedIntoPatientId == null;
}

async function buildVerifiedGroup(clinicId: number, m: typeof patientClinicMemberships.$inferSelect, gpp: typeof globalPlexusPatients.$inferSelect, validCases: PatientAncillaryCase[], episodesNextCursor: string | null): Promise<PcsPatientGroup> {
  const vectors = await buildStageVectors({ clinicId, cases: validCases });
  for (const v of vectors) { v.identity.patientDisplay = gpp.displayName ?? null; v.identity.patientDob = gpp.dob ?? null; v.identity.clinicMrn = m.clinicMrn ?? null; v.identity.available = true; v.identity.warnings = []; }
  return {
    globalPlexusPatientId: m.globalPlexusPatientId, patientClinicMembershipId: m.id,
    patientDisplay: gpp.displayName ?? null, patientDob: gpp.dob ?? null, clinicMrn: m.clinicMrn ?? null,
    identityAvailable: true, identityWarnings: [], episodes: vectors, episodesNextCursor,
  };
}

// ─── identity-unresolved stream ──────────────────────────────────────────────
async function loadUnresolvedStream(clinicId: number, afterCaseId: number | null, limit: number, filters: ReturnType<typeof loadCaseFilters>) {
  // Scan same-clinic cases by exact case-id cursor; a case that resolves to a
  // verified patient belongs to the verified stream and is skipped here (leaving
  // the cursor to advance past it so nothing is unretrievable).
  const conds = [eq(patientAncillaryCases.clinicId, clinicId)];
  if (afterCaseId != null) conds.push(gt(patientAncillaryCases.id, afterCaseId));
  applyCaseFilters(conds, filters);
  const raw = await db.select().from(patientAncillaryCases).where(and(...conds)).orderBy(asc(patientAncillaryCases.id)).limit(limit + 1);
  const scanned = raw.filter((c) => c.clinicId === clinicId && (afterCaseId == null || c.id > afterCaseId) && matchesFilters(c, filters)).sort((a, b) => a.id - b.id).slice(0, limit + 1);
  const hasMore = scanned.length > limit;
  const page = scanned.slice(0, limit);
  const nextCursor = hasMore && page.length ? encodeCursor(page[page.length - 1].id) : null;

  // Resolve membership rows for the page's non-null membership ids (by id). gpp is
  // loaded only for THIS-clinic ACTIVE memberships (never cross-clinic PHI).
  const memIds = [...new Set(page.map((c) => c.patientClinicMembershipId).filter((x): x is number => x != null))];
  const memRows = memIds.length ? await db.select().from(patientClinicMemberships).where(inArray(patientClinicMemberships.id, memIds)).limit(PCS_UNRESOLVED_MAX_LIMIT * 2) : [];
  const memById = new Map(memRows.map((m) => [m.id, m]));
  const gppIds = [...new Set(memRows.filter((m) => m.clinicId === clinicId && m.membershipStatus === "active").map((m) => m.globalPlexusPatientId).filter((x): x is number => x != null))];
  const gppById = await loadGpps(gppIds);

  // Classify: keep only cases that do NOT resolve to a verified patient.
  const unresolvedCases: PatientAncillaryCase[] = [];
  const idresByCase = new Map<number, ReturnType<typeof verifyCaseIdentity>>();
  for (const c of page) {
    const membership = c.patientClinicMembershipId != null ? memById.get(c.patientClinicMembershipId) : undefined;
    const globalPatient = membership?.clinicId === clinicId && membership?.membershipStatus === "active" && membership?.globalPlexusPatientId != null ? gppById.get(membership.globalPlexusPatientId) : undefined;
    const idres = verifyCaseIdentity({ clinicId, caseGlobalPatientId: c.globalPlexusPatientId ?? null, caseMembershipId: c.patientClinicMembershipId ?? null, membership, globalPatient });
    if (idres.resolved) continue; // belongs to the verified stream
    unresolvedCases.push(c); idresByCase.set(c.id, idres);
  }
  const vectors = await buildStageVectors({ clinicId, cases: unresolvedCases });
  const byId = new Map(vectors.map((v) => [v.ancillaryCaseId, v]));
  const rows: PcsPatientGroup[] = unresolvedCases.map((c) => {
    const idres = idresByCase.get(c.id)!;
    const v = byId.get(c.id);
    if (v) { v.identity.patientDisplay = null; v.identity.patientDob = null; v.identity.clinicMrn = null; v.identity.available = false; v.identity.warnings = idres.warnings; }
    return {
      globalPlexusPatientId: null, patientClinicMembershipId: null, patientDisplay: null, patientDob: null, clinicMrn: null,
      identityAvailable: false, identityWarnings: idres.warnings, episodes: v ? [v] : [], episodesNextCursor: null,
    };
  });
  // `returned` = unresolved rows actually returned; `scanned` = cases examined
  // (the cursor may advance over verified cases skipped here). The UI shows
  // `returned`, never `scanned`.
  return { rows, pageInfo: { limit, nextCursor, returned: rows.length, scanned: page.length } };
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const PCS_DISPLAY_MIGRATION_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);
async function loadGpps(ids: number[]): Promise<Map<number, typeof globalPlexusPatients.$inferSelect>> {
  if (!ids.length) return new Map();
  try {
    const rows = await db.select().from(globalPlexusPatients).where(inArray(globalPlexusPatients.id, ids)).limit(PCS_MAX_LIMIT * 4);
    return new Map(rows.map((r) => [r.id, r]));
  } catch (e) {
    // K18: identity DISPLAY is not allowed to fail canonical case truth. A missing
    // canonical table (migration) MUST still propagate → the route answers 503. An
    // ORDINARY read failure degrades to "display unavailable": return an empty map so
    // every affected group falls back to unverified identity (fail-closed) with a null
    // display — the verified identity IDs on the case/vector are preserved, and identity
    // is NEVER inferred from demographics.
    if (PCS_DISPLAY_MIGRATION_CODES.has((e as { code?: string })?.code ?? "")) throw e;
    return new Map();
  }
}
function matchesFilters(c: PatientAncillaryCase, f: ReturnType<typeof loadCaseFilters>): boolean {
  if (f.serviceType && c.serviceType !== f.serviceType) return false;
  if (f.lifecycleStatus && c.lifecycleStatus !== f.lifecycleStatus) return false;
  if (f.adminReviewStatus && c.adminReviewStatus !== f.adminReviewStatus) return false;
  return true;
}
function applyCaseFilters(conds: unknown[], filters: ReturnType<typeof loadCaseFilters>): void {
  if (filters.serviceType) (conds as ReturnType<typeof eq>[]).push(eq(patientAncillaryCases.serviceType, filters.serviceType));
  if (filters.lifecycleStatus) (conds as ReturnType<typeof eq>[]).push(eq(patientAncillaryCases.lifecycleStatus, filters.lifecycleStatus));
  if (filters.adminReviewStatus) (conds as ReturnType<typeof eq>[]).push(eq(patientAncillaryCases.adminReviewStatus, filters.adminReviewStatus));
}
function clampLimit(n: number | undefined, def: number, max: number): number {
  if (!Number.isFinite(n) || n == null) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
}
