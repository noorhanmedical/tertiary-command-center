// Workspace settings dialog.
//
// Exposes workspace preferences. Preferences are saved automatically to the
// server (per user) as they change — see useWorkspacePrefs — so they persist
// across reloads and sync across devices.

import {
  SketchDialog,
  SketchDialogContent,
  SketchDialogHeader,
  SketchDialogTitle,
  SketchDialogFooter,
} from "@/components/playground/sketch/SketchOverlays";
import { SketchButton } from "@/components/playground/sketch/SketchPrimitives";
import { SketchSelect } from "@/components/playground/sketch/SketchSelect";
import { Label } from "@/components/ui/label";
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
    <SketchDialog open={open} onOpenChange={handleOpenChange}>
      <SketchDialogContent className="max-w-md" data-testid="workspace-settings-dialog">
        <SketchDialogHeader>
          <SketchDialogTitle>Workspace Settings</SketchDialogTitle>
        </SketchDialogHeader>

        <div className="rounded-lg px-3 py-2 text-[11px]" style={{ backgroundColor: "rgba(92,122,92,0.12)", color: "var(--sketch-green)" }} data-testid="settings-saved-note">
          Preferences are saved automatically and apply everywhere you sign in.
        </div>

        <div className="divide-y divide-slate-200/60">
          <Row label="Default tray tab" hint="Which communication tab opens first.">
            <SketchSelect
              seedId="setting-default-tray-tab"
              value={prefs.defaultTrayTab}
              onChange={(e) => updatePref("defaultTrayTab", e.target.value as TrayTab)}
              data-testid="setting-default-tray-tab"
            >
              {/* Patient Messages / patient SMS intentionally absent —
                  no live patient-texting path on this platform. */}
              <option value="direct">Direct Messages</option>
              <option value="team">Team Chat</option>
            </SketchSelect>
          </Row>

          <Row label="Calendar behavior" hint="What the Calendar tool does when clicked. Quick schedule pop-up is the default.">
            <SketchSelect
              seedId="setting-calendar-behavior"
              value={prefs.calendarBehavior}
              onChange={(e) => updatePref("calendarBehavior", e.target.value as CalendarBehavior)}
              data-testid="setting-calendar-behavior"
            >
              <option value="quickSchedule">Quick schedule pop-up (default)</option>
              <option value="playground">Open full calendar view</option>
            </SketchSelect>
          </Row>

          <Row label="Playground layout" hint="Docked single canvas or split two-up.">
            <SketchSelect
              seedId="setting-playground-layout"
              value={prefs.playgroundLayout}
              onChange={(e) => updatePref("playgroundLayout", e.target.value as PlaygroundLayout)}
              data-testid="setting-playground-layout"
            >
              <option value="docked">Docked</option>
              <option value="split">Split</option>
            </SketchSelect>
          </Row>

          <Row label="Show sticky notes" hint="Show/hide Playground widgets.">
            <Switch
              className="data-[state=checked]:bg-[color:var(--sketch-blue)]"
              checked={prefs.stickyNotesVisible}
              onCheckedChange={(v) => updatePref("stickyNotesVisible", v)}
              data-testid="setting-sticky-visible"
            />
          </Row>

          <Row label="Pin Tools panel by default">
            <Switch
              className="data-[state=checked]:bg-[color:var(--sketch-blue)]"
              checked={prefs.toolsPinnedByDefault}
              onCheckedChange={(v) => updatePref("toolsPinnedByDefault", v)}
              data-testid="setting-tools-pinned"
            />
          </Row>

          <Row label="Pin Work Queue by default">
            <Switch
              className="data-[state=checked]:bg-[color:var(--sketch-blue)]"
              checked={prefs.workQueuePinnedByDefault}
              onCheckedChange={(v) => updatePref("workQueuePinnedByDefault", v)}
              data-testid="setting-workqueue-pinned"
            />
          </Row>
        </div>

        <SketchDialogFooter className="flex items-center justify-between sm:justify-between">
          <SketchButton variant="ghost" size="sm" seedId="setting-reset" onClick={resetPrefs} data-testid="setting-reset">
            Reset to defaults
          </SketchButton>
          <SketchButton variant="primary" size="sm" seedId="setting-done" onClick={() => void handleOpenChange(false)} data-testid="setting-done">
            Done
          </SketchButton>
        </SketchDialogFooter>
      </SketchDialogContent>
    </SketchDialog>
  );
}
