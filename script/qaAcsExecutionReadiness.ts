// QA for ACS execution → procedure-complete → readiness linkage.
// Run with: `npm run qa:acs-execution-readiness`. No DB required.

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

function main() {
  console.log("\n--- canonical markProcedureComplete side-effect chain ---");
  const repo = readFile("server/repositories/procedureEvents.repo.ts");
  assert(
    /upsertCaseDocumentReadinessForProcedureComplete\(/.test(repo),
    "markProcedureComplete upserts case_document_readiness rows",
  );
  assert(
    /createPendingProcedureNotes\(/.test(repo),
    "markProcedureComplete fires createPendingProcedureNotes",
  );
  assert(
    /evaluateBillingReadinessForProcedure\(/.test(repo),
    "markProcedureComplete fires evaluateBillingReadinessForProcedure",
  );
  assert(
    /ensureMissingDocumentTask\(/.test(repo),
    "markProcedureComplete opens missing-doc plexus_tasks via ensureMissingDocumentTask",
  );

  console.log("\n--- API endpoint + button surface ---");
  const route = readFile("server/routes/procedureEvents.ts");
  assert(
    /\/api\/procedure-events\/complete/.test(route) && /markProcedureComplete/.test(route),
    "POST /api/procedure-events/complete is mounted (calls markProcedureComplete)",
  );
  const button = readFile("client/src/components/patient/ProcedureCompleteButton.tsx");
  assert(
    /useMutation/.test(button),
    "ProcedureCompleteButton uses TanStack useMutation (loading + error states)",
  );
  assert(
    /onError/.test(button) && /onSuccess/.test(button),
    "ProcedureCompleteButton wires onError + onSuccess",
  );
  assert(
    /Procedure Performed/.test(button),
    "button copy reflects canonical 'Procedure Performed' label",
  );

  console.log("\n--- PortalShell capability gating ---");
  const portalShell = readFile("client/src/components/portal/PortalShell.tsx");
  assert(
    /workspaceCanCompleteProcedure/.test(portalShell),
    "PortalShell exposes workspaceCanCompleteProcedure",
  );
  assert(
    /portalCapabilities\.canMarkProcedureCompleted/.test(portalShell),
    "PortalShell reads canMarkProcedureCompleted from the resolver",
  );
  assert(
    /\{workspaceCanCompleteProcedure\s*&&/.test(portalShell),
    "PortalShell gates a JSX block on {workspaceCanCompleteProcedure && ...}",
  );

  console.log("\n--- report-uploaded re-evaluation hook ---");
  const readinessRoute = readFile("server/routes/documentReadiness.ts");
  assert(
    /report-uploaded/.test(readinessRoute),
    "POST /api/case-document-readiness/report-uploaded is mounted",
  );
  assert(
    /evaluateBillingReadinessForProcedure/.test(readinessRoute),
    "report-uploaded path re-evaluates billing readiness",
  );
  assert(
    /resolveMissingDocumentTask/.test(readinessRoute),
    "report-uploaded path closes matching missing-doc task",
  );

  console.log("\n--- billing readiness recompute action ---");
  const billingReadinessRoute = readFile("server/routes/billingReadiness.ts");
  assert(
    /\/api\/billing-readiness-checks\/recompute/.test(billingReadinessRoute),
    "POST /api/billing-readiness-checks/recompute is mounted",
  );

  console.log("\n--- audit doc exists ---");
  const doc = readFile("docs/architecture/procedure-complete-canonical-path.md");
  assert(doc.length > 0, "procedure-complete-canonical-path.md exists");
  assert(/markProcedureComplete/.test(doc), "doc references markProcedureComplete");
  assert(/ensureMissingDocumentTask/.test(doc), "doc references ensureMissingDocumentTask");

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();
