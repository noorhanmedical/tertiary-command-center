import { PatientCard } from "@/components/PatientCard";

interface QualificationPatientCardsPaneProps {
  title: string;
  patients: any[];
  analyzingPatients: Set<number>;
  completedCount?: number;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
  onOpenScheduleModal: (patient: any) => void;
  schedulerName?: string | null;
  batchScheduleDate?: string | null;
  sourceMode?: "visit" | "outreach";
}

export default function QualificationPatientCardsPane({
  title,
  patients,
  analyzingPatients,
  completedCount = 0,
  onUpdatePatient,
  onDeletePatient,
  onAnalyzeOnePatient,
  onOpenScheduleModal,
  schedulerName = null,
  batchScheduleDate = null,
  sourceMode,
}: QualificationPatientCardsPaneProps) {
  if (patients.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="finance-section-title text-base">
          {title} ({patients.length})
        </h2>
        {completedCount > 0 && (
          <span className="text-xs text-finance-text-secondary">
            {completedCount}/{patients.length} analyzed
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {patients.map((patient) => (
          <PatientCard
            key={patient.id}
            patient={patient}
            isAnalyzing={analyzingPatients.has(patient.id)}
            onUpdate={(field, value) => onUpdatePatient(patient.id, { [field]: value })}
            onDelete={() => onDeletePatient(patient.id)}
            onAnalyze={() => onAnalyzeOnePatient(patient.id)}
            onOpenScheduleModal={(p) => onOpenScheduleModal(p)}
            schedulerName={schedulerName}
            batchScheduleDate={batchScheduleDate}
            sourceMode={sourceMode}
          />
        ))}
      </div>
    </section>
  );
}
