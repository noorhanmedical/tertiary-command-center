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
}: {
  completeModalPatient: PatientScreening | null;
  selectedCompletedTests: string[];
  setSelectedCompletedTests: React.Dispatch<React.SetStateAction<string[]>>;
  setCompleteModalPatient: (patient: PatientScreening | null) => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog
      open={!!completeModalPatient}
      onOpenChange={(open) => {
        if (!open) {
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

            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
              {(completeModalPatient.qualifyingTests || []).map((test) => {
                const checked = selectedCompletedTests.includes(test);
                return (
                  <label
                    key={test}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
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
            onClick={() => {
              setCompleteModalPatient(null);
              setSelectedCompletedTests([]);
            }}
          >
            Cancel
          </Button>
          <Button onClick={onConfirm}>
            Confirm completed tests
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
