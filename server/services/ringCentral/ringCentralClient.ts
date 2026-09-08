// Pure RingCentral client scaffold (Phase 1 Segment E Batch 6).
//
// This module is DORMANT in Phase 1: no route file imports it, no
// background job triggers it, and the live API is never called. It
// exposes a narrow, testable surface that a future approved batch can
// wire to a real RingCentral SDK behind the USE_RINGCENTRAL_ADAPTER
// server-side gate.
//
// Contract: docs/architecture/ringcentral-adapter-contract.md

export type RingCentralCallStatus = "queued" | "ringing" | "answered" | "failed";

export type InitiateCallInput = {
  fromUserExtension: string;
  toE164: string;
  patientScreeningId: number | null;
};

export type InitiateCallResult = {
  ringCentralCallId: string;
  status: RingCentralCallStatus;
};

export interface RingCentralClient {
  initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
  getCallStatus(ringCentralCallId: string): Promise<RingCentralCallStatus>;
}

export class DormantRingCentralClient implements RingCentralClient {
  async initiateCall(_input: InitiateCallInput): Promise<InitiateCallResult> {
    throw new Error("RingCentral adapter is dormant in Phase 1 (USE_RINGCENTRAL_ADAPTER OFF)");
  }
  async getCallStatus(_ringCentralCallId: string): Promise<RingCentralCallStatus> {
    throw new Error("RingCentral adapter is dormant in Phase 1 (USE_RINGCENTRAL_ADAPTER OFF)");
  }
}

// ─── Phase 6 — readiness + real/mock clients ────────────────────────────────
//
// The RingCentral integration is provider-agnostic-friendly: the telephony
// service depends on the RingCentralClient INTERFACE, so a real client, a mock
// client (tests), or the dormant client can be injected. Readiness is FAIL
// CLOSED — a capable-but-unconfigured RingCentral resolves to dormant, and the
// Team Portal falls back to manual. Provider events are EVIDENCE only; nothing
// here writes a business disposition.

export type RingCentralServerReadiness = {
  /** USE_RINGCENTRAL_ADAPTER flag is on. */
  enabled: boolean;
  /** All required credentials are present. */
  hasCredentials: boolean;
  /** enabled AND hasCredentials → a real client may be constructed. */
  ready: boolean;
  /** Non-sensitive reason when not ready (never logs secret values). */
  reason: string | null;
};

const REQUIRED_RC_ENV = [
  "RINGCENTRAL_SERVER_URL",
  "RINGCENTRAL_CLIENT_ID",
  "RINGCENTRAL_CLIENT_SECRET",
  "RINGCENTRAL_JWT",
] as const;

export function ringCentralServerReadiness(
  env: NodeJS.ProcessEnv = process.env,
): RingCentralServerReadiness {
  const enabled = isRingCentralAdapterEnabledLocal(env);
  const missing = REQUIRED_RC_ENV.filter((k) => !env[k] || String(env[k]).trim() === "");
  const hasCredentials = missing.length === 0;
  return {
    enabled,
    hasCredentials,
    ready: enabled && hasCredentials,
    reason: !enabled
      ? "USE_RINGCENTRAL_ADAPTER is off"
      : !hasCredentials
        ? `missing RingCentral configuration: ${missing.join(", ")}`
        : null,
  };
}

// Local copy of the flag check to avoid a circular import with the adapter.
function isRingCentralAdapterEnabledLocal(env: NodeJS.ProcessEnv): boolean {
  const v = env.USE_RINGCENTRAL_ADAPTER;
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Real RingCentral client (RingOut). Structured against the RingCentral REST
 * API (JWT auth grant → RingOut). Constructed ONLY when readiness passes; never
 * exercised by the test suite (which injects MockRingCentralClient) and NOT
 * described as production-validated. Fail-closed: any auth/HTTP error surfaces
 * as a thrown error the caller converts to a manual fallback.
 */
export class RealRingCentralClient implements RingCentralClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  constructor(
    private readonly cfg: {
      serverUrl: string;
      clientId: string;
      clientSecret: string;
      jwt: string;
    },
  ) {}

  private async authorize(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await fetch(`${this.cfg.serverUrl}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: this.cfg.jwt,
      }),
    });
    if (!res.ok) throw new Error(`RingCentral auth failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("RingCentral auth returned no token");
    this.accessToken = body.access_token;
    this.tokenExpiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    const token = await this.authorize();
    const res = await fetch(
      `${this.cfg.serverUrl}/restapi/v1.0/account/~/extension/~/ring-out`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: { extensionNumber: input.fromUserExtension },
          to: { phoneNumber: input.toE164 },
          playPrompt: false,
        }),
      },
    );
    if (!res.ok) throw new Error(`RingCentral ring-out failed (${res.status})`);
    const body = (await res.json()) as { id?: string | number; status?: { callStatus?: string } };
    if (body.id == null) throw new Error("RingCentral ring-out returned no call id");
    return {
      ringCentralCallId: String(body.id),
      status: mapRingCentralStatus(body.status?.callStatus),
    };
  }

  async getCallStatus(ringCentralCallId: string): Promise<RingCentralCallStatus> {
    const token = await this.authorize();
    const res = await fetch(
      `${this.cfg.serverUrl}/restapi/v1.0/account/~/extension/~/ring-out/${encodeURIComponent(ringCentralCallId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`RingCentral status failed (${res.status})`);
    const body = (await res.json()) as { status?: { callStatus?: string } };
    return mapRingCentralStatus(body.status?.callStatus);
  }
}

function mapRingCentralStatus(s: string | undefined): RingCentralCallStatus {
  switch ((s ?? "").toLowerCase()) {
    case "inprogress":
    case "success":
      return "answered";
    case "ringing":
      return "ringing";
    case "cannotreach":
    case "error":
    case "nocallerid":
      return "failed";
    default:
      return "queued";
  }
}

/**
 * Deterministic mock client for tests + local mock validation. Returns a stable
 * provider call id derived from the target so a test can then drive simulated
 * webhook events against it. Never makes network calls.
 */
export class MockRingCentralClient implements RingCentralClient {
  private seq = 0;
  constructor(private readonly opts: { idPrefix?: string } = {}) {}
  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    this.seq += 1;
    const digits = input.toE164.replace(/[^\d]/g, "");
    return {
      ringCentralCallId: `${this.opts.idPrefix ?? "rc-mock"}-${digits}-${this.seq}`,
      status: "queued",
    };
  }
  async getCallStatus(_ringCentralCallId: string): Promise<RingCentralCallStatus> {
    return "queued";
  }
}

/**
 * Resolve the RingCentral client for the current environment. FAIL CLOSED:
 * returns the DormantRingCentralClient (whose methods throw) unless readiness
 * passes with real credentials. An explicit override is honored (tests inject
 * MockRingCentralClient).
 */
export function resolveRingCentralClient(
  env: NodeJS.ProcessEnv = process.env,
  override?: RingCentralClient,
): { client: RingCentralClient; readiness: RingCentralServerReadiness } {
  const readiness = ringCentralServerReadiness(env);
  if (override) return { client: override, readiness };
  // Explicit MOCK mode: adapter enabled + RINGCENTRAL_MOCK set → deterministic
  // mock client, ready WITHOUT real credentials. This is the sanctioned
  // mock-validation path (never production-live) so the integrated flow can be
  // exercised end-to-end without provider secrets. Real creds take a different
  // branch below.
  if (
    isRingCentralAdapterEnabledLocal(env) &&
    (env.RINGCENTRAL_MOCK === "1" || env.RINGCENTRAL_MOCK === "true" || env.RINGCENTRAL_MOCK === "yes")
  ) {
    return {
      client: new MockRingCentralClient(),
      readiness: { enabled: true, hasCredentials: false, ready: true, reason: "mock" },
    };
  }
  if (!readiness.ready) return { client: new DormantRingCentralClient(), readiness };
  return {
    client: new RealRingCentralClient({
      serverUrl: String(env.RINGCENTRAL_SERVER_URL),
      clientId: String(env.RINGCENTRAL_CLIENT_ID),
      clientSecret: String(env.RINGCENTRAL_CLIENT_SECRET),
      jwt: String(env.RINGCENTRAL_JWT),
    }),
    readiness,
  };
}
