// QA — Email Composer is honest about its backend state.
//
//   - The backend (emailService.ts) requires SMTP_HOST / SMTP_PORT /
//     SMTP_USER / SMTP_PASS / SMTP_FROM. Without them it throws
//     "Email is not configured. Set SMTP_HOST ...".
//   - The route returns the error message in the JSON body with a
//     5xx status — the composer must surface that error literally
//     (no fake "sent" state).
//   - There is NO local mock send path; the composer always calls
//     the canonical /api/outreach/send-email or /api/outreach/send-
//     material endpoints.
//
// Run: node scripts/qa-team-portal-email-honest-send-state.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) if (src.includes(n)) failures.push(`${label}: forbidden "${n}" in ${rel}`);
}

// 1) Backend explicitly errors when SMTP is unset.
requireText("server/services/emailService.ts", [
  "Email is not configured",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
]);

// 2) Composer always uses the canonical send routes via the helpers.
requireText("client/src/components/portal/PortalEmailComposerTab.tsx", [
  "sendOutreachEmail",
  "sendMarketingMaterial",
  // Surfaces the literal error.
  'data-testid="portal-email-composer-error"',
  "Requires SMTP activation",
]);

// 3) NO mock / dummy success path inside the composer.
requireNotText(
  "client/src/components/portal/PortalEmailComposerTab.tsx",
  [
    "fakeSend",
    "mockSend",
    "fakeMessageId",
    "Math.random",
    "setTimeout(() => onSuccess",
  ],
  "Composer must not fake a sent state",
);

// 4) Helper points at the canonical route.
requireText("client/src/lib/portal/commandCenterApi.ts", [
  "sendOutreachEmail",
  "/api/outreach/send-email",
]);

if (failures.length > 0) {
  console.error("Email composer honest send-state QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Email composer honest send-state QA passed.");
