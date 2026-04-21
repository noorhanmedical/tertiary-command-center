import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { qk } from "./keys";

export type LibraryDoc = {
  id: number;
  title: string;
  description: string;
  kind: string;
  signatureRequirement: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  version: number;
  supersededByDocumentId: number | null;
  isCurrent: boolean;
  createdAt: string;
  surfaces: string[];
  downloadUrl: string;
  thumbnailUrl: string | null;
};

export type LibraryMeta = {
  kinds: string[];
  signatureRequirements: string[];
  surfaces: string[];
};

function invalidateList() {
  queryClient.invalidateQueries({ queryKey: ["/api/documents-library"] });
}

export function useDocumentLibraryMeta() {
  return useQuery<LibraryMeta>({ queryKey: qk.documentsLibrary.meta() });
}

export function useDocumentLibrary(filters: {
  kind: string;
  surface: string;
  patientId: string;
}) {
  return useQuery<LibraryDoc[]>({
    queryKey: qk.documentsLibrary.list(
      filters.kind,
      filters.surface,
      filters.patientId,
    ),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.surface !== "all") params.set("surface", filters.surface);
      else if (filters.kind !== "all") params.set("kind", filters.kind);
      const trimmed = filters.patientId.trim();
      if (trimmed && /^\d+$/.test(trimmed)) params.set("patientId", trimmed);
      const res = await fetch(
        `/api/documents-library?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
  });
}

export function useDocumentVersions(docId: number) {
  return useQuery<LibraryDoc[]>({
    queryKey: qk.documentsLibrary.versions(docId),
    queryFn: async () => {
      const res = await fetch(`/api/documents-library/${docId}/versions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load versions");
      return res.json();
    },
  });
}

export function useUploadDocument() {
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/documents-library", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: invalidateList,
  });
}

export function useDeleteDocument() {
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/documents-library/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) throw new Error("Delete failed");
    },
    onSuccess: invalidateList,
  });
}

export function useSupersedeDocument() {
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/documents-library/${id}/supersede`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Replace failed" }));
        throw new Error(err.error || "Replace failed");
      }
      return res.json();
    },
    onSuccess: invalidateList,
  });
}

export function useAddDocumentAssignment() {
  return useMutation({
    mutationFn: async ({ id, surface }: { id: number; surface: string }) => {
      const res = await fetch(`/api/documents-library/${id}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ surface }),
      });
      if (!res.ok) throw new Error("Failed to add assignment");
      return res.json();
    },
    onSuccess: invalidateList,
  });
}

export function useRemoveDocumentAssignment() {
  return useMutation({
    mutationFn: async ({ id, surface }: { id: number; surface: string }) => {
      const res = await fetch(
        `/api/documents-library/${id}/assignments/${surface}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to remove assignment");
    },
    onSuccess: invalidateList,
  });
}

