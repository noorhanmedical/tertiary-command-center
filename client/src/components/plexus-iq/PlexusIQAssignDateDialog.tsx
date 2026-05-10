import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Small dialog used by the Plexus IQ unscheduled-batches panel to assign a
// scheduleDate to a batch that was created without one. PATCHes the batch
// via the existing /api/screening-batches/:id endpoint (now accepting
// scheduleDate). After assignment the parent refetches the calendar
// summary and the batch lights up on the calendar.

export function PlexusIQAssignDateDialog({
  open,
  batchId,
  batchLabel,
  onClose,
  onAssign,
  pending,
}: {
  open: boolean;
  batchId: number | null;
  batchLabel: string;
  onClose: () => void;
  onAssign: (batchId: number, isoDate: string) => void | Promise<void>;
  pending: boolean;
}) {
  const [date, setDate] = useState<string>(todayIso());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDate(todayIso());
      setError(null);
    }
  }, [open, batchId]);

  async function handleAssign() {
    if (!batchId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Pick a valid date.");
      return;
    }
    setError(null);
    await onAssign(batchId, date);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm rounded-2xl" data-testid="plexus-iq-assign-date-dialog">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Assign date
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-slate-600 truncate" title={batchLabel}>
            {batchLabel}
          </p>
          <div>
            <Label htmlFor="plexus-iq-assign-date" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Date
            </Label>
            <Input
              id="plexus-iq-assign-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 h-9 text-sm"
              data-testid="input-plexus-iq-assign-date"
            />
          </div>
          {error && (
            <p className="text-xs text-red-600" data-testid="text-plexus-iq-assign-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            data-testid="button-plexus-iq-assign-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAssign}
            disabled={pending || !batchId}
            className="gap-1.5"
            data-testid="button-plexus-iq-assign-submit"
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            Assign date
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
