// Phase 2I — the REAL production composition of the workspace mode strip + the
// flag-gated canonical lifecycle section + the mode body, used by TeamPortalShell.
//
// This is a small, behaviorally-renderable boundary (§7) — NOT a test-only
// imitation. It preserves the existing WorkspaceModeSwitcher (all modes) and the
// existing mode-body `children`, and mounts the canonical section between them so
// canonical data renders INSIDE the shell (never as a parallel/standalone page).
// When the flag is OFF the section renders nothing and issues zero requests.

import {
  WorkspaceModeSwitcher, type TeamMemberWorkspaceMode,
} from "@/components/portal/WorkspaceModeSwitcher";
import { CanonicalLifecycleSection } from "./CanonicalLifecycleSection";

type WorkspaceRoleLike = "patientCareSpecialist" | "ancillaryCareSpecialist" | "technician" | "liaison" | undefined;

export function WorkspaceCanonicalHeader({
  activeMode, onModeChange, counts, compact, workspaceRole, canonicalEnabled, children,
}: {
  activeMode: TeamMemberWorkspaceMode;
  onModeChange: (mode: TeamMemberWorkspaceMode) => void;
  counts?: Partial<Record<TeamMemberWorkspaceMode, number>>;
  compact?: boolean;
  workspaceRole?: WorkspaceRoleLike;
  // Test-only override so the flag-ON composition can be behaviorally rendered
  // (production leaves it undefined ⇒ the client flag is the sole gate).
  canonicalEnabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div data-testid="workspace-canonical-header">
      <WorkspaceModeSwitcher activeMode={activeMode} onModeChange={onModeChange} counts={counts} compact={compact} />
      {/* Canonical lifecycle stage vectors, INSIDE the shell. Renders nothing (and
          issues zero requests) when the PCS/ACS flag is OFF; never replaces modes. */}
      <CanonicalLifecycleSection workspaceRole={workspaceRole} enabledOverride={canonicalEnabled} />
      {children}
    </div>
  );
}
