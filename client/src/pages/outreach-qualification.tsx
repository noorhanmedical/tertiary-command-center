import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileBarChart, FileText, Share2 } from "lucide-react";
import QualificationIntakePane from "@/components/qualification/QualificationIntakePane";
import QualificationPatientCardsPane from "@/components/qualification/QualificationPatientCardsPane";

type OutreachPatient = {
  id: number;
  name: string;
  time?: string;
  status: "draft" | "processing" | "completed";
  qualifyingTests: string[];
  clinicianPdfUrl?: string | null;
  plexusPdfUrl?: string | null;
  reasoning?: Record<string, unknown>;
};

function parsePatientLines(text: string): OutreachPatient[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let nextId = Date.now();

  return lines.map((line) => {
    let name = line;
    let time = "";

    const dashMatch = line.match(/^(.+?)\s*-\s*(.+)$/);
    if (dashMatch) {
      const left = dashMatch[1].trim();
      const right = dashMatch[2].trim();
      const looksLikeTime = /\d{1,2}:\d{2}|\bAM\b|\bPM\b/i.test(left);
      if (looksLikeTime) {
        time = left;
        name = right;
      }
    }

    return {
      id: nextId++,
      name,
      time,
      status: "draft",
      qualifyingTests: [],
      clinicianPdfUrl: null,
      plexusPdfUrl: null,
      reasoning: {},
    };
  });
}

export default function OutreachQualificationPage() {
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [importUnlocked, setImportUnlocked] = useState(false);
  const [importCodeInput, setImportCodeInput] = useState("");
  const [importCodeError, setImportCodeError] = useState(false);
  const [patients, setPatients] = useState<OutreachPatient[]>([]);
  const [analyzingPatients, setAnalyzingPatients] = useState<Set<number>>(new Set());

  const completedCount = useMemo(
    () => patients.filter((p) => p.status === "completed").length,
    [patients]
  );

  const importFromText = (text: string) => {
    const parsed = parsePatientLines(text);
    if (!parsed.length) return;
    setPatients((prev) => [...prev, ...parsed]);
    setPasteText("");
  };

  const handleFileUpload = async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    const content = await file.text();
    importFromText(content);
  };

  const addPatient = () => {
    setPatients((prev) => [
      ...prev,
      {
        id: Date.now(),
        name: "",
        time: "",
        status: "draft",
        qualifyingTests: [],
        clinicianPdfUrl: null,
        plexusPdfUrl: null,
        reasoning: {},
      },
    ]);
  };

  const updatePatient = (id: number, updates: Record<string, unknown>) => {
    setPatients((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  };

  const deletePatient = (id: number) => {
    setPatients((prev) => prev.filter((p) => p.id !== id));
  };

  const analyzeOnePatient = async (id: number) => {
    setAnalyzingPatients((prev) => new Set(prev).add(id));
    try {
      await new Promise((r) => setTimeout(r, 500));
      setPatients((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "completed",
                qualifyingTests:
                  p.qualifyingTests.length > 0 ? p.qualifyingTests : ["BrainWave"],
              }
            : p
        )
      );
    } finally {
      setAnalyzingPatients((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-10 pb-16">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <div className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase mb-3">
              PLEXUS ANCILLARY · OUTREACH QUALIFICATION
            </div>
            <h1
              className="text-3xl font-semibold text-slate-900 tracking-tight"
              data-testid="text-outreach-qualification-heading"
            >
              Outreach Qualification
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Same parser and patient bars as the visit flow, without requiring a committed visit schedule.
            </p>
          </div>

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
            onHandleFileUpload={handleFileUpload}
            onImportText={() => {
              if (!pasteText.trim()) return;
              importFromText(pasteText.trim());
            }}
            onAddPatient={addPatient}
            title="Add Outreach Patients"
            pastePlaceholder={"Paste outreach patient list here\n\n9:00 AM - John Smith\nJane Doe\nBob Johnson"}
            uploadTestId="dropzone-outreach-upload"
            pasteTestId="input-outreach-paste-list"
            importTextTestId="button-import-outreach-text"
            addPatientTestId="button-add-outreach-patient"
          />

          <QualificationPatientCardsPane
            title="Final Outreach List"
            patients={patients as any[]}
            analyzingPatients={analyzingPatients}
            completedCount={completedCount}
            onUpdatePatient={(id, updates) => updatePatient(id, updates)}
            onDeletePatient={(id) => deletePatient(id)}
            onAnalyzeOnePatient={(id) => analyzeOnePatient(id)}
            onOpenScheduleModal={() => {}}
            schedulerName={null}
            batchScheduleDate={null}
          />

          <section>
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider">
                Outreach Outputs
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
                Outreach patients now use the same parser intake and the same patient bars as visit patients.
              </div>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
