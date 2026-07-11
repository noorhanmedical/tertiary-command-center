// QA — Phase 3 must not introduce autonomous AI actions.
//
// Run: node scripts/qa-phase-3-no-autonomous-ai-actions.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

// AI service / route directories
const SCAN_DIRS = [
  "server/services/ai",
  "server/services/exceptionIntelligence",
  "server/routes",
];

// Phrases that indicate an autonomous AI action.
const FORBIDDEN_PHRASES = [
  "autoSendEmail",
  "autoSendSms",
  "autoSchedulePatient",
  "autoApproveInvoice",
  "autoMarkBillingReady",
  "autoMarkConsentSigned",
  "autoChangePatientState",
  "autoExecuteAction",
  "autoApplyTransition",
];

// Routes under /api/ai/* must not call canonical Phase 1/2/4
// writer paths. We grep for invocations of those routes inside
// /api/ai/* files specifically.
const AI_ROUTE_FILES = [
  "server/routes/aiRecommendations.ts",
  "server/routes/nextBestAction.ts",
];
const CANONICAL_WRITER_PATHS = [
  "/api/portal/sign-consent",
  "/api/portal/uploads",
  "/api/global-schedule-events/schedule-ancillary",
  "/api/global-schedule-events/:id/transition",
  "/api/engagement-center/call-results",
  "/api/engagement-center/call-result",
  "/api/invoices/:id/approve",
  "/api/invoices/:id/send-email",
  "/api/invoices/:id/payments",
  "/api/invoice-batches/:id/create-drafts",
  "/api/case-document-readiness/complete",
];

function walk(dir, fn) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), fn);
    else if (/\.ts$/.test(entry.name)) fn(path.join(dir, entry.name), fs.readFileSync(path.join(full, entry.name), "utf8"));
  }
}

for (const d of SCAN_DIRS) {
  walk(d, (file, src) => {
    for (const p of FORBIDDEN_PHRASES) {
      if (src.includes(p)) failures.push(`${file} contains forbidden autonomous-action phrase "${p}"`);
    }
  });
}

for (const f of AI_ROUTE_FILES) {
  if (!fs.existsSync(path.join(root, f))) continue;
  const src = fs.readFileSync(path.join(root, f), "utf8");
  for (const writer of CANONICAL_WRITER_PATHS) {
    if (src.includes(writer)) {
      failures.push(`${f} must not invoke canonical writer path "${writer}" — AI is proposed-only`);
    }
  }
}

if (failures.length > 0) {
  console.error("Phase-3 no-autonomous-AI-actions QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-3 no-autonomous-AI-actions QA passed.");
