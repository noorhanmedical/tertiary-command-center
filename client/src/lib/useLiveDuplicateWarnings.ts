// Live duplicate-warning hook (Batch F).
//
// Drop-in hook that consumers in Admin Review, Engagement handoff,
// Team Portal, and the Patient EHR page can call to get the
// per-patient DuplicateWarningResult against real Patient EHR
// facts. When the activation routes return 404 (flag OFF on server)
// the hook returns an empty result so call sites render no warning
// rather than crashing.

import { useQuery } from "@tanstack/react-query";
import {
  computeDuplicateWarnings,
  type DuplicatePatientFact,
  type DuplicateWarningResult,
} from "@/lib/patientDuplicateWarnings";
import {
  selectNoRuns,
  type RunSelection,
  type RunSourceRow,
} from "@/lib/qualificationRunOrdering";
import {
  fetchDuplicateWarningFacts,
  type DuplicateFactsTarget,
} from "@/lib/patientDirectoryApi";

export type LiveDuplicateWarningsInput = {
  /** Patients on the current surface (qualification cards, approve list, call list, etc.). */
  currentPatients: ReadonlyArray<DuplicatePatientFact>;
  /** Optional roster of patients from prior runs (defaults to []). */
  priorRunRoster?: ReadonlyArray<RunSourceRow & DuplicatePatientFact>;
  /** Selection of prior runs to compare against (defaults to none). */
  selection?: RunSelection;
  /** Restricted-test allow list override. */
  restrictedTestNames?: ReadonlyArray<string>;
};

export type LiveDuplicateWarningsResult = {
  /** Per-patient warnings keyed by patientScreeningId. */
  byId: Record<number, DuplicateWarningResult>;
  /** Raw list (same order as currentPatients). */
  list: ReadonlyArray<DuplicateWarningResult>;
  /** Loading / source-unavailable flags so the UI can render a skeleton. */
  loading: boolean;
  factsUnavailable: boolean;
};

export function useLiveDuplicateWarnings(
  input: LiveDuplicateWarningsInput,
): LiveDuplicateWarningsResult {
  const targets: DuplicateFactsTarget[] = input.currentPatients.map((p) => ({
    patientScreeningId: p.patientScreeningId,
    identity: p.identity,
  }));

  const factsQ = useQuery({
    queryKey: ["patient-directory-duplicate-facts", targets.map((t) => t.patientScreeningId).sort().join(",")],
    queryFn: () => fetchDuplicateWarningFacts(targets),
    enabled: targets.length > 0,
    staleTime: 30_000,
  });

  const facts = factsQ.data ?? {
    sentToEngagement: [],
    doNotContact: [],
    cooldowns: [],
    priorTests: [],
  };

  const factsUnavailable = factsQ.isFetched
    && facts.sentToEngagement.length === 0
    && facts.doNotContact.length === 0
    && facts.cooldowns.length === 0
    && facts.priorTests.length === 0
    && targets.length > 0
    && !factsQ.isFetching;

  // Hydrate facts to match the engine's DuplicatePatientFact shape
  // (engine wants patientName alongside identity).
  const hydratedFacts = {
    sentToEngagement: facts.sentToEngagement.map((r) => ({
      ...r, patientName: r.identity.name ?? "",
    })),
    doNotContact: facts.doNotContact.map((r) => ({
      ...r, patientName: r.identity.name ?? "",
    })),
    cooldowns: facts.cooldowns.map((r) => ({
      ...r, patientName: r.identity.name ?? "",
    })),
    priorTests: facts.priorTests,
  };

  // The engine runs regardless — for an OFF-flag environment the
  // empty facts mean no warnings, which matches expected behavior.
  const list = computeDuplicateWarnings({
    currentPatients: input.currentPatients,
    priorRunRoster: input.priorRunRoster ?? [],
    selection: input.selection ?? selectNoRuns(),
    facts: hydratedFacts,
    restrictedTestNames: input.restrictedTestNames,
  });

  const byId: Record<number, DuplicateWarningResult> = {};
  for (const r of list) byId[r.patientScreeningId] = r;

  return { byId, list, loading: factsQ.isLoading, factsUnavailable };
}
