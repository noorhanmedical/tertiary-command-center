// JSON-aware fetch helper for the canonical workflow APIs.
// The shared `apiRequest` in queryClient.ts only checks `res.ok` and returns
// the raw Response, so callers that do `res.json()` blow up with a cryptic
// "Unexpected token '<'" error if the server returns HTML (e.g. the Vite dev
// server's SPA catch-all when an API route is missing or misnamed).
//
// `requestJson` does three things differently:
//   1. Sends `Accept: application/json` so the server prefers JSON when negotiating.
//   2. Validates `Content-Type` includes `application/json` BEFORE parsing —
//      if the body is HTML/text we throw a readable diagnostic with URL, status,
//      and body snippet instead of a JSON parse error.
//   3. Surfaces JSON `{ error }` payloads from non-2xx responses cleanly.
//
// All sessions are sent (`credentials: "include"`) so the existing auth gate
// keeps working unchanged.

export class JsonResponseError extends Error {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly bodySnippet: string;
  constructor(opts: {
    url: string;
    status: number;
    contentType: string;
    bodySnippet: string;
    message?: string;
  }) {
    super(
      opts.message ??
        `Expected JSON from ${opts.url} but got ${opts.contentType || "no content-type"} (HTTP ${opts.status}). Body starts: ${opts.bodySnippet || "(empty)"}`,
    );
    this.name = "JsonResponseError";
    this.url = opts.url;
    this.status = opts.status;
    this.contentType = opts.contentType;
    this.bodySnippet = opts.bodySnippet;
  }
}

function snippetOf(text: string): string {
  return text.slice(0, 200).replace(/\s+/g, " ").trim();
}

export async function requestJson<T = unknown>(
  method: string,
  url: string,
  data?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (data !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  // HTML / text body — the Vite SPA fallback or a misrouted error page.
  // Throw an actionable diagnostic instead of letting `.json()` explode.
  if (!isJson) {
    const text = await res.text().catch(() => "");
    throw new JsonResponseError({
      url,
      status: res.status,
      contentType,
      bodySnippet: snippetOf(text),
    });
  }

  // JSON error envelopes (e.g. { error: "..." }) on non-2xx responses.
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body === "object") {
        const err = (body as { error?: unknown }).error;
        if (typeof err === "string" && err.length > 0) {
          message = `${res.status}: ${err}`;
        }
      }
    } catch {
      /* fall through to default message */
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}
