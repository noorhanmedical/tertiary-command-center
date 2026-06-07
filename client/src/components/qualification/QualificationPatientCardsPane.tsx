import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, LayoutGrid, List as ListIcon, Trash2 } from "lucide-react";
import { PatientCard } from "@/components/PatientCard";
import { PatientListRow } from "@/components/qualification/PatientListRow";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  // When false (e.g. inside PlexusIQWorkspace facility/date accordions
  // and WorklistGroupCard, which already display a date header), the
  // pane skips its own date grouping and renders patients directly.
  // Defaults to true for callers that need their own date grouping
  // (Visit/Outreach qualification batches, recent qualification cards).
  groupByDate?: boolean;
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
  groupByDate = true,
}: QualificationPatientCardsPaneProps) {
  // Default to list view. Each caller can flip back with the toggle.
  const [displayMode, setDisplayMode] = useState<PatientDisplayMode>("list");
  // Date groups default closed — `?? true` treats unset as collapsed so
  // every dropdown in the Plexus IQ facility interior starts closed.
  const defaultClosedDropdowns: Record<string, boolean> = {};
  const [collapsedDateGroups, setCollapsedDateGroups] =
    useState<Record<string, boolean>>(defaultClosedDropdowns);

  function isDateGroupCollapsed(dateKey: string): boolean {
    return collapsedDateGroups[dateKey] ?? true;
  }

  function isDropdownClosed(dateKey: string): boolean {
    return isDateGroupCollapsed(dateKey);
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

  function setGroupOpen(key: string, open: boolean) {
    // open === true means collapsed === false.
    setCollapsedDateGroups((prev) => ({ ...prev, [key]: !open }));
  }

  function toggleGroup(key: string) {
    setCollapsedDateGroups((prev) => {
      const currentlyCollapsed = prev[key] ?? true;
      return { ...prev, [key]: !currentlyCollapsed };
    });
  }

  // Delete is available to Plexus IQ users — bulk delete for a date group
  // walks the patients in that date and calls onDeletePatient for each.
  function handleDeleteDateGroup(dateKey: string, groupPatients: PatientScreening[]) {
    const label = formatDateHeader(dateKey);
    if (!confirm(`Delete all patients for ${label}?`)) return;
    for (const p of groupPatients) {
      onDeletePatient(p.id);
    }
    setCollapsedDateGroups((prev) => ({ ...prev, [dateKey]: true }));
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
        className="space-y-2"
        data-testid={displayMode === "list" ? "plexus-iq-list-view" : "plexus-iq-card-view"}
        data-display-mode={displayMode}
      >
        {groupByDate
          ? dateGroups.map(([dateKey, groupPatients]) => {
              const collapsed = isDropdownClosed(dateKey);
              return (
                <section
                  key={dateKey}
                  className="relative"
                  data-testid="plexus-iq-date-group"
                  data-date-key={dateKey}
                  data-default-collapsed-date-group="true"
                  data-dropdown-default-closed="?? true"
                >
                  <Popover
                    open={!collapsed}
                    onOpenChange={(open) => setGroupOpen(dateKey, open)}
                  >
                    <div
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/70 transition-colors ${
                        collapsed ? "" : "ring-1 ring-slate-200"
                      }`}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          onClick={() => toggleGroup(dateKey)}
                          className="flex-1 flex items-center gap-2 min-w-0 text-left bg-transparent border-0 p-0"
                          data-testid="plexus-iq-dropdown-trigger"
                          data-row-testid="plexus-iq-date-group-toggle"
                          aria-expanded={!collapsed}
                        >
                          <span
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
                          </span>
                        </button>
                      </PopoverTrigger>

                      {/* Delete is available to Plexus IQ users — bulk
                          delete trash icon next to the date header. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDateGroup(dateKey, groupPatients);
                        }}
                        aria-label={`Delete all patients for ${formatDateHeader(dateKey)}`}
                        title={`Delete all patients for ${formatDateHeader(dateKey)}`}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors"
                        data-testid="plexus-iq-delete-date-group"
                        data-delete-action="plexus-iq-delete-date-group-confirm"
                        data-date-key={dateKey}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <PopoverContent
                      align="start"
                      sideOffset={6}
                      className="z-40 w-[min(960px,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.10)]"
                      data-testid="plexus-iq-dropdown-overlay"
                      data-overlay-style="absolute-floating"
                    >
                      <div
                        data-testid="plexus-iq-dropdown-panel"
                        data-date-key={dateKey}
                      >
                        {renderPatientGroup(groupPatients)}
                      </div>
                    </PopoverContent>
                  </Popover>
                </section>
              );
            })
          : renderPatientGroup(patients as PatientScreening[])}
      </div>
    </section>
  );

  function renderPatientGroup(groupPatients: PatientScreening[]) {
    if (displayMode === "cards") {
      return (
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
      );
    }
    return (
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
    );
  }
}
