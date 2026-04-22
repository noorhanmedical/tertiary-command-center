import { Card } from "@/components/ui/card";
import { Phone, Share2, FileBarChart, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import QualificationIntakePane from "./QualificationIntakePane";

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
          <QualificationIntakePane
            pasteText={pasteText}
            setPasteText={setPasteText}
            dragOver={dragOver}
            setDragOver={setDragOver}
            importUnlocked={importUnlocked}
            setImportUnlocked={setImportUnlocked}
            importCodeInput={importCodeInput}
            setImportCodeInput={setImportCodeInput}
            importCodeError={importCodeError}
            setImportCodeError={setImportCodeError}
            title="Add Patients"
            pastePlaceholder={"Paste outreach patient list here\n\nJohn Smith\nJane Doe\nBob Johnson"}
            uploadTestId="dropzone-outreach-upload"
            pasteTestId="input-outreach-paste-list"
            importTextTestId="button-import-outreach-text"
            addPatientTestId="button-add-outreach-patient"
          />
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
