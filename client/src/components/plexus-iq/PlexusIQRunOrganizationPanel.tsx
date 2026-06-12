// Plexus IQ run organization panel (Part 2 / 3 / 4 / 5 of the
// activation continuation). Wires together:
//   - qualificationRunOrdering   (parent date + run grouping)
//   - orderPatientsWithinRun     (outreach alphabetical, visit appt-time)
//   - RunComparisonSelector      (parent date / multi-run / select-all)
//   - useLiveDuplicateWarnings   (Patient Directory facts)
//   - DuplicateWarningBadge      (per-row badges)
//   - PatientAuditTrailModal     (click-to-open from a warning)
//
// Rendered as a single additive Card inside PlexusIQWorkspace so the
// protected workspace gets a one-line import and a one-line JSX
// insertion. No layout redesign; the existing facility tiles / status
// tabs / cards continue to render below.

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, Layers, ArrowUpDown } from "lucide-react";
import {
  buildQualificationGroups,
  orderPatientsWithinRun,
  selectAllRuns,
  selectByRuns,
  selectNoRuns,
  type QualificationDateGroup,
  type RunSelection,
  type RunSourceRow,
} from "@/lib/qualificationRunOrdering";
import {
  DuplicateWarningBadge,
  DuplicateWarningSummary,
} from "@/components/patient-directory/DuplicateWarningBadge";
import { RunComparisonSelector } from "@/components/plexus-iq/RunComparisonSelector";
import { PatientAuditTrailModal } from "@/components/patient-directory/PatientAuditTrailModal";
import { useLiveDuplicateWarnings } from "@/lib/useLiveDuplicateWarnings";
import type { DuplicateWarningResult } from "@/lib/patientDuplicateWarnings";

export type PlexusIQRunOrgPatient = {
  id: number;
  name: string;
  facility: string | null;
  patientType?: "visit" | "outreach" | string | null;
  appointmentTime?: string | null;
  dob?: string | null;
  phoneNumber?: string | null;
  mrn?: string | null;
};

export type PlexusIQRunOrgBatch = {
  batchId: number;
  batchCreatedAt: string; // ISO
  patients: ReadonlyArray<PlexusIQRunOrgPatient>;
};

type Props = {
  batches: ReadonlyArray<PlexusIQRunOrgBatch>;
  defaultSelection?: RunSelection;
};

export function PlexusIQRunOrganizationPanel({
  batches,
  defaultSelection,
}: Props) {
  const [selection, setSelection] = useState<RunSelection>(defaultSelection ?? selectNoRuns());
  const [dateOrder, setDateOrder] = useState<"desc" | "asc">("desc");
  const [openDateKeys, setOpenDateKeys] = useState<Set<string>>(new Set());
  const [openRunIds, setOpenRunIds] = useState<Set<number>>(new Set());
  const [auditPatientId, setAuditPatientId] = useState<number | null>(null);

  // ── Flatten batches into RunSourceRow shape for the helper ───────────
  const flatRows = useMemo<RunSourceRow[]>(() => {
    const out: RunSourceRow[] = [];
    for (const b of batches) {
      for (const p of b.patients) {
        out.push({
          batchId: b.batchId,
          batchCreatedAt: b.batchCreatedAt,
          patientType: (p.patientType as "visit" | "outreach" | string | null | undefined) ?? "visit",
          patientId: p.id,
          name: p.name,
          appointmentTime: p.appointmentTime ?? null,
        });
      }
    }
    return out;
  }, [batches]);

  // ── Date / run groups (drives the dropdowns + the selector) ──────────
  const groups: ReadonlyArray<QualificationDateGroup> = useMemo(
    () => buildQualificationGroups(flatRows, { dateOrder, runOrder: "desc" }),
    [flatRows, dateOrder],
  );

  // ── Roster for the currently expanded date(s) — pulls patients back
  //    into the original shape so we can render names + duplicate badges.
  const patientsByBatchId = useMemo(() => {
    const m = new Map<number, ReadonlyArray<PlexusIQRunOrgPatient>>();
    for (const b of batches) m.set(b.batchId, b.patients);
    return m;
  }, [batches]);

  // ── Live duplicate warnings against Patient Directory facts ──────────
  // Collect every patient surfaced by the open dates so we get warnings
  // for what's actually visible (cheap when nothing is expanded).
  const visiblePatients = useMemo(() => {
    if (openDateKeys.size === 0 && openRunIds.size === 0) return [];
    const out: Array<{
      patientScreeningId: number;
      patientName: string;
      identity: { name: string; dob: string | null; facility: string | null; phoneNumber: string | null; mrn: string | null };
    }> = [];
    for (const g of groups) {
      const dateOpen = openDateKeys.has(g.parentDateKey);
      for (const r of g.runs) {
        const runOpen = openRunIds.has(r.runId);
        if (!dateOpen && !runOpen) continue;
        const rows = patientsByBatchId.get(r.runId) ?? [];
        for (const p of rows) {
          out.push({
            patientScreeningId: p.id,
            patientName: p.name,
            identity: {
              name: p.name,
              dob: p.dob ?? null,
              facility: p.facility ?? null,
              phoneNumber: p.phoneNumber ?? null,
              mrn: p.mrn ?? null,
            },
          });
        }
      }
    }
    return out;
  }, [groups, openDateKeys, openRunIds, patientsByBatchId]);

  const warningsState = useLiveDuplicateWarnings({
    currentPatients: visiblePatients,
    priorRunRoster: flatRows.map((r) => {
      const p = (patientsByBatchId.get(r.batchId) ?? []).find((x) => x.id === r.patientId);
      return {
        ...r,
        patientScreeningId: r.patientId,
        patientName: r.name,
        identity: {
          name: r.name,
          dob: p?.dob ?? null,
          facility: p?.facility ?? null,
          phoneNumber: p?.phoneNumber ?? null,
          mrn: p?.mrn ?? null,
        },
      };
    }),
    selection,
  });

  const warningById = warningsState.byId;

  function toggleDate(key: string) {
    setOpenDateKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleRun(runId: number) {
    setOpenRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId); else next.add(runId);
      return next;
    });
  }

  return (
    <Card className="mb-3 p-3 bg-white" data-testid="plexus-iq-run-organization-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-slate-500" />
          <div className="text-sm font-semibold text-slate-900">Qualification runs</div>
          <Badge variant="secondary" className="bg-slate-100 text-slate-600">
            {groups.length} date{groups.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDateOrder((o) => (o === "desc" ? "asc" : "desc"))}
            data-testid="plexus-iq-run-org-sort-toggle"
          >
            <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
            {dateOrder === "desc" ? "Newest first" : "Oldest first"}
          </Button>
          <Button
            type="button"
            variant={selection.kind === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelection(selection.kind === "all" ? selectNoRuns() : selectAllRuns())}
            data-testid="plexus-iq-run-org-select-all"
          >
            {selection.kind === "all" ? "Comparing: all" : "Select all"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelection(selectNoRuns())}
            data-testid="plexus-iq-run-org-clear"
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Selector — same component used by the duplicate-warning engine */}
      <RunComparisonSelector
        priorRunRoster={flatRows}
        selection={selection}
        onChange={setSelection}
      />

      {/* Visible run/date dropdown listing */}
      {groups.length === 0 ? (
        <div className="py-4 text-center text-xs text-slate-500" data-testid="plexus-iq-run-org-empty">
          No qualification runs yet.
        </div>
      ) : (
        <ul className="mt-2 space-y-2" data-testid="plexus-iq-run-org-date-list">
          {groups.map((g) => {
            const dateOpen = openDateKeys.has(g.parentDateKey);
            const dateRunIds = new Set(g.runs.map((r) => r.runId));
            const selectedRunsHere = selection.kind === "runs"
              ? selection.runIds.filter((id) => dateRunIds.has(id)).length
              : selection.kind === "all" || (selection.kind === "date" && selection.parentDateKey === g.parentDateKey)
                ? g.runs.length
                : 0;
            return (
              <li
                key={g.parentDateKey}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5"
                data-testid={`plexus-iq-run-org-date-${g.parentDateKey}`}
              >
                <button
                  type="button"
                  onClick={() => toggleDate(g.parentDateKey)}
                  className="flex w-full items-center gap-2 text-left text-[12px] font-medium text-slate-800"
                  data-testid={`plexus-iq-run-org-date-toggle-${g.parentDateKey}`}
                >
                  {dateOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <span>{g.parentDateLabel}</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    {g.runs.length} run{g.runs.length === 1 ? "" : "s"}
                  </span>
                  {selectedRunsHere > 0 ? (
                    <Badge variant="secondary" className="ml-auto bg-indigo-100 text-indigo-700">
                      {selectedRunsHere} compared
                    </Badge>
                  ) : null}
                </button>
                {dateOpen ? (
                  <ul className="mt-2 space-y-1.5" data-testid={`plexus-iq-run-org-runs-${g.parentDateKey}`}>
                    {g.runs.map((r) => {
                      const runOpen = openRunIds.has(r.runId);
                      const rawPatients = patientsByBatchId.get(r.runId) ?? [];
                      const orderedPatients = orderPatientsWithinRun(rawPatients.map((p) => ({
                        batchId: r.runId,
                        batchCreatedAt: r.runCreatedAt,
                        patientType: (p.patientType as "visit" | "outreach" | string | null | undefined) ?? "visit",
                        patientId: p.id,
                        name: p.name,
                        appointmentTime: p.appointmentTime ?? null,
                      })));
                      const compared = (selection.kind === "all")
                        || (selection.kind === "date" && selection.parentDateKey === g.parentDateKey)
                        || (selection.kind === "runs" && selection.runIds.includes(r.runId));
                      return (
                        <li
                          key={r.runId}
                          className="rounded-lg border border-slate-200 bg-white p-2"
                          data-testid={`plexus-iq-run-org-run-${r.runId}`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleRun(r.runId)}
                            className="flex w-full items-center gap-2 text-left text-[12px] text-slate-700"
                            data-testid={`plexus-iq-run-org-run-toggle-${r.runId}`}
                          >
                            {runOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            <span className="font-medium">{r.runLabel}</span>
                            <span className="text-[11px] text-slate-500">
                              {r.patientCount} patient{r.patientCount === 1 ? "" : "s"}
                              {r.outreachCount > 0 ? ` · outreach ${r.outreachCount}` : ""}
                              {r.visitCount > 0 ? ` · visit ${r.visitCount}` : ""}
                            </span>
                            {compared ? (
                              <Badge variant="secondary" className="ml-auto bg-indigo-100 text-indigo-700">Comparing</Badge>
                            ) : (
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  const ids = selection.kind === "runs" ? [...selection.runIds, r.runId] : [r.runId];
                                  setSelection(selectByRuns(ids));
                                }}
                                className="ml-auto text-[11px] text-indigo-600 underline-offset-2 hover:underline"
                                data-testid={`plexus-iq-run-org-run-compare-${r.runId}`}
                              >
                                Compare
                              </button>
                            )}
                          </button>
                          {runOpen ? (
                            <ul className="mt-1.5 space-y-1" data-testid={`plexus-iq-run-org-run-patients-${r.runId}`}>
                              {orderedPatients.length === 0 ? (
                                <li className="text-[11px] text-slate-500">No patients yet.</li>
                              ) : (
                                orderedPatients.map((row) => {
                                  const warning: DuplicateWarningResult | undefined = warningById[row.patientId];
                                  return (
                                    <li
                                      key={row.patientId}
                                      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px]"
                                      data-testid={`plexus-iq-run-org-patient-${row.patientId}`}
                                    >
                                      <span className="truncate text-slate-800">{row.name}</span>
                                      {row.patientType === "outreach"
                                        ? <Badge variant="secondary" className="bg-slate-100 text-slate-600">outreach</Badge>
                                        : <span className="text-[11px] text-slate-500">
                                            {row.appointmentTime
                                              ? new Date(row.appointmentTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                              : "—"}
                                          </span>}
                                      <DuplicateWarningBadge
                                        result={warning}
                                        onOpenAudit={() => setAuditPatientId(row.patientId)}
                                        variant="compact"
                                        align="right"
                                      />
                                      <DuplicateWarningSummary result={warning} />
                                    </li>
                                  );
                                })
                              )}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Click-from-warning audit modal */}
      <PatientAuditTrailModal
        open={auditPatientId !== null}
        onOpenChange={(o) => !o && setAuditPatientId(null)}
        patientScreeningId={auditPatientId}
        patientName={auditPatientId != null
          ? visiblePatients.find((p) => p.patientScreeningId === auditPatientId)?.patientName ?? null
          : null}
        warningResult={auditPatientId != null ? warningById[auditPatientId] : null}
        events={[]}
        endpointUnavailable={warningsState.factsUnavailable}
      />
    </Card>
  );
}
