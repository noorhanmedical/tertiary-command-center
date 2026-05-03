import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Wallet, ClipboardCheck } from "lucide-react";
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

const PACKAGE_STATUS_TONE: Record<string, string> = {
  pending_payment: "bg-amber-50 text-amber-700 border-amber-200",
  payment_updated: "bg-blue-50 text-blue-700 border-blue-200",
  completed_package: "bg-emerald-50 text-emerald-700 border-emerald-200",
  added_to_invoice: "bg-violet-50 text-violet-700 border-violet-200",
  invoiced: "bg-indigo-50 text-indigo-700 border-indigo-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
};

const READINESS_STATUS_TONE: Record<string, string> = {
  not_ready: "bg-slate-50 text-slate-600 border-slate-200",
  missing_requirements: "bg-amber-50 text-amber-700 border-amber-200",
  ready_to_generate: "bg-emerald-50 text-emerald-700 border-emerald-200",
  billing_document_generated: "bg-blue-50 text-blue-700 border-blue-200",
  sent_to_billing: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

function tone(map: Record<string, string>, key: string): string {
  return map[key] ?? "bg-slate-50 text-slate-600 border-slate-200";
}

export function CanonicalBillingPanel() {
  const { data: packages = [] } = useQuery<CompletedBillingPackage[]>({
    queryKey: completedBillingPackagesQueryKey({ limit: 5 }),
    queryFn: () => fetchCompletedBillingPackages({ limit: 5 }),
    staleTime: 30_000,
  });

  const { data: readinessChecks = [] } = useQuery<BillingReadinessCheck[]>({
    queryKey: billingReadinessChecksQueryKey({ limit: 5 }),
    queryFn: () => fetchBillingReadinessChecks({ limit: 5 }),
    staleTime: 30_000,
  });

  if (packages.length === 0 && readinessChecks.length === 0) return null;

  return (
    <div
      className="border-b border-slate-200 bg-slate-50/60 px-5 py-3"
      data-testid="canonical-billing-panel"
    >
      <div className="grid gap-3 md:grid-cols-2">
        {/* Completed Packages */}
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-xs font-semibold text-slate-700">Completed Packages</span>
            <Badge variant="outline" className="ml-auto rounded-full px-2 py-0 text-[10px]">
              {packages.length}
            </Badge>
          </div>
          {packages.length === 0 ? (
            <div className="text-[11px] text-slate-400">No packages yet.</div>
          ) : (
            <ul className="space-y-1">
              {packages.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 text-[11px]"
                  data-testid={`canonical-package-${p.id}`}
                >
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-slate-700">
                      {p.patientInitials ?? p.patientName ?? "—"}
                    </span>
                    <span className="ml-1.5 text-slate-500">· {p.serviceType}</span>
                    {p.fullAmountPaid && (
                      <span className="ml-1.5 text-slate-500">· ${p.fullAmountPaid}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] ${tone(PACKAGE_STATUS_TONE, p.packageStatus)}`}
                    >
                      {p.packageStatus}
                    </span>
                    <PackagePayAction pkg={p} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Readiness Checks */}
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-xs font-semibold text-slate-700">Billing Readiness</span>
            <Badge variant="outline" className="ml-auto rounded-full px-2 py-0 text-[10px]">
              {readinessChecks.length}
            </Badge>
          </div>
          {readinessChecks.length === 0 ? (
            <div className="text-[11px] text-slate-400">No readiness checks yet.</div>
          ) : (
            <ul className="space-y-1">
              {readinessChecks.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 text-[11px]"
                  data-testid={`canonical-readiness-${c.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="font-medium text-slate-700">{c.patientName ?? "—"}</span>
                      <span className="ml-1.5 text-slate-500">· {c.serviceType}</span>
                    </div>
                    {c.missingRequirements.length > 0 && (
                      <div className="truncate text-[10px] text-slate-400">
                        missing: {c.missingRequirements.join(", ")}
                      </div>
                    )}
                  </div>
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] ${tone(READINESS_STATUS_TONE, c.readinessStatus)}`}
                  >
                    {c.readinessStatus}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

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
          `Invoice line ${data.invoiceLineItem.id} created · totalCharges $${data.invoiceLineItem.totalCharges} (invoice ${data.invoiceTotals?.invoiceId ?? "?"} totalCharges $${data.invoiceTotals?.totalCharges ?? "?"})`,
        );
      } else {
        setResultMessage(
          "Payment recorded but no invoice line was added (no Draft invoice exists for this facility).",
        );
      }
      toast({ title: "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/completed-billing-packages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-readiness-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-journey-events"] });
    },
    onError: (e: Error) => {
      setResultMessage(`Error: ${e.message}`);
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
        className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
        data-testid={`canonical-package-pay-${pkg.id}`}
      >
        Pay
      </button>
      {open && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-sm" data-testid="canonical-package-pay-dialog">
            <DialogHeader>
              <DialogTitle className="text-base">Complete package payment</DialogTitle>
              <p className="text-xs text-slate-500">
                {(pkg.patientInitials ?? pkg.patientName ?? "—") + " · " + pkg.serviceType}
              </p>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <Label className="text-xs font-semibold text-slate-700">
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
                <Label className="text-xs font-semibold text-slate-700">Payment date</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="mt-1.5 rounded-xl text-sm"
                  data-testid="canonical-package-pay-date"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700">
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
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700"
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
