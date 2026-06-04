import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, LayoutGrid, List as ListIcon } from "lucide-react";
import { PatientCard } from "@/components/PatientCard";
import { PatientListRow } from "@/components/qualification/PatientListRow";
import type { PatientScreening } from "@shared/schema";

type PatientDisplayMode = "cards" | "list";

interface QualificationPatientCardsPaneProps {
  title: string;
  patients: any[];
  analyzingPatients: Set<number>;
  completedCount?: number;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
  onOpenScheduleModal: (patient: any) => void;
  schedulerName?: string | null;
  batchScheduleDate?: string | null;
  sourceMode?: "visit" | "outreach";
}

const UNGROUPED_KEY = "__no_date__";

// Date for grouping: batch schedule date → patient.time → patient.createdAt.
function patientDateKey(
  patient: PatientScreening,
  batchScheduleDate: string | null | undefined,
): string {
  if (batchScheduleDate && /^\d{4}-\d{2}-\d{2}/.test(batchScheduleDate)) {
    return batchScheduleDate.slice(0, 10);
  }
  const time = (patient as { time?: string | null }).time;
  if (time && /^\d{4}-\d{2}-\d{2}/.test(time)) {
    return time.slice(0, 10);
  }
  const createdAt = (patient as { createdAt?: string | Date | null }).createdAt;
  if (createdAt) {
    const iso = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
    if (m) return m[1];
  }
  return UNGROUPED_KEY;
}

function formatDateHeader(key: string): string {
  if (key === UNGROUPED_KEY) return "No scheduled date";
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function QualificationPatientCardsPane({
  title,
  patients,
  analyzingPatients,
  completedCount = 0,
  onUpdatePatient,
  onDeletePatient,
  onAnalyzeOnePatient,
  onOpenScheduleModal,
  schedulerName = null,
  batchScheduleDate = null,
  sourceMode,
}: QualificationPatientCardsPaneProps) {
  const [displayMode, setDisplayMode] = useState<PatientDisplayMode>("cards");
  // Date groups default closed — `undefined` is treated as collapsed.
  // User clicks toggle the explicit boolean in this map.
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>({});

  function isDateGroupCollapsed(dateKey: string): boolean {
    return collapsedDateGroups[dateKey] ?? true;
  }

  const dateGroups = useMemo(() => {
    const map = new Map<string, PatientScreening[]>();
    for (const p of patients) {
      const key = patientDateKey(p as PatientScreening, batchScheduleDate);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p as PatientScreening);
    }
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => {
      if (a === UNGROUPED_KEY) return 1;
      if (b === UNGROUPED_KEY) return -1;
      return a.localeCompare(b);
    });
    return entries;
  }, [patients, batchScheduleDate]);

  if (patients.length === 0) return null;

  function toggleGroup(key: string) {
    setCollapsedDateGroups((prev) => {
      const currentlyCollapsed = isDateGroupCollapsed(key);
      return { ...prev, [key]: !currentlyCollapsed };
    });
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="finance-section-title text-base">
          {title} ({patients.length})
        </h2>
        <div className="flex items-center gap-2">
          {completedCount > 0 && (
            <span className="text-xs text-finance-text-secondary">
              {completedCount}/{patients.length} analyzed
            </span>
          )}
          <div
            className="inline-flex items-center rounded-full border border-slate-200 bg-white p-0.5"
            data-testid="plexus-iq-view-toggle"
            role="tablist"
            aria-label="Patient display mode"
          >
            <button
              type="button"
              onClick={() => setDisplayMode("cards")}
              data-testid="plexus-iq-view-cards"
              role="tab"
              aria-selected={displayMode === "cards"}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                displayMode === "cards"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <LayoutGrid className="w-3 h-3" /> Cards
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("list")}
              data-testid="plexus-iq-view-list"
              role="tab"
              aria-selected={displayMode === "list"}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                displayMode === "list"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <ListIcon className="w-3 h-3" /> List
            </button>
          </div>
        </div>
      </div>

      <div
        className="space-y-6"
        data-testid={displayMode === "list" ? "plexus-iq-list-view" : "plexus-iq-card-view"}
        data-display-mode={displayMode}
      >
        {dateGroups.map(([dateKey, groupPatients]) => {
          const collapsed = isDateGroupCollapsed(dateKey);
          return (
            <section
              key={dateKey}
              className="space-y-2"
              data-testid="plexus-iq-date-group"
              data-date-key={dateKey}
              data-default-collapsed-date-group="true"
            >
              <button
                type="button"
                onClick={() => toggleGroup(dateKey)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left rounded-xl border border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/70 transition-colors ${
                  collapsed ? "" : "rounded-b-md"
                }`}
                data-testid="plexus-iq-date-group-toggle"
                aria-expanded={!collapsed}
              >
                <div
                  className="flex items-center gap-2 min-w-0"
                  data-testid="plexus-iq-date-group-header"
                >
                  {collapsed ? (
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    {formatDateHeader(dateKey)}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    · {groupPatients.length}
                  </span>
                </div>
              </button>

              {!collapsed && (
                <div
                  className="px-1"
                  data-testid="plexus-iq-date-group-body"
                  data-date-key={dateKey}
                >
                  {displayMode === "cards" ? (
                    <div
                      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start"
                      data-testid="plexus-iq-patient-card-grid"
                    >
                      {groupPatients.map((patient) => (
                        <PatientCard
                          key={patient.id}
                          patient={patient}
                          isAnalyzing={analyzingPatients.has(patient.id)}
                          onUpdate={(field, value) =>
                            onUpdatePatient(patient.id, { [field]: value })
                          }
                          onDelete={() => onDeletePatient(patient.id)}
                          onAnalyze={() => onAnalyzeOnePatient(patient.id)}
                          onOpenScheduleModal={(p) => onOpenScheduleModal(p)}
                          schedulerName={schedulerName}
                          batchScheduleDate={batchScheduleDate}
                          sourceMode={sourceMode}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className="flex flex-col gap-1.5"
                      data-testid="plexus-iq-patient-list"
                    >
                      {groupPatients.map((patient) => (
                        <PatientListRow
                          key={patient.id}
                          patient={patient}
                          isAnalyzing={analyzingPatients.has(patient.id)}
                          onUpdate={(field, value) =>
                            onUpdatePatient(patient.id, { [field]: value })
                          }
                          onDelete={() => onDeletePatient(patient.id)}
                          onAnalyze={() => onAnalyzeOnePatient(patient.id)}
                          schedulerName={schedulerName}
                          batchScheduleDate={batchScheduleDate}
                          sourceMode={sourceMode}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
