// QA for the legacy technician/liaison role isolation contract.
//
// Run with: `npm run qa:pcs-acs-role-isolation`. No DB required.
//
// Asserts:
//   - PortalShell declares the public role types
//     (PublicWorkspaceRole + WorkspaceRole including
//      patientCareSpecialist and ancillaryCareSpecialist).
//   - Legacy "technician" / "liaison" strings appear only inside
//     known compatibility locations:
//       - the WorkspaceRole / PublicWorkspaceRole declarations
//       - ClinicWorkflowPortal.INTERNAL_ROLE map (the translator)
//       - workspaceIsAncillaryCareSpecialist classifier (intentional)
//       - icon/title fallback in PortalShell:1180 area
//       - PortalWorkflowPanel internal Role alias
//     Documented in pcs-acs-legacy-role-leak-audit.md.
//   - PortalShell no longer treats undefined workspaceRole as ACS.
//   - Capability resolver remains the gate (PortalShell imports +
//     calls resolvePortalCapabilities).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let passes = 0;
let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

function readFile(path: string): string {
  try {
    return readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    return "";
  }
}

function main() {
  console.log("\n--- public role types are declared ---");
  const portalShell = readFile("client/src/components/portal/PortalShell.tsx");
  assert(
    /type PublicWorkspaceRole\b/.test(portalShell),
    "PortalShell declares PublicWorkspaceRole",
  );
  assert(
    /"patientCareSpecialist"/.test(portalShell),
    "PortalShell references patientCareSpecialist",
  );
  assert(
    /"ancillaryCareSpecialist"/.test(portalShell),
    "PortalShell references ancillaryCareSpecialist",
  );

  console.log("\n--- legacy technician/liaison only in compatibility locations ---");
  const portalShellLines = portalShell.split("\n");
  // Lines that mention "technician" or "liaison" — we'll classify
  // each occurrence as either a known compatibility location or a
  // suspect new leak.
  type Mention = { lineNo: number; line: string };
  const mentions: Mention[] = [];
  portalShellLines.forEach((line, idx) => {
    if (/\btechnician\b/i.test(line) || /\bliaison\b/i.test(line)) {
      mentions.push({ lineNo: idx + 1, line });
    }
  });

  const allowedMentionMatchers: RegExp[] = [
    // Compatibility / documentation comments (line + JSX block).
    /^\s*\/\//,
    /^\s*\*/,
    /^\s*\{\/\*/,
    /\/\*/,
    /\*\/\}\s*$/,
    // Type alias declarations.
    /type\s+(WorkspaceRole|Role|PublicWorkspaceRole)\b/,
    // String members of the WorkspaceRole / Role unions.
    /^\s*\|\s*"(technician|liaison|patientCareSpecialist|ancillaryCareSpecialist)"/,
    /"(technician|liaison|patientCareSpecialist|ancillaryCareSpecialist)"\s*\|/,
    // The classifier that intentionally translates legacy mounts to ACS.
    /workspaceRole\s*===\s*"(technician|liaison|ancillaryCareSpecialist)"/,
    // Icon/title fallbacks (documented compatibility surface).
    /role\s*===\s*"technician"/,
    /role\s*===\s*"liaison"/,
    /"Technician Portal"/,
    /"Liaison Technician Portal"/,
    /Technician Portal/, // catches the comment in subtitle line
    // String inputs to telemetry / display labels we accept as
    // back-compat.
    /workspaceRole\s*\?\?\s*role/,
  ];

  for (const m of mentions) {
    const isAllowed = allowedMentionMatchers.some((re) => re.test(m.line));
    assert(
      isAllowed,
      `PortalShell line ${m.lineNo} legacy role mention is in a documented compatibility location`,
    );
  }

  console.log("\n--- ClinicWorkflowPortal INTERNAL_ROLE translator present ---");
  const portal = readFile("client/src/components/workflow/ClinicWorkflowPortal.tsx");
  assert(
    /INTERNAL_ROLE/.test(portal),
    "ClinicWorkflowPortal still exposes INTERNAL_ROLE translator",
  );
  assert(
    /ancillaryCareSpecialist:\s*"technician"/.test(portal),
    "INTERNAL_ROLE maps ancillaryCareSpecialist → technician",
  );
  assert(
    /patientCareSpecialist:\s*"liaison"/.test(portal),
    "INTERNAL_ROLE maps patientCareSpecialist → liaison",
  );

  console.log("\n--- default safety: undefined role is not ACS ---");
  assert(
    !portalShell.includes("workspaceRole === undefined"),
    "PortalShell does not treat undefined workspaceRole as ACS",
  );

  console.log("\n--- capability resolver is the gate ---");
  assert(
    portalShell.includes("import { resolvePortalCapabilities }"),
    "PortalShell imports resolvePortalCapabilities",
  );
  assert(
    /resolvePortalCapabilities\(/.test(portalShell),
    "PortalShell calls resolvePortalCapabilities(...)",
  );
  assert(
    /portalCapabilities\.canMarkProcedureCompleted/.test(portalShell),
    "PortalShell reads canMarkProcedureCompleted from resolver",
  );

  console.log("\n--- legacy role leak audit doc exists ---");
  const auditDoc = readFile("docs/architecture/pcs-acs-legacy-role-leak-audit.md");
  assert(
    auditDoc.length > 0,
    "pcs-acs-legacy-role-leak-audit.md exists",
  );
  assert(
    /INTERNAL_ROLE/.test(auditDoc),
    "audit doc references INTERNAL_ROLE",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();
