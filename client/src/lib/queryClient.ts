import { QueryClient, QueryFunction } from "@tanstack/react-query";

/** K16: a structured API error. `message` is kept EXACTLY as before
 *  (`"<status>: <body>"`) so every existing `err.message` toast is unchanged, but the
 *  HTTP `status` and a stable server `code` (from the `{error, code}` JSON body, when
 *  present) are exposed as fields so consumers distinguish migration-missing (503 /
 *  `ANCILLARY_DOCUMENT_MIGRATION_MISSING`) from forbidden (403) and generic failures
 *  WITHOUT fragile message-string parsing. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: string;
  constructor(status: number, body: string, code: string | null) {
    super(`${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

function extractErrorCode(body: string): string | null {
  try { const j = JSON.parse(body); return typeof j?.code === "string" ? j.code : null; } catch { return null; }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new ApiError(res.status, text, extractErrorCode(text));
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
