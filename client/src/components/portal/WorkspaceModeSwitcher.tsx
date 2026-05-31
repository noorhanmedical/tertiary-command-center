// Right-panel mode switcher shared by Patient Care Specialist Workspace
// and Ancillary Care Specialist Workspace.
//
// Foundation only — the modes are surfaced as a tab strip; the data wiring
// behind each mode lands in later batches. Modes map to canonical data
// sources:
//   clinicSchedule    → global_schedule_events (doctor_visit / same_day_add)
//                       + patient_screenings on the day. Consent and
//                       screening-form readiness live here for the
//                       Ancillary Care Specialist Workspace and come from
//                       case_document_readiness / existing document
//                       endpoints.
//   ancillarySchedule → global_schedule_events (ancillary_appointment)
//                       + procedure_events.
//   callList          → patient_execution_cases.nextActionAt
//                       + patient_journey_events.

export const TEAM_MEMBER_WORKSPACE_MODES = [
  "clinicSchedule",
  "ancillarySchedule",
  "callList",
] as const;

export type TeamMemberWorkspaceMode =
  (typeof TEAM_MEMBER_WORKSPACE_MODES)[number];

export const TEAM_MEMBER_WORKSPACE_MODE_LABELS: Record<
  TeamMemberWorkspaceMode,
  string
> = {
  clinicSchedule: "Clinic Schedule",
  ancillarySchedule: "Ancillary Schedule",
  callList: "Call List",
};

export type WorkspaceModeSwitcherProps = {
  activeMode: TeamMemberWorkspaceMode;
  onModeChange: (mode: TeamMemberWorkspaceMode) => void;
  counts?: Partial<Record<TeamMemberWorkspaceMode, number>>;
};

export function WorkspaceModeSwitcher({
  activeMode,
  onModeChange,
  counts,
}: WorkspaceModeSwitcherProps) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5"
      role="tablist"
      data-testid="workspace-mode-switcher"
    >
      {TEAM_MEMBER_WORKSPACE_MODES.map((mode) => {
        const isActive = activeMode === mode;
        const label = TEAM_MEMBER_WORKSPACE_MODE_LABELS[mode];
        const count = counts?.[mode];
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onModeChange(mode)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-medium transition-colors ${
              isActive
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
            data-testid={`workspace-mode-switcher-${mode}`}
          >
            <span>{label}</span>
            {count != null && (
              <span
                className={`inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
