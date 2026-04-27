import { useQuery } from "@tanstack/react-query";
import { Wallet, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
