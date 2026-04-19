import { useState, useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { autoGeneratePatientNotes } from "@/lib/noteGeneration";
import { CompletedTestsDialog } from "@/features/schedule/CompletedTestsDialog";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import type { GeneratedDocument } from "@shared/plexus";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

interface NotesPanelDrawerProps {
  batch: ScreeningBatchWithPatients | undefined;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  completeModalPatient: PatientScreening | null;
  setCompleteModalPatient: (v: PatientScreening | null) => void;
}

export function NotesPanelDrawer({
  batch,
  onUpdatePatient,
  completeModalPatient,
  setCompleteModalPatient,
}: NotesPanelDrawerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isGeneratingCompletedDocs, setIsGeneratingCompletedDocs] = useState(false);
  const [selectedCompletedTests, setSelectedCompletedTests] = useState<string[]>([]);

  useEffect(() => {
    if (completeModalPatient) {
      setSelectedCompletedTests(completeModalPatient.qualifyingTests || []);
    }
  }, [completeModalPatient]);

  const saveNotesMutation = useMutation({
    mutationFn: async (payload: Array<{
      patientId: number; batchId: number; facility?: string | null; scheduleDate?: string | null;
      patientName: string; service: string; docKind: string; title: string;
      sections: Array<{ heading: string; body: string }>;
    }>) => {
      const res = await apiRequest("POST", "/api/generated-notes", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes/batch", batch?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
    },
    onError: (e: unknown) => {
      toast({ title: "Failed to save notes", description: e instanceof Error ? e.message : "Failed to save notes", variant: "destructive" });
    },
  });

  const completePatientWithSelectedTests = useCallback(async (patient: PatientScreening, completedTests: string[]) => {
    const uniqueCompletedTests = Array.from(new Set(completedTests)).filter(Boolean);

    if (uniqueCompletedTests.length === 0) {
      toast({ title: "Select completed tests", description: "Choose at least one completed test before marking the patient complete.", variant: "destructive" });
      return false;
    }

    if (!batch?.id) {
      toast({ title: "Missing batch context", description: "Could not determine the active schedule batch for note generation.", variant: "destructive" });
      return false;
    }

    setIsGeneratingCompletedDocs(true);

    try {
      toast({ title: "Generating ancillary documents", description: `Creating ancillary documents for ${patient.name}...` });

      onUpdatePatient(patient.id, {
        appointmentStatus: "completed",
        selectedCompletedTests: uniqueCompletedTests,
      });

      const docs = await autoGeneratePatientNotes(
        {
          ...patient,
          qualifyingTests: uniqueCompletedTests,
          reasoning: (patient.reasoning ?? null) as Record<string, string | { qualifying_factors?: string[]; icd10_codes?: string[]; clinician_understanding?: string }> | null,
        },
        batch?.scheduleDate,
        batch?.facility,
        batch?.clinicianName
      );

      if (!docs || docs.length === 0) {
        toast({ title: "No ancillary documents generated", description: "The selected completed tests did not produce any ancillary documents.", variant: "destructive" });
        return false;
      }

      const payload = docs.map((doc: GeneratedDocument) => ({
        patientId: patient.id,
        batchId: batch.id,
        facility: batch?.facility ?? null,
        scheduleDate: batch?.scheduleDate ?? null,
        patientName: patient.name,
        service: doc.service,
        docKind: doc.kind,
        title: doc.title,
        sections: doc.sections,
      }));

      await saveNotesMutation.mutateAsync(payload);

      toast({ title: "Ancillary documents created", description: `${docs.length} document${docs.length === 1 ? "" : "s"} generated for ${patient.name}.` });
      return true;
    } catch (e: unknown) {
      toast({ title: "Failed to generate ancillary documents", description: e instanceof Error ? e.message : "An unexpected error occurred while generating or saving ancillary documents.", variant: "destructive" });
      return false;
    } finally {
      setIsGeneratingCompletedDocs(false);
    }
  }, [batch, onUpdatePatient, toast, saveNotesMutation]);

  const handleCompletedTestsConfirm = useCallback(async () => {
    if (!completeModalPatient) return;
    const ok = await completePatientWithSelectedTests(completeModalPatient, selectedCompletedTests);
    if (!ok) return;
    setCompleteModalPatient(null);
    setSelectedCompletedTests([]);
  }, [completeModalPatient, completePatientWithSelectedTests, selectedCompletedTests, setCompleteModalPatient]);

  return (
    <CompletedTestsDialog
      completeModalPatient={completeModalPatient}
      selectedCompletedTests={selectedCompletedTests}
      setSelectedCompletedTests={setSelectedCompletedTests}
      setCompleteModalPatient={setCompleteModalPatient}
      isGenerating={isGeneratingCompletedDocs}
      onConfirm={handleCompletedTestsConfirm}
    />
  );
}
