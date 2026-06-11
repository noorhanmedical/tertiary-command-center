// QA: Phase 1 AWS deployment contract (Batch H1).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-aws-deployment-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "AWS deployment contract",
  "Environments",
  "local",
  "staging",
  "production",
  "Replit's existing hosting",
  "What Phase 1 deploys to AWS",
  "dist/index.cjs",
  "DATABASE_URL",
  "What Phase 1 does NOT deploy",
  "No production cut-over",
  "Flag posture at deploy time",
  "USE_PORTAL_CALL_HISTORY_READ",
  "VITE_USE_*",
  "Secrets",
  "AWS environment / Secrets Manager",
  ".env*",
  "Out of scope for Phase 1",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// .gitignore still blocks .env*.
{
  const gi = read(".gitignore") ?? "";
  if (!/\.env/.test(gi)) failures.push(".gitignore must continue to ignore .env*");
}

// Repo must not contain a committed .env file.
{
  const offenders = [];
  for (const candidate of [".env", ".env.local", ".env.production", ".env.staging"]) {
    if (fs.existsSync(path.join(root, candidate))) offenders.push(candidate);
  }
  for (const o of offenders) failures.push(`Secret file present: ${o} must not be committed`);
}

if (failures.length > 0) {
  console.error("Phase 1 AWS deployment contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 AWS deployment contract QA passed.");
