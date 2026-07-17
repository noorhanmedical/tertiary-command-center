// BatchFlow session isolation (task #515).
//
// Plexus IQ BatchFlow treats every intake as an isolated, timestamped
// batch session. This module owns the small amount of client-side state
// that backs that experience WITHOUT any schema change:
//
//   - The "active batch" token lives in sessionStorage under
//     `plexusIq.activeBatchId`. sessionStorage (not localStorage) is
//     deliberate: it survives an in-tab refresh so an intentionally
//     resumed batch stays put, but it does NOT auto-rehydrate across a
//     fresh tab / new session.
//   - A per-batch source map (paste / import / manual) lives in
//     localStorage. The screening_batches schema has no source column
//     and changing it is out of scope, so the UI records the source it
//     observed at creation time and falls back to derivation for rows it
//     never saw.
//   - A UI-only archived set lives in localStorage so operators can hide
//     finished sessions from Batch History without deleting the batch.
//
// A single CustomEvent (`plexusIq:activeBatchChanged`) keeps every
// mounted consumer (the active-batch header, the BatchFlow dialog) in
// sync when the token changes.

import { useCallback, useEffect, useState } from "react";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import { computePlexusIqStatus } from "@/lib/plexusIqStatus";

const ACTIVE_BATCH_KEY = "plexusIq.activeBatchId";
const SOURCE_MAP_KEY = "plexusIq.batchSources.v1";
const ARCHIVED_KEY = "plexusIq.archivedBatches.v1";
const ACTIVE_CHANGED_EVENT = "plexusIq:activeBatchChanged";

export type BatchSource = "paste" | "import" | "manual";

// ───── Active batch token (sessionStorage) ──────────────────────────────

export function getActiveBatchId(): number | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_BATCH_KEY);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function setActiveBatchId(id: number | null): void {
  try {
    if (id == null) sessionStorage.removeItem(ACTIVE_BATCH_KEY);
    else sessionStorage.setItem(ACTIVE_BATCH_KEY, String(id));
  } catch {
    // sessionStorage unavailable (SSR, quota); ignore.
  }
  try {
    window.dispatchEvent(new CustomEvent(ACTIVE_CHANGED_EVENT));
  } catch {
    /* noop */
  }
}

export function clearActiveBatchId(): void {
  setActiveBatchId(null);
}

/**
 * React hook for the active-batch token. Re-renders whenever the token
 * changes — including changes made by other components in the same tab
 * (via the CustomEvent) and cross-tab changes (via the storage event).
 */
export function useActiveBatchId(): {
  activeBatchId: number | null;
  setActive: (id: number | null) => void;
  clearActive: () => void;
} {
  const [activeBatchId, setId] = useState<number | null>(() => getActiveBatchId());

  useEffect(() => {
    const sync = () => setId(getActiveBatchId());
    window.addEventListener(ACTIVE_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ACTIVE_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setActive = useCallback((id: number | null) => setActiveBatchId(id), []);
  const clearActive = useCallback(() => clearActiveBatchId(), []);

  return { activeBatchId, setActive, clearActive };
}

// ───── Source map (localStorage) ────────────────────────────────────────

function readSourceMap(): Record<string, BatchSource> {
  try {
    const raw = localStorage.getItem(SOURCE_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function setBatchSource(id: number, source: BatchSource): void {
  try {
    const map = readSourceMap();
    map[String(id)] = source;
    localStorage.setItem(SOURCE_MAP_KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

export function getBatchSource(id: number): BatchSource | null {
  const map = readSourceMap();
  return map[String(id)] ?? null;
}

// Notes blob written by the clinical-import path. Used to derive a source
// for batches created before this feature existed (no recorded source).
const CLINICAL_IMPORT_MARKER = "plexus-iq-clinical-import";

/**
 * Best-effort source for a batch. Prefers the explicitly recorded source;
 * otherwise inspects patient notes for the clinical-import marker and
 * falls back to "manual".
 */
export function resolveBatchSource(
  batchId: number,
  patients?: Pick<PatientScreening, "notes">[],
): BatchSource {
  const recorded = getBatchSource(batchId);
  if (recorded) return recorded;
  if (patients && patients.some((p) => (p.notes ?? "").includes(CLINICAL_IMPORT_MARKER))) {
    return "import";
  }
  return "manual";
}

export function batchSourceLabel(source: BatchSource): string {
  switch (source) {
    case "paste":
      return "Pasted list";
    case "import":
      return "File import";
    case "manual":
      return "Manual entry";
  }
}

// ───── Archived set (localStorage, UI-only) ─────────────────────────────

function readArchived(): number[] {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n) => typeof n === "number");
  } catch {
    return [];
  }
}

export function isBatchArchived(id: number): boolean {
  return readArchived().includes(id);
}

export function getArchivedBatchIds(): number[] {
  return readArchived();
}

export function setBatchArchived(id: number, archived: boolean): void {
  try {
    const set = new Set(readArchived());
    if (archived) set.add(id);
    else set.delete(id);
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* noop */
  }
}

// ───── Batch-level qualification status (derived) ───────────────────────

export type BatchFlowStatus =
  | "empty"
  | "parsed"
  | "qualifying"
  | "ready_for_review"
  | "admin_approved"
  | "sent_to_engagement"
  | "failed";

export type BatchFlowStatusMeta = {
  status: BatchFlowStatus;
  label: string;
  pillClass: string;
};

const BATCH_STATUS_PILL: Record<BatchFlowStatus, string> = {
  empty: "bg-slate-100 text-slate-500 border-slate-200",
  parsed: "bg-slate-100 text-slate-700 border-slate-200",
  qualifying: "bg-sky-50 text-sky-800 border-sky-200",
  ready_for_review: "bg-violet-50 text-violet-800 border-violet-200",
  admin_approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  sent_to_engagement: "bg-teal-50 text-teal-800 border-teal-200",
  failed: "bg-rose-50 text-rose-800 border-rose-200",
};

const BATCH_STATUS_LABEL: Record<BatchFlowStatus, string> = {
  empty: "Empty",
  parsed: "Parsed",
  qualifying: "Qualifying",
  ready_for_review: "Ready for Review",
  admin_approved: "Admin Approved",
  sent_to_engagement: "Sent to Engagement",
  failed: "Needs Fix",
};

type StatusPatient = Pick<
  PatientScreening,
  "status" | "commitStatus" | "adminApprovalStatus" | "qualifyingTests" | "reasoning"
>;

/**
 * Aggregate a batch's per-patient Plexus IQ statuses into one batch-level
 * label. Precedence favors the "most advanced" state present so a row
 * never looks less done than its patients. `isRunning` comes from live
 * qualification-job tracking on the page.
 */
export function deriveBatchFlowStatus(
  patients: StatusPatient[] | undefined,
  opts: { isRunning?: boolean } = {},
): BatchFlowStatusMeta {
  if (opts.isRunning) {
    return {
      status: "qualifying",
      label: BATCH_STATUS_LABEL.qualifying,
      pillClass: BATCH_STATUS_PILL.qualifying,
    };
  }
  if (!patients || patients.length === 0) {
    return {
      status: "empty",
      label: BATCH_STATUS_LABEL.empty,
      pillClass: BATCH_STATUS_PILL.empty,
    };
  }

  let anySent = false;
  let allSent = true;
  let anyApproved = false;
  let anyReady = false;
  let anyFailed = false;
  let anyPending = false;

  for (const p of patients) {
    const meta = computePlexusIqStatus(p);
    switch (meta.status) {
      case "sent_to_engagement":
        anySent = true;
        break;
      case "admin_approved":
        anyApproved = true;
        allSent = false;
        break;
      case "ready_for_review":
        anyReady = true;
        allSent = false;
        break;
      case "failed":
        anyFailed = true;
        allSent = false;
        break;
      case "qualification_running":
        allSent = false;
        break;
      case "pending_qualification":
      default:
        anyPending = true;
        allSent = false;
        break;
    }
  }

  let status: BatchFlowStatus;
  if (anySent && allSent) status = "sent_to_engagement";
  else if (anyFailed) status = "failed";
  else if (anyApproved && !anyPending && !anyReady) status = "admin_approved";
  else if (anyReady || anyApproved || anySent) status = "ready_for_review";
  else status = "parsed";

  return {
    status,
    label: BATCH_STATUS_LABEL[status],
    pillClass: BATCH_STATUS_PILL[status],
  };
}

/**
 * A batch is "unfinished" (resumable) when it still has work to do —
 * nothing sent to engagement yet and not archived. Used to decide whether
 * "Continue Recent Batch" should appear on the landing screen.
 */
export function isBatchResumable(
  batch: Pick<ScreeningBatch, "id">,
  status: BatchFlowStatus,
): boolean {
  if (isBatchArchived(batch.id)) return false;
  return status !== "sent_to_engagement";
}
