import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { qk } from "./keys";

export type MarketingMaterialItem = {
  id: number;
  title: string;
  description: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
};

function invalidate() {
  queryClient.invalidateQueries({ queryKey: qk.marketingMaterials.all() });
}

export function useMarketingMaterials() {
  return useQuery<MarketingMaterialItem[]>({
    queryKey: qk.marketingMaterials.all(),
    staleTime: 60_000,
  });
}

export function useUploadMarketingMaterial() {
  return useMutation({
    mutationFn: async (input: {
      title: string;
      description: string;
      file: File;
    }) => {
      const fd = new FormData();
      fd.append("title", input.title);
      fd.append("description", input.description);
      fd.append("file", input.file);
      const res = await fetch("/api/marketing-materials", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useDeleteMarketingMaterial() {
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/marketing-materials/${id}`);
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed (${res.status})`);
      }
    },
    onSuccess: invalidate,
  });
}
