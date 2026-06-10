// Plexus IQ aggregate read forwarding test (Bundle 52).
//
// Runnable via:
//   npx tsx server/modules/plexus-iq/__tests__/aggregate-read-forwarding.test.ts
//
// Encodes the byte-identical forwarding rule from
// docs/architecture/plexus-iq-read-model-contract.md §3 so a future
// aggregate read endpoint cannot silently reshape, re-derive, or
// re-rank the canonical reasoning blob, qualifying factors,
// supporting buttons, ICD chips, or Admin Review state.
//
// No DB, no app boot, no network, no PHI.

import {
  FIXTURE_EVIDENCE_FORWARD,
  FIXTURE_EXECUTION_CASE_FORWARD,
  FIXTURE_SCREENING_FORWARD,
  forwardLegacySlicesToAggregate_REFERENCE,
} from "../../../../tests/fixtures/plexusIqAggregateRead.fixture";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

// ─── §1: All Bundle 25 §3.1 patient_screenings fields forward ────
{
  const aggregate = forwardLegacySlicesToAggregate_REFERENCE(
    FIXTURE_SCREENING_FORWARD,
    FIXTURE_EXECUTION_CASE_FORWARD,
    FIXTURE_EVIDENCE_FORWARD,
  );
  const s = aggregate.screening;
  // Identity.
  eq(s.id, FIXTURE_SCREENING_FORWARD.id, "§1: id");
  eq(s.name, FIXTURE_SCREENING_FORWARD.name, "§1: name");
  eq(s.dob, FIXTURE_SCREENING_FORWARD.dob, "§1: dob");
  eq(s.phoneNumber, FIXTURE_SCREENING_FORWARD.phoneNumber, "§1: phoneNumber");
  eq(s.email, FIXTURE_SCREENING_FORWARD.email, "§1: email");
  eq(s.facility, FIXTURE_SCREENING_FORWARD.facility, "§1: facility");
  eq(s.patientType, FIXTURE_SCREENING_FORWARD.patientType, "§1: patientType");
  // Commit state.
  eq(s.commitStatus, FIXTURE_SCREENING_FORWARD.commitStatus, "§1: commitStatus");
  eq(s.committedAt, FIXTURE_SCREENING_FORWARD.committedAt, "§1: committedAt");
  eq(s.committedByUserId, FIXTURE_SCREENING_FORWARD.committedByUserId, "§1: committedByUserId");
  // Admin approval state — Bundle 30's source-of-truth.
  eq(s.adminApprovalStatus, FIXTURE_SCREENING_FORWARD.adminApprovalStatus, "§1: adminApprovalStatus");
  eq(s.adminApprovedAt, FIXTURE_SCREENING_FORWARD.adminApprovedAt, "§1: adminApprovedAt");
  eq(s.adminApprovedByUserId, FIXTURE_SCREENING_FORWARD.adminApprovedByUserId, "§1: adminApprovedByUserId");
  eq(s.adminApprovalNote, FIXTURE_SCREENING_FORWARD.adminApprovalNote, "§1: adminApprovalNote");
  // Qualification arrays.
  check(
    JSON.stringify(s.qualifyingTests) ===
      JSON.stringify(FIXTURE_SCREENING_FORWARD.qualifyingTests),
    "§1: qualifyingTests array forwarded verbatim",
  );
  check(
    JSON.stringify(s.cooldownTests) ===
      JSON.stringify(FIXTURE_SCREENING_FORWARD.cooldownTests),
    "§1: cooldownTests array forwarded verbatim",
  );
  // Status.
  eq(s.status, FIXTURE_SCREENING_FORWARD.status, "§1: status");
}

// ─── §2: Canonical reasoning blob — every key forwarded verbatim ─
{
  const aggregate = forwardLegacySlicesToAggregate_REFERENCE(
    FIXTURE_SCREENING_FORWARD,
    FIXTURE_EXECUTION_CASE_FORWARD,
    FIXTURE_EVIDENCE_FORWARD,
  );
  const r = aggregate.screening.reasoning;
  // Object identity preserved — no copying / restructuring.
  check(
    r === FIXTURE_SCREENING_FORWARD.reasoning,
    "§2: reasoning blob must be the SAME object (no copy / restructure)",
  );
  // Per-ancillary AI rationale + qualifying factors + ICD chips +
  // guardrails forwarded.
  for (const ancillary of ["brainwave", "vitalwave", "ultrasound"]) {
    const sub = (r as Record<string, unknown>)[ancillary] as Record<string, unknown> | undefined;
    check(sub !== undefined, `§2: reasoning.${ancillary} must be present`);
    if (sub) {
      check("rationale" in sub, `§2: reasoning.${ancillary}.rationale must be present`);
      check("qualifyingFactors" in sub, `§2: reasoning.${ancillary}.qualifyingFactors must be present`);
      check("icdChips" in sub, `§2: reasoning.${ancillary}.icdChips must be present`);
      check("guardrails" in sub, `§2: reasoning.${ancillary}.guardrails must be present`);
    }
  }
  // Per-ancillary Admin Review supplemental metadata + evidence
  // snapshots forwarded.
  for (const key of ["adminReview:brainwave", "adminReview:vitalwave"]) {
    const sub = (r as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
    check(sub !== undefined, `§2: reasoning["${key}"] must be present`);
    if (sub) {
      check(
        "evidenceSnapshot" in sub,
        `§2: reasoning["${key}"].evidenceSnapshot must be present (load-bearing for Re-evaluate)`,
      );
      check(
        "modelMetadata" in sub,
        `§2: reasoning["${key}"].modelMetadata must be present`,
      );
    }
  }
}

// ─── §3: Execution case forwarded ─────────────────────────────────
{
  const aggregate = forwardLegacySlicesToAggregate_REFERENCE(
    FIXTURE_SCREENING_FORWARD,
    FIXTURE_EXECUTION_CASE_FORWARD,
    FIXTURE_EVIDENCE_FORWARD,
  );
  const ec = aggregate.executionCase;
  for (const k of [
    "engagementStatus",
    "engagementBucket",
    "commitStatus",
    "assignedTeamMemberId",
    "assignedRole",
    "lifecycleStatus",
  ] as const) {
    eq(ec[k], FIXTURE_EXECUTION_CASE_FORWARD[k], `§3: executionCase.${k}`);
  }
}

// ─── §4: Evidence array forwarded verbatim ────────────────────────
{
  const aggregate = forwardLegacySlicesToAggregate_REFERENCE(
    FIXTURE_SCREENING_FORWARD,
    FIXTURE_EXECUTION_CASE_FORWARD,
    FIXTURE_EVIDENCE_FORWARD,
  );
  check(
    aggregate.evidence === FIXTURE_EVIDENCE_FORWARD,
    "§4: evidence array must be the SAME reference (no copy)",
  );
  for (let i = 0; i < FIXTURE_EVIDENCE_FORWARD.length; i += 1) {
    eq(
      aggregate.evidence[i]?.ancillaryId,
      FIXTURE_EVIDENCE_FORWARD[i]?.ancillaryId,
      `§4: evidence[${i}].ancillaryId`,
    );
    eq(
      aggregate.evidence[i]?.ruleEngineVersion,
      FIXTURE_EVIDENCE_FORWARD[i]?.ruleEngineVersion,
      `§4: evidence[${i}].ruleEngineVersion`,
    );
    // candidateIcds + evidenceSnapshot byte-equivalent.
    check(
      JSON.stringify(aggregate.evidence[i]?.candidateIcds) ===
        JSON.stringify(FIXTURE_EVIDENCE_FORWARD[i]?.candidateIcds),
      `§4: evidence[${i}].candidateIcds verbatim`,
    );
    check(
      JSON.stringify(aggregate.evidence[i]?.evidenceSnapshot) ===
        JSON.stringify(FIXTURE_EVIDENCE_FORWARD[i]?.evidenceSnapshot),
      `§4: evidence[${i}].evidenceSnapshot verbatim`,
    );
  }
}

// ─── §5: No re-derivation — reasoning + qualifyingTests + ─────────
// candidateIcds remain the inputs the forwarder received. We assert
// this by deep-stringifying the input and the output and comparing.
{
  const before = JSON.stringify({
    s: FIXTURE_SCREENING_FORWARD,
    e: FIXTURE_EXECUTION_CASE_FORWARD,
    v: FIXTURE_EVIDENCE_FORWARD,
  });
  const aggregate = forwardLegacySlicesToAggregate_REFERENCE(
    FIXTURE_SCREENING_FORWARD,
    FIXTURE_EXECUTION_CASE_FORWARD,
    FIXTURE_EVIDENCE_FORWARD,
  );
  const after = JSON.stringify({
    s: aggregate.screening,
    e: aggregate.executionCase,
    v: aggregate.evidence,
  });
  check(before === after, "§5: aggregate output is byte-identical to input");
}

// ─── §6: Input not mutated ────────────────────────────────────────
{
  const frozenS = Object.freeze({ ...FIXTURE_SCREENING_FORWARD });
  const frozenE = Object.freeze({ ...FIXTURE_EXECUTION_CASE_FORWARD });
  const frozenV = Object.freeze(FIXTURE_EVIDENCE_FORWARD.map((e) => Object.freeze({ ...e })));
  let threw = false;
  try {
    forwardLegacySlicesToAggregate_REFERENCE(
      frozenS as typeof FIXTURE_SCREENING_FORWARD,
      frozenE as typeof FIXTURE_EXECUTION_CASE_FORWARD,
      frozenV,
    );
  } catch (err) {
    threw = true;
    failures.push(
      `§6: forwarder threw on frozen input: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  check(!threw, "§6: forwarder must not mutate input");
}

// ─── §7: Forbidden derived fields ─────────────────────────────────
// The aggregate MUST NOT introduce any field outside Bundle 25 §3.
// We assert specific shapes that would indicate scope creep
// (e.g. a merged `reasoning+evidence` field) are absent.
{
  const aggregate = forwardLegacySlicesToAggregate_REFERENCE(
    FIXTURE_SCREENING_FORWARD,
    FIXTURE_EXECUTION_CASE_FORWARD,
    FIXTURE_EVIDENCE_FORWARD,
  ) as Record<string, unknown>;
  for (const banned of [
    "reasoningWithEvidence",
    "mergedEvidence",
    "freshenedReasoning",
    "derivedQualifyingTests",
    "supportingButtonsResolved",
    "billingHints",
    "claimAmount",
    "revenueShare",
  ]) {
    check(
      !(banned in aggregate),
      `§7: aggregate must not introduce derived field "${banned}"`,
    );
  }
}

if (failures.length > 0) {
  console.error("Plexus IQ aggregate read forwarding test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Plexus IQ aggregate read forwarding test passed.");
}
