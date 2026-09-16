/**
 * Deterministic, token-aware clinical-context budgeter for Plexus IQ.
 *
 * WHY: some real EHR exports carry copy-forward clinical text (esp. medication
 * lists repeated across every encounter) that inflates a single patient's
 * prompt past the model's 128k-token context window, producing a hard
 * `400 maximum context length` provider error. This is the ONE shared layer the
 * canonical IQ prompt path uses to build a provider-safe clinical context.
 *
 * PRINCIPLES:
 *   • Deterministic only — NO AI/LLM pre-pass (no cost, no nondeterminism, no
 *     risk of hallucinating qualification evidence).
 *   • Token-aware, not character-only. No exact tokenizer dependency is present
 *     in the repo, so we use a CONSERVATIVE over-estimator plus generous margin.
 *   • Dedup before truncate: collapse exact-duplicate lines first (safe, loses
 *     no distinct clinical evidence), only then truncate by section priority.
 *   • Core identity/demographics + the service context are never the thing we
 *     cut; MRN/Patient ID do not belong in the clinical budget at all.
 *   • A section that must be cut gets an explicit neutral marker so the model
 *     never treats the shown text as exhaustive.
 *   • Never used to decide qualification — purely input shaping. A row that is
 *     still too large after compaction is an ERROR, never Not Qualified.
 */

// ─── Budget constants (single source of truth) ───────────────────────────────
// gpt-4o context window. Kept as one named constant so callers never sprinkle
// a magic 128000 around the codebase.
export const MODEL_CONTEXT_TOKENS = 128_000;
// Must stay >= the request's max_completion_tokens (screening.ts uses 16000).
export const OUTPUT_RESERVE_TOKENS = 16_000;
// System prompt + user-prompt suffix + JSON-schema/formatting overhead.
export const SYSTEM_RESERVE_TOKENS = 4_000;
// Headroom for tokenizer-estimation uncertainty (we estimate, not tokenize).
export const SAFETY_MARGIN_TOKENS = 12_000;
// The hard ceiling for CLINICAL INPUT text. 128000 - 16000 - 4000 - 12000.
export const MAX_CLINICAL_INPUT_TOKENS =
  MODEL_CONTEXT_TOKENS - OUTPUT_RESERVE_TOKENS - SYSTEM_RESERVE_TOKENS - SAFETY_MARGIN_TOKENS; // 96_000

export const TRUNCATION_MARKER = "[Additional entries omitted due to context limit]";

/**
 * Conservative token estimate. Real English/clinical text is ~4 chars/token; we
 * divide by 3.2 to deliberately OVER-estimate, so we err toward staying under
 * the provider limit. Replace with a real tokenizer if one is ever added.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.2);
}

export type ClinicalSectionKey = "diagnoses" | "medications" | "history" | "notes";

export type ClinicalSections = Partial<Record<ClinicalSectionKey, string | null | undefined>>;

// Qualification-evidence priority (audit §6): diagnoses first, then medications,
// then history, then lower-yield narrative (notes). When budget is tight, the
// LAST items lose body first.
const SECTION_PRIORITY: ClinicalSectionKey[] = ["diagnoses", "medications", "history", "notes"];
const SECTION_LABEL: Record<ClinicalSectionKey, string> = {
  diagnoses: "Diagnoses",
  medications: "Medications",
  history: "History/HPI",
  notes: "Notes",
};

/**
 * Collapse exact-duplicate lines (trim-compared), preserving first-occurrence
 * order, and collapse runs of blank lines. Deterministic; loses no distinct
 * line. Returns the compacted text and how many lines were removed.
 */
export function dedupeLines(text: string): { text: string; removed: number } {
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  let removed = 0;
  for (const raw of lines) {
    const key = raw.trim();
    if (key === "") {
      if (out.length > 0 && out[out.length - 1] === "") { removed++; continue; }
      out.push("");
      continue;
    }
    if (seen.has(key)) { removed++; continue; }
    seen.add(key);
    out.push(raw);
  }
  // drop a single trailing blank if present
  while (out.length && out[out.length - 1] === "") out.pop();
  return { text: out.join("\n"), removed };
}

/** Keep as many whole leading lines as fit `budgetTokens`, append the marker. */
function truncateToTokens(text: string, budgetTokens: number): { text: string; truncated: boolean } {
  if (estimateTokens(text) <= budgetTokens) return { text, truncated: false };
  const markerCost = estimateTokens(TRUNCATION_MARKER) + 1;
  const usable = Math.max(0, budgetTokens - markerCost);
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let acc = 0;
  for (const ln of lines) {
    const t = estimateTokens(ln) + 1;
    if (acc + t > usable) break;
    kept.push(ln);
    acc += t;
  }
  return { text: `${kept.join("\n")}\n${TRUNCATION_MARKER}`.trim(), truncated: true };
}

export type ContextBudgetMeta = {
  originalTokens: number;
  finalTokens: number;
  maxInputTokens: number;
  compactedSections: ClinicalSectionKey[]; // dedup removed duplicate lines
  truncatedSections: ClinicalSectionKey[]; // body was cut to fit
  droppedSections: ClinicalSectionKey[];   // no budget left for any body
  tokensRemoved: number;
  withinLimit: boolean;
};

export type BudgetedContext = {
  /** Rendered "Label: value" blocks for the sections that survived, in priority order. */
  sectionBlocks: string[];
  meta: ContextBudgetMeta;
};

/**
 * Build a provider-safe clinical context from raw sections.
 *   1. dedup each section (line-level).
 *   2. if the deduped total fits, keep everything.
 *   3. else allocate the clinical budget in priority order, truncating the
 *      section that overflows (with an explicit marker) and dropping bodies of
 *      lower-priority sections that get no budget.
 *
 * `reservedTokens` is the estimated size of the always-kept header
 * (Patient/Name/Age/Gender/etc.) so the clinical budget accounts for it.
 */
export function buildBudgetedClinicalContext(
  sections: ClinicalSections,
  reservedTokens = 0,
  maxClinicalInputTokens: number = MAX_CLINICAL_INPUT_TOKENS,
): BudgetedContext {
  const compactedSections: ClinicalSectionKey[] = [];
  const truncatedSections: ClinicalSectionKey[] = [];
  const droppedSections: ClinicalSectionKey[] = [];

  let originalTokens = 0;
  const deduped: Partial<Record<ClinicalSectionKey, string>> = {};
  for (const key of SECTION_PRIORITY) {
    const raw = (sections[key] ?? "").toString();
    if (!raw.trim()) continue;
    originalTokens += estimateTokens(raw);
    const { text, removed } = dedupeLines(raw);
    deduped[key] = text;
    if (removed > 0) compactedSections.push(key);
  }

  const budget = Math.max(0, maxClinicalInputTokens - reservedTokens);
  let remaining = budget;
  const sectionBlocks: string[] = [];
  let finalClinicalTokens = 0;

  for (const key of SECTION_PRIORITY) {
    const body = deduped[key];
    if (body == null || body.trim() === "") continue;
    const labelCost = estimateTokens(`${SECTION_LABEL[key]}: `) + 1;
    const bodyTokens = estimateTokens(body);
    if (labelCost + bodyTokens <= remaining) {
      sectionBlocks.push(`${SECTION_LABEL[key]}: ${body}`);
      remaining -= labelCost + bodyTokens;
      finalClinicalTokens += labelCost + bodyTokens;
    } else if (remaining - labelCost > 20) {
      const { text, truncated } = truncateToTokens(body, remaining - labelCost);
      sectionBlocks.push(`${SECTION_LABEL[key]}: ${text}`);
      const used = labelCost + estimateTokens(text);
      remaining -= used;
      finalClinicalTokens += used;
      if (truncated) truncatedSections.push(key);
    } else {
      droppedSections.push(key);
    }
  }

  const finalTokens = reservedTokens + finalClinicalTokens;
  return {
    sectionBlocks,
    meta: {
      originalTokens: reservedTokens + originalTokens,
      finalTokens,
      maxInputTokens: maxClinicalInputTokens,
      compactedSections,
      truncatedSections,
      droppedSections,
      tokensRemoved: reservedTokens + originalTokens - finalTokens,
      withinLimit: finalTokens <= maxClinicalInputTokens,
    },
  };
}
