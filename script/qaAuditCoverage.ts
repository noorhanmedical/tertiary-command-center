// QA for critical mutation audit coverage.
// Run with: `npm run qa:audit-coverage`. No DB required.
//
// Source-level contract: every named critical mutation should have
// at least one of (a) `logAudit(...)` to audit_log, or (b)
// `appendPatientJourneyEvent(...)` to patient_journey_events. The
// audit-log-coverage.md doc names which mutations are expected at
// which layer.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let passes = 0;
let failures = 0;
function assert(c: unknown, l: string) {
  if (c) { passes++; console.log(`  ✓ ${l}`); }
  else { failures++; console.log(`  ✗ ${l}`); }
}
function readFile(p: string): string {
  try { return readFileSync(resolve(process.cwd(), p), "utf8"); } catch { return ""; }
}

type AuditCheck = {
  file: string;
  expect: Array<{ kind: "logAudit" | "journey"; pattern: RegExp; label: string }>;
};

const CHECKS: AuditCheck[] = [
  {
    file: "server/routes/adminSettings.ts",
    expect: [
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"upsert",\s*"admin_setting"/,
        label: "admin-settings upsert writes audit_log",
      },
    ],
  },
  {
    file: "server/routes/appointments.ts",
    expect: [
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"create",\s*"appointment"/,
        label: "appointment create writes audit_log",
      },
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"cancel",\s*"appointment"/,
        label: "appointment cancel writes audit_log",
      },
      {
        kind: "journey",
        pattern: /eventType:\s*"appointment_created"/,
        label: "appointment create writes appointment_created journey event",
      },
      {
        kind: "journey",
        pattern: /eventType:\s*"appointment_cancelled"/,
        label: "appointment cancel writes appointment_cancelled journey event",
      },
    ],
  },
  {
    file: "server/routes/patients.ts",
    expect: [
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"update",\s*"patient"/,
        label: "patient update writes audit_log",
      },
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"delete",\s*"patient"/,
        label: "patient delete writes audit_log",
      },
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"commit",\s*"patient"/,
        label: "patient commit writes audit_log",
      },
    ],
  },
  {
    file: "server/routes/invoices.ts",
    expect: [
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"create",\s*"invoice"/,
        label: "invoice create writes audit_log",
      },
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"send",\s*"invoice"/,
        label: "invoice send writes audit_log",
      },
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"delete",\s*"invoice"/,
        label: "invoice delete writes audit_log",
      },
    ],
  },
  {
    file: "server/routes/billing.ts",
    expect: [
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"create",\s*"billing_record"/,
        label: "billing_record create writes audit_log",
      },
      {
        kind: "logAudit",
        pattern: /logAudit\(req,\s*"update",\s*"billing_record"/,
        label: "billing_record update writes audit_log",
      },
    ],
  },
  {
    file: "server/routes/documentReadiness.ts",
    expect: [
      {
        kind: "journey",
        pattern: /eventType:\s*"document_completed"/,
        label: "case-document-readiness/complete writes journey event",
      },
      {
        kind: "journey",
        pattern: /eventType:\s*"report_uploaded"/,
        label: "case-document-readiness/report-uploaded writes journey event",
      },
    ],
  },
  {
    file: "server/routes/completedBillingPackages.ts",
    expect: [
      {
        kind: "journey",
        pattern: /eventType:\s*"billing_package_transitioned"/,
        label: "package transition writes journey event",
      },
    ],
  },
  {
    file: "server/routes/billingReadiness.ts",
    expect: [
      {
        kind: "journey",
        pattern: /eventType:\s*"billing_readiness_recomputed"/,
        label: "billing readiness recompute writes journey event",
      },
    ],
  },
];

function main() {
  console.log("\n--- per-file audit coverage ---");
  for (const c of CHECKS) {
    const src = readFile(c.file);
    if (!src) {
      assert(false, `${c.file} exists`);
      continue;
    }
    for (const e of c.expect) {
      assert(e.pattern.test(src), `${c.file}: ${e.label}`);
    }
  }

  console.log("\n--- audit coverage docs exist ---");
  const auditDoc = readFile("docs/architecture/audit-log-coverage.md");
  assert(auditDoc.length > 0, "audit-log-coverage.md exists");

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();
