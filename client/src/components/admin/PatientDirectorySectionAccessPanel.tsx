// Admin-only editor for per-role access to Patient Directory chart sections.
//
// Rows are the chart sections (registry order); columns are the four roles.
// Each cell is a native <select> of hidden / summary / full. The admin column
// is locked to "full" (admins always see everything). Save PUTs the whole
// matrix; the server normalizes (admin forced to "full") and logs to audit_log.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  PATIENT_DIRECTORY_ROLES,
  SECTION_ACCESS_LEVELS,
  defaultSectionAccessMatrix,
  defaultAccessFor,
  type SectionAccessLevel,
  type SectionAccessMatrix,
  type PatientDirectoryRole,
  type PatientDirectorySectionDef,
} from "@shared/patientDirectorySections";

type AccessResponse = {
  matrix: SectionAccessMatrix;
  sections: PatientDirectorySectionDef[];
};

const ROLE_LABEL: Record<PatientDirectoryRole, string> = {
  admin: "Admin",
  clinician: "Clinician",
  biller: "Biller",
  scheduler: "Scheduler",
};

const LEVEL_LABEL: Record<SectionAccessLevel, string> = {
  hidden: "Hidden",
  summary: "Summary",
  full: "Full",
};

export default function PatientDirectorySectionAccessPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery<AccessResponse>({
    queryKey: ["/api/patient-directory/section-access"],
  });

  const sections = useMemo<PatientDirectorySectionDef[]>(
    () => (data?.sections ? [...data.sections].sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [data?.sections],
  );

  const [draft, setDraft] = useState<SectionAccessMatrix>({});

  // Hydrate the editable draft from the server matrix, falling back to
  // per-cell registry defaults for anything missing so no cell is blank.
  useEffect(() => {
    if (!data) return;
    const base = data.matrix ?? defaultSectionAccessMatrix();
    const next: SectionAccessMatrix = {};
    for (const s of data.sections ?? []) {
      const row = {} as Record<PatientDirectoryRole, SectionAccessLevel>;
      for (const role of PATIENT_DIRECTORY_ROLES) {
        row[role] = base[s.sectionId]?.[role] ?? defaultAccessFor(s.sectionId, role);
      }
      next[s.sectionId] = row;
    }
    setDraft(next);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (matrix: SectionAccessMatrix) => {
      await apiRequest("PUT", "/api/patient-directory/section-access", { matrix });
    },
    onSuccess: () => {
      toast({ title: "Section access saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-directory/section-access"] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const setCell = (sectionId: string, role: PatientDirectoryRole, level: SectionAccessLevel) => {
    setDraft((prev) => ({
      ...prev,
      [sectionId]: { ...prev[sectionId], [role]: level },
    }));
  };

  if (isLoading) {
    return (
      <Card className="p-4 bg-white" data-testid="patient-directory-section-access-loading">
        <div className="flex items-center text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading section access…
        </div>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card className="p-4 bg-white" data-testid="patient-directory-section-access-error">
        <div className="text-sm text-rose-700">Failed to load section access settings.</div>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-white" data-testid="patient-directory-section-access">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Patient chart section access</h2>
          <p className="text-[11px] text-slate-500">
            Control what each role sees for every section of the Patient EHR chart.
            Admins always see everything.
          </p>
        </div>
        <Button
          size="sm"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
          data-testid="button-save-section-access"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          Save
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left font-medium text-slate-600 py-2 pr-4">Section</th>
              {PATIENT_DIRECTORY_ROLES.map((role) => (
                <th key={role} className="text-left font-medium text-slate-600 py-2 px-2" data-testid={`col-role-${role}`}>
                  {ROLE_LABEL[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.sectionId} className="border-b border-slate-100" data-testid={`row-section-${s.sectionId}`}>
                <td className="py-2 pr-4 align-top">
                  <div className="font-medium text-slate-900">{s.label}</div>
                  {s.description ? (
                    <div className="text-[11px] text-slate-500">{s.description}</div>
                  ) : null}
                </td>
                {PATIENT_DIRECTORY_ROLES.map((role) => {
                  const locked = role === "admin";
                  const value = locked ? "full" : draft[s.sectionId]?.[role] ?? defaultAccessFor(s.sectionId, role);
                  return (
                    <td key={role} className="py-2 px-2 align-top">
                      <select
                        value={value}
                        disabled={locked}
                        onChange={(e) => setCell(s.sectionId, role, e.target.value as SectionAccessLevel)}
                        className="h-8 rounded border border-slate-300 bg-white px-2 text-[13px] disabled:bg-slate-100 disabled:text-slate-400"
                        data-testid={`select-access-${s.sectionId}-${role}`}
                      >
                        {SECTION_ACCESS_LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl}>{LEVEL_LABEL[lvl]}</option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
