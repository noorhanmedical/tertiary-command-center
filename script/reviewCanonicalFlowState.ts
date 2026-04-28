// Read-only review of canonical-flow state for the three synthetic test
// patients. Run with `npm run review:canonical-flow-state`. Requires
// DATABASE_URL.
//
// What it does:
//   - For each test patient, lists every canonical-spine row (screenings,
//     execution cases, journey events, schedule events, insurance/cooldown,
//     procedure events, document readiness, procedure notes, billing
//     readiness/document-request/completed-package, linked invoice line
//     item + invoice totals, projected invoice rows).
//   - Runs consistency checks and emits PASS/WARN/FAIL lines per patient.
//
// What it does NOT do:
//   - Mutate any rows. This is a read-only diagnostic.
//   - Touch non-test patients (every query is scoped by patient name).

import { eq, and, desc, inArray } from "drizzle-orm";

const TEST_PATIENTS = [
  { name: "TestGuy Robot",        dob: "01/01/1950" },
  { name: "TestVisit Patient",    dob: "02/02/1950" },
  { name: "TestOutreach Patient", dob: "03/03/1950" },
] as const;

type Tally = { pass: number; warn: number; fail: number };

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  if (typeof d === "string") return d;
  try {
    return d.toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return String(d);
  }
}

function divider(label: string) {
  console.log("");
  console.log("═".repeat(72));
  console.log(`  ${label}`);
  console.log("═".repeat(72));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[review:canonical-flow-state] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import("@shared/schema/executionCase");
  const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
  const { insuranceEligibilityReviews } = await import("@shared/schema/insuranceEligibility");
  const { cooldownRecords } = await import("@shared/schema/cooldown");
  const { procedureEvents } = await import("@shared/schema/procedureEvents");
  const { caseDocumentReadiness } = await import("@shared/schema/documentReadiness");
  const { procedureNotes } = await import("@shared/schema/generatedNotes");
  const { billingReadinessChecks } = await import("@shared/schema/billingReadiness");
  const { billingDocumentRequests } = await import("@shared/schema/billingDocuments");
  const { completedBillingPackages } = await import("@shared/schema/completedBillingPackages");
  const { projectedInvoiceRows } = await import("@shared/schema/projectedInvoices");
  const { invoices, invoiceLineItems } = await import("@shared/schema/invoices");

  const tally: Tally = { pass: 0, warn: 0, fail: 0 };

  function pass(line: string) { tally.pass++; console.log(`  ✓ PASS  ${line}`); }
  function warn(line: string) { tally.warn++; console.log(`  ⚠ WARN  ${line}`); }
  function fail(line: string) { tally.fail++; console.log(`  ✗ FAIL  ${line}`); }
  function info(line: string) { console.log(`  · INFO  ${line}`); }

  let exitCode = 0;
  try {
    for (const patient of TEST_PATIENTS) {
      divider(`${patient.name}  (DOB ${patient.dob})`);

      // ── 1) patient_screenings ─────────────────────────────────────────
      const screenings = await db
        .select()
        .from(patientScreenings)
        .where(eq(patientScreenings.name, patient.name))
        .orderBy(desc(patientScreenings.id));

      console.log(`\n  patient_screenings (${screenings.length})`);
      for (const s of screenings) {
        console.log(
          `    id=${s.id} batch=${s.batchId} dob=${s.dob} facility=${s.facility} ` +
          `insurance=${s.insurance} commitStatus=${s.commitStatus} isTest=${s.isTest}`,
        );
      }
      const screeningIds = screenings.map((s) => s.id);

      // ── 2) patient_execution_cases ────────────────────────────────────
      const allCasesByName = await db
        .select()
        .from(patientExecutionCases)
        .where(eq(patientExecutionCases.patientName, patient.name))
        .orderBy(desc(patientExecutionCases.id));

      console.log(`\n  patient_execution_cases (${allCasesByName.length})`);
      for (const c of allCasesByName) {
        console.log(
          `    id=${c.id} screeningId=${c.patientScreeningId ?? "(null)"} bucket=${c.engagementBucket} ` +
          `lifecycle=${c.lifecycleStatus} engagement=${c.engagementStatus} qualification=${c.qualificationStatus}`,
        );
      }

      const linkedCases = allCasesByName.filter((c) => c.patientScreeningId != null);
      const orphanCases = allCasesByName.filter((c) => c.patientScreeningId == null);
      const caseIds = allCasesByName.map((c) => c.id);

      // ── 3) patient_journey_events ─────────────────────────────────────
      const journeyEvents = screeningIds.length > 0
        ? await db
            .select()
            .from(patientJourneyEvents)
            .where(inArray(patientJourneyEvents.patientScreeningId, screeningIds))
            .orderBy(desc(patientJourneyEvents.createdAt))
        : [];
      console.log(`\n  patient_journey_events (${journeyEvents.length} total, latest 3 shown)`);
      for (const e of journeyEvents.slice(0, 3)) {
        console.log(`    [${fmtDate(e.createdAt)}] ${e.eventType} (source=${e.eventSource}) — ${e.summary}`);
      }

      // ── 4) global_schedule_events ─────────────────────────────────────
      const scheduleEvents = screeningIds.length > 0
        ? await db
            .select()
            .from(globalScheduleEvents)
            .where(inArray(globalScheduleEvents.patientScreeningId, screeningIds))
            .orderBy(desc(globalScheduleEvents.startsAt))
        : [];
      console.log(`\n  global_schedule_events (${scheduleEvents.length})`);
      for (const e of scheduleEvents) {
        console.log(
          `    id=${e.id} type=${e.eventType} service=${e.serviceType ?? "—"} ` +
          `startsAt=${fmtDate(e.startsAt)} status=${e.status}`,
        );
      }

      // ── 5) insurance_eligibility_reviews ──────────────────────────────
      const insuranceRows = screeningIds.length > 0
        ? await db
            .select()
            .from(insuranceEligibilityReviews)
            .where(inArray(insuranceEligibilityReviews.patientScreeningId, screeningIds))
            .orderBy(desc(insuranceEligibilityReviews.id))
        : [];
      console.log(`\n  insurance_eligibility_reviews (${insuranceRows.length})`);
      for (const r of insuranceRows) {
        console.log(
          `    id=${r.id} eligibility=${r.eligibilityStatus} approval=${r.approvalStatus} ` +
          `priorityClass=${r.priorityClass}`,
        );
      }

      // ── 6) cooldown_records ───────────────────────────────────────────
      const cooldownRows = screeningIds.length > 0
        ? await db
            .select()
            .from(cooldownRecords)
            .where(inArray(cooldownRecords.patientScreeningId, screeningIds))
            .orderBy(desc(cooldownRecords.id))
        : [];
      console.log(`\n  cooldown_records (${cooldownRows.length})`);
      for (const r of cooldownRows) {
        console.log(
          `    id=${r.id} service=${r.serviceType} status=${r.cooldownStatus} ` +
          `override=${r.overrideStatus}`,
        );
      }

      // ── 7) procedure_events ───────────────────────────────────────────
      const procEvents = screeningIds.length > 0
        ? await db
            .select()
            .from(procedureEvents)
            .where(inArray(procedureEvents.patientScreeningId, screeningIds))
            .orderBy(desc(procedureEvents.id))
        : [];
      console.log(`\n  procedure_events (${procEvents.length})`);
      for (const r of procEvents) {
        console.log(
          `    id=${r.id} service=${r.serviceType} status=${r.procedureStatus} ` +
          `completedAt=${fmtDate(r.completedAt)}`,
        );
      }

      // ── 8) case_document_readiness (grouped by service) ───────────────
      const docRows = screeningIds.length > 0
        ? await db
            .select()
            .from(caseDocumentReadiness)
            .where(inArray(caseDocumentReadiness.patientScreeningId, screeningIds))
            .orderBy(caseDocumentReadiness.serviceType, caseDocumentReadiness.documentType)
        : [];
      console.log(`\n  case_document_readiness (${docRows.length}, grouped by service)`);
      const docByService = new Map<string, typeof docRows>();
      for (const r of docRows) {
        const key = r.serviceType;
        if (!docByService.has(key)) docByService.set(key, []);
        docByService.get(key)!.push(r);
      }
      for (const [service, rows] of docByService) {
        console.log(`    [${service}]`);
        for (const r of rows) {
          console.log(
            `      ${r.documentType.padEnd(22)} status=${r.documentStatus.padEnd(11)} blocksBilling=${r.blocksBilling}`,
          );
        }
      }

      // ── 9) procedure_notes ────────────────────────────────────────────
      const noteRows = screeningIds.length > 0
        ? await db
            .select()
            .from(procedureNotes)
            .where(inArray(procedureNotes.patientScreeningId, screeningIds))
            .orderBy(desc(procedureNotes.id))
        : [];
      console.log(`\n  procedure_notes (${noteRows.length})`);
      for (const r of noteRows) {
        console.log(
          `    id=${r.id} service=${r.serviceType} type=${r.noteType} status=${r.generationStatus} ` +
          `byAi=${r.generatedByAi}`,
        );
      }

      // ── 10) billing_readiness_checks ──────────────────────────────────
      const readinessRows = screeningIds.length > 0
        ? await db
            .select()
            .from(billingReadinessChecks)
            .where(inArray(billingReadinessChecks.patientScreeningId, screeningIds))
            .orderBy(desc(billingReadinessChecks.id))
        : [];
      console.log(`\n  billing_readiness_checks (${readinessRows.length})`);
      for (const r of readinessRows) {
        const missing = Array.isArray(r.missingRequirements) ? r.missingRequirements as string[] : [];
        console.log(
          `    id=${r.id} service=${r.serviceType} status=${r.readinessStatus} ` +
          `readyAt=${fmtDate(r.readyAt)} missing=${missing.length === 0 ? "—" : missing.join(",")}`,
        );
      }

      // ── 11) billing_document_requests ─────────────────────────────────
      const docReqRows = screeningIds.length > 0
        ? await db
            .select()
            .from(billingDocumentRequests)
            .where(inArray(billingDocumentRequests.patientScreeningId, screeningIds))
            .orderBy(desc(billingDocumentRequests.id))
        : [];
      console.log(`\n  billing_document_requests (${docReqRows.length})`);
      for (const r of docReqRows) {
        console.log(
          `    id=${r.id} service=${r.serviceType} status=${r.requestStatus} ` +
          `byAi=${r.generatedByAi} readinessCheckId=${r.billingReadinessCheckId ?? "—"}`,
        );
      }

      // ── 12) completed_billing_packages ────────────────────────────────
      const pkgRows = screeningIds.length > 0
        ? await db
            .select()
            .from(completedBillingPackages)
            .where(inArray(completedBillingPackages.patientScreeningId, screeningIds))
            .orderBy(desc(completedBillingPackages.id))
        : [];
      console.log(`\n  completed_billing_packages (${pkgRows.length})`);
      for (const r of pkgRows) {
        console.log(
          `    id=${r.id} service=${r.serviceType} package=${r.packageStatus} ` +
          `payment=${r.paymentStatus} amount=${r.fullAmountPaid ?? "—"}`,
        );
      }

      // ── 13) Linked invoice line items + invoice totals ────────────────
      const linkedLineItemIds: number[] = [];
      const linkedInvoiceIds: number[] = [];
      for (const pkg of pkgRows) {
        const meta = (pkg.metadata && typeof pkg.metadata === "object") ? pkg.metadata as Record<string, unknown> : null;
        const liId = typeof meta?.invoiceLineItemId === "number" ? meta.invoiceLineItemId as number : null;
        const invId = typeof meta?.invoiceId === "number" ? meta.invoiceId as number : null;
        if (liId != null) linkedLineItemIds.push(liId);
        if (invId != null) linkedInvoiceIds.push(invId);
      }
      const lineItemRows = linkedLineItemIds.length > 0
        ? await db.select().from(invoiceLineItems).where(inArray(invoiceLineItems.id, linkedLineItemIds))
        : [];
      const invoiceRows = linkedInvoiceIds.length > 0
        ? await db.select().from(invoices).where(inArray(invoices.id, linkedInvoiceIds))
        : [];
      console.log(`\n  linked invoice_line_items (${lineItemRows.length})`);
      for (const r of lineItemRows) {
        console.log(
          `    id=${r.id} invoiceId=${r.invoiceId} service=${r.service} ` +
          `totalCharges=${r.totalCharges ?? "—"} paid=${r.paidAmount ?? "—"} balance=${r.balanceRemaining ?? "—"}`,
        );
      }
      console.log(`  linked invoices (${invoiceRows.length})`);
      for (const r of invoiceRows) {
        console.log(
          `    id=${r.id} number=${r.invoiceNumber} status=${r.status} ` +
          `totalCharges=${r.totalCharges} totalPaid=${r.totalPaid} totalBalance=${r.totalBalance}`,
        );
      }

      // ── 14) projected_invoice_rows ────────────────────────────────────
      const projectedRows = screeningIds.length > 0
        ? await db
            .select()
            .from(projectedInvoiceRows)
            .where(inArray(projectedInvoiceRows.patientScreeningId, screeningIds))
            .orderBy(desc(projectedInvoiceRows.id))
        : [];
      console.log(`\n  projected_invoice_rows (${projectedRows.length})`);
      for (const r of projectedRows) {
        console.log(
          `    id=${r.id} service=${r.serviceType} status=${r.projectedStatus} ` +
          `projectedAmount=${r.projectedFullAmount} variance=${r.varianceAmount ?? "—"}`,
        );
      }

      // ── CHECKS ────────────────────────────────────────────────────────
      console.log(`\n  Consistency checks:`);

      // Duplicate patient_screenings
      if (screenings.length === 0) fail("no patient_screenings — has the seed run?");
      else if (screenings.length === 1) pass("exactly 1 patient_screenings row");
      else warn(`${screenings.length} patient_screenings rows (potential duplicates: ${screenings.map((s) => s.id).join(",")})`);

      // Execution cases
      if (linkedCases.length === 0) fail("no execution_case linked to any screening for this patient");
      else if (linkedCases.length === 1) pass("exactly 1 linked execution_case");
      else {
        // Multiple linked cases is OK if each links to a different screening, but check for true duplicates per screening
        const perScreening = new Map<number, number>();
        for (const c of linkedCases) {
          if (c.patientScreeningId == null) continue;
          perScreening.set(c.patientScreeningId, (perScreening.get(c.patientScreeningId) ?? 0) + 1);
        }
        const dupePerScreening = Array.from(perScreening.entries()).filter(([, count]) => count > 1);
        if (dupePerScreening.length > 0) {
          warn(`duplicate execution_cases on screening(s): ${dupePerScreening.map(([sid, n]) => `screening=${sid}×${n}`).join(", ")}`);
        } else {
          info(`${linkedCases.length} linked execution_cases across ${perScreening.size} screening(s)`);
        }
      }

      // Orphan execution cases
      if (orphanCases.length === 0) pass("no orphan execution_cases (patient_screening_id IS NULL)");
      else warn(`${orphanCases.length} orphan execution_case(s) with patient_screening_id IS NULL: ${orphanCases.map((c) => c.id).join(",")}`);

      // Duplicate document readiness rows for same patient/service/documentType
      const docKeyCount = new Map<string, number>();
      for (const r of docRows) {
        const key = `${r.patientScreeningId}::${r.serviceType}::${r.documentType}`;
        docKeyCount.set(key, (docKeyCount.get(key) ?? 0) + 1);
      }
      const dupeDocs = Array.from(docKeyCount.entries()).filter(([, n]) => n > 1);
      if (docRows.length === 0) info("no case_document_readiness rows yet");
      else if (dupeDocs.length === 0) pass("no duplicate case_document_readiness rows");
      else warn(`duplicate case_document_readiness keys: ${dupeDocs.map(([k, n]) => `${k}×${n}`).join("; ")}`);

      // Billing readiness ready_to_generate but billing_document still blocked
      const readyChecks = readinessRows.filter((r) => r.readinessStatus === "ready_to_generate");
      const billingDocRows = docRows.filter((r) => r.documentType === "billing_document");
      if (readyChecks.length > 0 && billingDocRows.some((r) => r.documentStatus === "blocked")) {
        warn(`billing readiness ready_to_generate but case_document_readiness for billing_document still 'blocked' — expected to advance once doc is generated`);
      } else if (readyChecks.length > 0) {
        pass("billing readiness ready_to_generate AND billing_document doc readiness has advanced");
      } else {
        info(`no billing readiness in ready_to_generate state (status: ${readinessRows.map((r) => r.readinessStatus).join(",") || "none"})`);
      }

      // Completed package added_to_invoice but invoice totals still 0
      const addedToInvoice = pkgRows.filter((r) => r.packageStatus === "added_to_invoice");
      if (addedToInvoice.length > 0) {
        const invoicesWithZero = invoiceRows.filter((inv) => Number(inv.totalCharges) === 0);
        if (invoicesWithZero.length > 0) {
          warn(`${addedToInvoice.length} package(s) added_to_invoice but linked invoice totals still 0 — invoice recompute likely deferred to payment events: ${invoicesWithZero.map((i) => i.id).join(",")}`);
        } else {
          pass("all added_to_invoice packages have non-zero linked invoice totals");
        }
      } else {
        info("no packages in added_to_invoice state");
      }

      // Outreach patient with procedure complete
      const isOutreach = patient.name === "TestOutreach Patient";
      if (isOutreach) {
        const completed = procEvents.filter((e) => e.procedureStatus === "complete");
        if (completed.length === 0) pass("outreach patient has no completed procedure (expected — should be scheduled only)");
        else fail(`outreach patient has ${completed.length} procedure_event(s) with status='complete' — should only be scheduled at this stage`);
      } else {
        info(`outreach-only check N/A (${patient.name} is not the outreach test patient)`);
      }
    }

    // ── Summary ──────────────────────────────────────────────────────────
    divider("Summary");
    console.log(`  PASS: ${tally.pass}   WARN: ${tally.warn}   FAIL: ${tally.fail}`);
    if (tally.fail > 0) {
      console.log("\n[review:canonical-flow-state] FAIL — at least one canonical-state check failed");
      exitCode = 1;
    } else if (tally.warn > 0) {
      console.log("\n[review:canonical-flow-state] OK with warnings");
    } else {
      console.log("\n[review:canonical-flow-state] OK — all checks passed");
    }
  } catch (err: any) {
    console.error("[review:canonical-flow-state] failed:", err);
    exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[review:canonical-flow-state] unexpected failure:", err);
  process.exit(1);
});
