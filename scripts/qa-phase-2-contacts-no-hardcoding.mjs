// QA — Phase 2 PR 2.7 Internal Contacts canonical directory: no
// hardcoded list, real /api/contacts read.
//
// Run: node scripts/qa-phase-2-contacts-no-hardcoding.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/schema/contacts.ts",
  "server/repositories/contacts.repo.ts",
  "server/routes/contacts.ts",
  "client/src/lib/contactsApi.ts",
  "client/src/components/portal/InternalContactsTool.tsx",
  "migrations/0031_add_contacts.sql",
];
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(root, f))) failures.push(`missing ${f}`);
}

const schema = fs.readFileSync(path.join(root, "shared/schema/contacts.ts"), "utf8");
const REQUIRED_CATEGORIES = ["facility", "physician", "vendor_report", "escalation", "team_member"];
for (const c of REQUIRED_CATEGORIES) {
  if (!schema.includes(`"${c}"`)) failures.push(`contacts schema missing category "${c}"`);
}

const route = fs.readFileSync(path.join(root, "server/routes/contacts.ts"), "utf8");
if (!route.includes('app.get("/api/contacts"')) failures.push("contacts route missing GET /api/contacts");
if (!route.includes("requireAdmin")) failures.push("contacts route must define requireAdmin for writes");

const tool = fs.readFileSync(path.join(root, "client/src/components/portal/InternalContactsTool.tsx"), "utf8");
if (!tool.includes("fetchContacts(")) {
  failures.push("InternalContactsTool must read via fetchContacts (no hardcoded array)");
}
// Forbid a hardcoded contacts array literal in the tool source.
// A naive [{ name: "Ali Imran" ... }] would be a fake fallback.
if (/const\s+(FAKE|HARDCODED|FALLBACK|DEFAULT)_CONTACTS\s*=/.test(tool)) {
  failures.push("InternalContactsTool must not define a hardcoded contacts fallback");
}
if (/contacts\s*=\s*\[\s*\{\s*name:/.test(tool)) {
  failures.push("InternalContactsTool must not define an inline contact array literal");
}

const shell = fs.readFileSync(path.join(root, "client/src/components/portal/TeamPortalShell.tsx"), "utf8");
if (!shell.includes("left-rail-tool-internal-contacts")) {
  failures.push("TeamPortalShell must mount the Internal Contacts left-rail button");
}
if (!shell.includes("InternalContactsTool")) {
  failures.push("TeamPortalShell must render <InternalContactsTool /> in the playground");
}

if (failures.length > 0) {
  console.error("Phase-2 contacts-no-hardcoding QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 contacts-no-hardcoding QA passed.");
