// QA — Phase 3 must not create Mission Control.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
if (fs.existsSync(path.join(root, "client/src/pages/mission-control.tsx"))) failures.push("must not create /pages/mission-control.tsx");
if (fs.existsSync(path.join(root, "client/src/components/mission-control"))) failures.push("must not create /components/mission-control/");
const nav = fs.existsSync(path.join(root, "client/src/components/GlobalNav.tsx"))
  ? fs.readFileSync(path.join(root, "client/src/components/GlobalNav.tsx"), "utf8") : "";
if (/Mission Control/i.test(nav)) failures.push("GlobalNav must not gain 'Mission Control' label");
const app = fs.existsSync(path.join(root, "client/src/App.tsx"))
  ? fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8") : "";
if (/\/mission-control/.test(app)) failures.push("App.tsx must not register /mission-control");

if (failures.length > 0) {
  console.error("Phase-3 no-Mission-Control QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-3 no-Mission-Control QA passed.");
