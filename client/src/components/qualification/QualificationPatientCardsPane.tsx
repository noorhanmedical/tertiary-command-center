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
}: QualificationPatientCardsPaneProps) {
  if (patients.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider">
          {title} ({patients.length})
        </h2>
        {completedCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {completedCount}/{patients.length} analyzed
          </span>
        )}
      </div>
      <div className="space-y-4">
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
          />
        ))}
      </div>
    </section>
  );
}
