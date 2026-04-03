import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Building2,
  Calendar,
  Archive,
  Users,
} from "lucide-react";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";

type BatchWithPatients = ScreeningBatch & { patients: PatientScreening[] };

const APPOINTMENT_STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-800",
  "no show": "bg-red-100 text-red-800",
  rescheduled: "bg-blue-100 text-blue-800",
  "scheduled different day": "bg-purple-100 text-purple-800",
  cancelled: "bg-slate-100 text-slate-800",
  pending: "bg-amber-100 text-amber-800",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function getDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toISOString().split("T")[0];
}

export default function ArchivePage() {
  const { data: allBatches = [], isLoading } = useQuery<BatchWithPatients[]>({
    queryKey: ["/api/archive"],
  });

  const [expandedFacilities, setExpandedFacilities] = useState<Set<string>>(new Set());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set());

  const toggleFacility = (facility: string) => {
    setExpandedFacilities((prev) => {
      const next = new Set(prev);
      next.has(facility) ? next.delete(facility) : next.add(facility);
      return next;
    });
  };

  const toggleDate = (key: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleBatch = (batchId: number) => {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      next.has(batchId) ? next.delete(batchId) : next.add(batchId);
      return next;
    });
  };

  type DateGroup = { dateKey: string; dateLabel: string; batches: BatchWithPatients[] };
  type FacilityGroup = { facility: string; dateGroups: DateGroup[] };

  const facilityMap: Record<string, Record<string, BatchWithPatients[]>> = {};
  for (const batch of allBatches) {
    const facility = batch.facility || "Unassigned";
    const dateKey = getDateKey(batch.createdAt.toString());
    if (!facilityMap[facility]) facilityMap[facility] = {};
    if (!facilityMap[facility][dateKey]) facilityMap[facility][dateKey] = [];
    facilityMap[facility][dateKey].push(batch);
  }

  const facilityGroups: FacilityGroup[] = Object.keys(facilityMap)
    .sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    })
    .map((facility) => ({
      facility,
      dateGroups: Object.keys(facilityMap[facility])
        .sort((a, b) => b.localeCompare(a))
        .map((dateKey) => ({
          dateKey,
          dateLabel: formatDate(dateKey + "T12:00:00"),
          batches: facilityMap[facility][dateKey],
        })),
    }));

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative z-10">
      <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50 border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Archive className="w-5 h-5 text-slate-600" />
          <div>
            <h1 className="text-base font-bold tracking-tight">Patient Archive</h1>
            <p className="text-xs text-muted-foreground">
              {allBatches.length} batches · {allBatches.reduce((s, b) => s + b.patients.length, 0)} patients
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <div className="max-w-5xl mx-auto space-y-3">
          {facilityGroups.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <Archive className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-base">No archived schedules yet.</p>
            </div>
          )}

          {facilityGroups.map(({ facility, dateGroups }) => {
            const totalPatients = dateGroups.reduce((s, dg) => s + dg.batches.reduce((ss, b) => ss + b.patients.length, 0), 0);
            const isExpanded = expandedFacilities.has(facility);

            return (
              <Card key={facility} className="overflow-hidden" data-testid={`archive-facility-${facility.replace(/\s+/g, "-")}`}>
                <button
                  className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-muted/30 transition-colors text-left"
                  onClick={() => toggleFacility(facility)}
                  data-testid={`button-expand-facility-${facility.replace(/\s+/g, "-")}`}
                >
                  <Building2 className="w-5 h-5 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-900 dark:text-foreground">{facility}</p>
                    <p className="text-xs text-muted-foreground">
                      {dateGroups.length} date{dateGroups.length !== 1 ? "s" : ""} · {totalPatients} patient{totalPatients !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 dark:border-border divide-y divide-slate-100 dark:divide-border">
                    {dateGroups.map(({ dateKey, dateLabel, batches }) => {
                      const dateGroupKey = `${facility}::${dateKey}`;
                      const isDateExpanded = expandedDates.has(dateGroupKey);
                      const dateTotalPatients = batches.reduce((s, b) => s + b.patients.length, 0);

                      return (
                        <div key={dateKey} data-testid={`archive-date-${facility.replace(/\s+/g, "-")}-${dateKey}`}>
                          <button
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-muted/20 transition-colors text-left pl-10"
                            onClick={() => toggleDate(dateGroupKey)}
                            data-testid={`button-expand-date-${dateGroupKey.replace(/\s+/g, "-")}`}
                          >
                            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm text-slate-800 dark:text-foreground">{dateLabel}</p>
                              <p className="text-xs text-muted-foreground">
                                {batches.length} batch{batches.length !== 1 ? "es" : ""} · {dateTotalPatients} patient{dateTotalPatients !== 1 ? "s" : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="outline" className="text-[10px]">
                                <Users className="w-2.5 h-2.5 mr-1" />
                                {dateTotalPatients}
                              </Badge>
                              {isDateExpanded
                                ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                            </div>
                          </button>

                          {isDateExpanded && (
                            <div className="border-t border-slate-100 dark:border-border divide-y divide-slate-100 dark:divide-border">
                              {batches.map((batch) => {
                                const isBatchExpanded = expandedBatches.has(batch.id);
                                return (
                                  <div key={batch.id} data-testid={`archive-batch-${batch.id}`}>
                                    <button
                                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/50 dark:hover:bg-muted/10 transition-colors text-left pl-16"
                                      onClick={() => toggleBatch(batch.id)}
                                      data-testid={`button-expand-batch-${batch.id}`}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm text-slate-800 dark:text-foreground">{batch.name}</p>
                                        {batch.clinicianName && (
                                          <p className="text-xs text-muted-foreground">Dr. {batch.clinicianName}</p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs text-muted-foreground">{batch.patients.length} pts</span>
                                        {isBatchExpanded
                                          ? <ChevronDown className="w-3 h-3 text-slate-400" />
                                          : <ChevronRight className="w-3 h-3 text-slate-400" />}
                                      </div>
                                    </button>

                                    {isBatchExpanded && batch.patients.length > 0 && (
                                      <div className="bg-slate-50/60 dark:bg-muted/10 border-t border-slate-100 dark:border-border px-4 py-2 space-y-1">
                                        {batch.patients.map((patient) => {
                                          const aptStatus = patient.appointmentStatus || "pending";
                                          const patType = patient.patientType || "visit";
                                          return (
                                            <div
                                              key={patient.id}
                                              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white dark:bg-card border border-slate-100 dark:border-border"
                                              data-testid={`archive-patient-${patient.id}`}
                                            >
                                              {patient.time && (
                                                <span className="text-xs font-mono text-slate-500 shrink-0 tabular-nums">{patient.time}</span>
                                              )}
                                              <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-foreground truncate">
                                                {patient.name}
                                              </span>
                                              <span
                                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${
                                                  patType === "outreach"
                                                    ? "bg-orange-100 text-orange-800"
                                                    : "bg-teal-100 text-teal-800"
                                                }`}
                                                data-testid={`archive-type-${patient.id}`}
                                              >
                                                {patType}
                                              </span>
                                              <span
                                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${APPOINTMENT_STATUS_STYLES[aptStatus] || APPOINTMENT_STATUS_STYLES.pending}`}
                                                data-testid={`archive-status-${patient.id}`}
                                              >
                                                {aptStatus}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {isBatchExpanded && batch.patients.length === 0 && (
                                      <div className="px-16 py-2 text-xs text-muted-foreground italic">No patients in this batch.</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
