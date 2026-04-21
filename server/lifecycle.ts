// ─── Background services lifecycle ───────────────────────────────────────
// Single entry point for starting and stopping recurring in-process work.
// Called from server/index.ts after the HTTP server starts; also wired into
// the SIGTERM handler so ECS task replacement drains cleanly.
//
// Each background job already acquires a Postgres advisory lock before doing
// work (see server/lib/advisoryLock.ts). The lock guarantees that even when
// multiple ECS tasks run in parallel, the underlying side-effects (sheets
// sync, morning rebuild, absence alerts) only fire once per tick across the
// fleet.
//
// Adding a new recurring job? Start it from startBackgroundServices() and
// register its cleanup in stopBackgroundServices().

import { startAbsenceWatcher, stopAbsenceWatcher } from "./services/absenceWatcher";
import { startMorningRebuildScheduler, stopMorningRebuildScheduler } from "./services/morningRebuildScheduler";

let started = false;

export function startBackgroundServices(): void {
  if (started) return;
  started = true;
  startAbsenceWatcher();
  startMorningRebuildScheduler();
}

export async function stopBackgroundServices(): Promise<void> {
  if (!started) return;
  started = false;
  stopAbsenceWatcher();
  stopMorningRebuildScheduler();
}
