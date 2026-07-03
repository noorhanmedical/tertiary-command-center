// Clinical Intelligence & Governance — server-backed store.
//
// Replaces the localStorage prototype (key `plexusIq.clinicalIntelligence.v1`)
// with the `/api/clinical-intelligence` API so learning items, rules,
// evidence decisions, and audit entries are shared across devices and team
// members. The mutation functions keep the same names/parameters as the
// prototype but are now async (they resolve with the server-persisted
// entity). Every mutation invalidates the single state query so all mounted
// consumers (Admin Review drawer, governance page) stay in sync.
//
// Any legacy per-browser localStorage data is migrated to the server once
// (insert-only; the server skips browser-local seed rules) and the key is
// then cleared.

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  CiEvidenceRecord,
  CiLearningItem,
  CiLearningStatus,
  CiRule,
  CiRuleStatus,
  CiStoreState,
} from "./types";

const CI_QUERY_KEY = ["/api/clinical-intelligence"];
const LEGACY_STORAGE_KEY = "plexusIq.clinicalIntelligence.v1";

const EMPTY: CiStoreState = { learningItems: [], rules: [], evidence: [], audit: [] };

function invalidate(): void {
  queryClient.invalidateQueries({ queryKey: CI_QUERY_KEY });
}

async function ciApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, path, body);
  const json = (await res.json()) as T;
  invalidate();
  return json;
}

// ───── Mutations (server-persisted) ─────────────────────────────────────

export async function ciAddLearningItem(
  item: Omit<CiLearningItem, "id" | "createdAt">,
): Promise<CiLearningItem> {
  return ciApi<CiLearningItem>("POST", "/api/clinical-intelligence/learning-items", item);
}

export async function ciUpdateLearningItem(
  id: string,
  by: string,
  patch: Partial<CiLearningItem>,
): Promise<void> {
  await ciApi("PATCH", `/api/clinical-intelligence/learning-items/${encodeURIComponent(id)}`, {
    by,
    patch,
  });
}

export async function ciSetLearningStatus(
  id: string,
  by: string,
  status: CiLearningStatus,
): Promise<void> {
  await ciApi("POST", `/api/clinical-intelligence/learning-items/${encodeURIComponent(id)}/status`, {
    by,
    status,
  });
}

export async function ciAddRule(
  rule: Omit<CiRule, "id" | "createdAt" | "updatedAt" | "version" | "usageCount" | "history">,
): Promise<CiRule> {
  return ciApi<CiRule>("POST", "/api/clinical-intelligence/rules", rule);
}

export async function ciUpdateRule(
  id: string,
  by: string,
  patch: Partial<CiRule>,
  changeSummary = "Rule updated",
): Promise<void> {
  await ciApi("PATCH", `/api/clinical-intelligence/rules/${encodeURIComponent(id)}`, {
    by,
    patch,
    changeSummary,
  });
}

export async function ciSetRuleStatus(id: string, by: string, status: CiRuleStatus): Promise<void> {
  return ciUpdateRule(id, by, { status }, `Status → ${status}`);
}

export async function ciConvertLearningToRule(
  learningId: string,
  by: string,
  overrides: Partial<CiRule> = {},
): Promise<CiRule | null> {
  try {
    return await ciApi<CiRule>(
      "POST",
      `/api/clinical-intelligence/learning-items/${encodeURIComponent(learningId)}/convert`,
      { by, overrides },
    );
  } catch {
    return null;
  }
}

export async function ciRecordEvidence(
  record: Omit<CiEvidenceRecord, "id" | "at" | "usedInRuleIds">,
): Promise<CiEvidenceRecord> {
  return ciApi<CiEvidenceRecord>("POST", "/api/clinical-intelligence/evidence", record);
}

export async function ciMarkEvidenceUsedInRule(evidenceId: string, ruleId: string): Promise<void> {
  await ciApi(
    "POST",
    `/api/clinical-intelligence/evidence/${encodeURIComponent(evidenceId)}/used-in-rule`,
    { ruleId },
  );
}

// ───── One-time legacy localStorage migration ───────────────────────────

let migrationAttempted = false;

function migrateLegacyLocalState(): void {
  if (migrationAttempted) return;
  migrationAttempted = true;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unreadable legacy data — drop it so we don't retry forever.
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* noop */
    }
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const state = parsed as Partial<CiStoreState>;
  const payload = {
    learningItems: Array.isArray(state.learningItems) ? state.learningItems : [],
    rules: Array.isArray(state.rules) ? state.rules : [],
    evidence: Array.isArray(state.evidence) ? state.evidence : [],
    audit: Array.isArray(state.audit) ? state.audit : [],
  };
  apiRequest("POST", "/api/clinical-intelligence/import", payload)
    .then(() => {
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        /* noop */
      }
      invalidate();
    })
    .catch((err: unknown) => {
      // Import is gated to admin/clinician server-side. A 403 will never
      // succeed for this user, so drop the legacy key instead of retrying
      // forever; any other failure retries on the next page load.
      if (err instanceof Error && err.message.startsWith("403")) {
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          /* noop */
        }
        return;
      }
      migrationAttempted = false;
    });
}

// ───── React hooks ──────────────────────────────────────────────────────

export function useClinicalIntelligence(): CiStoreState {
  useEffect(() => {
    migrateLegacyLocalState();
  }, []);
  const { data } = useQuery<CiStoreState>({ queryKey: CI_QUERY_KEY });
  return data ?? EMPTY;
}

// Same as useClinicalIntelligence but also reports whether the initial
// server fetch has resolved. Consumers that reconcile local state into
// evidence records (e.g. Admin Review on-open reconciliation) must wait
// for `isLoaded` so they don't re-record entries that already exist.
export function useClinicalIntelligenceLoaded(): {
  state: CiStoreState;
  isLoaded: boolean;
} {
  useEffect(() => {
    migrateLegacyLocalState();
  }, []);
  const { data, isSuccess } = useQuery<CiStoreState>({ queryKey: CI_QUERY_KEY });
  return { state: data ?? EMPTY, isLoaded: isSuccess };
}

export function useCiRefresh(): () => void {
  return useCallback(() => {
    invalidate();
  }, []);
}
