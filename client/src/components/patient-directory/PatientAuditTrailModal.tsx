// Patient Audit Trail modal (Batch B10).
//
// Reads chronological events for a single patient. Today there's no
// dedicated patient_directory_events table (see Batch B4 migration
// plan), so the modal accepts caller-provided entries from the
// duplicate-warning engine + a future GET endpoint. When the endpoint
// is unavailable it shows a clear "source unavailable" state rather
// than crashing.

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  History,
  Upload,
  Brain,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRightCircle,
  Phone,
  PhoneOff,
  Ban,
  Clock4,
  FileText,
  FileSignature,
  Trash2,
  Undo2,
} from "lucide-react";
import type { DuplicateWarningResult } from "@/lib/patientDuplicateWarnings";
import type { PatientDirectoryEvent } from "@/lib/patientDirectoryAuditTypes";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientScreeningId: number | null;
  patientName?: string | null;
  /** Events the caller has on hand. Sorted client-side by occurredAt. */
  events?: ReadonlyArray<PatientDirectoryEvent> | null;
  /** Warning result (drives the header summary chips). */
  warningResult?: DuplicateWarningResult | null;
  /** True if the audit endpoint is still missing / not yet wired. */
  endpointUnavailable?: boolean;
};

const ICON_BY_KIND: Record<string, React.ComponentType<{ className?: string }>> = {
  patient_created: History,
  imported: Upload,
  qualification_generated: Brain,
  admin_review_approved: CheckCircle2,
  admin_review_rejected: XCircle,
  admin_review_needs_info: AlertCircle,
  sent_to_engagement: ArrowRightCircle,
  added_to_call_list: ArrowRightCircle,
  call_completed: Phone,
  call_callback_scheduled: Clock4,
  dnc_set: Ban,
  dnc_cleared: PhoneOff,
  cooldown_set: Clock4,
  cooldown_cleared: Clock4,
  prior_test_logged: FileText,
  packet_generated: FileSignature,
  document_uploaded: FileText,
  soft_deleted: Trash2,
  restored: Undo2,
  other: History,
};

const LABEL_BY_KIND: Record<string, string> = {
  patient_created: "Patient created",
  imported: "Imported from source",
  qualification_generated: "Qualification generated",
  admin_review_approved: "Admin Review approved",
  admin_review_rejected: "Admin Review rejected",
  admin_review_needs_info: "Admin Review marked as 'needs info'",
  sent_to_engagement: "Sent to Engagement Center",
  added_to_call_list: "Added to call list",
  call_completed: "Call completed",
  call_callback_scheduled: "Callback scheduled",
  dnc_set: "Do Not Contact set",
  dnc_cleared: "Do Not Contact cleared",
  cooldown_set: "Cooldown set",
  cooldown_cleared: "Cooldown cleared",
  prior_test_logged: "Prior ancillary test logged",
  packet_generated: "Patient packet generated",
  document_uploaded: "Document uploaded",
  soft_deleted: "Patient soft-deleted",
  restored: "Patient restored",
  other: "Other event",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function PatientAuditTrailModal({
  open,
  onOpenChange,
  patientScreeningId,
  patientName,
  events,
  warningResult,
  endpointUnavailable,
}: Props) {
  const sortedEvents = useMemo(() => {
    if (!events) return [];
    return events.slice().sort((a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );
  }, [events]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        data-testid="patient-audit-trail-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Patient audit trail
            {patientScreeningId != null ? (
              <span className="text-[12px] font-normal text-slate-500">#{patientScreeningId}</span>
            ) : null}
          </DialogTitle>
          {patientName ? (
            <DialogDescription>{patientName}</DialogDescription>
          ) : null}
        </DialogHeader>

        {warningResult && warningResult.warnings.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pb-2" data-testid="patient-audit-trail-warnings">
            {warningResult.warnings.map((w, i) => (
              <Badge
                key={`${w.kind}-${i}`}
                variant="secondary"
                className={[
                  "border text-[11px] font-semibold",
                  w.severity === "block"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : w.severity === "warn"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-slate-100 text-slate-700",
                ].join(" ")}
              >
                {w.message}
              </Badge>
            ))}
          </div>
        ) : null}

        {endpointUnavailable ? (
          <div
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-600"
            data-testid="patient-audit-trail-endpoint-unavailable"
          >
            The Patient EHR audit endpoint is not yet wired. The modal is
            showing only the events the calling surface had on hand
            (duplicate-warning context). Once the endpoint lands, the full
            history will appear here.
          </div>
        ) : null}

        <ScrollArea className="mt-2 max-h-[60vh] pr-2">
          {sortedEvents.length === 0 ? (
            <div
              className="py-8 text-center text-[12px] text-slate-500"
              data-testid="patient-audit-trail-empty"
            >
              No audit events available yet.
            </div>
          ) : (
            <ol className="space-y-2" data-testid="patient-audit-trail-list">
              {sortedEvents.map((event, idx) => {
                const Icon = ICON_BY_KIND[event.kind] ?? History;
                const label = LABEL_BY_KIND[event.kind] ?? event.kind;
                return (
                  <li
                    key={`${event.kind}-${event.occurredAt}-${idx}`}
                    className="flex gap-3 rounded-xl border border-slate-200 bg-white p-2.5"
                    data-testid={`patient-audit-trail-row-${idx}`}
                  >
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-[12px] font-medium text-slate-900">{label}</div>
                        <div className="text-[11px] text-slate-500">{formatDate(event.occurredAt)}</div>
                      </div>
                      {event.actorUserId ? (
                        <div className="text-[11px] text-slate-500">by {event.actorUserId}</div>
                      ) : null}
                      {event.payload && Object.keys(event.payload).length > 0 ? (
                        <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-slate-600">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
