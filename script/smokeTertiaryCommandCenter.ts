// Master Tertiary Command Center smoke aggregator.
//
// Source-level smoke (`smoke:pcs-acs-portal`) runs without a
// server; live smokes (`smoke:tertiary-spine`,
// `smoke:pcs-acs-portal-live`, `smoke:billing-invoice-spine`)
// require BASE_URL to be set. The aggregator runs only the
// source-level smoke unconditionally, and runs live smokes
// when BASE_URL is present.
import { spawnSync } from "node:child_process";

const SOURCE_LEVEL = ["smoke:pcs-acs-portal"];
const LIVE = [
  "smoke:tertiary-spine",
  "smoke:pcs-acs-portal-live",
  "smoke:billing-invoice-spine",
];

const baseUrl = process.env.BASE_URL ?? process.env.SMOKE_BASE_URL ?? "";
const SCRIPTS = baseUrl ? [...SOURCE_LEVEL, ...LIVE] : SOURCE_LEVEL;

let total = 0;
let failures = 0;
for (const name of SCRIPTS) {
  console.log(`\n>>> ${name}`);
  const r = spawnSync("npm", ["run", "--silent", name], {
    stdio: "inherit",
    encoding: "utf8",
    env: baseUrl ? { ...process.env, BASE_URL: baseUrl } : process.env,
  });
  total += 1;
  if (r.status !== 0) failures += 1;
}
if (!baseUrl) {
  console.log(
    "\n[smoke:tertiary-command-center] BASE_URL not set — ran source-level smoke only.",
  );
  console.log(
    "  Set BASE_URL=http://localhost:5000 to exercise the live smoke suite too.",
  );
}
console.log(`\n[smoke:tertiary-command-center] ${total - failures}/${total} scripts passed`);
process.exit(failures > 0 ? 1 : 0);
