// QA: Patient Directory activation flag safety (Part 12).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const FLAG = "server/services/patientDirectory/patientDirectoryActivationFlag.ts";
const c = read(FLAG);
if (c === null) failures.push(`Missing file: ${FLAG}`);
else for (const n of ["isPatientDirectoryActivationEnabled", "USE_PATIENT_DIRECTORY_ACTIVATION"]) {
  if (!c.includes(n)) failures.push(`${FLAG} missing "${n}"`);
}

// Route registration early-returns when flag is OFF.
const RT = read("server/routes/patientDirectory.ts") ?? "";
if (!RT.includes("if (!isPatientDirectoryActivationEnabled()) {")) {
  failures.push("route file must early-return when flag is OFF");
}

// Probe: with scrubbed env, accessor returns false.
{
  const probe = `
    process.env = {};
    (async () => {
      const m = await import("../server/services/patientDirectory/patientDirectoryActivationFlag.ts");
      if (m.isPatientDirectoryActivationEnabled() !== false) throw new Error("must default OFF");
      // Truthy values flip it ON.
      for (const v of ["1", "true", "yes"]) {
        process.env.USE_PATIENT_DIRECTORY_ACTIVATION = v;
        if (m.isPatientDirectoryActivationEnabled() !== true) throw new Error("must accept " + v);
      }
      process.env.USE_PATIENT_DIRECTORY_ACTIVATION = "0";
      if (m.isPatientDirectoryActivationEnabled() !== false) throw new Error("must reject '0'");
      console.log("OK");
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const tmp = path.join(root, "tmp_recovery", "phase-1-activation-flag-safety-probe.mjs");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, probe);
  try { execSync(`npx tsx ${tmp}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); }
  catch { failures.push("flag default probe FAILED"); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}

// Smoke runs already verify this — confirm cross-link by name.
const SM = read("scripts/smoke-patient-directory-full-activation.mjs") ?? "";
if (!SM.includes("USE_PATIENT_DIRECTORY_ACTIVATION")) failures.push("smoke must reference USE_PATIENT_DIRECTORY_ACTIVATION");

if (failures.length > 0) {
  console.error("Patient Directory activation flag safety QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory activation flag safety QA passed.");
