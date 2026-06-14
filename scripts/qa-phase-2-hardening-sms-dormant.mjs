// QA — Phase 2 hardening item 6: SMS remains dormant.
//
// Run: node scripts/qa-phase-2-hardening-sms-dormant.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const logger = fs.readFileSync(
  path.join(root, "server/services/communication/communicationLogService.ts"),
  "utf8",
);
// Logger must still expose sms_scaffold and only sms_scaffold (not sms).
if (!/"sms_scaffold"/.test(logger)) {
  failures.push("communicationLogService must continue to accept kind 'sms_scaffold'");
}
// Forbid a genuine "sms" kind without explicit hardening.
const REAL_SMS_KIND = /LogCommunicationKind\s*=\s*"email"\s*\|\s*"marketing_material"\s*\|\s*"sms_scaffold"/;
if (!REAL_SMS_KIND.test(logger)) {
  failures.push("LogCommunicationKind must remain exactly 'email' | 'marketing_material' | 'sms_scaffold' (no genuine sms kind)");
}

// No server route may call a real SMS provider.
const SERVER_DIRS = ["server/routes", "server/services"];
const FORBIDDEN_PROVIDER_CALLS = [
  "twilio.messages.create",
  "twilio.messages.send",
  "from twilio",
  "require('twilio')",
  'require("twilio")',
  "ringcentral.sms.send",
  "messaging-api",
  "sendSMS(",
];
function walk(dir, fn) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), fn);
    else if (/\.ts$/.test(entry.name)) {
      fn(path.join(dir, entry.name), fs.readFileSync(path.join(full, entry.name), "utf8"));
    }
  }
}
for (const d of SERVER_DIRS) {
  walk(d, (file, src) => {
    for (const p of FORBIDDEN_PROVIDER_CALLS) {
      if (src.includes(p)) {
        failures.push(`${file} contains forbidden SMS provider call "${p}"`);
      }
    }
  });
}

// CommunicationTimeline must wrap SMS labels honestly.
const timeline = fs.readFileSync(
  path.join(root, "client/src/components/patient/CommunicationTimeline.tsx"),
  "utf8",
);
if (!/SMS scaffold — not sent/.test(timeline)) {
  failures.push("CommunicationTimeline must label SMS rows with 'SMS scaffold — not sent'");
}
if (!/labelFor\(kind/.test(timeline)) {
  failures.push("CommunicationTimeline must use labelFor() (which guards SMS dormancy)");
}

// No portal component fakes a "SMS sent" toast/state.
const PORTAL_DIRS = ["client/src/components/portal", "client/src/components/patient"];
const FORBIDDEN_PORTAL = [
  "toast({ title: \"SMS sent\"",
  "fakeSmsSent",
  "smsDelivered: true",
];
for (const d of PORTAL_DIRS) {
  walk(d, (file, src) => {
    for (const p of FORBIDDEN_PORTAL) {
      if (src.includes(p)) {
        failures.push(`${file} contains forbidden fake SMS surface "${p}"`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error("Phase-2 hardening sms-dormant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 hardening sms-dormant QA passed.");
