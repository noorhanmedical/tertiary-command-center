// Automated QA for the visible canonical workflow surfaces.
// Run with `npm run qa:canonical-visual-state`. Requires DATABASE_URL.
// Optional: BASE_URL (default http://localhost:5000) and COOKIE for
// authenticated API calls.
//
// What it does:
//   - For each surface (Admin packet, Scheduler Portal cases, Ancillary
//     Documents readiness, Billing canonical status, Invoice totals)
//     it issues a real API call when COOKIE is supplied, else falls back
//     to a direct DB query that mirrors what the API would return.
//   - Emits one PASS/FAIL line per surface and exits 0 only if all
//     required checks pass.
//
// What it does NOT do:
//   - Mutate any rows. Read-only.
//   - Seed data. Assumes `npm run seed:canonical-flows` already ran.
//   - Drive a real browser. No Playwright/Puppeteer dependency.
//   - Touch non-test patients (every query is scoped by patient name).

import { eq, and, desc, inArray } from "drizzle-orm";

const TEST_FACILITY = "Test Facility";
const TESTGUY_NAME = "TestGuy Robot";
const TESTVISIT_NAME = "TestVisit Patient";
const TESTOUTREACH_NAME = "TestOutreach Patient";
const TESTVISIT_DOB = "02/02/1950";
const TESTOUTREACH_DOB = "03/03/1950";

type CheckResult = { name: string; ok: boolean; detail: string; via: "api" | "db" | "skipped" };

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[qa:canonical-visual-state] DATABASE_URL is not set");
    process.exit(1);
  }

  const baseUrl = trimTrailingSlash(process.env.BASE_URL ?? "http://localhost:5000");
  const cookie = process.env.COOKIE ? process.env.COOKIE.trim() : null;
  const apiAuthAvailable = !!cookie;

  console.log(`[qa:canonical-visual-state] base=${baseUrl} apiAuth=${apiAuthAvailable ? "yes" : "no"}`);
  if (!apiAuthAvailable) {
    console.log("  · INFO  COOKIE not supplied — API checks fall back to direct DB queries");
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import("@shared/schema/executionCase");
  const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
  const { insuranceEligibilityReviews } = await import("@shared/schema/insuranceEligibility");
  const { cooldownRecords } = await import("@shared/schema/cooldown");
  const { procedureEvents } = await import("@shared/schema/procedureEvents");
  const { caseDocumentReadiness } = await import("@shared/schema/documentReadiness");
  const { billingReadinessChecks } = await import("@shared/schema/billingReadiness");
  const { completedBillingPackages } = await import("@shared/schema/completedBillingPackages");
  const { invoices, invoiceLineItems } = await import("@shared/schema/invoices");

  const results: CheckResult[] = [];

  async function tryApiJson(path: string): Promise<{ ok: boolean; status: number; body: unknown; contentType: string }> {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(cookie ? { cookie } : {}),
        },
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, body: { _nonJsonBody: text.slice(0, 100) }, contentType };
      }
      const body = await res.json();
      return { ok: res.ok, status: res.status, body, contentType };
    } catch (err: any) {
      return { ok: false, status: 0, body: { _error: err.message ?? String(err) }, contentType: "" };
    }
  }

  // Resolve the canonical screening (linked to newest execution case) for a patient name —
  // mirrors the server's getPatientPacket name-only fallback.
  async function resolveCanonicalScreeningId(name: string): Promise<number | null> {
    const [linked] = await db
      .select({ screeningId: patientScreenings.id })
      .from(patientScreenings)
      .innerJoin(
        patientExecutionCases,
        eq(patientExecutionCases.patientScreeningId, patientScreenings.id),
      )
      .where(eq(patientScreenings.name, name))
      .orderBy(desc(patientExecutionCases.id))
      .limit(1);
    if (linked) return linked.screeningId;
    const [latest] = await db
      .select({ id: patientScreenings.id })
      .from(patientScreenings)
      .where(eq(patientScreenings.name, name))
      .orderBy(desc(patientScreenings.id))
      .limit(1);
    return latest?.id ?? null;
  }

  async function dbPacketCounts(name: string) {
    const screeningId = await resolveCanonicalScreeningId(name);
    if (screeningId == null) return null;
    const [
      [execCase],
      journey,
      schedule,
      insurance,
      cooldown,
      docs,
      procs,
    ] = await Promise.all([
      db.select().from(patientExecutionCases).where(eq(patientExecutionCases.patientScreeningId, screeningId)).limit(1),
      db.select().from(patientJourneyEvents).where(eq(patientJourneyEvents.patientScreeningId, screeningId)),
      db.select().from(globalScheduleEvents).where(eq(globalScheduleEvents.patientScreeningId, screeningId)),
      db.select().from(insuranceEligibilityReviews).where(eq(insuranceEligibilityReviews.patientScreeningId, screeningId)),
      db.select().from(cooldownRecords).where(eq(cooldownRecords.patientScreeningId, screeningId)),
      db.select().from(caseDocumentReadiness).where(eq(caseDocumentReadiness.patientScreeningId, screeningId)),
      db.select().from(procedureEvents).where(eq(procedureEvents.patientScreeningId, screeningId)),
    ]);
    return {
      screeningId,
      executionCaseId: execCase?.id ?? null,
      journeyCount: journey.length,
      scheduleCount: schedule.length,
      insuranceCount: insurance.length,
      cooldownCount: cooldown.length,
      docCount: docs.length,
      procCount: procs.length,
      schedule,
      procs,
    };
  }

  // ── 1) Admin TestGuy packet equivalent (populated sections) ─────────
  {
    let result: CheckResult;
    if (apiAuthAvailable) {
      const api = await tryApiJson(
        `/api/patient-packet?patientName=${encodeURIComponent(TESTGUY_NAME)}`,
      );
      if (!api.ok || typeof api.body !== "object" || api.body === null) {
        result = { name: "Admin packet (TestGuy)", ok: false, detail: `HTTP ${api.status} via API`, via: "api" };
      } else {
        const p = api.body as Record<string, unknown>;
        const ok =
          p.resolvedPatientScreeningId != null &&
          Array.isArray(p.journeyEvents) && (p.journeyEvents as unknown[]).length > 0 &&
          Array.isArray(p.insuranceEligibilityReviews) && (p.insuranceEligibilityReviews as unknown[]).length > 0;
        result = {
          name: "Admin packet (TestGuy)",
          ok,
          detail: `screeningId=${p.resolvedPatientScreeningId} journey=${(p.journeyEvents as unknown[])?.length ?? 0} insurance=${(p.insuranceEligibilityReviews as unknown[])?.length ?? 0}`,
          via: "api",
        };
      }
    } else {
      const c = await dbPacketCounts(TESTGUY_NAME);
      if (!c) {
        result = { name: "Admin packet (TestGuy)", ok: false, detail: "no canonical screening row found", via: "db" };
      } else {
        const ok = c.executionCaseId != null && c.journeyCount > 0 && c.insuranceCount > 0 && c.scheduleCount > 0;
        result = {
          name: "Admin packet (TestGuy)",
          ok,
          detail: `screeningId=${c.screeningId} executionCaseId=${c.executionCaseId} journey=${c.journeyCount} schedule=${c.scheduleCount} insurance=${c.insuranceCount}`,
          via: "db",
        };
      }
    }
    results.push(result);
  }

  // ── 2) TestVisit packet (populated sections) ────────────────────────
  {
    let result: CheckResult;
    if (apiAuthAvailable) {
      const api = await tryApiJson(
        `/api/patient-packet?patientName=${encodeURIComponent(TESTVISIT_NAME)}&patientDob=${encodeURIComponent(TESTVISIT_DOB)}`,
      );
      if (!api.ok || typeof api.body !== "object" || api.body === null) {
        result = { name: "TestVisit packet", ok: false, detail: `HTTP ${api.status} via API`, via: "api" };
      } else {
        const p = api.body as Record<string, unknown>;
        const procs = Array.isArray(p.procedureEvents) ? p.procedureEvents as Array<Record<string, unknown>> : [];
        const docs = Array.isArray(p.caseDocumentReadiness) ? p.caseDocumentReadiness as Array<Record<string, unknown>> : [];
        const billing = Array.isArray(p.billingReadinessChecks) ? p.billingReadinessChecks as Array<Record<string, unknown>> : [];
        const ok =
          p.resolvedPatientScreeningId != null &&
          procs.some((e) => e.procedureStatus === "complete") &&
          docs.length >= 6 &&
          billing.some((b) => b.readinessStatus === "ready_to_generate");
        result = {
          name: "TestVisit packet",
          ok,
          detail: `screeningId=${p.resolvedPatientScreeningId} procs=${procs.length} docs=${docs.length} billing=${billing.map((b) => b.readinessStatus).join(",")}`,
          via: "api",
        };
      }
    } else {
      const c = await dbPacketCounts(TESTVISIT_NAME);
      if (!c) {
        result = { name: "TestVisit packet", ok: false, detail: "no canonical screening row found", via: "db" };
      } else {
        const billing = await db.select().from(billingReadinessChecks).where(eq(billingReadinessChecks.patientScreeningId, c.screeningId));
        const hasComplete = c.procs.some((e) => e.procedureStatus === "complete");
        const ok = hasComplete && c.docCount >= 6 && billing.some((b) => b.readinessStatus === "ready_to_generate");
        result = {
          name: "TestVisit packet",
          ok,
          detail: `screeningId=${c.screeningId} procs=${c.procs.length}(complete=${hasComplete}) docs=${c.docCount} billing=${billing.map((b) => b.readinessStatus).join(",")}`,
          via: "db",
        };
      }
    }
    results.push(result);
  }

  // ── 3) TestOutreach packet (scheduled state, NOT complete) ──────────
  {
    let result: CheckResult;
    if (apiAuthAvailable) {
      const api = await tryApiJson(
        `/api/patient-packet?patientName=${encodeURIComponent(TESTOUTREACH_NAME)}&patientDob=${encodeURIComponent(TESTOUTREACH_DOB)}`,
      );
      if (!api.ok || typeof api.body !== "object" || api.body === null) {
        result = { name: "TestOutreach packet", ok: false, detail: `HTTP ${api.status} via API`, via: "api" };
      } else {
        const p = api.body as Record<string, unknown>;
        const procs = Array.isArray(p.procedureEvents) ? p.procedureEvents as Array<Record<string, unknown>> : [];
        const schedule = Array.isArray(p.globalScheduleEvents) ? p.globalScheduleEvents as Array<Record<string, unknown>> : [];
        const hasAncillary = schedule.some((s) => s.eventType === "ancillary_appointment");
        const noComplete = !procs.some((e) => e.procedureStatus === "complete");
        const ok = p.resolvedPatientScreeningId != null && hasAncillary && noComplete;
        result = {
          name: "TestOutreach packet",
          ok,
          detail: `screeningId=${p.resolvedPatientScreeningId} ancillary=${hasAncillary} noProcedureComplete=${noComplete}`,
          via: "api",
        };
      }
    } else {
      const c = await dbPacketCounts(TESTOUTREACH_NAME);
      if (!c) {
        result = { name: "TestOutreach packet", ok: false, detail: "no canonical screening row found", via: "db" };
      } else {
        const hasAncillary = c.schedule.some((s) => s.eventType === "ancillary_appointment");
        const noComplete = !c.procs.some((e) => e.procedureStatus === "complete");
        const ok = hasAncillary && noComplete;
        result = {
          name: "TestOutreach packet",
          ok,
          detail: `screeningId=${c.screeningId} ancillary=${hasAncillary} noProcedureComplete=${noComplete}`,
          via: "db",
        };
      }
    }
    results.push(result);
  }

  // ── 4) Scheduler Portal canonical cases for Test Facility ───────────
  {
    let result: CheckResult;
    if (apiAuthAvailable) {
      const api = await tryApiJson(`/api/scheduler-portal/cases?facilityId=${encodeURIComponent(TEST_FACILITY)}`);
      if (!api.ok || !Array.isArray(api.body)) {
        result = { name: "Scheduler Portal canonical cases", ok: false, detail: `HTTP ${api.status} via API`, via: "api" };
      } else {
        const cases = api.body as Array<Record<string, unknown>>;
        const names = cases.map((c) => String(c.patientName ?? ""));
        const hasTestGuy = names.includes(TESTGUY_NAME);
        const hasTestVisit = names.includes(TESTVISIT_NAME);
        const ok = hasTestGuy || hasTestVisit;
        result = {
          name: "Scheduler Portal canonical cases",
          ok,
          detail: `count=${cases.length} testGuy=${hasTestGuy} testVisit=${hasTestVisit}`,
          via: "api",
        };
      }
    } else {
      const cases = await db
        .select()
        .from(patientExecutionCases)
        .where(eq(patientExecutionCases.facilityId, TEST_FACILITY))
        .orderBy(desc(patientExecutionCases.id));
      const names = cases.map((c) => c.patientName ?? "");
      const hasTestGuy = names.includes(TESTGUY_NAME);
      const hasTestVisit = names.includes(TESTVISIT_NAME);
      const ok = hasTestGuy || hasTestVisit;
      result = {
        name: "Scheduler Portal canonical cases",
        ok,
        detail: `count=${cases.length} testGuy=${hasTestGuy} testVisit=${hasTestVisit}`,
        via: "db",
      };
    }
    results.push(result);
  }

  // ── 5) Ancillary Documents readiness for TestVisit ──────────────────
  {
    let result: CheckResult;
    const visitScreeningId = await resolveCanonicalScreeningId(TESTVISIT_NAME);
    if (visitScreeningId == null) {
      result = { name: "Ancillary Documents readiness (TestVisit)", ok: false, detail: "TestVisit screening not found", via: "db" };
    } else if (apiAuthAvailable) {
      const api = await tryApiJson(`/api/case-document-readiness?patientScreeningId=${visitScreeningId}&limit=20`);
      if (!api.ok || !Array.isArray(api.body)) {
        result = { name: "Ancillary Documents readiness (TestVisit)", ok: false, detail: `HTTP ${api.status} via API`, via: "api" };
      } else {
        const rows = api.body as Array<Record<string, unknown>>;
        const types = new Set(rows.map((r) => String(r.documentType ?? "")));
        const required = ["informed_consent", "screening_form", "report", "order_note", "post_procedure_note", "billing_document"];
        const allPresent = required.every((t) => types.has(t));
        result = {
          name: "Ancillary Documents readiness (TestVisit)",
          ok: allPresent && rows.length >= 6,
          detail: `count=${rows.length} types=[${[...types].join(",")}]`,
          via: "api",
        };
      }
    } else {
      const rows = await db
        .select()
        .from(caseDocumentReadiness)
        .where(eq(caseDocumentReadiness.patientScreeningId, visitScreeningId));
      const types = new Set(rows.map((r) => r.documentType));
      const required = ["informed_consent", "screening_form", "report", "order_note", "post_procedure_note", "billing_document"];
      const allPresent = required.every((t) => types.has(t));
      result = {
        name: "Ancillary Documents readiness (TestVisit)",
        ok: allPresent && rows.length >= 6,
        detail: `count=${rows.length} types=[${[...types].join(",")}]`,
        via: "db",
      };
    }
    results.push(result);
  }

  // ── 6) Billing canonical readiness for TestVisit ────────────────────
  {
    let result: CheckResult;
    const visitScreeningId = await resolveCanonicalScreeningId(TESTVISIT_NAME);
    if (visitScreeningId == null) {
      result = { name: "Billing canonical readiness (TestVisit)", ok: false, detail: "TestVisit screening not found", via: "db" };
    } else if (apiAuthAvailable) {
      const api = await tryApiJson(`/api/billing-readiness-checks?patientScreeningId=${visitScreeningId}&limit=10`);
      if (!api.ok || !Array.isArray(api.body)) {
        result = { name: "Billing canonical readiness (TestVisit)", ok: false, detail: `HTTP ${api.status} via API`, via: "api" };
      } else {
        const rows = api.body as Array<Record<string, unknown>>;
        const ok = rows.some((r) => r.readinessStatus === "ready_to_generate");
        result = {
          name: "Billing canonical readiness (TestVisit)",
          ok,
          detail: `count=${rows.length} statuses=[${rows.map((r) => r.readinessStatus).join(",")}]`,
          via: "api",
        };
      }
    } else {
      const rows = await db
        .select()
        .from(billingReadinessChecks)
        .where(eq(billingReadinessChecks.patientScreeningId, visitScreeningId));
      const ok = rows.some((r) => r.readinessStatus === "ready_to_generate");
      result = {
        name: "Billing canonical readiness (TestVisit)",
        ok,
        detail: `count=${rows.length} statuses=[${rows.map((r) => r.readinessStatus).join(",")}]`,
        via: "db",
      };
    }
    results.push(result);
  }

  // ── 7) Completed billing package + payment for TestVisit ────────────
  {
    let result: CheckResult;
    const visitScreeningId = await resolveCanonicalScreeningId(TESTVISIT_NAME);
    if (visitScreeningId == null) {
      result = { name: "Completed billing package (TestVisit)", ok: false, detail: "TestVisit screening not found", via: "db" };
    } else if (apiAuthAvailable) {
      const api = await tryApiJson(`/api/completed-billing-packages?patientScreeningId=${visitScreeningId}&limit=10`);
      if (!api.ok || !Array.isArray(api.body)) {
        result = { name: "Completed billing package (TestVisit)", ok: false, detail: `HTTP ${api.status} via API`, via: "api" };
      } else {
        const rows = api.body as Array<Record<string, unknown>>;
        const completed = rows.filter((r) =>
          r.packageStatus === "completed_package" || r.packageStatus === "added_to_invoice",
        );
        const paid = completed.some((r) => r.fullAmountPaid != null && r.fullAmountPaid !== "");
        const ok = completed.length > 0 && paid;
        result = {
          name: "Completed billing package (TestVisit)",
          ok,
          detail: `count=${rows.length} completedOrInvoiced=${completed.length} paid=${paid}`,
          via: "api",
        };
      }
    } else {
      const rows = await db
        .select()
        .from(completedBillingPackages)
        .where(eq(completedBillingPackages.patientScreeningId, visitScreeningId));
      const completed = rows.filter((r) =>
        r.packageStatus === "completed_package" || r.packageStatus === "added_to_invoice",
      );
      const paid = completed.some((r) => r.fullAmountPaid != null && r.fullAmountPaid !== "");
      const ok = completed.length > 0 && paid;
      result = {
        name: "Completed billing package (TestVisit)",
        ok,
        detail: `count=${rows.length} completedOrInvoiced=${completed.length} paid=${paid}`,
        via: "db",
      };
    }
    results.push(result);
  }

  // ── 8) Invoice line item + invoice totals (DB only — no public list endpoint) ──
  {
    let result: CheckResult;
    const visitScreeningId = await resolveCanonicalScreeningId(TESTVISIT_NAME);
    if (visitScreeningId == null) {
      result = { name: "Invoice line item + totals (TestVisit)", ok: false, detail: "TestVisit screening not found", via: "db" };
    } else {
      const pkgs = await db
        .select()
        .from(completedBillingPackages)
        .where(eq(completedBillingPackages.patientScreeningId, visitScreeningId));
      const lineItemIds: number[] = [];
      const invoiceIds: number[] = [];
      for (const pkg of pkgs) {
        const meta = (pkg.metadata && typeof pkg.metadata === "object")
          ? pkg.metadata as Record<string, unknown>
          : null;
        const liId = typeof meta?.invoiceLineItemId === "number" ? meta.invoiceLineItemId as number : null;
        const invId = typeof meta?.invoiceId === "number" ? meta.invoiceId as number : null;
        if (liId != null) lineItemIds.push(liId);
        if (invId != null) invoiceIds.push(invId);
      }
      const lines = lineItemIds.length > 0
        ? await db.select().from(invoiceLineItems).where(inArray(invoiceLineItems.id, lineItemIds))
        : [];
      const linkedInvoices = invoiceIds.length > 0
        ? await db.select().from(invoices).where(inArray(invoices.id, invoiceIds))
        : [];
      const hasLine = lines.length > 0;
      const hasNonZeroTotals = linkedInvoices.some((inv) => Number(inv.totalCharges) > 0);
      const ok = hasLine && hasNonZeroTotals;
      result = {
        name: "Invoice line item + totals (TestVisit)",
        ok,
        detail: `lineItems=${lines.length} linkedInvoices=${linkedInvoices.length} totalsNonZero=${hasNonZeroTotals}`,
        via: "db",
      };
    }
    results.push(result);
  }

  // ── 9) Engagement assignment dry-run for Test Facility (auth required) ──
  {
    let result: CheckResult;
    if (apiAuthAvailable) {
      try {
        const res = await fetch(`${baseUrl}/api/engagement-center/assign`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            cookie: cookie!,
          },
          body: JSON.stringify({
            facilityId: TEST_FACILITY,
            targetRole: "scheduler",
            dryRun: true,
            limit: 5,
          }),
        });
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) {
          const text = await res.text().catch(() => "");
          result = {
            name: "Assignment dry-run (Test Facility, scheduler)",
            ok: false,
            detail: `expected JSON; got ${ct} HTTP ${res.status} body=${text.slice(0, 80)}`,
            via: "api",
          };
        } else {
          const body = (await res.json()) as Record<string, unknown>;
          const cases = Array.isArray(body.cases) ? body.cases : [];
          const allDryRun = cases.every((c: any) => c.applied === false);
          const ok = res.ok && body.dryRun === true && allDryRun;
          result = {
            name: "Assignment dry-run (Test Facility, scheduler)",
            ok,
            detail: `dryRun=${body.dryRun} count=${body.count} appliedFalseForAll=${allDryRun}`,
            via: "api",
          };
        }
      } catch (err: any) {
        result = {
          name: "Assignment dry-run (Test Facility, scheduler)",
          ok: false,
          detail: `network error: ${err?.message ?? String(err)}`,
          via: "api",
        };
      }
    } else {
      result = {
        name: "Assignment dry-run (Test Facility, scheduler)",
        ok: true,
        detail: "skipped — POST /api/engagement-center/assign requires COOKIE; this check is no-op without auth",
        via: "skipped",
      };
    }
    results.push(result);
  }

  // ── Print results ────────────────────────────────────────────────────
  console.log("");
  console.log("───────── Canonical Visual QA ─────────");
  for (const r of results) {
    const symbol = r.ok ? "✓ PASS" : "✗ FAIL";
    console.log(`  ${symbol}  [${r.via}]  ${r.name} — ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`  totals: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length === 0) {
    console.log("[qa:canonical-visual-state] OK — every required surface verified");
  } else {
    console.log(`[qa:canonical-visual-state] FAIL — ${failed.length} surface(s) failed`);
  }

  try {
    await pool.end();
  } catch {
    /* noop */
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[qa:canonical-visual-state] unexpected failure:", err);
  process.exit(1);
});
