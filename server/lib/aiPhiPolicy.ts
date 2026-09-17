// Centralized AI PHI egress policy gate.
//
// PURPOSE: no production PHI may be sent to an AI provider unless that provider/
// configuration has been explicitly approved for PHI (BAA + zero-retention/
// enterprise terms). This gate is the single policy chokepoint enforced inside
// the shared AI call wrapper (server/services/aiClient.ts withRetry).
//
// BEHAVIOR (fail-explicit, never fabricate):
//   - When AI PHI use is NOT allowed, PHI-capable AI calls throw
//     AiPhiBlockedError. Callers that already have a deterministic non-AI path
//     (e.g. absenceWatcher's canonical recommendation text) fall back to it;
//     callers without one surface an explicit failure (recorded as a failure,
//     NEVER a fabricated clinical output).
//   - Default is ALLOWED so current (synthetic, non-PHI) staging behavior is
//     unchanged. Production sets AI_PHI_ALLOWED=false until the provider is
//     contractually approved for PHI.
//
// This gate makes a CONFIG decision only — it never receives or logs prompt
// content, so no PHI passes through it.

export class AiPhiBlockedError extends Error {
  readonly code = "AI_PHI_NOT_APPROVED";
  constructor(operation?: string) {
    super(
      `AI call blocked: PHI-capable AI is not approved in this environment` +
        (operation ? ` (operation: ${operation})` : ""),
    );
    this.name = "AiPhiBlockedError";
  }
}

/**
 * Whether PHI-capable AI calls are permitted in this environment.
 * Default: ALLOWED (preserves current behavior). Explicitly disable with
 * AI_PHI_ALLOWED in {false,0,no,off} (case-insensitive).
 */
export function isAiPhiAllowed(): boolean {
  const raw = process.env.AI_PHI_ALLOWED;
  if (raw === undefined) return true; // default preserve behavior
  return !/^(false|0|no|off)$/i.test(String(raw).trim());
}

/** Throw AiPhiBlockedError when PHI-capable AI is not approved. */
export function assertAiPhiAllowed(operation?: string): void {
  if (!isAiPhiAllowed()) {
    // PHI-safe: log a structural block event only — never the prompt.
    console.warn(
      JSON.stringify({
        source: "ai_phi_gate",
        outcome: "blocked",
        operation: operation ?? null,
      }),
    );
    throw new AiPhiBlockedError(operation);
  }
}
