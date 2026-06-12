import { useState, useEffect, useMemo } from "react";
import { Printer, Users2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { PatientScreening } from "@shared/schema";
import { orderPatientsWithinRun } from "@/lib/qualificationRunOrdering";

interface PdfPatientSelectDialogProps {
  open: boolean;
  mode: "clinician" | "plexus" | null;
  patients: PatientScreening[];
  onClose: () => void;
  onGenerate: (selected: PatientScreening[]) => void;
}

export default function PdfPatientSelectDialog({
  open,
  mode,
  patients,
  onClose,
  onGenerate,
}: PdfPatientSelectDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set(patients.map(p => p.id)));
  }, [open, patients]);

  // Phase 1 ordering: outreach alphabetical, visit by appointment time.
  // Same helper as PlexusIQRunOrganizationPanel + the PDF packet group
  // dialog so the order on screen matches the order in the generated PDF.
  const ordered = useMemo(() => {
    const rows = patients.map((p) => ({
      batchId: 0,
      batchCreatedAt: "",
      patientType: (p.patientType ?? "visit") as "visit" | "outreach" | string,
      patientId: p.id,
      name: p.name,
      appointmentTime: p.time ?? null,
    }));
    const orderedRows = orderPatientsWithinRun(rows);
    const byId = new Map(patients.map((p) => [p.id, p]));
    return orderedRows.map((r) => byId.get(r.patientId)!).filter(Boolean);
  }, [patients]);

  const allSelected = selected.size === ordered.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ordered.map(p => p.id)));
  const toggle = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const title = mode === "clinician" ? "Clinician PDF" : "Plexus Team PDF";
  const desc = mode === "clinician"
    ? "Select patients to include. Each gets a page with Dx/Hx/Rx and clinician reasoning per test."
    : "Select patients to include. Each gets a page with chart summary, test explanations, and conversation scripts.";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-pdf-select">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "clinician" ? <Printer className="w-4 h-4 text-slate-500" /> : <Users2 className="w-4 h-4 text-slate-500" />}
            {title}
          </DialogTitle>
          <p className="text-xs text-slate-500 mt-1">{desc}</p>
        </DialogHeader>

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div
            className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200"
            data-testid="checkbox-select-all-patients"
          >
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              id="select-all"
            />
            <Label htmlFor="select-all" className="text-sm font-semibold cursor-pointer select-none flex-1">
              Select all patients
            </Label>
            <span className="text-xs font-semibold text-slate-500">{selected.size}/{ordered.length}</span>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
            {ordered.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-2.5"
                data-testid={`checkbox-patient-pdf-${p.id}`}
              >
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                  id={`pdf-p-${p.id}`}
                />
                <Label htmlFor={`pdf-p-${p.id}`} className="flex-1 min-w-0 cursor-pointer select-none">
                  <span className="text-sm font-medium block">{p.name}</span>
                  <span className="text-[11px] text-slate-400">{[p.time, p.age ? `${p.age}yo` : "", p.gender].filter(Boolean).join(" · ")}</span>
                </Label>
                {(p.qualifyingTests || []).length > 0 && (
                  <span className="text-[10px] font-semibold text-emerald-600 shrink-0">{(p.qualifyingTests || []).length} tests</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-pdf-cancel">Cancel</Button>
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={() => onGenerate(ordered.filter(p => selected.has(p.id)))}
            className="gap-1.5"
            data-testid="button-pdf-generate"
          >
            {mode === "clinician" ? <Printer className="w-3.5 h-3.5" /> : <Users2 className="w-3.5 h-3.5" />}
            Generate PDF ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
