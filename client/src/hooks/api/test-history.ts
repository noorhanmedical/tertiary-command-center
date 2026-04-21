import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PatientTestHistory } from "@shared/schema";
import { qk } from "./keys";

export function useTestHistory(enabled = true) {
  return useQuery<PatientTestHistory[]>({
    queryKey: qk.testHistory.all(),
    enabled,
  });
}

function invalidate() {
  queryClient.invalidateQueries({ queryKey: qk.testHistory.all() });
}

export function useImportTestHistoryText() {
  return useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/test-history/import", { text });
      return (await res.json()) as { imported: number };
    },
    onSuccess: invalidate,
  });
}

export function useImportTestHistoryFile() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/test-history/import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Import failed");
      }
      return (await res.json()) as { imported: number };
    },
    onSuccess: invalidate,
  });
}

export function useDeleteTestHistoryRecord() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/test-history/${id}`);
    },
    onSuccess: invalidate,
  });
}

export function useClearTestHistory() {
  return useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/test-history");
    },
    onSuccess: invalidate,
  });
}
