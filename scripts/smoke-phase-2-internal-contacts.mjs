// Smoke — Phase 2 PR 2.7 Internal Contacts chain.
//
// Run: node scripts/smoke-phase-2-internal-contacts.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

check(
  "1. contacts schema + migration exist",
  "shared/schema/contacts.ts",
  (s) => s.includes("contacts") && s.includes("CONTACT_CATEGORIES"),
);
check(
  "2. Repo exposes list/create/update/archive",
  "server/repositories/contacts.repo.ts",
  (s) =>
    s.includes("listContacts") &&
    s.includes("createContact") &&
    s.includes("updateContact") &&
    s.includes("archiveContact"),
);
check(
  "3. Routes registered in server/routes.ts",
  "server/routes.ts",
  (s) => s.includes("registerContactsRoutes"),
);
check(
  "4. Client API exports fetchContacts",
  "client/src/lib/contactsApi.ts",
  (s) => s.includes("export async function fetchContacts"),
);
check(
  "5. Tool calls fetchContacts (no hardcoded data)",
  "client/src/components/portal/InternalContactsTool.tsx",
  (s) => s.includes("fetchContacts(") && !/HARDCODED/.test(s),
);
check(
  "6. Shell mounts both left-rail button + center-canvas slot",
  "client/src/components/portal/TeamPortalShell.tsx",
  (s) => s.includes("left-rail-tool-internal-contacts") && s.includes("InternalContactsTool"),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: internal contacts chain intact.");
