import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  markProcedureCompleteApi,
  type ProcedureCompleteInput,
  type ProcedureCompleteResponse,
} from "@/lib/workflow/procedureEventsApi";

type ProcedureCompleteButtonProps = {
  patientScreeningId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  serviceType: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
  /** Fired after a successful completion. Lets a parent run an exit animation
   *  (e.g. slide the completed row up) before refetching the call list. */
  onCompleted?: (data: ProcedureCompleteResponse) => void;
};

export function ProcedureCompleteButton({
  patientScreeningId,
  patientName,
  patientDob,
  facilityId,
  serviceType,
  size = "sm",
  variant = "outline",
  className,
  onCompleted,
}: ProcedureCompleteButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation<ProcedureCompleteResponse, Error, ProcedureCompleteInput>({
    mutationFn: (input) => markProcedureCompleteApi(input),
    onSuccess: (data) => {
      toast({
        title: "Procedure complete",
        description: `${serviceType} marked complete · ${data.documentReadinessRows.length} readiness rows updated`,
      });
      // Invalidate any canonical-spine query. The query cache keys all start
      // with `/api/...`, so a partial-match invalidation is the cheapest way
      // to keep packet/readiness/notes/billing views consistent.
      queryClient.invalidateQueries({ queryKey: ["/api/case-document-readiness"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procedure-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procedure-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-readiness-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-packet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-portal/patient-packet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/technician-liaison/patient-packet"] });
      onCompleted?.(data);
    },
    onError: (err) => {
      toast({
        title: "Failed to mark procedure complete",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const disabled = mutation.isPending || !serviceType;

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={disabled}
      onClick={() =>
        mutation.mutate({
          serviceType,
          patientScreeningId: patientScreeningId ?? null,
          patientName: patientName ?? null,
          patientDob: patientDob ?? null,
          facilityId: facilityId ?? null,
        })
      }
      data-testid={`button-procedure-complete-${serviceType}`}
    >
      {mutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" />
      )}
      <span className="ml-1.5">Procedure Complete</span>
    </Button>
  );
}
