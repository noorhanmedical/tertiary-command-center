// PDF / packet patient selection dialog (Batch B15).
//
// Renders before the PDF preview / print so the user can uncheck
// patients they don't want included. Sorts outreach alphabetically and
// visit by appointment time, matching qualificationRunOrdering.
//
// Does NOT modify the existing PDF visual format — it only narrows
// the patient roster handed to generateClinicianPDF / generatePlexusPDF.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Printer, Save } from "lucide-react";
import { orderPatientsWithinRun, type RunSourceRow } from "@/lib/qualificationRunOrdering";

export type PacketPatient = RunSourceRow & {
  patientScreeningId: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: ReadonlyArray<PacketPatient>;
  onConfirm: (selected: ReadonlyArray<PacketPatient>) => void;
  /** What the confirm button does — print or save. Just changes the label/icon. */
  mode?: "print" | "save";
};

export function PacketPatientSelectionDialog({
  open,
  onOpenChange,
  patients,
  onConfirm,
  mode = "print",
}: Props) {
  const ordered = useMemo(() => orderPatientsWithinRun(patients), [patients]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) setSelectedIds(new Set(ordered.map((p) => p.patientScreeningId)));
  }, [open, ordered]);

  const totalChecked = selectedIds.size;
  const ConfirmIcon = mode === "save" ? Save : Printer;
  const ConfirmLabel = mode === "save" ? "Save selected" : "Print selected";

  function toggle(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function selectAll() {
    setSelectedIds(new Set(ordered.map((p) => p.patientScreeningId)));
  }
  function clearAll() {
    setSelectedIds(new Set());
  }

  function confirm() {
    const out = ordered.filter((p) => selectedIds.has(p.patientScreeningId));
    onConfirm(out);
    onOpenChange(false);
  }

  // Split for the rendered groups.
  const outreach = ordered.filter((p) => (p.patientType ?? "visit") === "outreach");
  const visit = ordered.filter((p) => (p.patientType ?? "visit") !== "outreach");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="packet-patient-selection-dialog">
        <DialogHeader>
          <DialogTitle>Select patients for the packet</DialogTitle>
          <DialogDescription>
            Outreach patients are sorted alphabetically. Visit patients are sorted by appointment time.
            Uncheck any patient you don't want included.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 flex items-center justify-between text-[12px]">
          <div className="text-slate-600">
            {totalChecked} of {ordered.length} selected
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={selectAll} data-testid="packet-select-all">
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearAll} data-testid="packet-clear-all">
              Clear all
            </Button>
          </div>
        </div>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {outreach.length > 0 ? (
            <section data-testid="packet-section-outreach">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Outreach · alphabetical
              </div>
              <ul className="space-y-1">
                {outreach.map((p) => (
                  <li
                    key={p.patientScreeningId}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5"
                    data-testid={`packet-row-${p.patientScreeningId}`}
                  >
                    <Checkbox
                      checked={selectedIds.has(p.patientScreeningId)}
                      onCheckedChange={() => toggle(p.patientScreeningId)}
                      aria-label={p.name}
                      data-testid={`packet-row-checkbox-${p.patientScreeningId}`}
                    />
                    <span className="flex-1 truncate text-[12px] text-slate-800">{p.name}</span>
                    <Badge variant="secondary" className="bg-slate-100 text-slate-600">outreach</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {visit.length > 0 ? (
            <section data-testid="packet-section-visit">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Visit · appointment time
              </div>
              <ul className="space-y-1">
                {visit.map((p) => (
                  <li
                    key={p.patientScreeningId}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5"
                    data-testid={`packet-row-${p.patientScreeningId}`}
                  >
                    <Checkbox
                      checked={selectedIds.has(p.patientScreeningId)}
                      onCheckedChange={() => toggle(p.patientScreeningId)}
                      aria-label={p.name}
                      data-testid={`packet-row-checkbox-${p.patientScreeningId}`}
                    />
                    <span className="flex-1 truncate text-[12px] text-slate-800">{p.name}</span>
                    <span className="text-[11px] text-slate-500">
                      {p.appointmentTime
                        ? new Date(p.appointmentTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="packet-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={totalChecked === 0}
            onClick={confirm}
            className="rounded-full bg-indigo-600 px-4 text-white hover:bg-indigo-700 disabled:opacity-40"
            data-testid="packet-confirm"
          >
            <ConfirmIcon className="mr-1 h-3.5 w-3.5" />
            {ConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
