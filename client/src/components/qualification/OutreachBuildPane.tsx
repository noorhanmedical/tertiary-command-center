import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, FileText, Plus, Lock, Phone, Share2, FileBarChart } from "lucide-react";

const IMPORT_ACCESS_CODE = "1234";

interface OutreachBuildPaneProps {
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
}

export default function OutreachBuildPane({
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
}: OutreachBuildPaneProps) {
  return (
    <div className="flex flex-col h-full relative z-10">
      <div className="border-b bg-white/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-semibold tracking-[0.16em] uppercase text-slate-500 mb-1">
              Outreach Qualification
            </div>
            <div className="text-xl font-semibold text-slate-900">Standalone Outreach Patient Flow</div>
            <div className="text-sm text-slate-500 mt-1">
              Same parser, patient bars, qualification outputs, PDFs, and share path — ending in a final outreach list.
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Phone className="w-4 h-4" />
            Outreach lifecycle
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Add Patients</h2>
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
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      data-testid="dropzone-outreach-upload"
                    >
                      <Upload className="w-6 h-6 text-muted-foreground mb-1.5" />
                      <p className="text-xs text-muted-foreground text-center">Drop files or click to browse</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Excel, CSV, PDF, images, text</p>
                    </div>
                  </Card>

                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-base font-semibold">Paste List</span>
                    </div>
                    <Textarea
                      placeholder={"Paste outreach patient list here\n\nJohn Smith\nJane Doe\nBob Johnson"}
                      className="min-h-[82px] resize-none text-sm mb-2"
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      data-testid="input-outreach-paste-list"
                    />
                    <Button className="w-full gap-1.5" variant="outline" disabled={!pasteText.trim()} data-testid="button-import-outreach-text">
                      <Plus className="w-4 h-4" /> Import List
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
                      data-testid="input-outreach-import-code"
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
                      data-testid="button-outreach-import-unlock"
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
                <Button className="w-full gap-1.5" data-testid="button-add-outreach-patient">
                  <Plus className="w-4 h-4" /> Add Patient
                </Button>
              </Card>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider">
                Final Outreach List
              </h2>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" data-testid="button-outreach-clinician-pdf">
                  <FileBarChart className="w-4 h-4 mr-1" /> Clinician PDF
                </Button>
                <Button variant="outline" size="sm" data-testid="button-outreach-plexus-pdf">
                  <FileText className="w-4 h-4 mr-1" /> Plexus PDF
                </Button>
                <Button variant="outline" size="sm" data-testid="button-outreach-share">
                  <Share2 className="w-4 h-4 mr-1" /> Share
                </Button>
              </div>
            </div>

            <Card className="p-6">
              <div className="text-sm text-slate-500">
                This pane is the outreach counterpart to the visit final schedule and will be wired next to the same parser, patient bars, qualification outputs, and PDF/share flow.
              </div>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
