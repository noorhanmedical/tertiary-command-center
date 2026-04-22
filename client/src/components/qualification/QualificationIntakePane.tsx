import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
  return (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {importUnlocked ? (
          <>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="text-base font-semibold">Upload File</span>
              </div>
              <div
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-6 cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
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
                  <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-muted-foreground mb-1.5" />
                    <p className="text-xs text-muted-foreground text-center">Drop files or click to browse</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Excel, CSV, PDF, images, text</p>
                  </>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-base font-semibold">Paste List</span>
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
          </>
        ) : (
          <Card className="p-4 col-span-1 lg:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-4 h-4 text-muted-foreground" />
              <span className="text-base font-semibold">Import Access</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">File upload and paste import require an access code. Manual entry is always available.</p>
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
            {importCodeError && <p className="text-xs text-red-500 mt-1.5">Incorrect code. Please try again.</p>}
          </Card>
        )}

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Plus className="w-4 h-4 text-muted-foreground" />
            <span className="text-base font-semibold">Manual Entry</span>
          </div>
          <Button
            className="w-full gap-1.5"
            onClick={onAddPatient}
            disabled={addPatientPending || !onAddPatient}
            data-testid={addPatientTestId}
          >
            {addPatientPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Patient
          </Button>
        </Card>
      </div>
    </section>
  );
}
