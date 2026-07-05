// Patient EHR page (Batch B11 scaffold).
//
// Standalone surface used by the new /patient-directory route. Until
// the full GET /api/patient-directory/search endpoint lands, this page
// renders against an injected `searchResults` array so the duplicate
// warnings + profile drawer are testable from fixture data.
//
// Existing PatientDirectoryView (patient-database page) is untouched.

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, Upload, FileText } from "lucide-react";
import {
  PatientProfileDrawer,
  type PatientProfileSnapshot,
} from "@/components/patient-directory/PatientProfileDrawer";
import { PatientAuditTrailModal } from "@/components/patient-directory/PatientAuditTrailModal";
import { DuplicateWarningSummary } from "@/components/patient-directory/DuplicateWarningBadge";
import type { DuplicateWarningResult } from "@/lib/patientDuplicateWarnings";

export type PatientDirectoryRow = {
  patientScreeningId: number;
  name: string;
  facility: string | null;
  dob: string | null;
  mrn: string | null;
  phoneNumber: string | null;
  badges: {
    doNotContact: boolean;
    activeCooldown: boolean;
    everSentToEngagement: boolean;
    priorTestsCount: number;
    duplicateMatchCount: number;
  };
};

type Props = {
  searchResults: ReadonlyArray<PatientDirectoryRow>;
  warningResultsById?: Record<number, DuplicateWarningResult>;
  snapshotById?: Record<number, PatientProfileSnapshot>;
  onSearch?: (q: string) => void;
  onAddPatient?: () => void;
  onBulkImport?: () => void;
  auditEndpointUnavailable?: boolean;
};

export function PatientDirectoryPage({
  searchResults,
  warningResultsById,
  snapshotById,
  onSearch,
  onAddPatient,
  onBulkImport,
  auditEndpointUnavailable,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [auditId, setAuditId] = useState<number | null>(null);

  const selectedSnapshot = selectedId != null ? snapshotById?.[selectedId] ?? null : null;
  const selectedWarning = selectedId != null ? warningResultsById?.[selectedId] : null;
  const auditWarning = auditId != null ? warningResultsById?.[auditId] : null;
  const auditSnapshot = auditId != null ? snapshotById?.[auditId] : null;

  return (
    <div className="space-y-4 p-4" data-testid="patient-directory-page">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); onSearch?.(e.target.value); }}
              placeholder="Search by name / DOB / MRN / phone"
              className="pl-7"
              data-testid="patient-directory-search-input"
            />
          </div>
          <Button type="button" variant="outline" onClick={onAddPatient} data-testid="patient-directory-add-patient">
            <UserPlus className="mr-1 h-4 w-4" />
            Add patient
          </Button>
          <Button type="button" variant="outline" onClick={onBulkImport} data-testid="patient-directory-bulk-import">
            <Upload className="mr-1 h-4 w-4" />
            Bulk import
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        {searchResults.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-slate-500" data-testid="patient-directory-empty">
            No patients to show. Add one or start an import.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200" data-testid="patient-directory-rows">
            {searchResults.map((row) => {
              const warning = warningResultsById?.[row.patientScreeningId];
              return (
                <li
                  key={row.patientScreeningId}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50"
                  data-testid={`patient-directory-row-${row.patientScreeningId}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="truncate text-[13px] font-medium text-slate-900 hover:underline"
                        onClick={() => setSelectedId(row.patientScreeningId)}
                        data-testid={`patient-directory-row-name-${row.patientScreeningId}`}
                      >
                        {row.name}
                      </button>
                      {row.badges.doNotContact ? <Badge className="bg-rose-100 text-rose-800 border-rose-200">DNC</Badge> : null}
                      {row.badges.activeCooldown ? <Badge className="bg-rose-100 text-rose-800 border-rose-200">Cooldown</Badge> : null}
                      {row.badges.everSentToEngagement ? <Badge className="bg-amber-100 text-amber-800 border-amber-200">Sent to Engagement</Badge> : null}
                      {row.badges.priorTestsCount > 0 ? <Badge className="bg-amber-100 text-amber-800 border-amber-200">Prior tests: {row.badges.priorTestsCount}</Badge> : null}
                      {row.badges.duplicateMatchCount > 0 ? <Badge className="bg-amber-100 text-amber-800 border-amber-200">{row.badges.duplicateMatchCount} match(es)</Badge> : null}
                      <DuplicateWarningSummary result={warning ?? null} />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {[row.facility, row.dob, row.mrn, row.phoneNumber].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAuditId(row.patientScreeningId)}
                    data-testid={`patient-directory-row-audit-${row.patientScreeningId}`}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" />
                    Audit
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <PatientProfileDrawer
        open={selectedId != null}
        onOpenChange={(o) => !o && setSelectedId(null)}
        snapshot={selectedSnapshot}
        warningResult={selectedWarning}
      />

      <PatientAuditTrailModal
        open={auditId != null}
        onOpenChange={(o) => !o && setAuditId(null)}
        patientScreeningId={auditId}
        patientName={auditSnapshot?.identity?.name ?? null}
        events={auditSnapshot?.events ?? null}
        warningResult={auditWarning}
        endpointUnavailable={auditEndpointUnavailable}
      />
    </div>
  );
}
