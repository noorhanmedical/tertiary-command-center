import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Stethoscope, FileText, Pill, ClipboardList } from "lucide-react";
import type { PatientScreening } from "@shared/schema";

interface ClinicalDataEditorProps {
  patient: PatientScreening;
  localDx: string;
  setLocalDx: (v: string) => void;
  localHx: string;
  setLocalHx: (v: string) => void;
  localRx: string;
  setLocalRx: (v: string) => void;
  localPrevTests: string;
  setLocalPrevTests: (v: string) => void;
  localPrevTestsDate: string;
  setLocalPrevTestsDate: (v: string) => void;
  localNoPrevTests: boolean;
  setLocalNoPrevTests: (v: boolean) => void;
  onUpdate: (field: string, value: string | string[] | boolean) => void;
  onExtractDate: (text: string) => string | null;
}

export function ClinicalDataEditor({
  patient,
  localDx, setLocalDx,
  localHx, setLocalHx,
  localRx, setLocalRx,
  localPrevTests, setLocalPrevTests,
  localPrevTestsDate, setLocalPrevTestsDate,
  localNoPrevTests, setLocalNoPrevTests,
  onUpdate,
  onExtractDate,
}: ClinicalDataEditorProps) {
  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <div>
        <label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5 mb-1.5">
          <Stethoscope className="w-3.5 h-3.5" /> Dx (Diagnoses)
        </label>
        <Textarea
          placeholder="HTN, DM2, HLD..."
          className="min-h-[70px] resize-none text-sm"
          value={localDx}
          onChange={(e) => setLocalDx(e.target.value)}
          onBlur={() => { if (localDx !== (patient.diagnoses || "")) onUpdate("diagnoses", localDx); }}
          data-testid={`input-dx-${patient.id}`}
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5 mb-1.5">
          <FileText className="w-3.5 h-3.5" /> Hx (History / PMH)
        </label>
        <Textarea
          placeholder="CAD, CVA, PAD..."
          className="min-h-[70px] resize-none text-sm"
          value={localHx}
          onChange={(e) => setLocalHx(e.target.value)}
          onBlur={() => { if (localHx !== (patient.history || "")) onUpdate("history", localHx); }}
          data-testid={`input-hx-${patient.id}`}
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5 mb-1.5">
          <Pill className="w-3.5 h-3.5" /> Rx (Medications)
        </label>
        <Textarea
          placeholder="Metformin, Lisinopril..."
          className="min-h-[70px] resize-none text-sm"
          value={localRx}
          onChange={(e) => setLocalRx(e.target.value)}
          onBlur={() => { if (localRx !== (patient.medications || "")) onUpdate("medications", localRx); }}
          data-testid={`input-rx-${patient.id}`}
        />
      </div>
      <div className="col-span-1 md:col-span-2 lg:col-span-4">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" />
            Previous Tests
            {!localNoPrevTests && <span className="text-red-500 font-bold ml-0.5">*</span>}
          </label>
          <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none" data-testid={`label-no-prev-tests-${patient.id}`}>
            <input
              type="checkbox"
              checked={localNoPrevTests}
              onChange={(e) => {
                const checked = e.target.checked;
                setLocalNoPrevTests(checked);
                if (checked) {
                  setLocalPrevTests("");
                  setLocalPrevTestsDate("");
                  onUpdate("noPreviousTests", true);
                  onUpdate("previousTests", "");
                  onUpdate("previousTestsDate", "");
                } else {
                  onUpdate("noPreviousTests", false);
                }
              }}
              className="w-3.5 h-3.5 accent-primary"
              data-testid={`checkbox-no-prev-tests-${patient.id}`}
            />
            <span className="text-xs text-muted-foreground">No previous tests</span>
          </label>
        </div>
        <div className={`flex gap-2 ${localNoPrevTests ? "opacity-40 pointer-events-none" : ""}`}>
          <Textarea
            placeholder="Echo TTE 01/2024, Carotid Duplex 06/2023..."
            className={`min-h-[60px] resize-none text-sm flex-1 ${!localNoPrevTests && !localPrevTests ? "border-red-300 focus-visible:ring-red-300" : ""}`}
            value={localPrevTests}
            disabled={localNoPrevTests}
            onChange={(e) => setLocalPrevTests(e.target.value)}
            onBlur={() => {
              if (localPrevTests !== (patient.previousTests || "")) {
                onUpdate("previousTests", localPrevTests);
                const extracted = onExtractDate(localPrevTests);
                if (extracted && extracted !== localPrevTestsDate) {
                  setLocalPrevTestsDate(extracted);
                  onUpdate("previousTestsDate", extracted);
                }
              }
            }}
            data-testid={`input-prev-tests-${patient.id}`}
          />
          <div className="flex flex-col gap-1 w-32 shrink-0">
            <label className="text-xs text-muted-foreground font-medium">Most Recent Date</label>
            <Input
              placeholder="YYYY-MM-DD"
              value={localPrevTestsDate}
              disabled={localNoPrevTests}
              onChange={(e) => setLocalPrevTestsDate(e.target.value)}
              onBlur={() => { if (localPrevTestsDate !== (patient.previousTestsDate || "")) onUpdate("previousTestsDate", localPrevTestsDate); }}
              className="h-8 text-xs px-2"
              data-testid={`input-prev-tests-date-${patient.id}`}
            />
          </div>
        </div>
        {!localNoPrevTests && !localPrevTests && (
          <p className="text-xs text-red-500 mt-1" data-testid={`text-prev-tests-required-${patient.id}`}>Required — enter previous tests or check "No previous tests"</p>
        )}
      </div>
    </div>
  );
}
