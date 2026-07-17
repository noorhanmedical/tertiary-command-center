// Canonical UI manifest hash regression test.
//
// Loads docs/canonical-ui-manifest.json (the baseline recorded before
// Phase 1 began) and asserts that every listed file still exists at its
// recorded git blob SHA — with the exception of the paths listed under
// `approvedExceptionPaths`.
//
// Any drift on a non-exception file fails the test. This guards the
// approved canonical UI from being altered by later wiring phases.
//
// Runnable via:
//   npx tsx tests/unit/canonicalUiManifest.test.ts
//
// Exit 0 = pass; exit 1 = fail.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, "docs/canonical-ui-manifest.json");

type ManifestFile = {
  path: string;
  blob: string;
  approvedException: boolean;
  referencedInAppTsx: boolean;
  protectedUi: boolean;
};

type Manifest = {
  generatedAtCommit: string;
  approvedExceptionPaths: string[];
  totalFiles: number;
  files: ManifestFile[];
};

const failures: string[] = [];

function currentBlob(rel: string): string | null {
  try {
    return execSync(`git ls-tree HEAD -- "${rel}"`, { cwd: ROOT }).toString().trim().split(/\s+/)[2] ?? null;
  } catch {
    return null;
  }
}

if (!fs.existsSync(MANIFEST)) {
  console.error(`canonicalUiManifest.test.ts: manifest missing at ${MANIFEST}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as Manifest;
const approved = new Set(manifest.approvedExceptionPaths);

for (const entry of manifest.files) {
  if (approved.has(entry.path)) {
    // Exceptions may drift by design.
    continue;
  }
  const now = currentBlob(entry.path);
  if (!now) {
    failures.push(`Missing file: ${entry.path} (was ${entry.blob} in manifest)`);
    continue;
  }
  if (now !== entry.blob) {
    failures.push(
      `Blob drift on protected UI file ${entry.path}: manifest ${entry.blob}, current ${now}. Add to approvedExceptionPaths + update manifest if the change is intentional.`,
    );
  }
}

// Every approved exception path in the manifest must still exist on disk
// so we don't silently lose the exception.
for (const rel of manifest.approvedExceptionPaths) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    failures.push(
      `Approved exception file was removed: ${rel}. If truly gone, remove it from docs/canonical-ui-manifest.json approvedExceptionPaths.`,
    );
  }
}

if (failures.length > 0) {
  console.error("canonicalUiManifest.test.ts: FAILURES:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(
  `canonicalUiManifest.test.ts: all ${manifest.files.length - manifest.approvedExceptionPaths.length} protected UI files match manifest hashes`,
);
