import { useMemo, useState } from "react";
import VisitBuildPane from "@/components/qualification/VisitBuildPane";

type OutreachPatient = {
  id: number;
  name: string;
  time?: string;
  status: "draft" | "processing" | "completed";
  qualifyingTests: string[];
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
  const [clinicianInput, setClinicianInput] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(null);
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);

  const completedCount = useMemo(
    () => patients.filter((p) => p.status === "completed").length,
    [patients]
  );

  const outreachBatch = useMemo(
    () =>
      ({
        id: -1,
        name: "Outreach Qualification",
        clinicianName: clinicianInput,
        assignedScheduler: null,
        scheduleDate: null,
        facility: "Outreach",
      }) as any,
    [clinicianInput]
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
      },
    ]);
  };

  const updatePatient = (id: number, updates: Record<string, unknown>) => {
    setPatients((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
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

  const analyzeAll = async () => {
    if (isAnalyzingAll) return;
    setIsAnalyzingAll(true);
    setAnalysisProgress({ completed: 0, total: patients.length });
    try {
      for (let i = 0; i < patients.length; i++) {
        const patient = patients[i];
        await analyzeOnePatient(patient.id);
        setAnalysisProgress({ completed: i + 1, total: patients.length });
      }
    } finally {
      setIsAnalyzingAll(false);
      setAnalysisProgress(null);
    }
  };

  return (
    <VisitBuildPane
      selectedBatch={outreachBatch}
      selectedBatchId={-1}
      patients={patients as any[]}
      batchLoading={false}
      isProcessing={isAnalyzingAll}
      analysisProgress={analysisProgress}
      completedCount={completedCount}
      clinicianInput={clinicianInput}
      setClinicianInput={setClinicianInput}
      outreachSchedulers={[]}
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
      analyzingPatients={analyzingPatients}
      onNavigate={() => {}}
      onDeleteAll={() => setPatients([])}
      onGenerateAll={analyzeAll}
      onUpdateClinician={(value) => setClinicianInput(value)}
      onAssignScheduler={undefined}
      onHandleDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
      }}
      onHandleFileUpload={handleFileUpload}
      onImportText={() => {
        if (!pasteText.trim()) return;
        importFromText(pasteText.trim());
      }}
      onAddPatient={addPatient}
      onUpdatePatient={updatePatient}
      onDeletePatient={deletePatient}
      onAnalyzeOnePatient={analyzeOnePatient}
      onOpenScheduleModal={() => {}}
      importFilePending={false}
      importTextPending={false}
      addPatientPending={false}
    />
  );
}
