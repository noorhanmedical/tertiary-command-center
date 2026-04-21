import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  ScreeningBatch,
  PatientScreening,
  OutreachScheduler,
} from "@shared/schema";
import { qk } from "./keys";

export type ScreeningBatchWithPatients = ScreeningBatch & {
  patients?: PatientScreening[];
  assignedScheduler?: OutreachScheduler | null;
};

export type CreateBatchResult = ScreeningBatchWithPatients & {
  requiresManualAssignment?: boolean;
  availableSchedulers?: OutreachScheduler[];
};

export type AnalysisStatus = {
  status: "not_started" | "processing" | "completed" | "failed";
  completedPatients?: number;
  totalPatients?: number;
  errorMessage?: string;
};

function invalidateAll(batchId?: number | null) {
  queryClient.invalidateQueries({ queryKey: qk.screeningBatches.all() });
  if (batchId != null) {
    queryClient.invalidateQueries({
      queryKey: qk.screeningBatches.detail(batchId),
    });
  }
}

export function useScreeningBatches() {
  return useQuery<ScreeningBatchWithPatients[]>({
    queryKey: qk.screeningBatches.all(),
  });
}

export function useScreeningBatch(
  id: number | null | undefined,
  options?: { pollWhileProcessing?: boolean },
) {
  return useQuery<ScreeningBatchWithPatients>({
    queryKey: qk.screeningBatches.detail(id),
    enabled: !!id,
    refetchInterval: options?.pollWhileProcessing
      ? (query) => (query.state.data?.status === "processing" ? 2000 : false)
      : false,
  });
}

export function useCreateBatch() {
  return useMutation({
    mutationFn: async (input: {
      name: string;
      facility: string;
      scheduleDate?: string;
    }) => {
      const res = await apiRequest("POST", "/api/batches", input);
      return (await res.json()) as CreateBatchResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.screeningBatches.all() });
    },
  });
}

export function useDeleteBatch() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/screening-batches/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.screeningBatches.all() });
    },
  });
}

export function useUpdateBatch() {
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: number;
      updates: Partial<ScreeningBatch>;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/screening-batches/${id}`,
        updates,
      );
      return (await res.json()) as ScreeningBatch;
    },
    onSuccess: (_data, vars) => invalidateAll(vars.id),
  });
}

export function useAssignScheduler() {
  return useMutation({
    mutationFn: async ({
      batchId,
      schedulerId,
    }: {
      batchId: number;
      schedulerId: number | null;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/batches/${batchId}/assign-scheduler`,
        { schedulerId },
      );
      return res.json();
    },
    onSuccess: (_data, vars) => invalidateAll(vars.batchId),
  });
}

export type AddPatientInput = {
  batchId: number;
  name: string;
  time?: string;
  age?: string | number;
  gender?: string;
  dob?: string;
  phoneNumber?: string;
  insurance?: string;
  diagnoses?: string;
  history?: string;
  medications?: string;
  previousTests?: string;
  previousTestsDate?: string;
  noPreviousTests?: boolean;
  patientType?: string;
  notes?: string;
};

export function useAddPatient() {
  return useMutation({
    mutationFn: async (input: AddPatientInput) => {
      const { batchId, ...body } = input;
      const res = await apiRequest(
        "POST",
        `/api/batches/${batchId}/patients`,
        body,
      );
      return (await res.json()) as PatientScreening;
    },
    onSuccess: (_data, vars) => invalidateAll(vars.batchId),
  });
}

export function useImportPatientsText() {
  return useMutation({
    mutationFn: async ({
      batchId,
      text,
    }: {
      batchId: number;
      text: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/batches/${batchId}/import-text`,
        { text },
      );
      return (await res.json()) as { imported: number };
    },
    onSuccess: (_data, vars) => invalidateAll(vars.batchId),
  });
}

export function useImportPatientsFile() {
  return useMutation({
    mutationFn: async ({
      batchId,
      formData,
    }: {
      batchId: number;
      formData: FormData;
    }) => {
      const res = await fetch(`/api/batches/${batchId}/import-file`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as { imported: number };
    },
    onSuccess: (_data, vars) => invalidateAll(vars.batchId),
  });
}

export function useUpdatePatient() {
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: number;
      updates: Record<string, unknown>;
    }) => {
      const res = await apiRequest("PATCH", `/api/patients/${id}`, updates);
      return (await res.json()) as PatientScreening;
    },
    onSuccess: (updatedPatient, vars) => {
      const batchId = updatedPatient.batchId;
      if (batchId != null) {
        queryClient.setQueryData<ScreeningBatchWithPatients>(
          qk.screeningBatches.detail(batchId),
          (old) =>
            old
              ? {
                  ...old,
                  patients: (old.patients ?? []).map((p) =>
                    p.id === vars.id ? { ...p, ...updatedPatient } : p,
                  ),
                }
              : old,
        );
      }
    },
  });
}

export function useDeletePatient() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/patients/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.screeningBatches.all() });
    },
  });
}

// Kicks off batch analysis on the server. Caller is responsible for any
// polling / progress UI; `useFetchAnalysisStatus` exposes a one-shot fetch
// helper that uses the canonical key.
export function useStartBatchAnalysis() {
  return useMutation({
    mutationFn: async (batchId: number) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/analyze`);
      return (await res.json()) as { patientCount?: number };
    },
  });
}

export async function fetchAnalysisStatus(
  batchId: number,
): Promise<AnalysisStatus> {
  const res = await fetch(`/api/batches/${batchId}/analysis-status`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Lost connection during analysis.");
  return res.json();
}

export type AnalyzePatientResult = {
  autoCommittedSchedulerName?: string | null;
  commitStatus?: string | null;
  [key: string]: unknown;
};

export function useAnalyzePatient() {
  return useMutation({
    mutationFn: async (patientId: number) => {
      const res = await apiRequest("POST", `/api/patients/${patientId}/analyze`);
      return (await res.json().catch(() => ({}))) as AnalyzePatientResult;
    },
  });
}

// Convenience hook returning the cache-invalidator so callers can drop the
// useQueryClient + queryKey duplication.
export function useInvalidateBatch() {
  const qc = useQueryClient();
  return (batchId?: number | null) => {
    qc.invalidateQueries({ queryKey: qk.screeningBatches.all() });
    if (batchId != null) {
      qc.invalidateQueries({ queryKey: qk.screeningBatches.detail(batchId) });
    }
  };
}
