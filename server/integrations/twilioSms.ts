// Twilio SMS adapter (Task #648) — the ONLY place that talks to the SMS
// provider. Env/connection gated: when Twilio isn't configured every caller
// gets an honest "not connected" result, never a fake send.
//
// Credential sources, in order:
//   1. Replit Twilio connector (connectors.replit.com credential proxy).
//   2. Environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//      TWILIO_PHONE_NUMBER.
//
// Sends go through the plain Twilio REST API via fetch — no SDK dependency.
// Credentials are never cached (connector tokens rotate).

export type TwilioConfig = {
  accountSid: string;
  /** Basic-auth username — API key SID when using API keys, else account SID. */
  authUser: string;
  /** Basic-auth password — API key secret or auth token. */
  authSecret: string;
  /** The practice's sending number (E.164). */
  fromNumber: string;
  source: "connector" | "env";
};

async function getConnectorConfig(): Promise<TwilioConfig | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) return null;
  try {
    const res = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=twilio`,
      { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ settings?: Record<string, any> }> };
    const settings = data.items?.[0]?.settings;
    if (!settings) return null;
    const accountSid: string | undefined =
      settings.account_sid ?? settings.accountSid ?? settings.oauth?.credentials?.account_sid;
    const apiKey: string | undefined = settings.api_key ?? settings.apiKey;
    const apiKeySecret: string | undefined =
      settings.api_key_secret ?? settings.apiKeySecret ?? settings.api_secret;
    const authToken: string | undefined = settings.auth_token ?? settings.authToken;
    const fromNumber: string | undefined =
      settings.phone_number ?? settings.phoneNumber ?? settings.from_phone_number;
    if (!accountSid || !fromNumber) return null;
    if (apiKey && apiKeySecret) {
      return { accountSid, authUser: apiKey, authSecret: apiKeySecret, fromNumber, source: "connector" };
    }
    if (authToken) {
      return { accountSid, authUser: accountSid, authSecret: authToken, fromNumber, source: "connector" };
    }
    return null;
  } catch {
    return null;
  }
}

function getEnvConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authUser: accountSid, authSecret: authToken, fromNumber, source: "env" };
}

/** Resolve Twilio credentials, or null when SMS is not connected. */
export async function getTwilioConfig(): Promise<TwilioConfig | null> {
  return (await getConnectorConfig()) ?? getEnvConfig();
}

/** Loose phone normalization: keep digits, prefix +1 for bare 10-digit US numbers. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return "+" + digits.slice(1).replace(/\D/g, "");
  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;
  return bare.length > 0 ? `+${bare}` : "";
}

export type SmsSendResult =
  | { ok: true; sid: string; sentAt: string }
  | { ok: false; error: string };

/**
 * Send one SMS through Twilio's REST API. Returns an honest result — a
 * failed provider call is reported as failure, never masked as success.
 */
export async function sendSmsViaTwilio(
  config: TwilioConfig,
  to: string,
  body: string,
): Promise<SmsSendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: config.fromNumber, Body: body });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${config.authUser}:${config.authSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const msg = data?.message || `Twilio rejected the send (HTTP ${res.status})`;
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      sid: String(data?.sid ?? ""),
      sentAt: data?.date_created ?? new Date().toISOString(),
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error reaching Twilio" };
  }
}
