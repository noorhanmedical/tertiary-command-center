import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuthUser } from "@/App";
import {
  defaultSectionAccessMatrix,
  defaultAccessFor,
  type SectionAccessLevel,
  type SectionAccessMatrix,
  type PatientDirectoryRole,
} from "@shared/patientDirectorySections";

type SectionAccessResponse = {
  matrix: SectionAccessMatrix;
  sections: unknown[];
};

/**
 * Runtime guard for Patient Directory chart sections.
 *
 * Resolves the effective access level (`hidden` | `summary` | `full`) for the
 * current user's role and a given section id. Admins always get `full` without
 * a server round-trip. Non-admins read the admin-configured matrix; if the
 * config is unavailable (empty DB / fetch failure), it falls back to the
 * registry defaults so the chart never blanks.
 */
export function usePatientDirectorySectionAccess() {
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const role = (user?.role ?? "clinician") as string;
  const isAdmin = role === "admin";

  const { data, isLoading } = useQuery<SectionAccessResponse>({
    queryKey: ["/api/patient-directory/section-access"],
    // Admins always see everything; skip the fetch entirely for them.
    enabled: !isAdmin,
    staleTime: 5 * 60_000,
  });

  const matrix = data?.matrix ?? defaultSectionAccessMatrix();

  const getSectionAccess = useCallback(
    (sectionId: string): SectionAccessLevel => {
      if (isAdmin) return "full";
      const row = matrix[sectionId];
      const lvl = row?.[role as PatientDirectoryRole];
      return lvl ?? defaultAccessFor(sectionId, role);
    },
    [isAdmin, matrix, role],
  );

  return { getSectionAccess, isAdmin, role, isLoading: !isAdmin && isLoading };
}
