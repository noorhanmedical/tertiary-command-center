import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldCheck, AlertCircle, Clock, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Compact admin approval chip + dialog used on `PatientCard`. The
// chip displays the current approval state; clicking opens a dialog
// where an admin can flip the state. Backend route is
// `POST /api/patient-screenings/:id/admin-approval` which also
// appends a `patient_journey_events` row.

export type AdminApprovalStatus = "pending" | "approved" | "needs_info" | "rejected";

export type AdminApprovalControlProps = {
  patientId: number;
  status: AdminApprovalStatus | string | null;
  compact?: boolean;
};

const STATUS_META: Record<
  AdminApprovalStatus,
  { label: string; tone: string; Icon: typeof Clock }
> = {
  pending: {
    label: "Pending review",
    tone: "bg-amber-50 border-amber-200 text-amber-900",
    Icon: Clock,
  },
  approved: {
    label: "Approved",
    tone: "bg-emerald-50 border-emerald-200 text-emerald-900",
    Icon: ShieldCheck,
  },
  needs_info: {
    label: "Needs info",
    tone: "bg-sky-50 border-sky-200 text-sky-900",
    Icon: AlertCircle,
  },
  rejected: {
    label: "Rejected",
    tone: "bg-rose-50 border-rose-200 text-rose-900",
    Icon: XCircle,
  },
};

function normalize(status: string | null): AdminApprovalStatus {
  if (status === "approved" || status === "needs_info" || status === "rejected") {
    return status;
  }
  return "pending";
}

export function AdminApprovalControl({
  patientId,
  status,
  compact = false,
}: AdminApprovalControlProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<AdminApprovalStatus>(normalize(status as string | null));
  const [note, setNote] = useState("");

  const current = normalize(status as string | null);
  const meta = STATUS_META[current];

  const mutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/patient-screenings/${patientId}/admin-approval`, {
        status: picked,
        note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: `Admin approval: ${picked.replace("_", " ")}` });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      queryClient.invalidateQueries({ queryKey: ["portal-command-center", patientId] });
      setOpen(false);
      setNote("");
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not update admin approval",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPicked(current);
          setNote("");
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.tone} ${compact ? "h-5" : "h-6"} hover:opacity-90`}
        title={`Admin: ${meta.label}`}
        data-testid={`admin-approval-chip-${patientId}`}
      >
        <meta.Icon className="h-3 w-3" />
        {meta.label}
      </button>

      <Dialog open={open} onOpenChange={(v) => !mutation.isPending && setOpen(v)}>
        <DialogContent className="max-w-sm" data-testid={`admin-approval-dialog-${patientId}`}>
          <DialogHeader>
            <DialogTitle className="text-base">Admin approval</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Status
            </Label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(STATUS_META) as AdminApprovalStatus[]).map((key) => {
                const m = STATUS_META[key];
                const isSelected = picked === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPicked(key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
                      isSelected
                        ? "border-slate-900 bg-slate-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                    data-testid={`admin-approval-option-${key}-${patientId}`}
                  >
                    <m.Icon className="h-3.5 w-3.5" />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <div>
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Note (optional)
              </Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 min-h-[60px] text-xs"
                placeholder="Why this status?"
                data-testid={`admin-approval-note-${patientId}`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || picked === current}
              className="gap-1.5"
              data-testid={`admin-approval-save-${patientId}`}
            >
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
