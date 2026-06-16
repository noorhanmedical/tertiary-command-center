// exceptionSnapshotEngine — Phase 3 PR 3.2.
//
// Evaluates exceptions from canonical Phase 2/4 sources and upserts
// rows in exception_snapshots. Read-only with respect to patient,
// billing, scheduling, and invoice state — only writes exception
// snapshots.
//
// PR 3.2 ships the engine skeleton + the highest-value detectors
// (callback_overdue, payment_overdue, invoice_delivery_failed,
// invoice_readiness_blocked, physician_signature_pending). PR 3.6
// + 3.7 register the rest into the registry-driven loop.

import { db } from "../../db";
import { and, eq, isNotNull, inArray, sql } from "drizzle-orm";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { invoices } from "@shared/schema/invoices";
import { invoiceDeliveryEvents } from "@shared/schema/invoiceDelivery";
import { invoiceReadinessSnapshots } from "@shared/schema/invoiceReadiness";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { billingReadinessChecks } from "@shared/schema/billingReadiness";
import { invoiceBatches } from "@shared/schema/invoiceBatches";
import { invoiceDenials } from "@shared/schema/invoiceFinancialEvents";
import { patientScreenings } from "@shared/schema/screening";
import { outreachCalls } from "@shared/schema/outreach";
import { getEffectiveExceptionPolicy } from "./exceptionSettingsService";
import { DETECTOR_REGISTRY } from "./detectorRegistry";
import { upsertException, markSuperseded, listExceptions } from "../../repositories/exceptionSnapshots.repo";
import type { ExceptionType, ExceptionSeverity, ExceptionOwnerRole } from "@shared/contracts/exceptionIntelligence";

const DETECTOR_VERSION = "3.7.0";

const PRESENT_DOC_STATUS = new Set([
  "completed", "complete", "uploaded", "generated", "approved", "signed", "verified", "present",
]);

function hoursBetween(a: Date | string | null | undefined, b: Date = new Date()): number {
  if (!a) return 0;
  const t = a instanceof Date ? a.getTime() : new Date(a).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (b.getTime() - t) / 3600_000);
}
function daysBetween(a: Date | string | null | undefined, b: Date = new Date()): number {
  return hoursBetween(a, b) / 24;
}

function fillTemplate(template: string, facts: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (facts[k] != null ? String(facts[k]) : "—"));
}

export type EvaluationResult = {
  detected: number;
  refreshed: number;
  superseded: number;
};

type DetectorContext = {
  policy: Awaited<ReturnType<typeof getEffectiveExceptionPolicy>>;
  now: Date;
  facilityId?: string | null;
};

type EmitArgs = {
  type: ExceptionType;
  entityType: string;
  entityId: number | null;
  exceptionKey: string;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  invoiceId?: number | null;
  facilityId?: string | null;
  testType?: string | null;
  facts: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

async function emit(ctx: DetectorContext, args: EmitArgs): Promise<"detected" | "refreshed"> {
  const def = DETECTOR_REGISTRY.find((d) => d.exceptionType === args.type);
  if (!def) throw new Error(`unknown detector ${args.type}`);
  const eff = ctx.policy.detectors[args.type];
  const explanation = fillTemplate(def.explanationTemplate, {
    ...args.facts,
    thresholdValue: eff?.thresholdValue ?? def.defaultThresholdValue,
  });
  const { created } = await upsertException({
    exceptionKey: args.exceptionKey,
    exceptionType: args.type,
    entityType: args.entityType,
    entityId: args.entityId ?? null,
    patientScreeningId: args.patientScreeningId ?? null,
    executionCaseId: args.executionCaseId ?? null,
    invoiceId: args.invoiceId ?? null,
    facilityId: args.facilityId ?? null,
    testType: args.testType ?? null,
    severity: (eff?.severity ?? def.defaultSeverity) as ExceptionSeverity,
    status: "open",
    title: def.title,
    explanation,
    recommendedOwnerRole: (eff?.ownerRole ?? def.defaultOwnerRole) as ExceptionOwnerRole,
    sourceSnapshot: args.facts,
    detectorVersion: DETECTOR_VERSION,
    policySnapshot: {
      severity: eff?.severity ?? def.defaultSeverity,
      ownerRole: eff?.ownerRole ?? def.defaultOwnerRole,
      thresholdValue: eff?.thresholdValue ?? def.defaultThresholdValue,
      thresholdUnit: def.thresholdUnit,
      humanReviewRequired: ctx.policy.humanReviewRequired,
      autoActionsEnabled: ctx.policy.autoActionsEnabled,
    },
    metadata: args.metadata ?? {},
  } as any);
  return created ? "detected" : "refreshed";
}

// ── individual detectors ────────────────────────────────────────────

async function detectCallbackOverdue(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["callback_overdue"];
  const cases = await db.select().from(patientExecutionCases).where(isNotNull(patientExecutionCases.nextActionAt));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const c of cases) {
    if (ctx.facilityId && c.facilityId !== ctx.facilityId) continue;
    if (!c.nextActionAt) continue;
    const hoursOverdue = hoursBetween(c.nextActionAt as any, ctx.now);
    if (hoursOverdue < eff.thresholdValue) continue;
    const key = `callback_overdue:${c.id}`;
    keys.add(key);
    const r = await emit(ctx, {
      type: "callback_overdue",
      entityType: "execution_case",
      entityId: c.id,
      exceptionKey: key,
      patientScreeningId: c.patientScreeningId ?? null,
      executionCaseId: c.id,
      facilityId: c.facilityId ?? null,
      facts: { nextActionAt: (c.nextActionAt as Date).toISOString(), hoursOverdue: hoursOverdue.toFixed(1) },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectPaymentOverdue(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["payment_overdue"];
  const rows = await db.select().from(invoices);
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const i of rows) {
    if (ctx.facilityId && i.facility !== ctx.facilityId) continue;
    if (i.status === "Paid") continue;
    const due = (i as any).dueDate as string | null;
    if (!due) continue;
    const dueDate = new Date(due);
    if (Number.isNaN(dueDate.getTime())) continue;
    const daysOverdue = (ctx.now.getTime() - dueDate.getTime()) / (24 * 3600 * 1000);
    if (daysOverdue < eff.thresholdValue) continue;
    const key = `payment_overdue:${i.id}`;
    keys.add(key);
    const r = await emit(ctx, {
      type: "payment_overdue",
      entityType: "invoice",
      entityId: i.id,
      exceptionKey: key,
      invoiceId: i.id,
      facilityId: i.facility,
      facts: { invoiceId: i.id, totalBalance: i.totalBalance, daysOverdue: daysOverdue.toFixed(1), dueDate: due },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectInvoiceDeliveryFailed(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const rows = await db.select().from(invoices).where(eq(invoices.deliveryStatus, "failed" as any));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const i of rows) {
    if (ctx.facilityId && i.facility !== ctx.facilityId) continue;
    const [evt] = await db.select().from(invoiceDeliveryEvents).where(and(eq(invoiceDeliveryEvents.invoiceId, i.id), eq(invoiceDeliveryEvents.eventType, "failed"))).limit(1);
    const key = `invoice_delivery_failed:${i.id}`;
    keys.add(key);
    const r = await emit(ctx, {
      type: "invoice_delivery_failed",
      entityType: "invoice",
      entityId: i.id,
      exceptionKey: key,
      invoiceId: i.id,
      facilityId: i.facility,
      facts: { invoiceId: i.id, failedAt: (evt?.createdAt as Date | undefined)?.toISOString?.() ?? "unknown", errorMessage: evt?.errorMessage ?? null },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectInvoiceReadinessBlocked(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["invoice_readiness_blocked"];
  const rows = await db.select().from(invoiceReadinessSnapshots).where(eq(invoiceReadinessSnapshots.readinessStatus, "blocked"));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const s of rows) {
    if (ctx.facilityId && s.facilityId !== ctx.facilityId) continue;
    const hoursBlocked = hoursBetween(s.evaluatedAt as any, ctx.now);
    if (hoursBlocked < eff.thresholdValue) continue;
    const key = `invoice_readiness_blocked:${s.id}`;
    keys.add(key);
    const blockers = Array.isArray(s.blockers) ? (s.blockers as unknown[]).join(", ") : "(unknown)";
    const r = await emit(ctx, {
      type: "invoice_readiness_blocked",
      entityType: "invoice_readiness",
      entityId: s.id,
      exceptionKey: key,
      executionCaseId: s.executionCaseId ?? null,
      facilityId: s.facilityId ?? null,
      testType: s.serviceType ?? null,
      facts: { hoursBlocked: hoursBlocked.toFixed(1), blockers },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectPhysicianSignaturePending(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["physician_signature_pending"];
  // Cases that have an order_note present but no physician_signed_order
  // with status in the present set.
  const orderRows = await db.select().from(caseDocumentReadiness).where(eq(caseDocumentReadiness.documentType, "order_note"));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  const PRESENT = new Set(["completed", "complete", "uploaded", "generated", "approved", "signed", "verified", "present"]);
  for (const o of orderRows) {
    if (!PRESENT.has((o.documentStatus ?? "").toLowerCase())) continue;
    if (ctx.facilityId && o.facilityId !== ctx.facilityId) continue;
    const [signed] = await db.select().from(caseDocumentReadiness).where(and(
      eq(caseDocumentReadiness.executionCaseId, o.executionCaseId ?? -1),
      eq(caseDocumentReadiness.documentType, "physician_signed_order"),
    )).limit(1);
    const isSigned = signed && PRESENT.has((signed.documentStatus ?? "").toLowerCase());
    if (isSigned) continue;
    const hoursPending = hoursBetween(o.completedAt as any, ctx.now);
    if (hoursPending < eff.thresholdValue) continue;
    const key = `physician_signature_pending:${o.executionCaseId}:${o.serviceType}`;
    keys.add(key);
    const r = await emit(ctx, {
      type: "physician_signature_pending",
      entityType: "execution_case",
      entityId: o.executionCaseId ?? null,
      exceptionKey: key,
      executionCaseId: o.executionCaseId ?? null,
      patientScreeningId: o.patientScreeningId ?? null,
      facilityId: o.facilityId ?? null,
      testType: o.serviceType,
      facts: { hoursPending: hoursPending.toFixed(1) },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectDenialFollowupDue(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["denial_followup_due"];
  const rows = await db.select().from(invoiceDenials).where(eq(invoiceDenials.status, "open"));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const d of rows) {
    const daysOpen = daysBetween(d.createdAt as any, ctx.now);
    if (daysOpen < eff.thresholdValue) continue;
    const key = `denial_followup_due:${d.id}`;
    keys.add(key);
    const r = await emit(ctx, {
      type: "denial_followup_due",
      entityType: "denial",
      entityId: d.id,
      exceptionKey: key,
      invoiceId: d.invoiceId ?? null,
      facts: { denialId: d.id, denialCode: d.denialCode ?? "—", daysOpen: daysOpen.toFixed(1) },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

// ── PR 3.6 document detectors ───────────────────────────────────────

async function detectMissingDocument(
  ctx: DetectorContext,
  documentType: string,
  exceptionType: "report_missing" | "order_note_missing" | "procedure_note_missing",
): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors[exceptionType];
  const rows = await db.select().from(caseDocumentReadiness)
    .where(eq(caseDocumentReadiness.documentType, documentType));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const r of rows) {
    if (ctx.facilityId && r.facilityId !== ctx.facilityId) continue;
    const status = (r.documentStatus ?? "").toLowerCase();
    if (PRESENT_DOC_STATUS.has(status)) continue;
    if (!r.blocksBilling) continue;
    const hoursMissing = hoursBetween(r.createdAt as any, ctx.now);
    if (hoursMissing < eff.thresholdValue) continue;
    const key = `${exceptionType}:${r.id}`;
    keys.add(key);
    const ev = await emit(ctx, {
      type: exceptionType,
      entityType: "execution_case",
      entityId: r.executionCaseId ?? null,
      exceptionKey: key,
      executionCaseId: r.executionCaseId ?? null,
      patientScreeningId: r.patientScreeningId ?? null,
      facilityId: r.facilityId ?? null,
      testType: r.serviceType,
      facts: {
        documentType,
        documentStatus: r.documentStatus,
        hoursMissing: hoursMissing.toFixed(1),
        patientLabel: r.patientName ?? "—",
      },
    });
    if (ev === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectBillingReadinessBlocked(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["billing_readiness_blocked"];
  const rows = await db.select().from(billingReadinessChecks)
    .where(inArray(billingReadinessChecks.readinessStatus, ["not_ready", "missing_requirements"]));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const r of rows) {
    if (ctx.facilityId && r.facilityId !== ctx.facilityId) continue;
    const hoursBlocked = hoursBetween(r.updatedAt as any, ctx.now);
    if (hoursBlocked < eff.thresholdValue) continue;
    const key = `billing_readiness_blocked:${r.id}`;
    keys.add(key);
    const missing = Array.isArray(r.missingRequirements) ? (r.missingRequirements as unknown[]).join(", ") : "(unknown)";
    const ev = await emit(ctx, {
      type: "billing_readiness_blocked",
      entityType: "execution_case",
      entityId: r.executionCaseId ?? null,
      exceptionKey: key,
      executionCaseId: r.executionCaseId ?? null,
      patientScreeningId: r.patientScreeningId ?? null,
      facilityId: r.facilityId ?? null,
      testType: r.serviceType,
      facts: {
        readinessStatus: r.readinessStatus,
        hoursBlocked: hoursBlocked.toFixed(1),
        missingRequirements: missing,
      },
    });
    if (ev === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectInvoiceBatchStale(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["invoice_batch_stale"];
  const rows = await db.select().from(invoiceBatches)
    .where(inArray(invoiceBatches.batchStatus, ["draft_preview", "draft", "pending_approval"]));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const b of rows) {
    if (ctx.facilityId && b.facilityId !== ctx.facilityId) continue;
    const hoursStale = hoursBetween(b.createdAt as any, ctx.now);
    if (hoursStale < eff.thresholdValue) continue;
    const key = `invoice_batch_stale:${b.id}`;
    keys.add(key);
    const ev = await emit(ctx, {
      type: "invoice_batch_stale",
      entityType: "invoice_batch",
      entityId: b.id,
      exceptionKey: key,
      facilityId: b.facilityId,
      facts: { batchStatus: b.batchStatus, hoursStale: hoursStale.toFixed(1) },
    });
    if (ev === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectInvoiceDraftStale(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["invoice_draft_stale"];
  const rows = await db.select().from(invoices).where(eq(invoices.status, "Draft"));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const i of rows) {
    if (ctx.facilityId && i.facility !== ctx.facilityId) continue;
    const hoursStale = hoursBetween(i.createdAt as any, ctx.now);
    if (hoursStale < eff.thresholdValue) continue;
    const key = `invoice_draft_stale:${i.id}`;
    keys.add(key);
    const ev = await emit(ctx, {
      type: "invoice_draft_stale",
      entityType: "invoice",
      entityId: i.id,
      exceptionKey: key,
      invoiceId: i.id,
      facilityId: i.facility,
      facts: { hoursStale: hoursStale.toFixed(1), approvalStatus: i.approvalStatus },
    });
    if (ev === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectMissingInvoiceRecipient(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const rows = await db.select().from(invoices)
    .where(eq(invoices.deliveryStatus, "blocked_missing_recipient" as any));
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const i of rows) {
    if (ctx.facilityId && i.facility !== ctx.facilityId) continue;
    const key = `missing_invoice_recipient:${i.id}`;
    keys.add(key);
    const ev = await emit(ctx, {
      type: "missing_invoice_recipient",
      entityType: "invoice",
      entityId: i.id,
      exceptionKey: key,
      invoiceId: i.id,
      facilityId: i.facility,
      facts: { deliveryStatus: i.deliveryStatus, recipientSnapshot: i.recipientSnapshot },
    });
    if (ev === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectHighBalanceAging(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["high_balance_aging"];
  const rows = await db.select().from(invoices);
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const i of rows) {
    if (ctx.facilityId && i.facility !== ctx.facilityId) continue;
    if (i.status === "Paid") continue;
    const balanceNum = Number(i.totalBalance ?? 0);
    if (!Number.isFinite(balanceNum) || balanceNum <= 0) continue;
    const daysAging = daysBetween(i.createdAt as any, ctx.now);
    if (daysAging < eff.thresholdValue) continue;
    const key = `high_balance_aging:${i.id}`;
    keys.add(key);
    const ev = await emit(ctx, {
      type: "high_balance_aging",
      entityType: "invoice",
      entityId: i.id,
      exceptionKey: key,
      invoiceId: i.id,
      facilityId: i.facility,
      facts: { totalBalance: balanceNum.toFixed(2), daysAging: daysAging.toFixed(1) },
    });
    if (ev === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

// ── PR 3.7 scheduling / call detectors ──────────────────────────────

async function detectMissingPatientContact(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const rows = await db.select({
    id: patientScreenings.id,
    facility: patientScreenings.facility,
    phoneNumber: patientScreenings.phoneNumber,
    email: patientScreenings.email,
    name: patientScreenings.name,
    deletedAt: patientScreenings.deletedAt,
  }).from(patientScreenings);
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const p of rows) {
    if (p.deletedAt) continue;
    if (ctx.facilityId && p.facility !== ctx.facilityId) continue;
    const phoneEmpty = !p.phoneNumber || !p.phoneNumber.toString().trim();
    const emailEmpty = !p.email || !p.email.toString().trim();
    if (!phoneEmpty && !emailEmpty) continue;
    const key = `missing_patient_contact:${p.id}`;
    keys.add(key);
    const r = await emit(ctx, {
      type: "missing_patient_contact",
      entityType: "patient_screening",
      entityId: p.id,
      exceptionKey: key,
      patientScreeningId: p.id,
      facilityId: p.facility ?? null,
      facts: {
        patientLabel: p.name ?? "—",
        phoneMissing: phoneEmpty,
        emailMissing: emailEmpty,
      },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectCallOutcomeOverdue(
  ctx: DetectorContext,
  outcome: "voicemail" | "no_answer",
  exceptionType: "lvm_followup_overdue" | "no_answer_followup_overdue",
): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors[exceptionType];
  // Latest outreach_call per patient with the given outcome.
  const calls = await db.select().from(outreachCalls);
  type CallRow = typeof calls[number];
  const latestByPatient = new Map<number, CallRow>();
  for (const c of calls) {
    const prev = latestByPatient.get(c.patientScreeningId);
    if (!prev) { latestByPatient.set(c.patientScreeningId, c); continue; }
    const ts = c.startedAt instanceof Date ? c.startedAt.getTime() : new Date(c.startedAt as any).getTime();
    const pts = prev.startedAt instanceof Date ? prev.startedAt.getTime() : new Date(prev.startedAt as any).getTime();
    if (ts > pts) latestByPatient.set(c.patientScreeningId, c);
  }
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const [patientScreeningId, c] of latestByPatient) {
    if (c.outcome !== outcome) continue;
    const hoursOverdue = hoursBetween(c.startedAt as any, ctx.now);
    if (hoursOverdue < eff.thresholdValue) continue;
    const key = `${exceptionType}:${patientScreeningId}`;
    keys.add(key);
    const r = await emit(ctx, {
      type: exceptionType,
      entityType: "patient_screening",
      entityId: patientScreeningId,
      exceptionKey: key,
      patientScreeningId,
      facts: {
        attemptNumber: c.attemptNumber,
        outcome,
        hoursOverdue: hoursOverdue.toFixed(1),
      },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

async function detectUnableToReachThreshold(ctx: DetectorContext): Promise<{ detected: number; refreshed: number; keys: Set<string> }> {
  const eff = ctx.policy.detectors["unable_to_reach_threshold_met"];
  const counts = await db.execute<{ patient_screening_id: number; attempts: string }>(sql`
    select patient_screening_id, count(*)::text as attempts
    from outreach_calls
    where outcome in ('no_answer','voicemail','mailbox_full','busy','hung_up','disconnected')
    group by 1
  `);
  let detected = 0, refreshed = 0;
  const keys = new Set<string>();
  for (const row of counts.rows) {
    const attempts = Number(row.attempts);
    if (!Number.isFinite(attempts) || attempts < eff.thresholdValue) continue;
    const key = `unable_to_reach_threshold_met:${row.patient_screening_id}`;
    keys.add(key);
    const r = await emit(ctx, {
      type: "unable_to_reach_threshold_met",
      entityType: "patient_screening",
      entityId: row.patient_screening_id,
      exceptionKey: key,
      patientScreeningId: row.patient_screening_id,
      facts: { attempts: String(attempts) },
    });
    if (r === "detected") detected++; else refreshed++;
  }
  return { detected, refreshed, keys };
}

// ── public engine API ───────────────────────────────────────────────

export type EvaluateInput = { facilityId?: string | null; testType?: string | null };

export async function evaluateExceptions(input: EvaluateInput = {}): Promise<EvaluationResult> {
  const policy = await getEffectiveExceptionPolicy({ facilityId: input.facilityId ?? null, testType: input.testType ?? null });
  const ctx: DetectorContext = { policy, now: new Date(), facilityId: input.facilityId ?? null };

  const detectors = [
    detectCallbackOverdue,
    detectPaymentOverdue,
    detectInvoiceDeliveryFailed,
    detectInvoiceReadinessBlocked,
    detectPhysicianSignaturePending,
    detectDenialFollowupDue,
    // PR 3.6 — document + billing intelligence
    (c: DetectorContext) => detectMissingDocument(c, "report", "report_missing"),
    (c: DetectorContext) => detectMissingDocument(c, "order_note", "order_note_missing"),
    (c: DetectorContext) => detectMissingDocument(c, "procedure_note", "procedure_note_missing"),
    detectBillingReadinessBlocked,
    detectInvoiceBatchStale,
    detectInvoiceDraftStale,
    detectMissingInvoiceRecipient,
    detectHighBalanceAging,
    // PR 3.7 — scheduling / call detectors
    detectMissingPatientContact,
    (c: DetectorContext) => detectCallOutcomeOverdue(c, "voicemail", "lvm_followup_overdue"),
    (c: DetectorContext) => detectCallOutcomeOverdue(c, "no_answer", "no_answer_followup_overdue"),
    detectUnableToReachThreshold,
  ];

  let detected = 0;
  let refreshed = 0;
  const liveKeys = new Set<string>();
  for (const fn of detectors) {
    const r = await fn(ctx);
    detected += r.detected;
    refreshed += r.refreshed;
    for (const k of r.keys) liveKeys.add(k);
  }

  // Supersede open exceptions whose keys are no longer emitted by
  // the engine — the source condition has cleared. Only supersedes
  // open / acknowledged / in_review rows (not resolved/dismissed).
  let superseded = 0;
  const stale = await listExceptions({ status: ["open", "acknowledged", "in_review"] }, 1000);
  for (const row of stale) {
    if (input.facilityId && row.facilityId !== input.facilityId) continue;
    if (liveKeys.has(row.exceptionKey)) continue;
    // Only auto-supersede detectors that the engine ran in this
    // pass (PR 3.6/3.7 detectors are added later; until they run
    // their snapshots must remain open).
    const myTypes = new Set([
      "callback_overdue", "payment_overdue", "invoice_delivery_failed",
      "invoice_readiness_blocked", "physician_signature_pending", "denial_followup_due",
      // PR 3.6 additions
      "report_missing", "order_note_missing", "procedure_note_missing",
      "billing_readiness_blocked", "invoice_batch_stale", "invoice_draft_stale",
      "missing_invoice_recipient", "high_balance_aging",
      // PR 3.7 additions
      "missing_patient_contact", "lvm_followup_overdue",
      "no_answer_followup_overdue", "unable_to_reach_threshold_met",
    ]);
    if (!myTypes.has(row.exceptionType)) continue;
    await markSuperseded(row.id);
    superseded++;
  }

  return { detected, refreshed, superseded };
}
