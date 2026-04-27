// Run both canonical workflow scenarios end-to-end.
// `npm run seed:canonical-flows` → seed:visit-flow + seed:outreach-flow.
// Each sub-script is fully idempotent and runs in its own process so a
// failure in one doesn't leave the other half-seeded.

import { spawnSync } from "node:child_process";

type Step = { label: string; cmd: string; args: string[] };

const steps: Step[] = [
  { label: "Visit Patient flow",    cmd: "tsx", args: ["script/seedVisitPatientFlow.ts"] },
  { label: "Outreach Patient flow", cmd: "tsx", args: ["script/seedOutreachPatientFlow.ts"] },
];

function divider(label: string) {
  const bar = "─".repeat(Math.max(4, 60 - label.length));
  console.log(`\n──── ${label} ${bar}`);
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:canonical-flows] DATABASE_URL is not set");
    process.exit(1);
  }

  let failed = 0;
  for (const step of steps) {
    divider(step.label);
    const result = spawnSync(step.cmd, step.args, {
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0 || result.signal) {
      console.error(
        `[seed:canonical-flows] "${step.label}" exited ${result.status ?? `signal=${result.signal}`}`,
      );
      failed++;
    }
  }

  console.log("");
  if (failed === 0) {
    console.log("[seed:canonical-flows] OK — both scenarios seeded");
    process.exit(0);
  }
  console.error(`[seed:canonical-flows] FAIL — ${failed} of ${steps.length} scenario(s) failed`);
  process.exit(1);
}

main();
