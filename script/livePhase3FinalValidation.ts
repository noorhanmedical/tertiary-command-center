// Final Phase 3 validation — runs all 7 live DB probes in sequence and
// reports a summary. Honest skip on the whole batch when DATABASE_URL
// is unset.

import { spawnSync } from "node:child_process";

const PROBES = [
  "probe:phase3-exception-settings",
  "probe:phase3-exception-snapshots",
  "probe:phase3-exception-review",
  "probe:phase3-ai-recommendation-log",
  "probe:phase3-recommendation-engine",
  "probe:phase3-call-priority",
  "probe:phase3-operational-summary",
];

function run(script: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("npm", ["run", "-s", script], { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("[phase3-final-validation] SKIP — DATABASE_URL not set");
    return;
  }
  const results: { script: string; status: "PASS" | "FAIL" | "SKIP"; tail: string }[] = [];
  for (const probe of PROBES) {
    const r = run(probe);
    const tail = (r.stdout.trim().split("\n").pop() ?? "") + (r.stderr.trim() ? ` | ${r.stderr.trim().split("\n").pop()}` : "");
    if (r.code === 0 && /\[live-phase3-[^\]]+\]\s*(PASS|SKIP)/.test(tail)) {
      const status = /SKIP/.test(tail) ? "SKIP" : "PASS";
      results.push({ script: probe, status, tail });
    } else {
      results.push({ script: probe, status: "FAIL", tail });
    }
  }
  const pass = results.filter((r) => r.status === "PASS").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  for (const r of results) console.log(`  [${r.status}] ${r.script} — ${r.tail}`);
  console.log(`[phase3-final-validation] PASS=${pass} SKIP=${skip} FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error("[phase3-final-validation] ERROR", err); process.exit(1); });
