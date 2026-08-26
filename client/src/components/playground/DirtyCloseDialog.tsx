// Dirty Close Dialog — reusable Save / Discard / Cancel for unsaved workspace content.
//
// Used by PlaygroundTabBar when closing a dirty workspace.
// Can be consumed by any workspace that supports dirty-state.

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export type DirtyCloseAction = "save" | "discard" | "cancel";

export type DirtyCloseDialogProps = {
  open: boolean;
  workspaceTitle: string;
  description?: string;
  saving?: boolean;
  onAction: (action: DirtyCloseAction) => void;
};

export function DirtyCloseDialog({
  open,
  workspaceTitle,
  description,
  saving = false,
  onAction,
}: DirtyCloseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onAction("cancel"); }}>
      <DialogContent className="max-w-sm" data-testid="dirty-close-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Unsaved Changes
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-slate-700">
            <span className="font-medium">{workspaceTitle}</span> has unsaved changes.
          </p>
          {description && (
            <p className="text-xs text-slate-500 mt-1">{description}</p>
          )}
        </div>
        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAction("cancel")}
            disabled={saving}
            data-testid="dirty-close-cancel"
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAction("discard")}
              disabled={saving}
              className="text-rose-600 hover:text-rose-700"
              data-testid="dirty-close-discard"
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => onAction("save")}
              disabled={saving}
              data-testid="dirty-close-save"
            >
              {saving ? "Saving..." : "Save & Close"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
