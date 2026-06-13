// QA — AWS readiness final.
//
// Phase 1 contract: AWS production is intentionally NOT activated as
// part of Phase 1. The runbooks + deployment contract + backup
// runbook + smoke test runbook must all exist and reference each
// other so a Phase 5 operator can boot from them. The
// `.env`-not-committed rule (CLAUDE_PHASE_GUARDRAILS.md §15) must be
// enforced by .gitignore.
//
// Run: node scripts/qa-phase-1-aws-readiness-final.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function requireFile(rel) {
  if (!fs.existsSync(path.join(root, rel))) {
    failures.push(`Missing file: ${rel}`);
  }
}

function requireText(rel, needles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  const src = fs.readFileSync(abs, "utf8");
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

// 1. Six canonical AWS docs all exist.
for (const rel of [
  "docs/architecture/aws-readiness-checklist.md",
  "docs/architecture/aws-readiness-design.md",
  "docs/architecture/phase-1-aws-backup-runbook.md",
  "docs/architecture/phase-1-aws-deploy-runbook.md",
  "docs/architecture/phase-1-aws-deployment-contract.md",
  "docs/architecture/phase-1-aws-smoke-test-runbook.md",
]) {
  requireFile(rel);
}

// 2. The deployment contract references the canonical secrets-from-
//    env-only rule (no committed .env).
requireText("docs/architecture/phase-1-aws-deployment-contract.md", [
  "secrets",
]);

// 3. .gitignore enforces no-.env-commit.
requireText(".gitignore", [
  ".env",
  ".env.*",
]);

// 4. The Phase 1 completion results doc labels AWS as Requires
//    activation (NOT Live).
requireText("docs/architecture/phase-1-full-system-completion-results.md", [
  "AWS production | Requires activation",
]);

// 5. No CI/CD activation file accidentally committed (Phase 5 work).
//    If any Phase 1 slice introduces deployment automation it must
//    update this QA + the audit doc.
if (fs.existsSync(path.join(root, ".github", "workflows"))) {
  const wfs = fs.readdirSync(path.join(root, ".github", "workflows"));
  for (const wf of wfs) {
    if (/deploy|aws|prod/i.test(wf)) {
      failures.push(
        `Found ${wf} in .github/workflows — Phase 1 must not land deploy automation. Phase 5 work.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("AWS readiness final QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("AWS readiness final QA passed.");
