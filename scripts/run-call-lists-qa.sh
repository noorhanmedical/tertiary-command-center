#!/usr/bin/env bash
# Watchdog-safe QA: boot the dev server as a CHILD of this single script (so the
# app's ancestor-change watchdog never fires mid-run), wait for health, run the
# Call Lists Playwright spec, then tear the server down. No secrets committed —
# the admin password is read from $E2E_ADMIN_PASS in the environment.
set -a; source .env 2>/dev/null; set +a
export PORT=5177
NODE_ENV=development npx tsx server/index.ts > /tmp/plexus_calllists.log 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null' EXIT
code=""
for i in $(seq 1 45); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5177/healthz 2>/dev/null)
  [ "$code" = "200" ] && break
done
echo "healthz=$code readyz=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5177/readyz) (waited ${i}s)"
[ "$code" = "200" ] || { echo "SERVER DID NOT BOOT"; tail -15 /tmp/plexus_calllists.log; exit 1; }

PLAYWRIGHT_BASE_URL=http://localhost:5177 \
PLAYWRIGHT_TEST_ADMIN_USER=e2e_playwright_admin \
PLAYWRIGHT_TEST_ADMIN_PASS="${E2E_ADMIN_PASS}" \
npx playwright test tests/e2e/interactions/engagement-call-lists.spec.ts --project=chromium --reporter=list > /tmp/pw_calllists.log 2>&1
echo "--- playwright result ---"; grep -iE "passed|failed|error:" /tmp/pw_calllists.log | head -12
echo "=== REPORT ==="; node -e "try{console.log(JSON.stringify(require('./test-results/call-lists-repro.json'),null,2))}catch(e){console.log('no report')}"
echo "=== SCREENSHOTS ==="; ls -la test-results/call-lists-*.png 2>/dev/null
