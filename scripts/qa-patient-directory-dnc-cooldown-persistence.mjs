// QA: DNC + cooldown persistence activation (Batch I).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const WRITER = read("server/services/patientDirectory/patientDirectoryWriter.ts") ?? "";
for (const n of [
  "setDoNotContact",
  "clearDoNotContact",
  "setCooldown",
  "clearCooldown",
  "do_not_contact",
  "do_not_contact_set_at",
  "do_not_contact_reason",
  "do_not_contact_set_by_user_id",
  "cooldown_records",
  '"dnc_set"',
  '"dnc_cleared"',
  '"cooldown_set"',
  '"cooldown_cleared"',
]) if (!WRITER.includes(n)) failures.push(`writer missing "${n}"`);

const RT = read("server/routes/patientDirectory.ts") ?? "";
for (const n of [
  '"/api/patient-directory/:patientId/contact-restrictions"',
  '"/api/patient-directory/:patientId/cooldown"',
]) if (!RT.includes(n)) failures.push(`routes missing "${n}"`);

const SHARED = read("shared/contactRestrictions.ts") ?? "";
for (const n of [
  "COOLDOWN_PRESET_LABEL",
  "gateOutreach",
  "isCooldownActive",
  '"dnc"',
  '"active_cooldown"',
]) if (!SHARED.includes(n)) failures.push(`shared helper missing "${n}"`);

if (failures.length > 0) {
  console.error("DNC + cooldown persistence QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("DNC + cooldown persistence QA passed.");
