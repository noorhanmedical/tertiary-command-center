// Physician signing service scaffold (Phase 1 Segment F Batch 6).
//
// DORMANT module. Encodes the F5 signing-state machine as a pure
// transition table so a future approved batch can wire it into a
// route + storage helper without re-deriving allowed transitions.
//
// NO PDF generation logic. NO byte mutation. NO storage / db / route
// coupling. Production behavior is unchanged until USE_ANCILLARY_SIGNING_SERVICE
// is flipped truthy AND a route adopts it.
//
// Contract: docs/architecture/physician-signing-contract.md

export type SigningStatus = "unsigned" | "pending" | "signed" | "declined" | "revoked";

export type SigningTransition = {
  from: SigningStatus;
  to: SigningStatus;
  trigger: "open_signing_ui" | "attest_signed" | "reject_signing" | "cancel_signing" | "admin_revoke";
};

export const SIGNING_TRANSITIONS: ReadonlyArray<SigningTransition> = [
  { from: "unsigned", to: "pending", trigger: "open_signing_ui" },
  { from: "pending", to: "signed", trigger: "attest_signed" },
  { from: "pending", to: "declined", trigger: "reject_signing" },
  { from: "pending", to: "unsigned", trigger: "cancel_signing" },
  { from: "signed", to: "revoked", trigger: "admin_revoke" },
];

export const TERMINAL_SIGNING_STATUSES: ReadonlySet<SigningStatus> = new Set<SigningStatus>([
  "signed",
  "revoked",
]);

export function isSigningServiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.USE_ANCILLARY_SIGNING_SERVICE;
  return v === "1" || v === "true" || v === "yes";
}

export function canTransition(from: SigningStatus, to: SigningStatus): boolean {
  return SIGNING_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function nextSigningStatus(
  from: SigningStatus,
  trigger: SigningTransition["trigger"],
): SigningStatus | null {
  const match = SIGNING_TRANSITIONS.find((t) => t.from === from && t.trigger === trigger);
  return match ? match.to : null;
}

const KINDS_REQUIRING_SIGNATURE: ReadonlySet<string> = new Set([
  "post_procedure_note",
  "report",
]);

export function requiresPhysicianSignature(kind: string): boolean {
  return KINDS_REQUIRING_SIGNATURE.has(kind);
}
