import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileBarChart, FileText, Plus, Share2, Trash2 } from "lucide-react";
import QualificationIntakePane from "@/components/qualification/QualificationIntakePane";

type OutreachPatientRow = {
  id: number;
  name: string;
  time: string;
  qualifyingTests: string[];
};

function parsePatientLines(text: string): OutreachPatientRow[] {
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
      qualifyingTests: [],
    };
  });
}

export default function OutreachQualificationPage() {
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [importUnlocked, setImportUnlocked] = useState(false);
  const [importCodeInput, setImportCodeInput] = useState("");
  const [importCodeError, setImportCodeError] = useState(false);
  const [patients, setPatients] = useState<OutreachPatientRow[]>([]);

  const completedCount = useMemo(
    () => patients.filter((p) => p.qualifyingTests.length > 0).length,
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
        qualifyingTests: [],
      },
    ]);
  };

  const updatePatient = (id: number, updates: Partial<OutreachPatientRow>) => {
    setPatients((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const deletePatient = (id: number) => {
    setPatients((prev) => prev.filter((p) => p.id !== id));
  };

  const qualifyPatient = (id: number) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              qualifyingTests:
                p.qualifyingTests.length > 0 ? p.qualifyingTests : ["BrainWave"],
            }
          : p
      )
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-10 pb-16">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <div className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase mb-3">
              PLEXUS ANCILLARY · OUTREACH QUALIFICATION
            </div>
            <h1 className="text-3xl font-semibold text-slate-900 tracking-tight" data-testid="text-outreach-qualification-heading">
              Outreach Qualification
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Standalone outreach patients with parser intake, patient bars, qualification, and final outreach list.
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

          <section>
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider">
                Final Outreach List ({patients.length})
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

            <div className="mb-3 text-xs text-slate-500">
              {completedCount}/{patients.length} qualified
            </div>

            <div className="space-y-4">
              {patients.map((patient) => (
                <Card key={patient.id} className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-[1.2fr_180px_auto_auto] gap-3 items-start">
                    <Input
                      value={patient.name}
                      onChange={(e) => updatePatient(patient.id, { name: e.target.value })}
                      placeholder="Patient name"
                      data-testid={`outreach-patient-name-${patient.id}`}
                    />
                    <Input
                      value={patient.time}
                      onChange={(e) => updatePatient(patient.id, { time: e.target.value })}
                      placeholder="Time (optional)"
                      data-testid={`outreach-patient-time-${patient.id}`}
                    />
                    <Button
                      variant="outline"
                      onClick={() => qualifyPatient(patient.id)}
                      data-testid={`button-qualify-outreach-${patient.id}`}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Qualify
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => deletePatient(patient.id)}
                      data-testid={`button-delete-outreach-${patient.id}`}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </div>

                  <div className="mt-3 text-sm text-slate-600">
                    {patient.qualifyingTests.length > 0 ? (
                      <div>
                        <span className="font-medium text-slate-900">Qualified:</span>{" "}
                        {patient.qualifyingTests.join(", ")}
                      </div>
                    ) : (
                      <div className="text-slate-400">Not qualified yet</div>
                    )}
                  </div>
                </Card>
              ))}

              {patients.length === 0 && (
                <Card className="p-6">
                  <div className="text-sm text-slate-500">
                    Add outreach patients using upload, paste list, or manual entry.
                  </div>
                </Card>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
