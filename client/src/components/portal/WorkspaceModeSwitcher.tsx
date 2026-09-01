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

import { Activity, CalendarDays, PhoneCall, type LucideIcon } from "lucide-react";

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

// Per-mode presentation metadata: a Lucide icon, a one-line subtitle that
// describes the data each mode surfaces, and an accent color set used for the
// active left-border, the active icon tint, and the count chip. Keeping this
// in one map means the switcher styling stays consistent everywhere.
type ModeMeta = {
  icon: LucideIcon;
  // Short label shown on the active tab to keep the strip compact.
  shortLabel: string;
  subtitle: string;
  /** Muted colored-pencil accent (CSS color) for the active tab. */
  accent: string;
};

// SketchUI paper tabs. `accent` is the muted colored-pencil hue for the active
// tab (icon + underline + count chip); inactive tabs are quiet graphite on paper.
const MODE_META: Record<TeamMemberWorkspaceMode, ModeMeta> = {
  clinicSchedule: {
    icon: CalendarDays,
    shortLabel: "Clinic",
    subtitle: "Today's visits & consent readiness",
    accent: "var(--sketch-blue)",
  },
  ancillarySchedule: {
    icon: Activity,
    shortLabel: "Ancillary",
    subtitle: "Procedures & diagnostic tests",
    accent: "var(--sketch-violet)",
  },
  callList: {
    icon: PhoneCall,
    shortLabel: "Calls",
    subtitle: "Outreach & follow-up queue",
    accent: "var(--sketch-green)",
  },
};

export type WorkspaceModeSwitcherProps = {
  activeMode: TeamMemberWorkspaceMode;
  onModeChange: (mode: TeamMemberWorkspaceMode) => void;
  counts?: Partial<Record<TeamMemberWorkspaceMode, number>>;
  // Compact = the thin (small) right rail. Same layout as normal mode
  // (icon + label on every tab) just rendered a touch smaller so it
  // stays visually consistent rather than collapsing to icon-only.
  compact?: boolean;
};

export function WorkspaceModeSwitcher({
  activeMode,
  onModeChange,
  counts,
  compact = false,
}: WorkspaceModeSwitcherProps) {
  const activeMeta = MODE_META[activeMode];
  return (
    <div>
      <div
        className="flex items-center gap-1"
        role="tablist"
        data-testid="workspace-mode-switcher"
      >
        {TEAM_MEMBER_WORKSPACE_MODES.map((mode) => {
          const isActive = activeMode === mode;
          const label = TEAM_MEMBER_WORKSPACE_MODE_LABELS[mode];
          const meta = MODE_META[mode];
          const Icon = meta.icon;
          const count = counts?.[mode];
          return (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={`${label} — ${meta.subtitle}`}
              onClick={() => onModeChange(mode)}
              className={`group flex flex-1 items-center justify-center gap-1.5 rounded-md ${
                compact ? "px-1.5 py-1" : "px-2 py-1.5"
              } transition-colors ${
                isActive ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
              }`}
              style={
                isActive
                  ? { backgroundColor: "#FAFBF8", boxShadow: `inset 0 -2px 0 ${meta.accent}` }
                  : undefined
              }
              data-testid={`workspace-mode-switcher-${mode}`}
            >
              <span className="inline-flex shrink-0" style={{ color: isActive ? meta.accent : "#94A3B8" }}>
                <Icon className="h-4 w-4" />
              </span>
              <span
                className={`truncate font-semibold leading-tight ${
                  compact ? "text-[10px]" : "text-[11px]"
                }`}
              >
                {meta.shortLabel}
              </span>
              {count != null && (
                <span
                  className="inline-flex h-4 min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
                  style={
                    isActive
                      ? { color: meta.accent, backgroundColor: "rgba(31,41,55,0.06)" }
                      : { color: "#64748B", backgroundColor: "rgba(148,163,184,0.16)" }
                  }
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* One-line caption describing the data the active mode surfaces. */}
      <p
        className="mt-1 truncate px-1 text-[10px] leading-tight text-slate-500"
        data-testid="workspace-mode-subtitle"
      >
        {activeMeta.subtitle}
      </p>
    </div>
  );
}
