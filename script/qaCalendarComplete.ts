// Master calendar QA aggregator. Runs every canonical calendar
// QA in series and aggregates pass/fail counts.
import { spawnSync } from "node:child_process";

const SCRIPTS = [
  "qa:calendar-profile-wiring",
  "qa:calendar-data-shape",
  "qa:calendar-profile-overrides",
  "qa:pcs-acs-mini-calendar",
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
console.log(`\n[qa:calendar-complete] ${total - failures}/${total} scripts passed`);
process.exit(failures > 0 ? 1 : 0);
