import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { PatientScreening } from "@shared/schema";

export function CompletedTestsDialog({
  completeModalPatient,
  selectedCompletedTests,
  setSelectedCompletedTests,
  setCompleteModalPatient,
  onConfirm,
  isGenerating,
}: {
  completeModalPatient: PatientScreening | null;
  selectedCompletedTests: string[];
  setSelectedCompletedTests: React.Dispatch<React.SetStateAction<string[]>>;
  setCompleteModalPatient: (patient: PatientScreening | null) => void;
  onConfirm: () => Promise<void>;
  isGenerating: boolean;
}) {
  return (
    <Dialog
      open={!!completeModalPatient}
      onOpenChange={(open) => {
        if (!open && !isGenerating) {
          setCompleteModalPatient(null);
          setSelectedCompletedTests([]);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="dialog-complete-tests">
        <DialogHeader>
          <DialogTitle>Select completed tests</DialogTitle>
        </DialogHeader>

        {completeModalPatient && (
          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              Choose only the tests actually completed for {completeModalPatient.name}.
            </div>

            {isGenerating && (
              <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3">
                <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-blue-600 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-blue-900">
                    Generating ancillary documents
                  </div>
                  <div className="text-xs text-blue-700">
                    Please wait while the selected completed tests are turned into ancillary documents.
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
              {(completeModalPatient.qualifyingTests || []).map((test) => {
                const checked = selectedCompletedTests.includes(test);
                return (
                  <label
                    key={test}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${
                      isGenerating ? "border-slate-100 bg-slate-50 opacity-70" : "border-slate-200"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={isGenerating}
                      onCheckedChange={(value) => {
                        setSelectedCompletedTests((prev) =>
                          value
                            ? Array.from(new Set([...prev, test]))
                            : prev.filter((t) => t !== test)
                        );
                      }}
                    />
                    <span className="text-sm text-slate-900">{test}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isGenerating}
            onClick={() => {
              setCompleteModalPatient(null);
              setSelectedCompletedTests([]);
            }}
          >
            Cancel
          </Button>
          <Button disabled={isGenerating} onClick={onConfirm} className="min-w-[220px]">
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating ancillary documents...
              </>
            ) : (
              "Confirm completed tests"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
