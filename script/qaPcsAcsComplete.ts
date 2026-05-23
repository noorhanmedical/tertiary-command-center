// Master PCS/ACS QA aggregator.
import { spawnSync } from "node:child_process";

const SCRIPTS = [
  "qa:pcs-acs-portal-actions",
  "qa:pcs-acs-capabilities",
  "qa:pcs-acs-mini-calendar",
  "qa:pcs-acs-role-isolation",
  "qa:acs-capability-onboarding",
  "qa:acs-execution-readiness",
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
console.log(`\n[qa:pcs-acs-complete] ${total - failures}/${total} scripts passed`);
process.exit(failures > 0 ? 1 : 0);
