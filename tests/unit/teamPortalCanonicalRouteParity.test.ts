// Team Portal canonical route parity — static regression test.
//
// Locks the non-negotiable rule for the live ACS + PCS routes:
// they MUST mount ClinicWorkflowPortal (which renders the real
// TeamPortalShell). They must NEVER mount TeamMemberPortalPlayground,
// which is a static, unwired mockup / design reference.
//
// This test also verifies the workflow-portal wrapper still adapts
// both roles to TeamPortalShell so a future refactor cannot silently
// mount PortalShell (the legacy technician/liaison shell) for a
// patient- or ancillary-care-specialist route.
//
// Runnable via:
//   npx tsx tests/unit/teamPortalCanonicalRouteParity.test.ts
// Exit 0 = pass; exit 1 = fail.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const failures: string[] = [];

function readOr(fail: string, rel: string): string | null {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`Missing file: ${rel} (${fail})`);
    return null;
  }
  return fs.readFileSync(abs, "utf8");
}

// ─── §1: PCS page must mount ClinicWorkflowPortal ─────────────────
{
  const pcs = readOr(
    "PCS canonical route",
    "client/src/pages/patient-care-specialist-portal.tsx",
  );
  if (pcs) {
    if (!pcs.includes("ClinicWorkflowPortal")) {
      failures.push(
        "§1 patient-care-specialist-portal.tsx must import + render ClinicWorkflowPortal",
      );
    }
    if (!/<ClinicWorkflowPortal\s+role=["']patientCareSpecialist["']/i.test(pcs)) {
      failures.push(
        `§1 patient-care-specialist-portal.tsx must render <ClinicWorkflowPortal role="patientCareSpecialist" ... />`,
      );
    }
    if (
      /^\s*import[^\n]+TeamMemberPortalPlayground/m.test(pcs) ||
      /<TeamMemberPortalPlayground\b/.test(pcs)
    ) {
      failures.push(
        "§1 patient-care-specialist-portal.tsx must NOT import TeamMemberPortalPlayground (static mockup)",
      );
    }
    if (/import\s+PortalShell\b/.test(pcs) || /<PortalShell\b/.test(pcs)) {
      failures.push(
        "§1 patient-care-specialist-portal.tsx must NOT mount legacy PortalShell directly",
      );
    }
    if (/import\s+TeamPortalShell\b/.test(pcs) || /<TeamPortalShell\b/.test(pcs)) {
      failures.push(
        "§1 patient-care-specialist-portal.tsx should mount ClinicWorkflowPortal, not TeamPortalShell directly (adapter carries workspaceLabel / defaultMode)",
      );
    }
  }
}

// ─── §2: ACS page must mount ClinicWorkflowPortal ─────────────────
{
  const acs = readOr(
    "ACS canonical route",
    "client/src/pages/ancillary-care-specialist-portal.tsx",
  );
  if (acs) {
    if (!acs.includes("ClinicWorkflowPortal")) {
      failures.push(
        "§2 ancillary-care-specialist-portal.tsx must import + render ClinicWorkflowPortal",
      );
    }
    if (!/<ClinicWorkflowPortal\s+role=["']ancillaryCareSpecialist["']/i.test(acs)) {
      failures.push(
        `§2 ancillary-care-specialist-portal.tsx must render <ClinicWorkflowPortal role="ancillaryCareSpecialist" ... />`,
      );
    }
    if (
      /^\s*import[^\n]+TeamMemberPortalPlayground/m.test(acs) ||
      /<TeamMemberPortalPlayground\b/.test(acs)
    ) {
      failures.push(
        "§2 ancillary-care-specialist-portal.tsx must NOT import TeamMemberPortalPlayground (static mockup)",
      );
    }
    if (/import\s+PortalShell\b/.test(acs) || /<PortalShell\b/.test(acs)) {
      failures.push(
        "§2 ancillary-care-specialist-portal.tsx must NOT mount legacy PortalShell directly",
      );
    }
    if (/import\s+TeamPortalShell\b/.test(acs) || /<TeamPortalShell\b/.test(acs)) {
      failures.push(
        "§2 ancillary-care-specialist-portal.tsx should mount ClinicWorkflowPortal, not TeamPortalShell directly",
      );
    }
  }
}

// ─── §3: ClinicWorkflowPortal wrapper adapts to TeamPortalShell ───
{
  const wrapper = readOr(
    "ClinicWorkflowPortal wrapper",
    "client/src/components/workflow/ClinicWorkflowPortal.tsx",
  );
  if (wrapper) {
    if (!wrapper.includes("TeamPortalShell")) {
      failures.push(
        "§3 ClinicWorkflowPortal.tsx must import TeamPortalShell — it is the shell the PCS + ACS roles must render",
      );
    }
    if (!/isTeamMemberWorkspace|patientCareSpecialist[\s\S]*ancillaryCareSpecialist/i.test(wrapper)) {
      failures.push(
        "§3 ClinicWorkflowPortal.tsx must branch on the patientCareSpecialist / ancillaryCareSpecialist roles",
      );
    }
  }
}

// ─── §4: TeamPortalShell.tsx is the rich source shell, not stubbed ─
{
  const shellPath = "client/src/components/portal/TeamPortalShell.tsx";
  const abs = path.join(root, shellPath);
  if (!fs.existsSync(abs)) {
    failures.push(`§4 Missing shell: ${shellPath}`);
  } else {
    const lines = fs.readFileSync(abs, "utf8").split("\n").length;
    // The source shell is ~3,973 lines; the legacy PortalShell.tsx is
    // ~1,816. Anything under 2,500 lines almost certainly means the
    // canonical rich shell has been replaced with a stub or reverted
    // to the legacy shell.
    if (lines < 2500) {
      failures.push(
        `§4 TeamPortalShell.tsx is ${lines} lines; canonical source shell is ~3,973 lines. A shell under 2,500 lines suggests the rich shell was replaced with a stub or the legacy shell.`,
      );
    }
  }
}

// ─── §5: The two live pages must NOT mention "Playground shell" ──
// Guards against a copy-paste comment revert that reintroduces the
// playground mount decision.
{
  for (const rel of [
    "client/src/pages/patient-care-specialist-portal.tsx",
    "client/src/pages/ancillary-care-specialist-portal.tsx",
  ]) {
    const src = readOr("live portal page", rel);
    if (src && /Uses\s+the\s+Playground\s+shell/i.test(src)) {
      failures.push(
        `§5 ${rel} contains a "Uses the Playground shell" comment. That comment is only correct for the static mockup; canonical live pages mount ClinicWorkflowPortal.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("teamPortalCanonicalRouteParity.test.ts: FAILURES:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("teamPortalCanonicalRouteParity.test.ts: all tests passed");
