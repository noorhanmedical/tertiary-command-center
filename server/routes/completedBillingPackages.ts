import type { Express, Request } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { completedBillingPackages } from "@shared/schema/completedBillingPackages";
import { invoiceLineItems, invoices } from "@shared/schema/invoices";
import {
  listCompletedBillingPackages,
  getCompletedBillingPackageById,
  updateCompletedBillingPackagePayment,
  createCompletedBillingPackage,
  updateCompletedBillingPackage,
  addCompletedPackageToInvoice,
} from "../repositories/completedBillingPackages.repo";
import {
  appendPatientJourneyEvent,
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
} from "../repositories/executionCase.repo";
import {
  listBillingReadinessChecks,
} from "../repositories/billingReadiness.repo";
import {
  listBillingDocumentRequests,
  createPendingBillingDocumentRequestFromReadiness,
  createBillingDocumentRequest,
} from "../repositories/billingDocuments.repo";
import { getGlobalAdminSettingValue } from "../repositories/adminSettings.repo";

const paymentUpdateSchema = z.object({
  fullAmountPaid: z.string().min(1, "fullAmountPaid is required"),
  paymentDate: z.string().optional().nullable(),
  paymentStatus: z.string().optional(),
  note: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

const completePackagePaymentSchema = z.object({
  executionCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  serviceType: z.string().min(1),
  fullAmountPaid: z.string().min(1, "fullAmountPaid is required"),
  paymentDate: z.string().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
  adminOverride: z.boolean().optional(),
});

function sessionUserIdFromBilling(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

export function registerCompletedBillingPackageRoutes(app: Express) {
  // GET /api/completed-billing-packages
  // Filters: executionCaseId, patientScreeningId, procedureEventId,
  //          billingReadinessCheckId, billingDocumentRequestId,
  //          facilityId, serviceType, packageStatus, paymentStatus, limit
  app.get("/api/completed-billing-packages", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listCompletedBillingPackages>[0] = {};

      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.procedureEventId) {
        const id = parseInt(q.procedureEventId, 10);
        if (!isNaN(id)) filters.procedureEventId = id;
      }
      if (q.billingReadinessCheckId) {
        const id = parseInt(q.billingReadinessCheckId, 10);
        if (!isNaN(id)) filters.billingReadinessCheckId = id;
      }
      if (q.billingDocumentRequestId) {
        const id = parseInt(q.billingDocumentRequestId, 10);
        if (!isNaN(id)) filters.billingDocumentRequestId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.packageStatus) filters.packageStatus = q.packageStatus;
      if (q.paymentStatus) filters.paymentStatus = q.paymentStatus;

      const packages = await listCompletedBillingPackages(filters, limit);
      res.json(packages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/completed-billing-packages/:id/payment
  app.post("/api/completed-billing-packages/:id/payment", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const parsed = paymentUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }

      const updated = await updateCompletedBillingPackagePayment(id, {
        ...parsed.data,
        paymentUpdatedByUserId: req.session?.userId ?? undefined,
      });

      if (!updated) return res.status(404).json({ error: "Completed billing package not found" });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /api/completed-billing-packages/:id
  app.get("/api/completed-billing-packages/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const pkg = await getCompletedBillingPackageById(id);
      if (!pkg) return res.status(404).json({ error: "Completed billing package not found" });
      res.json(pkg);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/billing/complete-package-payment
  // Body: serviceType (required), fullAmountPaid (required), executionCaseId? |
  //       patientScreeningId? (one required), paymentDate?, facilityId?,
  //       metadata?, adminOverride?
  // Single-shot action: verifies billing readiness is ready_to_generate
  // (or adminOverride=true), ensures a pending billing_document_request
  // exists, creates/updates the completed_billing_package, records the
  // payment, awaits the invoice-line-item insert (using the existing
  // 50/50 split via settings-aware metadata), and appends two journey
  // events (billing_payment_updated + added_to_invoice).
  app.post("/api/billing/complete-package-payment", async (req, res) => {
    try {
      const parsed = completePackagePaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const data = parsed.data;
      const actorUserId = sessionUserIdFromBilling(req);

      // Resolve patient context
      let executionCaseId: number | null = data.executionCaseId ?? null;
      let patientScreeningId: number | null = data.patientScreeningId ?? null;
      let executionCase: Awaited<ReturnType<typeof getExecutionCaseById>> | null = null;

      if (executionCaseId !== null) {
        const ec = await getExecutionCaseById(executionCaseId);
        if (ec) {
          executionCase = ec;
          if (patientScreeningId === null) patientScreeningId = ec.patientScreeningId ?? null;
        }
      }
      if (executionCase === null && patientScreeningId !== null) {
        const ec = await getExecutionCaseByScreeningId(patientScreeningId);
        if (ec) {
          executionCase = ec;
          executionCaseId = ec.id;
        }
      }
      if (!executionCase) {
        return res.status(404).json({
          error: "Could not resolve an execution case from executionCaseId or patientScreeningId",
        });
      }

      const facilityId = data.facilityId ?? executionCase.facilityId ?? null;
      if (!facilityId) {
        return res.status(400).json({
          error: "facilityId is required (and was not derivable from the execution case)",
        });
      }

      // Read invoice split settings (default Plexus 50%, clinic 50%)
      const ourPortionSetting = await getGlobalAdminSettingValue<{ percentage?: number }>(
        "invoice",
        "our_portion_percentage",
      );
      const ourPortionPercentage =
        typeof ourPortionSetting?.percentage === "number" && ourPortionSetting.percentage >= 0
          ? ourPortionSetting.percentage
          : 50;

      // Verify billing readiness OR adminOverride
      const readinessRows = patientScreeningId !== null
        ? await listBillingReadinessChecks({ patientScreeningId, serviceType: data.serviceType }, 1)
        : await listBillingReadinessChecks({ executionCaseId: executionCase.id, serviceType: data.serviceType }, 1);
      const readiness = readinessRows[0] ?? null;
      const adminOverride = data.adminOverride === true;

      if (!readiness && !adminOverride) {
        return res.status(409).json({
          error: "No billing_readiness_check exists yet — pass adminOverride=true to bypass.",
        });
      }
      if (readiness && readiness.readinessStatus !== "ready_to_generate" && !adminOverride) {
        return res.status(409).json({
          error: `Billing readiness is "${readiness.readinessStatus}" — not ready_to_generate. Pass adminOverride=true to bypass.`,
          readiness,
        });
      }

      // Ensure a pending billing_document_request exists. Prefer the
      // readiness-driven helper (handles dedup by readiness check id);
      // when overriding without a readiness check, fall back to a direct
      // insert tagged with the override metadata.
      const existingRequests = await listBillingDocumentRequests(
        patientScreeningId !== null
          ? { patientScreeningId, serviceType: data.serviceType }
          : { executionCaseId: executionCase.id, serviceType: data.serviceType },
        5,
      );
      let billingDocumentRequest = existingRequests[0] ?? null;
      if (!billingDocumentRequest) {
        if (readiness) {
          billingDocumentRequest = await createPendingBillingDocumentRequestFromReadiness(readiness);
        } else {
          billingDocumentRequest = await createBillingDocumentRequest({
            executionCaseId: executionCase.id,
            patientScreeningId: patientScreeningId ?? undefined,
            patientName: executionCase.patientName,
            patientDob: executionCase.patientDob ?? undefined,
            facilityId,
            serviceType: data.serviceType,
            requestStatus: "pending",
            metadata: { createdSource: "billing_complete_payment_admin_override" },
          });
        }
      }

      // Find or create completed_billing_package — dedup by
      // (patientScreeningId, serviceType) when available, else
      // (executionCaseId, serviceType).
      const dedupConditions = [eq(completedBillingPackages.serviceType, data.serviceType)];
      if (patientScreeningId !== null) {
        dedupConditions.push(eq(completedBillingPackages.patientScreeningId, patientScreeningId));
      } else {
        dedupConditions.push(eq(completedBillingPackages.executionCaseId, executionCase.id));
      }
      const [existingPkg] = await db
        .select()
        .from(completedBillingPackages)
        .where(and(...dedupConditions))
        .orderBy(desc(completedBillingPackages.createdAt))
        .limit(1);

      let pkg = existingPkg;
      if (!pkg) {
        pkg = await createCompletedBillingPackage({
          executionCaseId: executionCase.id,
          patientScreeningId: patientScreeningId ?? undefined,
          billingReadinessCheckId: readiness?.id ?? undefined,
          billingDocumentRequestId: billingDocumentRequest?.id ?? undefined,
          patientName: executionCase.patientName,
          patientDob: executionCase.patientDob ?? undefined,
          facilityId,
          serviceType: data.serviceType,
          packageStatus: "pending_payment",
          paymentStatus: "not_received",
          metadata: {
            createdSource: "billing_complete_payment_action",
            ourPortionPercentage,
          },
        });
      }

      // Update payment fields directly (bypassing the helper's
      // fire-and-forget invoice add so we can await the line item).
      const now = new Date();
      const updatedPkg = await updateCompletedBillingPackage(pkg.id, {
        fullAmountPaid: data.fullAmountPaid,
        paymentDate: data.paymentDate ?? undefined,
        paymentStatus: "updated",
        packageStatus: "completed_package",
        paymentUpdatedByUserId: actorUserId ?? undefined,
        paymentUpdatedAt: now,
        billingReadinessCheckId: readiness?.id ?? pkg.billingReadinessCheckId ?? undefined,
        billingDocumentRequestId: billingDocumentRequest?.id ?? pkg.billingDocumentRequestId ?? undefined,
        metadata: {
          ...(typeof pkg.metadata === "object" && pkg.metadata !== null ? pkg.metadata as Record<string, unknown> : {}),
          ...(data.metadata ?? {}),
          ourPortionPercentage,
          adminOverride: adminOverride ? true : undefined,
          paymentSource: "billing_complete_payment_action",
        },
      });

      const finalPkg = updatedPkg ?? pkg;

      // Add to invoice (await — not fire-and-forget). Helper applies the
      // 50/50 split at line-item time; settings value is recorded in the
      // package metadata for downstream auditing.
      const invoiceResult = await addCompletedPackageToInvoice(finalPkg);

      // Re-read invoice for fresh totals
      let invoiceTotals: { invoiceId: number; totalCharges: string; totalPaid: string; totalBalance: string; status: string } | null = null;
      if (invoiceResult) {
        const [invRow] = await db
          .select({
            id: invoices.id,
            totalCharges: invoices.totalCharges,
            totalPaid: invoices.totalPaid,
            totalBalance: invoices.totalBalance,
            status: invoices.status,
          })
          .from(invoices)
          .where(eq(invoices.id, invoiceResult.invoiceId))
          .limit(1);
        if (invRow) {
          invoiceTotals = {
            invoiceId: invRow.id,
            totalCharges: invRow.totalCharges,
            totalPaid: invRow.totalPaid,
            totalBalance: invRow.totalBalance,
            status: invRow.status,
          };
        }
      }

      // Append journey events (best-effort)
      const journeyEvents: Array<Awaited<ReturnType<typeof appendPatientJourneyEvent>>> = [];
      try {
        const paymentEvent = await appendPatientJourneyEvent({
          patientName: executionCase.patientName,
          patientDob: executionCase.patientDob ?? undefined,
          patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? undefined,
          executionCaseId: executionCase.id,
          eventType: "billing_payment_updated",
          eventSource: "billing_complete_payment_action",
          actorUserId,
          summary: `Payment updated for ${data.serviceType}: ${data.fullAmountPaid}`,
          metadata: {
            serviceType: data.serviceType,
            fullAmountPaid: data.fullAmountPaid,
            paymentDate: data.paymentDate ?? null,
            ourPortionPercentage,
            packageId: finalPkg.id,
            billingDocumentRequestId: billingDocumentRequest?.id ?? null,
            billingReadinessCheckId: readiness?.id ?? null,
            adminOverride,
          },
        });
        journeyEvents.push(paymentEvent);
      } catch (err: any) {
        console.error("[complete-package-payment] journey billing_payment_updated failed:", err.message);
      }

      if (invoiceResult) {
        try {
          const invoiceEvent = await appendPatientJourneyEvent({
            patientName: executionCase.patientName,
            patientDob: executionCase.patientDob ?? undefined,
            patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? undefined,
            executionCaseId: executionCase.id,
            eventType: "added_to_invoice",
            eventSource: "billing_complete_payment_action",
            actorUserId,
            summary: `Line item added to invoice ${invoiceResult.invoiceId}`,
            metadata: {
              serviceType: data.serviceType,
              packageId: finalPkg.id,
              invoiceId: invoiceResult.invoiceId,
              invoiceLineItemId: invoiceResult.lineItem.id,
              totalCharges: invoiceResult.lineItem.totalCharges,
              paidAmount: invoiceResult.lineItem.paidAmount,
              balanceRemaining: invoiceResult.lineItem.balanceRemaining,
              ourPortionPercentage,
            },
          });
          journeyEvents.push(invoiceEvent);
        } catch (err: any) {
          console.error("[complete-package-payment] journey added_to_invoice failed:", err.message);
        }
      }

      // Re-read package to get final state (helper updates packageStatus
      // to added_to_invoice on success)
      const finalState = await getCompletedBillingPackageById(finalPkg.id);

      return res.json({
        ok: true,
        package: finalState ?? finalPkg,
        billingDocumentRequest,
        billingReadinessCheck: readiness,
        invoiceLineItem: invoiceResult?.lineItem ?? null,
        invoiceTotals,
        journeyEvents,
        ourPortionPercentage,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });
}
