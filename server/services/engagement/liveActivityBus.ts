// Cross-instance pub/sub bus for live engagement activity (Phase 4).
//
// Whenever a patient_journey_event is written, the canonical repo writer
// publishes its eventType here. The engagement distribution SSE endpoint
// (`GET /api/engagement/distribution/stream`) subscribes so it can push a
// lightweight "refresh" signal to admins watching the Live Team Activity feed
// the moment an assignment/outcome event happens — instead of waiting on the
// 15s polling tick.
//
// Under horizontal scaling (AWS multi-task) each server instance runs its own
// process, so an in-process EventEmitter alone would only deliver pushes to
// admins connected to the *same* instance that wrote the event. To make the
// feed reliable team-wide, this bus is backed by Postgres LISTEN/NOTIFY:
//
//   • publishLiveActivity() emits locally (instant, same-instance subscribers)
//     AND fires a Postgres NOTIFY carrying only the non-PHI eventType + the
//     origin instance id.
//   • A single dedicated LISTEN connection per instance receives NOTIFYs from
//     *other* instances and re-emits them onto the local EventEmitter, so
//     subscribers on any instance see events written on any instance within
//     ~1s. Self-originated NOTIFYs are ignored (already emitted locally) to
//     avoid double delivery.
//
// The payload carries only the eventType literal, never patient data. If the
// LISTEN connection drops it reconnects with backoff; meanwhile the SSE
// consumer's polling fallback still covers the gap (the refetch always reads
// the shared DB).

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

export interface LiveActivitySignal {
  eventType: string;
}

interface NotifyPayload {
  eventType: string;
  origin: string;
}

const emitter = new EventEmitter();
// Many concurrent admin SSE connections may subscribe; lift the default
// 10-listener warning ceiling so legitimate fan-out doesn't log spuriously.
emitter.setMaxListeners(0);

const CHANNEL = "activity";
// Postgres NOTIFY channel name (must be a valid identifier).
const PG_CHANNEL = "live_activity";
// Unique per-process id so we can ignore our own NOTIFYs on the LISTEN side.
const INSTANCE_ID = randomUUID();

/** Emit a signal to all in-process subscribers. */
function emitLocal(eventType: string): void {
  try {
    emitter.emit(CHANNEL, { eventType } satisfies LiveActivitySignal);
  } catch {
    // Swallow — a broken subscriber must never break the publish path.
  }
}

/** Publish a journey-event signal. Best-effort: never throws into the caller
 *  (the DB write must not fail just because a listener or NOTIFY misbehaves).
 *  Delivers instantly to same-instance subscribers and fans out to other
 *  instances via Postgres NOTIFY. */
export function publishLiveActivity(eventType: string): void {
  // Fast path: same-instance subscribers.
  emitLocal(eventType);

  // Cross-instance fan-out. Fire-and-forget over a short-lived pooled query so
  // we don't hold the dedicated LISTEN connection. Lazy import avoids a static
  // import cycle with server/db.ts.
  void (async () => {
    try {
      const { pool } = await import("../../db");
      const payload: NotifyPayload = { eventType, origin: INSTANCE_ID };
      await pool.query("SELECT pg_notify($1, $2)", [
        PG_CHANNEL,
        JSON.stringify(payload),
      ]);
    } catch (err) {
      // Other instances simply fall back to their polling tick.
      console.error(
        "[liveActivityBus] NOTIFY failed:",
        err instanceof Error ? err.message : err,
      );
    }
  })();
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

// ─── Cross-instance LISTEN bridge ────────────────────────────────────────
// A single long-lived connection per process holds `LISTEN live_activity`.
// node-postgres pooled clients can't be used for LISTEN (the connection must
// stay checked out indefinitely), so we manage a dedicated pg.Client here.

let listenClient: Client | null = null;
let stopped = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelayMs = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

function handleNotification(payload: string | undefined): void {
  if (!payload) return;
  let parsed: NotifyPayload;
  try {
    parsed = JSON.parse(payload) as NotifyPayload;
  } catch {
    return; // Ignore malformed payloads.
  }
  if (!parsed || typeof parsed.eventType !== "string") return;
  // We already emitted locally on publish; ignore our own NOTIFY to avoid
  // double delivery to same-instance subscribers.
  if (parsed.origin === INSTANCE_ID) return;
  emitLocal(parsed.eventType);
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectListener();
  }, delay);
}

async function connectListener(): Promise<void> {
  if (stopped || listenClient) return;
  if (!process.env.DATABASE_URL) {
    console.error(
      "[liveActivityBus] DATABASE_URL unset — cross-instance bridge disabled",
    );
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  const onFailure = (err: unknown, where: string) => {
    console.error(
      `[liveActivityBus] LISTEN client ${where}:`,
      err instanceof Error ? err.message : err,
    );
    if (listenClient === client) listenClient = null;
    try {
      client.removeAllListeners();
      void client.end().catch(() => {});
    } catch {
      // ignore
    }
    scheduleReconnect();
  };

  client.on("error", (err) => onFailure(err, "error"));
  client.on("end", () => {
    if (!stopped && listenClient === client) onFailure(new Error("connection ended"), "end");
  });
  client.on("notification", (msg) => {
    if (msg.channel !== PG_CHANNEL) return;
    handleNotification(msg.payload);
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${PG_CHANNEL}`);
    listenClient = client;
    reconnectDelayMs = 1_000; // reset backoff on success
    console.log("[liveActivityBus] cross-instance LISTEN bridge connected");
  } catch (err) {
    onFailure(err, "connect");
  }
}

/** Start the cross-instance LISTEN bridge. Idempotent; safe to call once on
 *  startup. Failures self-heal via backoff reconnect. */
export function startLiveActivityBridge(): void {
  stopped = false;
  void connectListener();
}

/** Stop the bridge and release its connection (SIGTERM / shutdown). */
export async function stopLiveActivityBridge(): Promise<void> {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const client = listenClient;
  listenClient = null;
  if (client) {
    try {
      client.removeAllListeners();
      await client.end();
    } catch (err) {
      console.error(
        "[liveActivityBus] error closing LISTEN client:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
