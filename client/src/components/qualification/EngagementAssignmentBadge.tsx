import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { UserCog } from "lucide-react";
import { ChangeEngagementAssignmentDialog } from "@/components/qualification/ChangeEngagementAssignmentDialog";

// Compact badge shown on cards that have been sent to Engagement.
//
// Reads from /api/patients/:id/engagement-assignment so the badge
// stays correct after auto-assignment / reassignment / PTO
// redistribution — there's no second cached source of truth.

export type EngagementAssignmentBadgeProps = {
  patientId: number;
  commitStatus?: string | null;
  compact?: boolean;
};

type AssignmentResponse = {
  patientScreeningId: number;
  executionCaseId: number | null;
  commitStatus: string | null;
  engagementStatus: string | null;
  engagementBucket: string | null;
  assignedRole: string | null;
  assignedTeamMemberId: number | null;
  scheduler: { id: number; name: string; facility: string } | null;
};

export function EngagementAssignmentBadge({
  patientId,
  commitStatus,
  compact = false,
}: EngagementAssignmentBadgeProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Render gate: only show the badge on patients that have already
  // been sent to Engagement. The shared `PatientCard` uses
  // `patient.commitStatus`; honour it without fetching for Draft rows.
  const isSent = (commitStatus ?? "Draft") !== "Draft";

  const { data } = useQuery<AssignmentResponse>({
    queryKey: ["engagement-assignment", patientId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/engagement-assignment`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return (await res.json()) as AssignmentResponse;
    },
    enabled: isSent,
    staleTime: 60_000,
  });

  if (!isSent) return null;

  const assignedName = data?.scheduler?.name ?? null;
  const summary = assignedName
    ? `Sent to Engagement · ${assignedName}`
    : "Sent to Engagement · Assignment pending";
  const sizeClass = compact ? "h-6 px-2 text-[10px]" : "h-7 px-2 text-[11px]";

  return (
    <div
      className="inline-flex items-center gap-1.5"
      data-testid={`engagement-assignment-badge-${patientId}`}
    >
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-900"
        title={summary}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        {summary}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          setDialogOpen(true);
        }}
        className={`gap-1 ${sizeClass}`}
        data-testid={`button-change-engagement-assignment-${patientId}`}
      >
        <UserCog className="h-3 w-3" />
        Change
      </Button>
      <ChangeEngagementAssignmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={patientId}
        currentSchedulerId={data?.scheduler?.id ?? null}
      />
    </div>
  );
}
