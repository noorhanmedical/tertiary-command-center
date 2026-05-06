import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Wallet,
  ClipboardCheck,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  fetchCompletedBillingPackages,
  completedBillingPackagesQueryKey,
  fetchBillingReadinessChecks,
  billingReadinessChecksQueryKey,
  type CompletedBillingPackage,
  type BillingReadinessCheck,
} from "@/lib/workflow/billingPipelineApi";

const PAID_PACKAGE_STATUSES = new Set([
  "completed_package",
  "added_to_invoice",
  "invoiced",
  "closed",
]);

function formatDos(value: string | null | undefined): string {
  if (!value) return "—";
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return value;
  const [yyyy, mm, dd] = parts;
  return new Date(yyyy, mm - 1, dd).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function packageDos(pkg: CompletedBillingPackage): string | null {
  if (pkg.dos) return pkg.dos;
  const meta = pkg.metadata;
  if (meta && typeof meta === "object") {
    const v = (meta as Record<string, unknown>).dos;
    if (typeof v === "string") return v;
  }
  return null;
}

function readinessDos(c: BillingReadinessCheck): string | null {
  const meta = c.metadata;
  if (meta && typeof meta === "object") {
    const v = (meta as Record<string, unknown>).dos;
    if (typeof v === "string") return v;
  }
  return c.readyAt ? c.readyAt.slice(0, 10) : null;
}

function packagePaidAmount(pkg: CompletedBillingPackage): string | null {
  if (!pkg.fullAmountPaid) return null;
  const n = parseFloat(pkg.fullAmountPaid);
  if (Number.isNaN(n)) return pkg.fullAmountPaid;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function invoiceLineId(pkg: CompletedBillingPackage): number | null {
  const meta = pkg.metadata;
  if (meta && typeof meta === "object") {
    const v = (meta as Record<string, unknown>).invoiceLineItemId;
    if (typeof v === "number") return v;
  }
  return null;
}

function invoiceId(pkg: CompletedBillingPackage): number | null {
  const meta = pkg.metadata;
  if (meta && typeof meta === "object") {
    const v = (meta as Record<string, unknown>).invoiceId;
    if (typeof v === "number") return v;
  }
  return null;
}

export function CanonicalBillingPanel() {
  const { data: packages = [] } = useQuery<CompletedBillingPackage[]>({
    queryKey: completedBillingPackagesQueryKey({ limit: 50 }),
    queryFn: () => fetchCompletedBillingPackages({ limit: 50 }),
    staleTime: 30_000,
  });

  const { data: readinessChecks = [] } = useQuery<BillingReadinessCheck[]>({
    queryKey: billingReadinessChecksQueryKey({ limit: 50 }),
    queryFn: () => fetchBillingReadinessChecks({ limit: 50 }),
    staleTime: 30_000,
  });

  const buckets = useMemo(() => {
    // Strong-key dedup: a readiness row is "covered" by a package when
    // (patientScreeningId, serviceType) matches (or executionCaseId fallback).
    const coveredKey = new Set<string>();
    for (const p of packages) {
      const psId = p.patientScreeningId ?? p.executionCaseId ?? null;
      if (psId !== null) coveredKey.add(`${psId}|${p.serviceType}`);
    }

    const readyForPackage = readinessChecks.filter((c) => {
      if (c.readinessStatus !== "ready_to_generate") return false;
      const psId = c.patientScreeningId ?? c.executionCaseId ?? null;
      if (psId === null) return true;
      return !coveredKey.has(`${psId}|${c.serviceType}`);
    });

    const missingDocs = readinessChecks.filter(
      (c) => c.readinessStatus === "missing_requirements" && c.missingRequirements.length > 0,
    );

    const readyForPayment = packages.filter((p) => p.packageStatus === "pending_payment");

    const paid = packages.filter(
      (p) => PAID_PACKAGE_STATUSES.has(p.packageStatus) || p.paymentStatus === "updated",
    );

    return { readyForPackage, missingDocs, readyForPayment, paid };
  }, [packages, readinessChecks]);

  const totalRows =
    buckets.readyForPackage.length +
    buckets.missingDocs.length +
    buckets.readyForPayment.length +
    buckets.paid.length;

  if (totalRows === 0) return null;

  return (
    <div className="px-5 py-4" data-testid="canonical-billing-panel">
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadyForPackageSection rows={buckets.readyForPackage} />
        <ReadyForPaymentSection rows={buckets.readyForPayment} />
        <PaidSection rows={buckets.paid} />
        <MissingDocsSection rows={buckets.missingDocs} />
      </div>
    </div>
  );
}

// ─── Section: Ready for billing package ──────────────────────────────────────

function ReadyForPackageSection({ rows }: { rows: BillingReadinessCheck[] }) {
  return (
    <section className="finance-card p-4" data-testid="billing-section-ready-for-package">
      <SectionHeader
        icon={ClipboardCheck}
        iconClass="text-finance-cta-blue"
        title="Ready for billing package"
        count={rows.length}
      />
      {rows.length === 0 ? (
        <EmptyState message="No billing-ready patients found." />
      ) : (
        <ul className="divide-y divide-finance-border">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 py-2.5"
              data-testid={`billing-ready-package-${r.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-finance-text">
                  {r.patientName ?? "—"}
                </div>
                <div className="truncate text-xs text-finance-text-secondary">
                  {[r.serviceType, r.facilityId, formatDos(readinessDos(r))]
                    .filter((s): s is string => !!s && s !== "—")
                    .join(" · ") || "—"}
                </div>
              </div>
              <span className="finance-status-pill bg-finance-green-soft text-emerald-700 border-emerald-100">
                Ready
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Section: Ready for payment ──────────────────────────────────────────────

function ReadyForPaymentSection({ rows }: { rows: CompletedBillingPackage[] }) {
  return (
    <section className="finance-card p-4" data-testid="billing-section-ready-for-payment">
      <SectionHeader
        icon={Wallet}
        iconClass="text-finance-cta-sand"
        title="Ready for payment"
        count={rows.length}
      />
      {rows.length === 0 ? (
        <EmptyState message="No packages awaiting payment." />
      ) : (
        <ul className="divide-y divide-finance-border">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 py-2.5"
              data-testid={`billing-ready-payment-${p.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-finance-text">
                  {p.patientInitials ?? p.patientName ?? "—"}
                </div>
                <div className="truncate text-xs text-finance-text-secondary">
                  {[p.serviceType, p.facilityId, formatDos(packageDos(p))]
                    .filter((s): s is string => !!s && s !== "—")
                    .join(" · ") || "—"}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="finance-status-pill bg-finance-sand-soft text-amber-800 border-amber-100">
                  Awaiting payment
                </span>
                <PackagePayAction pkg={p} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Section: Paid / Added to invoice ────────────────────────────────────────

function PaidSection({ rows }: { rows: CompletedBillingPackage[] }) {
  return (
    <section className="finance-card p-4" data-testid="billing-section-paid">
      <SectionHeader
        icon={CheckCircle2}
        iconClass="text-finance-cta-green"
        title="Paid / Added to invoice"
        count={rows.length}
      />
      {rows.length === 0 ? (
        <EmptyState message="No paid packages yet." />
      ) : (
        <ul className="divide-y divide-finance-border">
          {rows.map((p) => {
            const liId = invoiceLineId(p);
            const invId = invoiceId(p);
            const paid = packagePaidAmount(p);
            const onInvoice = liId !== null;
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-2.5"
                data-testid={`billing-paid-${p.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-finance-text">
                    {p.patientInitials ?? p.patientName ?? "—"}
                  </div>
                  <div className="truncate text-xs text-finance-text-secondary">
                    {[p.serviceType, formatDos(packageDos(p)), paid]
                      .filter((s): s is string => !!s && s !== "—")
                      .join(" · ") || "—"}
                  </div>
                  {(liId !== null || invId !== null) && (
                    <div className="mt-0.5 truncate text-[11px] text-finance-text-muted">
                      {liId !== null && (
                        <span data-testid={`billing-paid-line-${p.id}`}>
                          Invoice line #{liId}
                        </span>
                      )}
                      {liId !== null && invId !== null && (
                        <span> · </span>
                      )}
                      {invId !== null && (
                        <span data-testid={`billing-paid-invoice-${p.id}`}>
                          Invoice #{invId}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <span
                  className={
                    onInvoice
                      ? "finance-status-pill bg-finance-green-soft text-emerald-700 border-emerald-100"
                      : "finance-status-pill bg-finance-blue-soft text-blue-700 border-blue-100"
                  }
                >
                  {onInvoice ? "Added to invoice" : "Paid"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Section: Missing documents ──────────────────────────────────────────────

function MissingDocsSection({ rows }: { rows: BillingReadinessCheck[] }) {
  return (
    <section className="finance-card p-4" data-testid="billing-section-missing-docs">
      <SectionHeader
        icon={AlertCircle}
        iconClass="text-finance-cta-lavender"
        title="Missing documents"
        count={rows.length}
      />
      {rows.length === 0 ? (
        <EmptyState message="No missing-document items." />
      ) : (
        <ul className="divide-y divide-finance-border">
          {rows.map((r) => (
            <li
              key={r.id}
              className="py-2.5"
              data-testid={`billing-missing-docs-${r.id}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-finance-text">
                    {r.patientName ?? "—"}
                  </div>
                  <div className="truncate text-xs text-finance-text-secondary">
                    {[r.serviceType, r.facilityId]
                      .filter((s): s is string => !!s)
                      .join(" · ") || "—"}
                  </div>
                </div>
                <span className="finance-status-pill bg-finance-pink-soft text-rose-700 border-rose-100">
                  Missing {r.missingRequirements.length}
                </span>
              </div>
              <div className="mt-1.5 text-[11px] text-finance-text-muted">
                Missing: {r.missingRequirements.join(", ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  iconClass,
  title,
  count,
}: {
  icon: typeof Wallet;
  iconClass: string;
  title: string;
  count: number;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className={`h-4 w-4 ${iconClass}`} />
      <span className="text-sm font-semibold text-finance-text">{title}</span>
      <Badge
        variant="outline"
        className="ml-auto rounded-full border-finance-border bg-finance-bg-soft px-2 py-0 text-[10px] font-medium text-finance-text-secondary"
      >
        {count}
      </Badge>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-3 text-center text-xs text-finance-text-muted">{message}</div>
  );
}

// ─── Pay action (unchanged behavior) ─────────────────────────────────────────

function PackagePayAction({ pkg }: { pkg: CompletedBillingPackage }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [fullAmountPaid, setFullAmountPaid] = useState<string>(pkg.fullAmountPaid ?? "");
  const [paymentDate, setPaymentDate] = useState<string>(
    pkg.paymentDate ?? new Date().toISOString().slice(0, 10),
  );
  const [adminOverride, setAdminOverride] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        executionCaseId: pkg.executionCaseId ?? undefined,
        patientScreeningId: pkg.patientScreeningId ?? undefined,
        serviceType: pkg.serviceType,
        fullAmountPaid: fullAmountPaid.trim(),
        paymentDate: paymentDate || undefined,
        facilityId: pkg.facilityId ?? undefined,
        adminOverride: adminOverride || undefined,
      };
      const res = await apiRequest("POST", "/api/billing/complete-package-payment", body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to complete payment");
      }
      return data as {
        ok: boolean;
        invoiceLineItem: { id: number; totalCharges: string } | null;
        invoiceTotals: { invoiceId: number; totalCharges: string } | null;
      };
    },
    onSuccess: (data) => {
      if (data.invoiceLineItem) {
        setResultMessage(
          `Payment recorded · invoice line #${data.invoiceLineItem.id} added to invoice ${data.invoiceTotals?.invoiceId ?? "—"}.`,
        );
      } else {
        setResultMessage(
          "Payment recorded but invoice line was not created because no Draft invoice exists.",
        );
      }
      toast({ title: "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/completed-billing-packages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-readiness-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-journey-events"] });
    },
    onError: (e: Error) => {
      setResultMessage(`Could not record payment: ${e.message}`);
      toast({ title: "Could not record payment", description: e.message, variant: "destructive" });
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResultMessage(null);
          setOpen(true);
        }}
        className="rounded-full border border-finance-border-strong bg-white px-2.5 py-1 text-[11px] font-medium text-finance-text hover:bg-finance-bg-soft"
        data-testid={`canonical-package-pay-${pkg.id}`}
      >
        Pay
      </button>
      {open && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-sm" data-testid="canonical-package-pay-dialog">
            <DialogHeader>
              <DialogTitle className="text-base">Complete package payment</DialogTitle>
              <p className="text-xs text-finance-text-secondary">
                {(pkg.patientInitials ?? pkg.patientName ?? "—") + " · " + pkg.serviceType}
              </p>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <Label className="text-xs font-semibold text-finance-text">
                  Full amount paid
                </Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={fullAmountPaid}
                  onChange={(e) => setFullAmountPaid(e.target.value)}
                  placeholder="e.g. 500.00"
                  className="mt-1.5 rounded-xl text-sm"
                  data-testid="canonical-package-pay-amount"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-finance-text">Payment date</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="mt-1.5 rounded-xl text-sm"
                  data-testid="canonical-package-pay-date"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-finance-text">
                <input
                  type="checkbox"
                  checked={adminOverride}
                  onChange={(e) => setAdminOverride(e.target.checked)}
                  data-testid="canonical-package-pay-override"
                />
                Admin override (skip readiness gate)
              </label>
              {resultMessage && (
                <div
                  className="rounded-xl border border-finance-border bg-finance-bg-soft px-3 py-2 text-[11px] text-finance-text"
                  data-testid="canonical-package-pay-result"
                >
                  {resultMessage}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  data-testid="canonical-package-pay-close"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  disabled={submit.isPending || !fullAmountPaid.trim()}
                  onClick={() => submit.mutate()}
                  data-testid="canonical-package-pay-submit"
                >
                  {submit.isPending ? "Saving…" : "Submit payment"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
