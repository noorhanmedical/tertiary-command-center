// Workspace settings dialog.
//
// Exposes workspace preferences. Preferences are saved automatically to the
// server (per user) as they change — see useWorkspacePrefs — so they persist
// across reloads and sync across devices.

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  WorkspacePrefs,
  TrayTab,
  PlaygroundLayout,
  CalendarBehavior,
} from "./workspacePrefs";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <Label className="text-sm text-slate-800">{label}</Label>
        {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  prefs,
  updatePref,
  resetPrefs,
  flushPersist,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: WorkspacePrefs;
  updatePref: <K extends keyof WorkspacePrefs>(key: K, value: WorkspacePrefs[K]) => void;
  resetPrefs: () => void;
  // Optional so existing callers that don't yet supply a flush fall
  // back to the old debounce-only behavior. When supplied, closing
  // the dialog awaits any pending debounced write, so a user who
  // hits Escape/Done and immediately navigates away or reloads
  // never loses a preference edit.
  flushPersist?: () => Promise<void>;
}) {
  const handleOpenChange = async (next: boolean) => {
    if (!next && flushPersist) {
      // Commit any pending write BEFORE the dialog unmounts. Await
      // so the request lands before any subsequent navigation.
      await flushPersist();
    }
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="workspace-settings-dialog">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700" data-testid="settings-saved-note">
          Preferences are saved automatically and apply everywhere you sign in.
        </div>

        <div className="divide-y divide-slate-100">
          <Row label="Default tray tab" hint="Which communication tab opens first.">
            <Select
              value={prefs.defaultTrayTab}
              onValueChange={(v) => updatePref("defaultTrayTab", v as TrayTab)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs" data-testid="setting-default-tray-tab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[95]">
                <SelectItem value="patients">Patient Messages</SelectItem>
                <SelectItem value="direct">Direct Messages</SelectItem>
                <SelectItem value="team">Team Chat</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label="Calendar behavior" hint="What the Calendar tool does when clicked. Quick schedule pop-up is the default.">
            <Select
              value={prefs.calendarBehavior}
              onValueChange={(v) => updatePref("calendarBehavior", v as CalendarBehavior)}
            >
              <SelectTrigger className="h-8 w-[170px] text-xs" data-testid="setting-calendar-behavior">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[95]">
                <SelectItem value="quickSchedule">Quick schedule pop-up (default)</SelectItem>
                <SelectItem value="playground">Open full calendar view</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label="Playground layout" hint="Docked single canvas or split two-up.">
            <Select
              value={prefs.playgroundLayout}
              onValueChange={(v) => updatePref("playgroundLayout", v as PlaygroundLayout)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs" data-testid="setting-playground-layout">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[95]">
                <SelectItem value="docked">Docked</SelectItem>
                <SelectItem value="split">Split</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label="Show sticky notes" hint="Show/hide Playground widgets.">
            <Switch
              checked={prefs.stickyNotesVisible}
              onCheckedChange={(v) => updatePref("stickyNotesVisible", v)}
              data-testid="setting-sticky-visible"
            />
          </Row>

          <Row label="Pin Tools panel by default">
            <Switch
              checked={prefs.toolsPinnedByDefault}
              onCheckedChange={(v) => updatePref("toolsPinnedByDefault", v)}
              data-testid="setting-tools-pinned"
            />
          </Row>

          <Row label="Pin Work Queue by default">
            <Switch
              checked={prefs.workQueuePinnedByDefault}
              onCheckedChange={(v) => updatePref("workQueuePinnedByDefault", v)}
              data-testid="setting-workqueue-pinned"
            />
          </Row>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={resetPrefs} data-testid="setting-reset">
            Reset to defaults
          </Button>
          <Button size="sm" onClick={() => void handleOpenChange(false)} data-testid="setting-done">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
