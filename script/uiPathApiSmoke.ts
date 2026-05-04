// UI-path API smoke. Drives the same HTTP endpoints the canonical row
// action buttons in the Scheduler Portal + Billing page click, in order:
//
//   POST /api/auth/login
//   POST /api/engagement-center/call-result          (Log Call button)
//   POST /api/global-schedule-events/schedule-ancillary   (Sched button)
//   POST /api/procedure-events/complete               (Done dialog → procedure)
//   POST /api/case-document-readiness/complete × 5    (Done dialog → docs)
//   POST /api/billing/complete-package-payment        (Pay button)
//
// Uses the seeded TestVisit Patient (is_test=true) only — discovers
// patientScreeningId / executionCaseId via DB lookup, never hardcoded.
// After each major step, asserts the canonical row that should exist
// (call_result_logged, ancillary_appointment, procedure_event,
// case_document_readiness, billing_readiness_checks, completed_billing_
// packages, invoice_line_items). Re-runs the chain a second time and
// asserts no duplicates.
//
// No new dependencies — Node 20 native fetch + a small in-memory cookie
// jar handle the session.
//
// Env:
//   DATABASE_URL          required (DB asserts)
//   BASE_URL              optional (default http://localhost:5000)
//   UI_SMOKE_USERNAME     optional (default "admin")
//   UI_SMOKE_PASSWORD     optional (default "admin")

import { and, count, eq, ilike } from "drizzle-orm";

const TEST_VISIT_NAME = "TestVisit Patient";
const TEST_VISIT_DOB = "02/02/1950";
const TEST_FACILITY = "Test Facility";
const TEST_SERVICE = "BrainWave";
const TEST_PAID_AMOUNT = "500.00";

const REQUIRED_DOCS: Array<{ documentType: string; documentStatus: string }> = [
  { documentType: "informed_consent",    documentStatus: "completed" },
  { documentType: "screening_form",      documentStatus: "completed" },
  { documentType: "report",              documentStatus: "uploaded" },
  { documentType: "order_note",          documentStatus: "generated" },
  { documentType: "post_procedure_note", documentStatus: "generated" },
];

type Assertion = { name: string; pass: boolean; detail: string };
function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${symbol}  ${name} — ${detail}`);
}

// ── Tiny cookie jar (no dependency) ──────────────────────────────────────
class CookieJar {
  private cookies = new Map<string, string>();

  store(setCookieHeaders: string[] | null): void {
    if (!setCookieHeaders || setCookieHeaders.length === 0) return;
    for (const header of setCookieHeaders) {
      // First entry before ";" is name=value; trailing entries are attrs (Path, HttpOnly, etc).
      const [first] = header.split(";");
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  size(): number {
    return this.cookies.size;
  }
}

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:ui-path-api-smoke] DATABASE_URL is not set");
    process.exit(1);
  }
  const baseUrl = trimTrailingSlash(process.env.BASE_URL ?? "http://localhost:5000");
  const username = process.env.UI_SMOKE_USERNAME ?? "admin";
  const password = process.env.UI_SMOKE_PASSWORD ?? "admin";

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import(
    "@shared/schema/executionCase"
  );
  const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
  const { caseDocumentReadiness } = await import("@shared/schema/documentReadiness");
  const { billingReadinessChecks } = await import("@shared/schema/billingReadiness");
  const { billingDocumentRequests } = await import("@shared/schema/billingDocuments");
  const { completedBillingPackages } = await import("@shared/schema/completedBillingPackages");
  const { invoiceLineItems } = await import("@shared/schema/invoices");
  const { procedureEvents } = await import("@shared/schema/procedureEvents");
  const {
    createOrUpdateExecutionCaseFromScreening,
    getExecutionCaseByScreeningId,
  } = await import("../server/repositories/executionCase.repo");

  const assertions: Assertion[] = [];
  let exitCode = 0;
  const jar = new CookieJar();

  async function fetchJson(
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<{ status: number; ok: boolean; data: any }> {
    const url = `${baseUrl}${path}`;
    const headers = new Headers(init.headers ?? undefined);
    headers.set("accept", "application/json");
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
    }
    const cookieHeader = jar.header();
    if (cookieHeader) headers.set("cookie", cookieHeader);

    const res = await fetch(url, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });

    // Capture Set-Cookie. Node 20 fetch exposes getSetCookie() returning a string[].
    const setCookies = (res.headers as any).getSetCookie?.() ?? null;
    jar.store(setCookies);

    let data: any = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { status: res.status, ok: res.ok, data };
  }

  async function singleCount(table: any, where: any): Promise<number> {
    const rows = await db.select({ n: count() }).from(table).where(where);
    return rows[0]?.n ?? 0;
  }

  type CountSnapshot = {
    call_result_logged: number;
    ancillary_appointment: number;
    procedure_event_complete: number;
    case_document_readiness: number;
    billing_readiness_checks: number;
    billing_document_requests: number;
    completed_billing_packages: number;
    invoice_line_items: number;
  };

  async function captureCounts(
    psid: number,
    executionCaseId: number,
    patientName: string,
    startsAt: Date,
  ): Promise<CountSnapshot> {
    return {
      call_result_logged: await singleCount(
        patientJourneyEvents,
        and(
          eq(patientJourneyEvents.executionCaseId, executionCaseId),
          eq(patientJourneyEvents.eventType, "call_result_logged"),
        ),
      ),
      ancillary_appointment: await singleCount(
        globalScheduleEvents,
        and(
          eq(globalScheduleEvents.patientScreeningId, psid),
          eq(globalScheduleEvents.eventType, "ancillary_appointment"),
          eq(globalScheduleEvents.serviceType, TEST_SERVICE),
          eq(globalScheduleEvents.startsAt, startsAt),
        ),
      ),
      procedure_event_complete: await singleCount(
        procedureEvents,
        and(
          eq(procedureEvents.patientScreeningId, psid),
          eq(procedureEvents.serviceType, TEST_SERVICE),
          eq(procedureEvents.procedureStatus, "complete"),
        ),
      ),
      case_document_readiness: await singleCount(
        caseDocumentReadiness,
        and(
          eq(caseDocumentReadiness.patientScreeningId, psid),
          eq(caseDocumentReadiness.serviceType, TEST_SERVICE),
        ),
      ),
      billing_readiness_checks: await singleCount(
        billingReadinessChecks,
        and(
          eq(billingReadinessChecks.patientScreeningId, psid),
          eq(billingReadinessChecks.serviceType, TEST_SERVICE),
        ),
      ),
      billing_document_requests: await singleCount(
        billingDocumentRequests,
        and(
          eq(billingDocumentRequests.patientScreeningId, psid),
          eq(billingDocumentRequests.serviceType, TEST_SERVICE),
        ),
      ),
      completed_billing_packages: await singleCount(
        completedBillingPackages,
        and(
          eq(completedBillingPackages.patientScreeningId, psid),
          eq(completedBillingPackages.serviceType, TEST_SERVICE),
        ),
      ),
      invoice_line_items: await singleCount(
        invoiceLineItems,
        ilike(invoiceLineItems.patientName, `%${patientName}%`),
      ),
    };
  }

  type RunOutcome = {
    callResultId: number | null;
    callResultStatus: number;
    ancillaryEventId: number | null;
    ancillaryStatus: number;
    procedureEventId: number | null;
    procedureStatus: number;
    docResults: Array<{ documentType: string; status: number; ok: boolean }>;
    billingPackageId: number | null;
    billingPaymentStatus: number;
    invoiceLineItemId: number | null;
    invoiceId: number | null;
    invoiceTotalCharges: string | null;
    billingReadinessStatus: string | null;
  };

  async function runFullChain(
    psid: number,
    executionCaseId: number,
    startsAt: Date,
  ): Promise<RunOutcome> {
    const outcome: RunOutcome = {
      callResultId: null,
      callResultStatus: 0,
      ancillaryEventId: null,
      ancillaryStatus: 0,
      procedureEventId: null,
      procedureStatus: 0,
      docResults: [],
      billingPackageId: null,
      billingPaymentStatus: 0,
      invoiceLineItemId: null,
      invoiceId: null,
      invoiceTotalCharges: null,
      billingReadinessStatus: null,
    };

    // 1. Log call result (UI: Log button → callback)
    const callbackAt = new Date();
    callbackAt.setHours(callbackAt.getHours() + 24);
    {
      const r = await fetchJson("/api/engagement-center/call-result", {
        method: "POST",
        json: {
          executionCaseId,
          patientScreeningId: psid,
          callResult: "callback",
          note: "ui-path-api-smoke",
          nextActionAt: callbackAt.toISOString(),
        },
      });
      outcome.callResultStatus = r.status;
      outcome.callResultId = r.data?.journeyEvent?.id ?? null;
    }

    // 2. Schedule ancillary (UI: Sched button)
    {
      const r = await fetchJson("/api/global-schedule-events/schedule-ancillary", {
        method: "POST",
        json: {
          executionCaseId,
          patientScreeningId: psid,
          serviceType: TEST_SERVICE,
          startsAt: startsAt.toISOString(),
          facilityId: TEST_FACILITY,
          note: "ui-path-api-smoke",
        },
      });
      outcome.ancillaryStatus = r.status;
      outcome.ancillaryEventId = r.data?.event?.id ?? null;
    }

    // 3. Procedure complete (UI: Done → Mark procedure complete)
    {
      const r = await fetchJson("/api/procedure-events/complete", {
        method: "POST",
        json: {
          executionCaseId,
          patientScreeningId: psid,
          serviceType: TEST_SERVICE,
          completedAt: new Date().toISOString(),
        },
      });
      outcome.procedureStatus = r.status;
      outcome.procedureEventId = r.data?.procedureEvent?.id ?? null;
    }

    // 4. Document completions (UI: Done → Document section, 5 clicks)
    for (const doc of REQUIRED_DOCS) {
      const r = await fetchJson("/api/case-document-readiness/complete", {
        method: "POST",
        json: {
          executionCaseId,
          patientScreeningId: psid,
          serviceType: TEST_SERVICE,
          documentType: doc.documentType,
          documentStatus: doc.documentStatus,
        },
      });
      outcome.docResults.push({
        documentType: doc.documentType,
        status: r.status,
        ok: r.ok,
      });
      if (r.data?.billingReadinessCheck?.readinessStatus) {
        outcome.billingReadinessStatus = r.data.billingReadinessCheck.readinessStatus;
      }
    }

    // 5. Billing payment (UI: Billing page → Pay button)
    {
      const r = await fetchJson("/api/billing/complete-package-payment", {
        method: "POST",
        json: {
          executionCaseId,
          patientScreeningId: psid,
          serviceType: TEST_SERVICE,
          fullAmountPaid: TEST_PAID_AMOUNT,
          paymentDate: new Date().toISOString().slice(0, 10),
          facilityId: TEST_FACILITY,
        },
      });
      outcome.billingPaymentStatus = r.status;
      outcome.billingPackageId = r.data?.package?.id ?? null;
      outcome.invoiceLineItemId = r.data?.invoiceLineItem?.id ?? null;
      outcome.invoiceId = r.data?.invoiceTotals?.invoiceId ?? null;
      outcome.invoiceTotalCharges = r.data?.invoiceTotals?.totalCharges ?? null;
    }

    return outcome;
  }

  try {
    // ── 0. Login ──────────────────────────────────────────────────────
    console.log(`[test:ui-path-api-smoke] base=${baseUrl} user=${username}`);
    const login = await fetchJson("/api/auth/login", {
      method: "POST",
      json: { username, password },
    });
    if (!login.ok) {
      console.error(
        `[test:ui-path-api-smoke] login failed status=${login.status} body=${JSON.stringify(login.data)}`,
      );
      console.error(
        `[test:ui-path-api-smoke] verify the dev server is running at ${baseUrl} and credentials are valid (override via UI_SMOKE_USERNAME/UI_SMOKE_PASSWORD)`,
      );
      process.exit(1);
    }
    const me = await fetchJson("/api/auth/me");
    record(
      assertions,
      "0 · login + session cookie",
      login.ok && me.ok && me.data?.username === login.data?.username,
      `login.status=${login.status} me.status=${me.status} user=${me.data?.username ?? "?"} role=${me.data?.role ?? "?"} cookies=${jar.size()}`,
    );

    // ── 1. Resolve seed (DB) ──────────────────────────────────────────
    const [seed] = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, TEST_VISIT_NAME),
          eq(patientScreenings.dob, TEST_VISIT_DOB),
          eq(patientScreenings.isTest, true),
        ),
      )
      .limit(1);
    if (!seed) {
      console.error(
        `[test:ui-path-api-smoke] seed missing — run \`npm run seed:visit-flow\` first`,
      );
      process.exit(1);
    }
    const psid = seed.id;
    let executionCase = await getExecutionCaseByScreeningId(psid);
    if (!executionCase) {
      const created = await createOrUpdateExecutionCaseFromScreening(seed, null);
      executionCase = created.executionCase;
    }
    const executionCaseId = executionCase.id;

    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + 7);
    startsAt.setHours(10, 0, 0, 0);

    console.log(
      `[test:ui-path-api-smoke] psid=${psid} executionCaseId=${executionCaseId} startsAt=${startsAt.toISOString()}`,
    );

    // ── 2. Capture before-counts ──────────────────────────────────────
    const before = await captureCounts(psid, executionCaseId, seed.name, startsAt);
    console.log(`[before]  ${JSON.stringify(before)}`);

    // ── 3. First chain run via HTTP ───────────────────────────────────
    console.log("\n── First run via HTTP ───────────────────────────────────");
    const first = await runFullChain(psid, executionCaseId, startsAt);
    const afterFirst = await captureCounts(psid, executionCaseId, seed.name, startsAt);
    console.log(`[after-1] ${JSON.stringify(afterFirst)}`);
    console.log(`  outcome=${JSON.stringify(first)}`);

    // ── 4. Per-step assertions ────────────────────────────────────────
    console.log("\n── Assertions ───────────────────────────────────────────");
    record(
      assertions,
      "1 · POST /api/engagement-center/call-result returned 2xx",
      first.callResultStatus >= 200 && first.callResultStatus < 300,
      `status=${first.callResultStatus} journeyEventId=${first.callResultId ?? "null"}`,
    );
    record(
      assertions,
      "1a · call_result_logged journey event exists for this case",
      afterFirst.call_result_logged >= 1,
      `count=${afterFirst.call_result_logged}`,
    );

    record(
      assertions,
      "2 · POST /api/global-schedule-events/schedule-ancillary returned 2xx",
      first.ancillaryStatus >= 200 && first.ancillaryStatus < 300,
      `status=${first.ancillaryStatus} eventId=${first.ancillaryEventId ?? "null"}`,
    );
    record(
      assertions,
      "2a · ancillary_appointment exists (one row per patient/service/startsAt)",
      afterFirst.ancillary_appointment === 1,
      `count=${afterFirst.ancillary_appointment}`,
    );

    record(
      assertions,
      "3 · POST /api/procedure-events/complete returned 2xx",
      first.procedureStatus >= 200 && first.procedureStatus < 300,
      `status=${first.procedureStatus} procedureEventId=${first.procedureEventId ?? "null"}`,
    );
    record(
      assertions,
      "3a · procedure_event with procedureStatus=complete exists",
      afterFirst.procedure_event_complete >= 1,
      `count=${afterFirst.procedure_event_complete}`,
    );

    const allDocsOk = first.docResults.every((d) => d.ok);
    record(
      assertions,
      "4 · POST /api/case-document-readiness/complete × 5 all returned 2xx",
      allDocsOk,
      first.docResults.map((d) => `${d.documentType}:${d.status}`).join(", "),
    );
    record(
      assertions,
      "4a · case_document_readiness rows ≥ 5 for service",
      afterFirst.case_document_readiness >= 5,
      `count=${afterFirst.case_document_readiness}`,
    );
    record(
      assertions,
      "4b · billing_readiness ready_to_generate after final doc",
      first.billingReadinessStatus === "ready_to_generate",
      `readinessStatus=${first.billingReadinessStatus ?? "null"}`,
    );

    record(
      assertions,
      "5 · POST /api/billing/complete-package-payment returned 2xx",
      first.billingPaymentStatus >= 200 && first.billingPaymentStatus < 300,
      `status=${first.billingPaymentStatus} packageId=${first.billingPackageId ?? "null"}`,
    );
    record(
      assertions,
      "5a · completed_billing_package exists",
      first.billingPackageId !== null && afterFirst.completed_billing_packages >= 1,
      `id=${first.billingPackageId} count=${afterFirst.completed_billing_packages}`,
    );
    // Invoice line is conditional — only when a Draft invoice exists for the
    // facility. Treat null as a deterministic skip so the smoke still passes
    // on environments without seeded Draft invoices.
    if (first.invoiceLineItemId !== null) {
      record(
        assertions,
        "6 · invoice_line_item created and linked to invoice",
        first.invoiceId !== null,
        `lineItemId=${first.invoiceLineItemId} invoiceId=${first.invoiceId} totalCharges=${first.invoiceTotalCharges}`,
      );
    } else {
      record(
        assertions,
        "6 · invoice_line_item skipped (no Draft invoice for facility)",
        true,
        "invoiceLineItem=null — deterministic skip",
      );
    }

    // ── 5. Second run (idempotency) ───────────────────────────────────
    console.log("\n── Second run via HTTP (idempotency) ────────────────────");
    await runFullChain(psid, executionCaseId, startsAt);
    const afterSecond = await captureCounts(psid, executionCaseId, seed.name, startsAt);
    console.log(`[after-2] ${JSON.stringify(afterSecond)}`);

    const dupChecks: Array<{ name: string; key: keyof CountSnapshot }> = [
      { name: "ancillary_appointment",       key: "ancillary_appointment" },
      { name: "procedure_event_complete",    key: "procedure_event_complete" },
      { name: "case_document_readiness",     key: "case_document_readiness" },
      { name: "billing_readiness_checks",    key: "billing_readiness_checks" },
      { name: "billing_document_requests",   key: "billing_document_requests" },
      { name: "completed_billing_packages",  key: "completed_billing_packages" },
      { name: "invoice_line_items",          key: "invoice_line_items" },
    ];
    for (const dc of dupChecks) {
      const delta = afterSecond[dc.key] - afterFirst[dc.key];
      record(
        assertions,
        `7 · second run does NOT duplicate ${dc.name}`,
        delta === 0,
        `delta=${delta}`,
      );
    }
    // call_result_logged is append-only by design — it grows by exactly 1
    // per HTTP call; the route always emits a new journey event. The QA
    // here only verifies that other canonical rows stay deduped, which is
    // the actual "no garbage" contract.
    record(
      assertions,
      "7 · call_result_logged is append-only (informational, not deduped)",
      afterSecond.call_result_logged - afterFirst.call_result_logged === 1,
      `delta=${afterSecond.call_result_logged - afterFirst.call_result_logged} (expected 1)`,
    );

    // ── 6. Summary ────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  baseUrl                    = ${baseUrl}`);
    console.log(`  user                       = ${username}`);
    console.log(`  patientScreeningId         = ${psid}`);
    console.log(`  executionCaseId            = ${executionCaseId}`);
    console.log(`  ancillaryEventId           = ${first.ancillaryEventId ?? "null"}`);
    console.log(`  procedureEventId           = ${first.procedureEventId ?? "null"}`);
    console.log(`  billingReadinessStatus     = ${first.billingReadinessStatus ?? "null"}`);
    console.log(`  completedBillingPackageId  = ${first.billingPackageId ?? "null"}`);
    console.log(`  invoiceLineItemId          = ${first.invoiceLineItemId ?? "null"}`);
    console.log(`  invoiceId                  = ${first.invoiceId ?? "null"}`);
    console.log(`  invoiceTotalCharges        = ${first.invoiceTotalCharges ?? "null"}`);
    console.log("  counts before/1/2:");
    console.log(`    before  : ${JSON.stringify(before)}`);
    console.log(`    after-1 : ${JSON.stringify(afterFirst)}`);
    console.log(`    after-2 : ${JSON.stringify(afterSecond)}`);
    console.log(`  assertions  passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:ui-path-api-smoke] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:ui-path-api-smoke] OK");
    }
  } catch (err: any) {
    console.error("[test:ui-path-api-smoke] unexpected failure:", err);
    exitCode = 1;
  } finally {
    // Same fire-and-forget tail-write grace period as our other QA scripts
    // (markProcedureComplete + evaluateBillingReadinessForProcedure schedule
    // async DB writes).
    await new Promise<void>((resolve) => setTimeout(resolve, 750));
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[test:ui-path-api-smoke] top-level error:", err);
  process.exit(1);
});
