// Focused tests: clinical-context budgeter (dedup/truncate/preserve/under-limit)
// + centralized provider-failure classifier + billing circuit breaker.
import assert from "node:assert/strict";
import {
  buildBudgetedClinicalContext,
  dedupeLines,
  estimateTokens,
  TRUNCATION_MARKER,
  MAX_CLINICAL_INPUT_TOKENS,
} from "../../server/services/screening/clinicalContextBudget";
import {
  classifyProviderFailure,
  isBillingBreakerTripped,
  tripBillingBreaker,
  resetBillingBreaker,
} from "../../server/services/plexusIq/providerFailure";

function main() {
  // ── dedupeLines ──
  {
    const { text, removed } = dedupeLines("Metformin 500mg\nMetformin 500mg\nMetformin 500mg\nLisinopril 10mg");
    assert.equal(text, "Metformin 500mg\nLisinopril 10mg", "exact duplicate lines collapsed, order preserved");
    assert.equal(removed, 2);
  }

  // ── normal context unchanged (no dedup, no truncation) ──
  {
    const { sectionBlocks, meta } = buildBudgetedClinicalContext(
      { diagnoses: "E11.9 Type 2 diabetes", history: "HTN, HLD", medications: "Metformin 500mg\nLisinopril 10mg" },
      50,
    );
    assert.equal(meta.compactedSections.length, 0, "no dedup for unique text");
    assert.equal(meta.truncatedSections.length, 0);
    assert.equal(meta.droppedSections.length, 0);
    assert.equal(meta.withinLimit, true);
    assert.ok(sectionBlocks.some((b) => b.startsWith("Diagnoses:")));
    assert.ok(sectionBlocks.some((b) => b.startsWith("Medications:")));
  }

  // ── heavy copy-forward medications compacted, fits, diagnoses preserved ──
  {
    const meds = Array.from({ length: 20000 }, () => "Metformin 500mg BID orally with meals").join("\n") + "\nLisinopril 10mg daily";
    assert.ok(estimateTokens(meds) > MAX_CLINICAL_INPUT_TOKENS, "raw meds exceed ceiling pre-compaction");
    const { sectionBlocks, meta } = buildBudgetedClinicalContext(
      { diagnoses: "E11.9 Type 2 diabetes\nI10 Hypertension", medications: meds },
      50,
    );
    assert.ok(meta.compactedSections.includes("medications"), "medications deduped");
    assert.equal(meta.withinLimit, true, "fits after dedup");
    assert.ok(meta.finalTokens < MAX_CLINICAL_INPUT_TOKENS);
    assert.ok(sectionBlocks.some((b) => b.startsWith("Diagnoses:")), "diagnoses evidence preserved");
    const medBlock = sectionBlocks.find((b) => b.startsWith("Medications:"))!;
    assert.ok(medBlock.includes("Lisinopril 10mg daily"), "distinct med retained after dedup");
  }

  // ── genuinely large UNIQUE history is truncated section-aware with marker ──
  {
    // 60k unique lines -> way over ceiling even after dedup (all distinct).
    const bigHistory = Array.from({ length: 60000 }, (_, i) => `Encounter ${i}: unique note ${i}`).join("\n");
    const { sectionBlocks, meta } = buildBudgetedClinicalContext(
      { diagnoses: "E11.9 Type 2 diabetes", history: bigHistory },
      50,
    );
    assert.equal(meta.withinLimit, true, "final fits under ceiling");
    assert.ok(meta.truncatedSections.includes("history"), "history truncated");
    const histBlock = sectionBlocks.find((b) => b.startsWith("History/HPI:"))!;
    assert.ok(histBlock.includes(TRUNCATION_MARKER), "explicit truncation marker inserted");
    assert.ok(sectionBlocks.some((b) => b.startsWith("Diagnoses:")), "higher-priority diagnoses fully kept");
  }

  // ── still-too-large-after-compaction: reserved header alone exceeds ceiling ──
  {
    const { meta } = buildBudgetedClinicalContext(
      { diagnoses: "x", medications: "y" },
      MAX_CLINICAL_INPUT_TOKENS + 100, // pathological header reserve
    );
    assert.equal(meta.withinLimit, false, "flagged not-within-limit -> caller raises error, NOT Not-Qualified");
  }

  // ── provider failure classification ──
  {
    const billing = classifyProviderFailure({ status: 429, message: "429 You have no credits remaining. Add credits to continue" });
    assert.equal(billing.category, "billing_quota_exhausted");
    assert.equal(billing.isBillingExhaustion, true);

    const rl = classifyProviderFailure({ status: 429, message: "Rate limit reached for requests" });
    assert.equal(rl.category, "rate_limited");
    assert.equal(rl.isBillingExhaustion, false, "generic 429 is NOT billing exhaustion");

    const conn = classifyProviderFailure({ message: "Connection error." });
    assert.equal(conn.category, "connection_error");
    assert.equal(conn.retryable, true);

    const ctx = classifyProviderFailure({ status: 400, message: "400 This model's maximum context length is 128000 tokens" });
    assert.equal(ctx.category, "context_too_large");

    const ctx2 = classifyProviderFailure({ code: "context_too_large_after_compaction", message: "context_too_large_after_compaction" });
    assert.equal(ctx2.category, "context_too_large_after_compaction");
    assert.equal(ctx2.isBillingExhaustion, false);

    const five = classifyProviderFailure({ status: 503, message: "Service Unavailable" });
    assert.equal(five.category, "provider_5xx");
  }

  // ── billing circuit breaker ──
  {
    resetBillingBreaker();
    assert.equal(isBillingBreakerTripped(), false);
    tripBillingBreaker("credits gone");
    assert.equal(isBillingBreakerTripped(), true, "breaker trips");
    resetBillingBreaker();
    assert.equal(isBillingBreakerTripped(), false, "breaker resets for a fresh run");
  }

  console.log("plexusIqContextAndFailure.test.ts — all assertions passed");
}

main();
