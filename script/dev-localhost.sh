#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Plexus self-healing local dev server.
#
# Goal: a localhost that ALWAYS works and ALWAYS reflects the latest code.
#   • Runs the Vite dev server (HMR) so every edit is live-reloaded.
#   • Frees the port before starting so a stale/wedged process never blocks boot
#     (kills the recurring EADDRINUSE loop).
#   • A watchdog pings /healthz; if the server wedges (HTTP 000, event-loop
#     stall under heavy on-demand route compile) it hard-restarts automatically.
#
# Usage:  npm run dev:local        (or)   bash script/dev-localhost.sh
# Then open http://localhost:5050  (login admin/admin on a fresh local DB).
#
# Tunables via env:
#   PORT (5050)  HEAP_MB (4096)  CHECK_INTERVAL (10s)
#   FAIL_THRESHOLD (3)  BOOT_GRACE (25s)
# ─────────────────────────────────────────────────────────────────────────────
set -u

PORT="${PORT:-5050}"
HEALTH_URL="http://localhost:${PORT}/healthz"
HEAP_MB="${HEAP_MB:-4096}"
CHECK_INTERVAL="${CHECK_INTERVAL:-10}"   # seconds between health checks
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"    # consecutive failures before restart
BOOT_GRACE="${BOOT_GRACE:-25}"           # seconds to allow a (re)boot to settle

cd "$(dirname "$0")/.." || exit 1

log() { echo "[dev-localhost $(date +%H:%M:%S)] $*"; }

free_port() {
  local pids
  pids="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)"
  if [ -n "$pids" ]; then
    log "Freeing port $PORT (killing listeners: $(echo "$pids" | tr '\n' ' '))"
    echo "$pids" | xargs kill -9 2>/dev/null
  fi
  # tsx wrapper + node child can outlive a port kill; clear them too.
  pkill -9 -f "tsx server/index.ts" 2>/dev/null
  sleep 1
}

DEV_PID=""
start_server() {
  free_port
  log "Starting dev server on :$PORT (heap ${HEAP_MB}MB)"
  local desired_port="$PORT"
  set -a
  # shellcheck disable=SC1091
  [ -f ./.env ] && . ./.env
  set +a
  export NODE_ENV=development
  # Force OUR port to win — .env may define its own PORT (e.g. 5001), but the
  # watchdog health check and the server must agree on one port. Sourcing .env
  # above clobbers PORT, so restore the port we were launched with.
  PORT="$desired_port"
  export PORT
  export NODE_OPTIONS="--max-old-space-size=${HEAP_MB} ${NODE_OPTIONS:-}"
  npm run dev &
  DEV_PID=$!
  log "Dev server launched (npm pid=$DEV_PID)"
}

stop_server() {
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null
    sleep 2
    kill -9 "$DEV_PID" 2>/dev/null
  fi
  free_port
}

trap 'log "Supervisor shutting down"; stop_server; exit 0' INT TERM

start_server
log "Waiting ${BOOT_GRACE}s for first boot to settle..."
sleep "$BOOT_GRACE"

fails=0
while true; do
  # Child process died outright → restart now, don't wait for health checks.
  if [ -n "$DEV_PID" ] && ! kill -0 "$DEV_PID" 2>/dev/null; then
    log "Dev server process exited unexpectedly. Restarting."
    start_server
    sleep "$BOOT_GRACE"
    fails=0
    continue
  fi

  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$HEALTH_URL" 2>/dev/null)"
  if [ "$code" = "200" ]; then
    [ "$fails" -ne 0 ] && log "Health recovered (200)."
    fails=0
  else
    fails=$((fails + 1))
    log "Health check failed (got '$code') [$fails/$FAIL_THRESHOLD]"
    if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
      log "Server wedged — hard restarting."
      stop_server
      start_server
      sleep "$BOOT_GRACE"
      fails=0
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
