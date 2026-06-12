// Qualification job status polling hook (hotfix).
//
// Polls /api/plexus-iq/qualification-jobs/:jobId/status with a safe
// interval + exponential backoff on transient network failures. Treats
// fetch failures as a "reconnecting" state rather than terminal job
// failure — the actual job is still running on the server, the browser
// just lost the latest poll.
//
// Terminal statuses (completed / failed / cancelled) stop polling and
// invalidate the relevant Plexus IQ caches so the UI refreshes
// automatically.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type QualificationJobStatus = {
  ok?: boolean;
  jobId: number;
  batchId: number;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
  percent: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  errors: ReadonlyArray<{ patientId: number; patientName: string; error: string }>;
};

export type UseQualificationJobStatusOptions = {
  /** Base poll interval in ms when the connection is healthy. */
  intervalMs?: number;
  /** Max poll interval after repeated network failures. */
  maxBackoffMs?: number;
  /** Cache keys to invalidate on terminal status. */
  invalidateOnDone?: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Stop polling when jobId is null/undefined. */
  enabled?: boolean;
};

export type UseQualificationJobStatusResult = {
  data: QualificationJobStatus | null;
  /** True between poll attempts when the last poll failed but the
   *  job's server-side state may still be progressing. UI should keep
   *  the qualification banner visible and show a "reconnecting" cue. */
  reconnecting: boolean;
  /** Number of consecutive failed polls. Resets to 0 on success. */
  consecutiveFailures: number;
  /** True until the first poll completes (success or failure). */
  initialLoading: boolean;
  /** True once the server reports a terminal status. */
  done: boolean;
};

const TERMINAL = new Set(["completed", "failed", "cancelled"] as const);

export function useQualificationJobStatus(
  jobId: number | null | undefined,
  {
    intervalMs = 2500,
    maxBackoffMs = 30_000,
    invalidateOnDone = [],
    enabled = true,
  }: UseQualificationJobStatusOptions = {},
): UseQualificationJobStatusResult {
  const [data, setData] = useState<QualificationJobStatus | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const qc = useQueryClient();

  // Mutable ref so the timer callback always sees the latest values.
  const stateRef = useRef({ data, reconnecting, consecutiveFailures });
  stateRef.current = { data, reconnecting, consecutiveFailures };

  const done = useMemo(() => {
    if (!data) return false;
    return TERMINAL.has(data.status as never);
  }, [data]);

  // Memoize the invalidate list so the effect doesn't loop on a fresh
  // array reference each render.
  const invalidateSerialized = useMemo(
    () => invalidateOnDone.map((k) => JSON.stringify(k)).join("||"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invalidateOnDone.length],
  );

  useEffect(() => {
    if (!enabled || jobId == null) {
      setInitialLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/plexus-iq/qualification-jobs/${jobId}/status`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as QualificationJobStatus;
        if (cancelled) return;
        setData(next);
        setReconnecting(false);
        setConsecutiveFailures(0);
        setInitialLoading(false);
        if (TERMINAL.has(next.status as never)) {
          for (const key of invalidateOnDone) {
            qc.invalidateQueries({ queryKey: key as readonly unknown[] });
          }
          return; // stop polling
        }
        timer = setTimeout(poll, intervalMs);
      } catch {
        if (cancelled) return;
        setReconnecting(true);
        const nextFailureCount = stateRef.current.consecutiveFailures + 1;
        setConsecutiveFailures(nextFailureCount);
        setInitialLoading(false);
        const backoff = Math.min(
          intervalMs * Math.pow(2, nextFailureCount),
          maxBackoffMs,
        );
        timer = setTimeout(poll, backoff);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  // invalidateSerialized + the four primitives below cover all
  // re-runs we care about.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, enabled, intervalMs, maxBackoffMs, invalidateSerialized]);

  return {
    data,
    reconnecting,
    consecutiveFailures,
    initialLoading,
    done,
  };
}
