// AcsWorkflowPanel — Phase 2 PR 2.5
//
// Renders the ACS workflow snapshot for an execution case in the
// center patient canvas. Each status is derived honestly from the
// canonical sources via /api/acs-workflow/:executionCaseId; pending
// states are shown explicitly, never faked.

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  fetchAcsWorkflowSnapshot,
  statusTone,
  ACS_STATUS_LABELS,
  type AcsWorkflowSnapshot,
  type AcsWorkflowStatus,
} from "@/lib/portal/acsWorkflowApi";
import { isCanonicalAppointmentUiEnabled } from "@/lib/canonicalAppointmentUiFlag";
import { CanonicalAppointmentSummary } from "@/components/canonical/CanonicalAppointmentSummary";

type Props = { executionCaseId: number };

function toneClass(tone: "good" | "pending" | "warn"): string {
  if (tone === "good") return "bg-emerald-100 text-emerald-900";
  if (tone === "warn") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

export function AcsWorkflowPanel({ executionCaseId }: Props) {
  const { data, isLoading, isError } = useQuery<AcsWorkflowSnapshot | null>({
    queryKey: ["acs-workflow-snapshot", executionCaseId],
    queryFn: () => fetchAcsWorkflowSnapshot(executionCaseId),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card className="p-3 bg-white" data-testid="acs-workflow-panel-loading">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading ACS workflow…
        </div>
      </Card>
    );
  }
  if (isError || !data) return null;

  return (
    <Card className="p-3 bg-white" data-testid="acs-workflow-panel">
      <div className="mb-2 text-sm font-semibold text-slate-900">ACS workflow</div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {data.statuses.map((s: AcsWorkflowStatus) => (
          <span
            key={s}
            className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${toneClass(statusTone(s))}`}
            data-testid={`acs-workflow-status-${s}`}
          >
            {ACS_STATUS_LABELS[s]}
          </span>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Documents</div>
          {data.documentReadiness.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic">No document readiness rows.</div>
          ) : (
            <ul className="space-y-1">
              {data.documentReadiness.map((d) => (
                <li
                  key={d.documentType}
                  className="text-[11px] text-slate-700 flex items-center justify-between gap-2"
                  data-testid={`acs-doc-${d.documentType}`}
                >
                  <span className="capitalize">{d.documentType.replace(/_/g, " ")}</span>
                  <span className="text-[10px] text-slate-500">{d.documentStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Billing checks</div>
          {data.billingChecks.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic">No billing checks yet.</div>
          ) : (
            <ul className="space-y-1">
              {data.billingChecks.map((c, i) => (
                <li
                  key={`${c.serviceType}-${i}`}
                  className="text-[11px] text-slate-700 flex items-center justify-between gap-2"
                  data-testid={`acs-billing-${c.serviceType}-${i}`}
                >
                  <span className="capitalize">{c.serviceType.replace(/_/g, " ")}</span>
                  <span className="text-[10px] text-slate-500">{c.readinessStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Phase 2D-C2 — canonical per-service appointment (flag ON). The
          server projection is the source of truth; a cancelled/no_show/
          rescheduled prior event never shows as active. Falls back to
          the legacy nextScheduleEvent line when the UI flag is OFF. */}
      {isCanonicalAppointmentUiEnabled() && data.appointmentByService
        ? Object.entries(data.appointmentByService).map(([serviceType, projection]) => (
            <div className="mt-3" key={serviceType}>
              <CanonicalAppointmentSummary
                projection={projection}
                serviceType={serviceType}
                showHistory
                data-testid={`acs-canonical-appointment-${serviceType}`}
              />
            </div>
          ))
        : data.nextScheduleEvent ? (
          <div className="mt-3 text-[11px] text-slate-600">
            Next: {data.nextScheduleEvent.serviceType ?? "ancillary"} ·{" "}
            {data.nextScheduleEvent.status} ·{" "}
            {new Date(data.nextScheduleEvent.startsAt).toLocaleString()}
          </div>
        ) : null}

      {/* Phase 2 hardening item 4 — explicit physician-signing
          pending block. When the workflow surfaces the
          physician_signature_pending status, we show an explicit
          honest message instead of letting the small status pill
          stand alone. No fake "sign now" button. */}
      {data.statuses.includes("physician_signature_pending") ? (
        <div
          className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900"
          data-testid="acs-physician-signing-pending-block"
        >
          <div className="font-semibold">Physician signing pending</div>
          <div>
            Physician signing writer not configured yet — the order
            note is present but no canonical
            <code className="mx-1">physician_signed_order</code>
            writer / route exists. See
            docs/architecture/phase-2-hardening-physician-signing.md.
          </div>
        </div>
      ) : null}
    </Card>
  );
}
