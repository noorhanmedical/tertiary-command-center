// QA — SMS honesty guard.
//
// Originally (Phase 2 hardening item 6) this enforced that SMS stayed fully
// dormant. Task #648 enabled REAL patient SMS via the Twilio adapter, so the
// guard now enforces the honest-enablement invariants instead:
//
//   1. The Twilio adapter (server/integrations/twilioSms.ts) is the ONLY
//      server module that talks to the SMS provider.
//   2. The adapter is gated — it must be able to return null (not connected)
//      and the send route must surface SMS_NOT_CONNECTED instead of faking.
//   3. Outbound sends are recorded honestly: a failed provider call must be
//      persisted as status "failed" (never "sent").
//   4. communicationLogService keeps BOTH kinds: "sms_scaffold" (dormant
//      path, still labeled "not sent") and "sms" (genuine provider send).
//   5. CommunicationTimeline still labels sms_scaffold rows "not sent".
//   6. No portal component fakes an "SMS sent" toast or status.
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
// Logger must keep the dormant scaffold kind AND the genuine sms kind.
if (!/"sms_scaffold"/.test(logger)) {
  failures.push("communicationLogService must continue to accept kind 'sms_scaffold'");
}
if (!/\|\s*"sms"/.test(logger)) {
  failures.push("communicationLogService must accept the genuine kind 'sms' (Task #648)");
}

// The Twilio adapter must exist and be the only provider integration point.
const ADAPTER = "server/integrations/twilioSms.ts";
if (!fs.existsSync(path.join(root, ADAPTER))) {
  failures.push(`${ADAPTER} must exist — it is the single SMS provider integration point`);
} else {
  const adapter = fs.readFileSync(path.join(root, ADAPTER), "utf8");
  if (!/return null/.test(adapter)) {
    failures.push("twilioSms adapter must be gated (able to return null when not connected)");
  }
  if (!/api\.twilio\.com/.test(adapter)) {
    failures.push("twilioSms adapter must call the real Twilio REST API (no fake sends)");
  }
}

// No OTHER server module may talk to the provider directly.
const SERVER_DIRS = ["server/routes", "server/services"];
const FORBIDDEN_PROVIDER_CALLS = [
  "api.twilio.com",
  "twilio.messages.create",
  "twilio.messages.send",
  "from 'twilio'",
  'from "twilio"',
  "require('twilio')",
  'require("twilio")',
  "ringcentral.sms.send",
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
        failures.push(
          `${file} contains direct SMS provider call "${p}" — only server/integrations/twilioSms.ts may talk to the provider`,
        );
      }
    }
  });
}

// The send route must be honest when SMS isn't connected and must record
// provider failures as failed (never as sent).
const smsRoute = fs.readFileSync(path.join(root, "server/routes/patientMessages.ts"), "utf8");
if (!/SMS_NOT_CONNECTED/.test(smsRoute)) {
  failures.push("patientMessages route must return SMS_NOT_CONNECTED when Twilio isn't configured");
}
if (!/result\.ok \? "sent" : "failed"/.test(smsRoute)) {
  failures.push('patientMessages route must record status "sent" only when the provider accepted');
}

// CommunicationTimeline must still wrap the dormant scaffold label honestly.
const timeline = fs.readFileSync(
  path.join(root, "client/src/components/patient/CommunicationTimeline.tsx"),
  "utf8",
);
if (!/SMS scaffold — not sent/.test(timeline)) {
  failures.push("CommunicationTimeline must label sms_scaffold rows with 'SMS scaffold — not sent'");
}
if (!/labelFor\(kind/.test(timeline)) {
  failures.push("CommunicationTimeline must use labelFor() (which guards scaffold dormancy)");
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
// The tray's patient composer must gate on real connection status.
const tray = fs.readFileSync(
  path.join(root, "client/src/components/portal/tools/CommunicationTray.tsx"),
  "utf8",
);
if (!/patient-messages\/status/.test(tray) || !/isn'?t connected|not connected/i.test(tray)) {
  failures.push("CommunicationTray Patients tab must gate its composer on the real /status endpoint");
}

if (failures.length > 0) {
  console.error("SMS honesty QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("SMS honesty QA passed.");
