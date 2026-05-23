// Master Tertiary Command Center QA aggregator.
//
// Runs every canonical QA covering calendar + PCS/ACS + scheduling
// triage + procedure/readiness + billing/invoice + audit + outbox.
// Fails the run if any individual script returns non-zero.
import { spawnSync } from "node:child_process";

const SCRIPTS = [
  // Calendar
  "qa:calendar-profile-wiring",
  "qa:calendar-data-shape",
  "qa:calendar-profile-overrides",
  // PCS/ACS
  "qa:pcs-acs-portal-actions",
  "qa:pcs-acs-capabilities",
  "qa:pcs-acs-mini-calendar",
  "qa:pcs-acs-role-isolation",
  "qa:acs-capability-onboarding",
  "qa:acs-execution-readiness",
  // Scheduling / triage
  "qa:scheduling-triage",
  // Procedure / readiness / admin approval (existing)
  "qa:procedure-readiness-spine",
  "qa:admin-approval-engagement-gate",
  // Billing / invoice
  "qa:projected-invoice-reconciliation",
  // Audit / outbox
  "qa:audit-coverage",
  "qa:outbox-coverage",
];

let total = 0;
let failures = 0;
for (const name of SCRIPTS) {
  console.log(`\n>>> ${name}`);
  const r = spawnSync("npm", ["run", "--silent", name], {
    stdio: "inherit",
    encoding: "utf8",
  });
  total += 1;
  if (r.status !== 0) failures += 1;
}
console.log(`\n[qa:tertiary-command-center] ${total - failures}/${total} scripts passed`);
process.exit(failures > 0 ? 1 : 0);
