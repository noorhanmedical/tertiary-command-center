// Add-action launcher for the canonical calendar primitives.
//
// Renders a Plus button with a dropdown listing the actions allowed by the
// resolved profile. Each action is currently a no-op placeholder — later
// batches must wire each one to its canonical API:
//
//   addPatient                 → POST /api/batches/:id/patients (find-or-create batch)
//   importPatients             → existing bulk import flow
//   addCallListItem            → call list mutation
//   addCallback                → outreach scheduler callback create
//   addAncillaryAppointment    → POST global_schedule_events (ancillary_appointment)
//   addSameDayAncillary        → POST global_schedule_events (same_day_add)
//   markProcedureCompleted     → POST procedure_events / global_schedule_events
//                                (procedure_complete)
//   addTeamAvailabilityBlock   → POST global_schedule_events
//                                (team_member_availability / pto_block / sick_day)
//
// This batch only assembles the menu shape; it must not write data.

import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { CalendarContext } from "./calendarEventTypes";
import {
  type CalendarAddActionId,
  type CalendarProfile,
} from "./calendarProfiles";

const ADD_ACTION_LABELS: Record<CalendarAddActionId, string> = {
  addPatient: "Add Patient",
  importPatients: "Import Patients",
  addCallListItem: "Add Call-List Item",
  addCallback: "Add Callback",
  addAncillaryAppointment: "Add Ancillary Appointment",
  addSameDayAncillary: "Add Same-Day Ancillary",
  markProcedureCompleted: "Mark Procedure Completed",
  addTeamAvailabilityBlock: "Add Team Availability Block",
};

export type CalendarAddActionButtonProps = {
  profile: CalendarProfile;
  context?: CalendarContext;
};

export function CalendarAddActionButton({
  profile,
}: CalendarAddActionButtonProps) {
  if (profile.addActions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          className="gap-1.5 rounded-xl"
          data-testid="canonical-calendar-add-action"
        >
          <Plus className="w-4 h-4" />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-500">
          {profile.label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {profile.addActions.map((action) => (
          <DropdownMenuItem
            key={action}
            // Placeholder. Later batches wire each action to canonical APIs.
            onSelect={() => {
              /* no-op until wired in a later batch */
            }}
            disabled
            data-testid={`canonical-calendar-add-action-${action}`}
            title="Wired in a later batch"
          >
            {ADD_ACTION_LABELS[action]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
