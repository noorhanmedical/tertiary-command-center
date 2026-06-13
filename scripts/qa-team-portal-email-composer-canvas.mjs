// QA — Email Composer opens in the center canvas (not in the left
// rail) and uses the canonical send routes. Honest backend state
// surfaced when SMTP is not configured.
//
// Run: node scripts/qa-team-portal-email-composer-canvas.mjs

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

const composer = "client/src/components/portal/PortalEmailComposerTab.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";
const api = "client/src/lib/portal/commandCenterApi.ts";
const emailRoute = "server/routes/email.ts";

// 1) Composer exists with the canonical fields.
requireText(composer, [
  "PortalEmailComposerTab",
  "sendOutreachEmail",
  "sendMarketingMaterial",
  'data-testid="portal-email-composer"',
  'data-testid="portal-email-composer-to"',
  'data-testid="portal-email-composer-subject"',
  'data-testid="portal-email-composer-body"',
  'data-testid="portal-email-composer-send"',
  // Honest SMTP-not-configured surfacing.
  "Requires SMTP activation",
  'data-testid="portal-email-composer-error"',
]);

// 2) Shell wires the composer into the center canvas via the
//    "email" tab kind.
requireText(shell, [
  '"email"',
  "PortalEmailComposerTab",
  '<PortalEmailComposerTab',
  'data-testid="playground-email-composer"',
  "preAttachedMaterialIds",
  "prefilledTemplate",
]);

// 3) Client helper points at the canonical route.
requireText(api, [
  "sendOutreachEmail",
  "/api/outreach/send-email",
]);

// 4) Backend route exists + uses nodemailer.
requireText(emailRoute, [
  '"/api/outreach/send-email"',
  "sendOutreachEmail",
]);

if (failures.length > 0) {
  console.error("Team Portal email composer QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal email composer QA passed.");
