import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function collectTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectTestFiles(full));
    else if (name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const files = collectTestFiles("tests");
if (files.length === 0) {
  console.error("No test files found under tests/");
  process.exit(1);
}

const result = spawnSync("npx", ["tsx", "--test", ...files], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
