// In-process pub/sub bus for live engagement activity (Phase 4).
//
// Whenever a patient_journey_event is written, the canonical repo writer
// publishes its eventType here. The engagement distribution SSE endpoint
// (`GET /api/engagement/distribution/stream`) subscribes so it can push a
// lightweight "refresh" signal to admins watching the Live Team Activity feed
// the moment an assignment/outcome event happens — instead of waiting on the
// 15s polling tick.
//
// This is intentionally tiny and dependency-free: it carries only the
// non-PHI eventType literal, never patient data. The SSE consumer decides
// which event types are feed-worthy. Multiple ECS tasks each have their own
// in-process bus; a client connected to one task only gets pushes for events
// written by that task, and the polling fallback covers the rest — which is
// acceptable for a "nudge to refetch" signal (the refetch always reads the
// shared DB).

import { EventEmitter } from "node:events";

export interface LiveActivitySignal {
  eventType: string;
}

const emitter = new EventEmitter();
// Many concurrent admin SSE connections may subscribe; lift the default
// 10-listener warning ceiling so legitimate fan-out doesn't log spuriously.
emitter.setMaxListeners(0);

const CHANNEL = "activity";

/** Publish a journey-event signal. Best-effort: never throws into the caller
 *  (the DB write must not fail just because a listener misbehaves). */
export function publishLiveActivity(eventType: string): void {
  try {
    emitter.emit(CHANNEL, { eventType } satisfies LiveActivitySignal);
  } catch {
    // Swallow — a broken subscriber must never break the write path.
  }
}

/** Subscribe to live activity signals. Returns an unsubscribe function. */
export function subscribeLiveActivity(
  listener: (signal: LiveActivitySignal) => void,
): () => void {
  emitter.on(CHANNEL, listener);
  return () => {
    emitter.off(CHANNEL, listener);
  };
}
