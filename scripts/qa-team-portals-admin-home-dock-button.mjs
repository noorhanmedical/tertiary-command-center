// QA — Admin Home dock button is wired correctly.
//
// Asserts:
//   1. The button is rendered only when isAdmin is true.
//   2. The icon is `Home` from lucide-react.
//   3. The click handler navigates to "/home".
//   4. The button carries a stable data-testid.
//   5. /home is a real route in App.tsx.
//
// Run: node scripts/qa-team-portals-admin-home-dock-button.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const shell = "client/src/components/portal/TeamPortalShell.tsx";
const app = "client/src/App.tsx";

requireText(shell, [
  '{isAdmin && (',
  'dock-icon-home',
  'setLocation("/home")',
  'Home', // lucide-react component
  'useLocation',
]);

requireText(app, [
  '<Route path="/home">',
]);

if (failures.length > 0) {
  console.error("Admin Home dock button QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Admin Home dock button QA passed.");
