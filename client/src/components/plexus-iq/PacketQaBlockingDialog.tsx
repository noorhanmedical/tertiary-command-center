// Plexus IQ Packet QA Gate — pre-print blocking dialog.
//
// Opens when `auditPacketPatients` returns at least one blocked patient.
// Renders a patient-level missing-field report and forces the operator
// to choose:
//   - Cancel (default)
//   - Print N safe rows (excludes M blocked)
//
// Does NOT auto-regenerate reasoning, does NOT silently exclude rows.
// Excluded rows are visible to the operator before they confirm.

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Printer } from "lucide-react";
import type { PacketQaReport } from "@/lib/packetQa";

export type PacketQaBlockingDialogProps = {
  open: boolean;
  report: PacketQaReport | null;
  onCancel: () => void;
  /** Called with the printable patient subset when the operator
   *  confirms "Print N safe rows". Caller is responsible for opening
   *  the preview with that subset. */
  onProceed: () => void;
};

export function PacketQaBlockingDialog({
  open,
  report,
  onCancel,
  onProceed,
}: PacketQaBlockingDialogProps) {
  if (!report) return null;
  const modeLabel = report.mode === "plexus" ? "Plexus" : "Clinician";
  const printableCount = report.total - report.blockedCount;
  const canPrintSubset = printableCount > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent
        className="max-w-2xl"
        data-testid="packet-qa-blocking-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {modeLabel} Packet — pre-print check found problems
          </DialogTitle>
          <DialogDescription>
            {report.blockedCount} of {report.total} selected patient{report.total === 1 ? "" : "s"} {report.blockedCount === 1 ? "is" : "are"} missing
            required data for the {modeLabel} Packet. Review below.
            Nothing is regenerated automatically.
          </DialogDescription>
        </DialogHeader>

        <div
          className="max-h-[55vh] overflow-y-auto rounded-md border border-amber-200 bg-amber-50/30"
          data-testid="packet-qa-blocked-list"
        >
          <ul className="divide-y divide-amber-100">
            {report.blockedPatients.map((p) => (
              <li
                key={p.patientId}
                className="px-3 py-2"
                data-testid={`packet-qa-blocked-row-${p.patientId}`}
              >
                <div className="text-[12px] font-semibold text-slate-900">
                  #{p.patientId} · {p.patientName}
                </div>
                <ul className="mt-1 space-y-0.5 text-[11px] text-rose-700">
                  {p.blockers.map((b, idx) => (
                    <li
                      key={`${p.patientId}-b-${idx}`}
                      data-testid={`packet-qa-blocker-${p.patientId}-${b.kind}`}
                    >
                      • {b.message}
                    </li>
                  ))}
                </ul>
                {p.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[10px] text-amber-700">
                    {p.warnings.slice(0, 4).map((w, idx) => (
                      <li key={`${p.patientId}-w-${idx}`}>
                        warning: {w.message}
                      </li>
                    ))}
                    {p.warnings.length > 4 && (
                      <li className="italic opacity-70">
                        and {p.warnings.length - 4} more warning{p.warnings.length - 4 === 1 ? "" : "s"}
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="mt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            data-testid="packet-qa-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canPrintSubset}
            onClick={onProceed}
            className="rounded-full bg-indigo-600 px-4 text-white hover:bg-indigo-700 disabled:opacity-40"
            data-testid="packet-qa-proceed-with-subset"
            title={
              canPrintSubset
                ? `Excludes ${report.blockedCount} blocked patient${report.blockedCount === 1 ? "" : "s"}`
                : "Every selected patient is blocked"
            }
          >
            <Printer className="mr-1 h-3.5 w-3.5" />
            {canPrintSubset
              ? `Print ${printableCount} safe row${printableCount === 1 ? "" : "s"} (excludes ${report.blockedCount})`
              : "Nothing to print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
