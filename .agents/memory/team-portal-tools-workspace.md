---
name: Team Portal Tools workspace
description: How the ACS/PCS TeamPortalShell left "Tools" panel is structured (launcher dock + communication tray + playground widgets).
---

The left "Tools" panel in `TeamPortalShell.tsx` is a two-region flex column:
a scrollable `ToolDock` launcher grid on top and a `CommunicationTray`
(Patient/Team/Email/Notes) filling the bottom half. The tray is hidden in
the narrow icon rail (`leftRailSize === "small"`); in narrow mode the dock
takes `flex-1`.

Supporting modules live in `client/src/components/portal/tools/`:
`ToolDock.tsx`, `CommunicationTray.tsx`, `WorkspaceSettingsDialog.tsx`,
`workspacePrefs.ts` (useWorkspacePrefs), `workspaceWidgets.tsx`
(useWorkspaceWidgets + PlaygroundWidgetLayer). Dock tiles drag onto the
playground via MIME `WIDGET_DND_MIME` to spawn floating widgets; the
playground surface needs a ref + onDragOver/onDrop for drop-point math.

**Why / constraints that will bite again:**
- Persistence is intentionally session/local only — NO DB tables. Every
  surface shows a "Not saved" indicator. Shapes are serializable so a
  later pass can persist without touching call sites (follow-ups exist).
- Honest boundaries per tab: Email = live sender (reuses
  `PortalEmailComposerTab`). **Team = REAL Plexus task-message threads**
  (pick a task from your `/api/portal/my-tasks`, read + POST via
  `/api/plexus/tasks/:id/messages`; bubble alignment by
  `senderUserId === currentUser.id`, "You" vs "Teammate" — no names in
  the message row). Patient Messages = boundary/draft-only (no SMS
  backend). Notes = session-only.
- **Playground layout pref (`workspacePrefs.playgroundLayout`)**: "docked"
  = single canvas (`flex-1`); "split" = two-up flex row — left pane
  `basis-1/2` holds the normal center content, right pane
  (`data-testid=playground-split-panel`, `lg:flex` only) docks a second
  CommunicationTray. "Floating" is NOT a layout value — floating = the
  drag-spawned widgets. Wiring lives at the center content region wrapper
  in `TeamPortalShell.tsx` (the `flex-1 min-h-0 overflow-y-auto` region
  became a `flex gap-4` row with a conditional right pane).
- Attribution uses the REAL `currentUser.username`/`currentUser.id`,
  never the admin view-as candidate. Server sets Plexus message sender
  from session, so view-as cannot forge a sender.
- Radix Select/Popover inside the z-[80] portal overlay must be z-[90]+
  (settings dialog Select content uses z-[95]).
