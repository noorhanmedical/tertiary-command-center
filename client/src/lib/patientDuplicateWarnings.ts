// Duplicate warning engine (Batch B5).
//
// Pure module. Walks a current roster against one or more prior runs
// + Patient EHR facts and returns a per-patient warning model
// the UI renders. No DB access; no fetches; callers wire it up.

import {
  buildPatientIdentityIndex,
  buildPatientIdentityKeys,
  explainPatientMatch,
  lookupPatientInIndex,
  matchPatientIdentity,
  PATIENT_MATCH_TIER_LABEL,
  type PatientIdentityInput,
  type PatientMatchResult,
  type PatientMatchTier,
} from "../../../shared/patientIdentity";
import {
  buildComparisonRunSet,
  buildQualificationGroups,
  makeRunLabel,
  type QualificationDateGroup,
  type RunSelection,
  type RunSourceRow,
} from "./qualificationRunOrdering";

export type DuplicateWarningKind =
  | "matched_prior_run"
  | "previously_sent_to_engagement"
  | "do_not_contact"
  | "active_cooldown"
  | "expired_cooldown_historical"
  | "prior_ancillary_test";

export type DuplicateWarningSeverity = "info" | "warn" | "block";

export type RunMatchDetail = {
  runId: number;
  runLabel: string;
  parentDateKey: string;
  parentDateLabel: string;
  runTime: string;
  matchedAt: PatientMatchTier;
  matchedTierLabel: string;
  matchedFields: ReadonlyArray<string>;
  matchScore: number;
  reason: string;
};

export type DuplicateWarning = {
  kind: DuplicateWarningKind;
  severity: DuplicateWarningSeverity;
  message: string;
  helpText?: string;
  blocksOutreach: boolean;
  payload?: Record<string, unknown>;
};

export type DuplicatePatientFact = {
  patientScreeningId: number;
  identity: PatientIdentityInput;
  patientName: string;
};

export type DuplicateFacts = {
  /** Patients already sent to engagement (per Patient EHR). */
  sentToEngagement: ReadonlyArray<DuplicatePatientFact & { sentAt: string | null }>;
  /** Active DNC patients. */
  doNotContact: ReadonlyArray<DuplicatePatientFact & { reason: string | null; setAt: string | null }>;
  /** Active or expired cooldowns. */
  cooldowns: ReadonlyArray<DuplicatePatientFact & {
    active: boolean;
    endsAt: string | null;
    reason: string | null;
  }>;
  /** Prior ancillary tests indexed by (name + dob) keys. */
  priorTests: ReadonlyArray<{
    identity: PatientIdentityInput;
    testName: string;
    dateOfService: string | null;
    facility: string | null;
  }>;
};

export type DuplicateWarningInput = {
  /** Current run patients we're qualifying / about to send / about to call. */
  currentPatients: ReadonlyArray<DuplicatePatientFact>;
  /** Patients pulled from prior runs (used to compute prior-run matches). */
  priorRunRoster: ReadonlyArray<RunSourceRow & DuplicatePatientFact>;
  /** Which runs to compare against. */
  selection: RunSelection;
  /** Patient EHR facts. */
  facts: DuplicateFacts;
  /** Tests considered restricted for "prior ancillary" warning. */
  restrictedTestNames?: ReadonlyArray<string>;
};

export type DuplicateWarningResult = {
  patientScreeningId: number;
  patientName: string;
  warnings: ReadonlyArray<DuplicateWarning>;
  matchedRuns: ReadonlyArray<RunMatchDetail>;
  topMatchScore: number;
  blockedFromOutreach: boolean;
};

function findRunMatches(
  current: DuplicatePatientFact,
  groups: ReadonlyArray<QualificationDateGroup>,
  rosterByRunId: Map<number, ReadonlyArray<RunSourceRow & DuplicatePatientFact>>,
  comparisonSet: ReadonlyArray<{ runId: number; runLabel: string; parentDateKey: string; runCreatedAt: string }>,
): RunMatchDetail[] {
  const matches: RunMatchDetail[] = [];
  for (const run of comparisonSet) {
    const roster = rosterByRunId.get(run.runId);
    if (!roster) continue;
    for (const other of roster) {
      if (other.patientScreeningId === current.patientScreeningId) continue;
      const m: PatientMatchResult = matchPatientIdentity(current.identity, other.identity);
      if (!m.matched || !m.tier) continue;
      const group = groups.find((g) => g.parentDateKey === run.parentDateKey);
      matches.push({
        runId: run.runId,
        runLabel: run.runLabel,
        parentDateKey: run.parentDateKey,
        parentDateLabel: group?.parentDateLabel ?? run.parentDateKey,
        runTime: run.runCreatedAt,
        matchedAt: m.tier,
        matchedTierLabel: PATIENT_MATCH_TIER_LABEL[m.tier],
        matchedFields: m.matchedFields,
        matchScore: m.score,
        reason: explainPatientMatch(m),
      });
    }
  }
  return matches;
}

const DEFAULT_RESTRICTED_TESTS: ReadonlyArray<string> = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex",
  "Echocardiogram TTE",
  "Renal Artery Doppler",
  "Lower Extremity Arterial Doppler",
  "Upper Extremity Arterial Doppler",
  "Abdominal Aortic Aneurysm Duplex",
  "Stress Echocardiogram",
  "Lower Extremity Venous Duplex",
  "Upper Extremity Venous Duplex",
];

export function computeDuplicateWarnings(
  input: DuplicateWarningInput,
): ReadonlyArray<DuplicateWarningResult> {
  const restricted = new Set((input.restrictedTestNames ?? DEFAULT_RESTRICTED_TESTS).map((t) => t.toLowerCase()));

  // Build qualification groups + roster-by-run index for run matching.
  const groups = buildQualificationGroups(input.priorRunRoster);
  const flatRuns = groups.flatMap((g) => g.runs);
  const comparisonRuns = buildComparisonRunSet(groups, input.selection);
  const rosterByRunId = new Map<number, Array<RunSourceRow & DuplicatePatientFact>>();
  for (const row of input.priorRunRoster) {
    const list = rosterByRunId.get(row.batchId) ?? [];
    list.push(row);
    rosterByRunId.set(row.batchId, list);
  }

  // Hydrate comparison runs with labels from the grouped set.
  const enrichedComparisonRuns = comparisonRuns.map((r) => ({
    runId: r.runId,
    runLabel: r.runLabel,
    parentDateKey: r.parentDateKey,
    runCreatedAt: r.runCreatedAt,
  }));

  // Indexes for fact lookups.
  const sentToEngagementIdx = buildPatientIdentityIndex(input.facts.sentToEngagement, (r) => r.identity);
  const dncIdx = buildPatientIdentityIndex(input.facts.doNotContact, (r) => r.identity);
  const cooldownIdx = buildPatientIdentityIndex(input.facts.cooldowns, (r) => r.identity);

  // Prior tests are name+dob-shaped; precompute their keys.
  type PriorTestEntry = {
    identity: PatientIdentityInput;
    keys: ReturnType<typeof buildPatientIdentityKeys>;
    testName: string;
    dateOfService: string | null;
    facility: string | null;
  };
  const priorTestEntries: PriorTestEntry[] = input.facts.priorTests.map((p) => ({
    identity: p.identity,
    keys: buildPatientIdentityKeys(p.identity),
    testName: p.testName,
    dateOfService: p.dateOfService,
    facility: p.facility,
  }));

  const results: DuplicateWarningResult[] = [];
  for (const current of input.currentPatients) {
    const warnings: DuplicateWarning[] = [];

    // 1) Prior-run matches.
    const runMatches = findRunMatches(current, groups, rosterByRunId, enrichedComparisonRuns);
    if (runMatches.length > 0) {
      const top = runMatches.reduce((a, b) => (a.matchScore >= b.matchScore ? a : b));
      warnings.push({
        kind: "matched_prior_run",
        severity: "warn",
        message: `Matched prior run: ${top.parentDateLabel} - Run ${flatRuns.find((r) => r.runId === top.runId)?.runNumberWithinDate ?? "?"} - ${new Date(top.runTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
        helpText: `${top.matchedTierLabel}. ${runMatches.length} total match(es) across selected runs.`,
        blocksOutreach: false,
        payload: { matchCount: runMatches.length, topMatchedAt: top.matchedAt, runIds: runMatches.map((r) => r.runId) },
      });
    }

    // 2) Previously sent to engagement.
    const sentHit = lookupPatientInIndex(sentToEngagementIdx, current.identity);
    if (sentHit) {
      const sentAt = sentHit.row.sentAt;
      warnings.push({
        kind: "previously_sent_to_engagement",
        severity: "warn",
        message: sentAt
          ? `Duplicate: this patient was previously approved and sent to Engagement Center on ${sentAt}.`
          : "Duplicate: this patient was previously sent to Engagement Center.",
        blocksOutreach: false,
        payload: { tier: sentHit.tier },
      });
    }

    // 3) DNC.
    const dncHit = lookupPatientInIndex(dncIdx, current.identity);
    if (dncHit) {
      warnings.push({
        kind: "do_not_contact",
        severity: "block",
        message: `Do Not Contact${dncHit.row.reason ? ` — ${dncHit.row.reason}` : ""}`,
        helpText: dncHit.row.setAt ? `Set ${dncHit.row.setAt}` : undefined,
        blocksOutreach: true,
      });
    }

    // 4) Cooldown — active blocks, expired is historical info.
    const cdHit = lookupPatientInIndex(cooldownIdx, current.identity);
    if (cdHit) {
      if (cdHit.row.active) {
        warnings.push({
          kind: "active_cooldown",
          severity: "block",
          message: `Active cooldown until ${cdHit.row.endsAt ?? "(no end date)"}${cdHit.row.reason ? ` — ${cdHit.row.reason}` : ""}`,
          blocksOutreach: true,
        });
      } else {
        warnings.push({
          kind: "expired_cooldown_historical",
          severity: "info",
          message: `Prior cooldown (expired) — ${cdHit.row.endsAt ?? ""}${cdHit.row.reason ? ` — ${cdHit.row.reason}` : ""}`,
          blocksOutreach: false,
        });
      }
    }

    // 5) Prior ancillary test among restricted tests.
    const currentKeys = buildPatientIdentityKeys(current.identity);
    const matchedTests = priorTestEntries.filter((t) => {
      if (!restricted.has(t.testName.toLowerCase())) return false;
      if (currentKeys.facilityMrnDob && t.keys.facilityMrnDob === currentKeys.facilityMrnDob) return true;
      if (currentKeys.mrnDob && t.keys.mrnDob === currentKeys.mrnDob) return true;
      if (currentKeys.nameDobPhone && t.keys.nameDobPhone === currentKeys.nameDobPhone) return true;
      // Name+DOB fallback (no phone known in test history).
      if (currentKeys.mrnDob == null) {
        const tNameKey = `${(t.identity.name ?? "").toLowerCase().trim()}|${t.identity.dob ?? ""}`;
        const cNameKey = `${(current.identity.name ?? "").toLowerCase().trim()}|${current.identity.dob ?? ""}`;
        if (tNameKey === cNameKey && tNameKey.includes("|") && tNameKey !== "|") return true;
      }
      return false;
    });
    if (matchedTests.length > 0) {
      const summary = matchedTests
        .map((t) => `${t.testName}${t.dateOfService ? ` (${t.dateOfService})` : ""}`)
        .join("; ");
      warnings.push({
        kind: "prior_ancillary_test",
        severity: "warn",
        message: `Prior ancillary test(s) on file: ${summary}`,
        blocksOutreach: false,
        payload: { count: matchedTests.length },
      });
    }

    const blockedFromOutreach = warnings.some((w) => w.blocksOutreach);
    const topMatchScore = runMatches.reduce((max, m) => Math.max(max, m.matchScore), 0);
    results.push({
      patientScreeningId: current.patientScreeningId,
      patientName: current.patientName,
      warnings,
      matchedRuns: runMatches,
      topMatchScore,
      blockedFromOutreach,
    });
  }
  return results;
}

/** Convenience helper: any blocking warning across the result set. */
export function hasBlockingWarning(results: ReadonlyArray<DuplicateWarningResult>): boolean {
  return results.some((r) => r.blockedFromOutreach);
}

export { makeRunLabel };
