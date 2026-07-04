---
name: Dev EADDRINUSE on workflow restart (port 5000)
description: Why the dev server recurrently fails with EADDRINUSE on restart and the durable invariants that keep the port releasable.
---

**Symptom:** the dev workflow recurrently fails to start with
`listen EADDRINUSE: address already in use 0.0.0.0:5000`.

**Process topology:** `sh -c` → tsx CLI wrapper → **node child (the actual port
listener)**. The node child runs our code; the sh and tsx wrapper do not.

**Two independent root causes (both must be handled):**

1. **Leaked listener subtree (primary, hardest).** On restart the workflow
   manager kills an ancestor, but SIGKILL does not propagate down. Two leak
   shapes occur: (a) only the node child is reparented (its `ppid` changes), or
   (b) the manager kills the top `sh`, the tsx wrapper is reparented but stays
   alive, and the node child's **direct `ppid` is unchanged** — a ppid-only
   check misses this. Either way the listener keeps holding port 5000 and the
   next start collides.
   **Fix:** dev-only watchdog in `server/index.ts` that self-exits when EITHER
   its own `ppid` changes OR its grandparent pid changes (read grandparent via
   `/proc/<ppid>/stat`, parsing fields after the final ')'). Catches both leak
   shapes and frees the port automatically.

2. **Slow drain on SIGTERM (secondary).** `httpServer.close(cb)` only runs its
   callback (→ `process.exit`) once all connections end, but Vite HMR holds a
   long-lived connection, so the drain hangs.
   **Fix:** dev-only, after `httpServer.close()`, drop connections via
   `closeIdleConnections()`/`closeAllConnections()` (guarded) + short force-exit
   timer. Keep the production drain longer (gate on `NODE_ENV`).

**Invariant:** the listener must become killable/exit promptly on restart. Never
shorten the drain, force-close connections, or run the watchdog in production —
gate all of it on `NODE_ENV` (`development` for the watchdog, `!== production`
for the drain). ECS owns the production lifecycle.

**Caution:** these fixes have been reverted by a checkpoint/merge at least once —
if EADDRINUSE recurs, first re-check that the watchdog + drain code is still
present in `server/index.ts` before assuming a new cause.

**Runbook if it recurs:** find holders with `ps aux | rg "server/index"` then
`kill -9 <pid>` (do NOT `pkill -f "tsx server/index.ts"` — the pattern matches
the killing shell's own command line and it suicides with code 137;
`lsof`/`fuser` are unreliable in this container). Then restart. The structural
cure is a single-process dev command (`node --import tsx server/index.ts`), but
that edits package.json — ask the user first.
