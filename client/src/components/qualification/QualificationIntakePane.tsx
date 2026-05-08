import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Upload, FileText, Plus, Lock } from "lucide-react";

const IMPORT_ACCESS_CODE = "1234";

interface QualificationIntakePaneProps {
  pasteText: string;
  setPasteText: (value: string) => void;
  dragOver: boolean;
  setDragOver: (value: boolean) => void;
  importUnlocked: boolean;
  setImportUnlocked: (value: boolean) => void;
  importCodeInput: string;
  setImportCodeInput: (value: string) => void;
  importCodeError: boolean;
  setImportCodeError: (value: boolean) => void;
  importFilePending?: boolean;
  importTextPending?: boolean;
  addPatientPending?: boolean;
  onHandleDrop?: (e: React.DragEvent) => void;
  onHandleFileUpload?: (files: FileList | File[]) => void;
  onImportText?: () => void;
  onAddPatient?: () => void;
  title?: string;
  pastePlaceholder?: string;
  uploadTestId?: string;
  pasteTestId?: string;
  importTextTestId?: string;
  addPatientTestId?: string;
}

export default function QualificationIntakePane({
  pasteText,
  setPasteText,
  dragOver,
  setDragOver,
  importUnlocked,
  setImportUnlocked,
  importCodeInput,
  setImportCodeInput,
  importCodeError,
  setImportCodeError,
  importFilePending = false,
  importTextPending = false,
  addPatientPending = false,
  onHandleDrop,
  onHandleFileUpload,
  onImportText,
  onAddPatient,
  title = "Add Patients",
  pastePlaceholder = "Paste patient list here",
  uploadTestId = "dropzone-upload",
  pasteTestId = "input-paste-list",
  importTextTestId = "button-import-text",
  addPatientTestId = "button-add-patient",
}: QualificationIntakePaneProps) {
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  function closeImportDialog() {
    setImportDialogOpen(false);
    setImportCodeInput("");
    setImportCodeError(false);
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="finance-section-title text-base">{title}</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportDialogOpen(true)}
            className="gap-1.5"
            data-testid="button-open-import-access"
            title="Import Access"
          >
            <Lock className="w-4 h-4" />
            Import Access
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onAddPatient}
            disabled={addPatientPending || !onAddPatient}
            className="gap-1.5"
            data-testid={addPatientTestId}
          >
            {addPatientPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Patient
          </Button>
        </div>
      </div>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => (open ? setImportDialogOpen(true) : closeImportDialog())}
      >
        <DialogContent className="max-w-2xl" data-testid="dialog-import-access">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-finance-text-muted" />
              Import Access
            </DialogTitle>
          </DialogHeader>

          {!importUnlocked ? (
            <div className="space-y-3 pt-2">
              <p className="text-xs text-finance-text-secondary">
                File upload and paste import require an access code. Manual entry is always available without unlocking.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Enter 4-digit code"
                  value={importCodeInput}
                  onChange={(e) => {
                    setImportCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4));
                    setImportCodeError(false);
                  }}
                  className={`max-w-[160px] ${importCodeError ? "border-red-400" : ""}`}
                  data-testid="input-import-code"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (importCodeInput === IMPORT_ACCESS_CODE) {
                      setImportUnlocked(true);
                      setImportCodeInput("");
                      setImportCodeError(false);
                    } else {
                      setImportCodeError(true);
                      setImportCodeInput("");
                    }
                  }}
                  data-testid="button-import-unlock"
                >
                  Unlock
                </Button>
              </div>
              {importCodeError && (
                <p className="text-xs text-red-500" data-testid="text-import-code-error">
                  Incorrect code. Please try again.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <Card className="finance-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Upload className="w-4 h-4 text-finance-text-muted" />
                  <span className="text-base font-semibold text-finance-text">Upload File</span>
                </div>
                <div
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-6 cursor-pointer transition-colors ${
                    dragOver ? "border-primary bg-primary/5" : "border-border"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => onHandleDrop?.(e)}
                  onClick={() => {
                    if (!onHandleFileUpload) return;
                    const input = document.createElement("input");
                    input.type = "file";
                    input.multiple = true;
                    input.accept = ".xlsx,.xls,.csv,.txt,.text,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp";
                    input.onchange = (e) => {
                      const files = (e.target as HTMLInputElement).files;
                      if (files) onHandleFileUpload(files);
                    };
                    input.click();
                  }}
                  data-testid={uploadTestId}
                >
                  {importFilePending ? (
                    <Loader2 className="w-6 h-6 text-finance-text-muted animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-finance-text-muted mb-1.5" />
                      <p className="text-xs text-finance-text-secondary text-center">Drop files or click to browse</p>
                      <p className="text-[10px] text-finance-text-muted mt-0.5">Excel, CSV, PDF, images, text</p>
                    </>
                  )}
                </div>
              </Card>

              <Card className="finance-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-finance-text-muted" />
                  <span className="text-base font-semibold text-finance-text">Paste List</span>
                </div>
                <Textarea
                  placeholder={pastePlaceholder}
                  className="min-h-[82px] resize-none text-sm mb-2"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text");
                    if (pasted.trim() && onImportText) {
                      e.preventDefault();
                      setPasteText(pasted);
                      onImportText();
                    }
                  }}
                  data-testid={pasteTestId}
                />
                <Button
                  className="w-full gap-1.5"
                  variant="outline"
                  onClick={onImportText}
                  disabled={!pasteText.trim() || importTextPending || !onImportText}
                  data-testid={importTextTestId}
                >
                  {importTextPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Import List
                </Button>
              </Card>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={closeImportDialog}
              data-testid="button-close-import-access"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
