// Phase 5B — client integration of the Phase 4 active-work claim as ONE
// patient-interaction session. Hosted ONCE at the Team Portal shell and keyed
// on the active interaction's executionCaseId, so the claim spans Phone ↔
// Calendar (the key does not change on a mode switch) and there is exactly ONE
// renewal timer per interaction (no per-tab / per-mode timers).
//
// Contract:
//   • acquire when an editable interaction begins (enabled + a real case id);
//   • a SINGLE renewal heartbeat below the lease; server expiry is authoritative;
//   • pause the heartbeat while the tab is hidden so an abandoned tab lets its
//     lease lapse (never renews forever) — resume on return;
//   • tolerate transient failures (keep the claim, retry); detect a REAL loss
//     (expired / taken over) and surface it for stale-work recovery;
//   • release on teardown ONLY if we actually held it (next patient / close /
//     unmount / owner change) — a successful disposition already releases
//     server-side, and a mode switch keeps `enabled` true so it does not fire.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireWorkClaim,
  renewWorkClaim,
  releaseWorkClaim,
  type WorkClaimInfo,
} from "@/lib/workflow/workClaimApi";

export type WorkClaimStatus =
  | "idle" // no active interaction
  | "acquiring" // acquire in flight
  | "held" // we hold the claim → editable work is safe
  | "conflict" // someone else holds it → read-only
  | "lost" // we lost a claim we held → stale-work recovery
  | "unavailable"; // no roster identity / case missing / error

export type WorkClaimSession = {
  status: WorkClaimStatus;
  claim: WorkClaimInfo | null;
  holderName: string | null;
  message: string | null;
  /** True ONLY while we currently hold the claim → mutable work is allowed. */
  canEdit: boolean;
  /** Re-attempt acquisition (e.g. a "Resume" action after a lost claim). Never
   *  force-steals — a live foreign claim still resolves to `conflict`. */
  reacquire: () => void;
  /** Explicitly release + go idle (e.g. "Return to queue"). */
  release: () => void;
};

export function useWorkClaim(
  executionCaseId: number | null,
  opts: { enabled?: boolean } = {},
): WorkClaimSession {
  const enabled =
    (opts.enabled ?? true) && typeof executionCaseId === "number" && executionCaseId > 0;
  const caseId = enabled ? (executionCaseId as number) : null;

  const [status, setStatus] = useState<WorkClaimStatus>("idle");
  const [claim, setClaim] = useState<WorkClaimInfo | null>(null);
  const [holderName, setHolderName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bump → re-run acquire (reacquire)

  // ONE renewal timer for the whole hook instance (Part 16).
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renewMsRef = useRef<number>(120_000);
  const ownedRef = useRef<number | null>(null); // case we currently own work for
  const heldRef = useRef(false); // did we actually acquire (→ release on teardown)

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reacquire = useCallback(() => setAttempt((n) => n + 1), []);

  const release = useCallback(() => {
    stopTimer();
    const id = ownedRef.current;
    ownedRef.current = null;
    heldRef.current = false;
    setStatus("idle");
    setClaim(null);
    setHolderName(null);
    setMessage(null);
    if (id != null) void releaseWorkClaim(id);
  }, [stopTimer]);

  useEffect(() => {
    if (caseId == null) {
      // No active interaction. Any prior claim was already released by the
      // previous effect's cleanup; just reflect idle.
      setStatus("idle");
      setClaim(null);
      setHolderName(null);
      setMessage(null);
      return;
    }

    let cancelled = false;
    ownedRef.current = caseId;
    heldRef.current = false;
    setStatus("acquiring");
    setMessage(null);
    setHolderName(null);

    const heartbeat = async () => {
      if (ownedRef.current !== caseId) return;
      // Skip while the tab is hidden — an abandoned/backgrounded tab must not
      // hold the claim forever; the server lease lapses and frees the patient.
      if (typeof document !== "undefined" && document.hidden) return;
      const r = await renewWorkClaim(caseId);
      if (cancelled || ownedRef.current !== caseId) return;
      if (r.ok) {
        setClaim(r.claim);
      } else if (r.reason === "lost") {
        stopTimer();
        heldRef.current = false;
        setStatus("lost");
        setMessage(r.message);
      }
      // transient → keep the timer; retry on the next tick.
    };

    (async () => {
      const result = await acquireWorkClaim(caseId);
      if (cancelled || ownedRef.current !== caseId) return;
      if (result.ok) {
        heldRef.current = true;
        renewMsRef.current = Math.max(15, result.renewSeconds) * 1000;
        setClaim(result.claim);
        setStatus("held");
        setMessage(null);
        stopTimer();
        timerRef.current = setInterval(heartbeat, renewMsRef.current);
      } else if (result.reason === "conflict" || result.reason === "conflict_sibling") {
        setStatus("conflict");
        setHolderName(result.holderName);
        setMessage(result.message);
      } else {
        setStatus("unavailable");
        setMessage(result.message);
      }
    })();

    return () => {
      cancelled = true;
      stopTimer();
      // Release on teardown ONLY when we actually held it. The shell keeps
      // `enabled` true across Phone↔Calendar (caseId unchanged), so this does
      // NOT fire on a mode switch — only on next-patient / close / unmount.
      if (ownedRef.current === caseId && heldRef.current) {
        void releaseWorkClaim(caseId);
      }
      ownedRef.current = null;
      heldRef.current = false;
    };
  }, [caseId, attempt, stopTimer]);

  // Resume the heartbeat promptly when the tab returns to the foreground
  // (hidden tabs skipped heartbeats above). Never asserts the claim locally —
  // it just renews; a lapsed claim resolves to `lost` (server authoritative).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = async () => {
      if (document.hidden || ownedRef.current == null || !heldRef.current) return;
      const id = ownedRef.current;
      const r = await renewWorkClaim(id);
      if (ownedRef.current !== id) return;
      if (r.ok) setClaim(r.claim);
      else if (r.reason === "lost") {
        stopTimer();
        heldRef.current = false;
        setStatus("lost");
        setMessage(r.message);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [stopTimer]);

  return {
    status,
    claim,
    holderName,
    message,
    canEdit: status === "held",
    reacquire,
    release,
  };
}
