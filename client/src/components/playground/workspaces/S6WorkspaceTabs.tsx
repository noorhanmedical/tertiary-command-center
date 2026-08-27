// S6 Playground workspace wrappers — wire the real Team Portal tool components
// into the Playground workspace engine (Option A). Thin adapters only: they
// supply workspace/patient context + close/open behavior and render the real,
// canonical components. No business logic is forked here.
//
// Each wrapper renders directly on the continuous Playground canvas (a
// transparent `h-full overflow-auto` host) — no full-workspace tile.

import { usePlayground } from "../PlaygroundWorkspaceProvider";
import { dispatchOpenWorkspace } from "../playgroundEvents";
import type { WorkspaceRenderProps } from "../types";

import { PortalEmailComposerTab } from "@/components/portal/PortalEmailComposerTab";
import { QuickNoteTool } from "@/components/portal/QuickNoteTool";
import { PortalPatientSearchTab } from "@/components/portal/PortalPatientSearchTab";
import { InternalContactsTool } from "@/components/portal/InternalContactsTool";
import InvoiceDeskPanel from "@/components/portal/InvoiceDeskPanel";
import { PortalTemplatesResourcesTab } from "@/components/portal/PortalTemplatesResourcesTab";
import { PortalMarketingTab } from "@/components/portal/PortalMarketingTab";

function Host({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div className="h-full w-full overflow-auto bg-transparent" data-testid={testId}>
      {children}
    </div>
  );
}

// ─── Email ───────────────────────────────────────────────────────────────────
export function EmailWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  const { foregroundPatientId } = usePlayground();
  const psid = workspace.patientScreeningId ?? foregroundPatientId ?? null;
  const selectedPatient =
    psid != null ? { patientScreeningId: psid, name: workspace.title ?? "Patient", email: null } : null;
  return (
    <Host testId={`workspace-email-${workspace.id}`}>
      <PortalEmailComposerTab selectedPatient={selectedPatient} />
    </Host>
  );
}

// ─── Quick Note ────────────────────────────────────────────────────────────── 
export function QuickNoteWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  return (
    <Host testId={`workspace-quick-note-${workspace.id}`}>
      <QuickNoteTool />
    </Host>
  );
}

// ─── Patient Search ────────────────────────────────────────────────────────────
export function PatientSearchWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  return (
    <Host testId={`workspace-patient-search-${workspace.id}`}>
      <PortalPatientSearchTab
        onSelectPatient={(row) => {
          if (row.patientScreeningId != null) {
            // Open/focus the patient EHR workspace (dedupe prevents duplicates).
            dispatchOpenWorkspace({
              type: "patient_ehr",
              title: row.name ?? "Patient",
              patientScreeningId: row.patientScreeningId,
              facilityId: row.facility ?? null,
            });
          }
        }}
      />
    </Host>
  );
}

// ─── Contacts ──────────────────────────────────────────────────────────────────
export function ContactsWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  return (
    <Host testId={`workspace-contacts-${workspace.id}`}>
      <InternalContactsTool />
    </Host>
  );
}

// ─── Invoice Desk ──────────────────────────────────────────────────────────────
export function InvoiceDeskWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  return (
    <Host testId={`workspace-invoice-desk-${workspace.id}`}>
      <InvoiceDeskPanel />
    </Host>
  );
}

// ─── Scripts (Staff templates/resources) ─────────────────────────────────────
export function ScriptsWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  return (
    <Host testId={`workspace-scripts-${workspace.id}`}>
      <PortalTemplatesResourcesTab
        onInsertIntoComposer={(tpl) =>
          dispatchOpenWorkspace({ type: "email", title: "Email", subtitle: tpl.subject })
        }
      />
    </Host>
  );
}

// ─── Proof / PDFs (Marketing materials) ───────────────────────────────────────
export function ProofPdfsWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  const { foregroundPatientId } = usePlayground();
  const psid = workspace.patientScreeningId ?? foregroundPatientId ?? null;
  const selectedPatient =
    psid != null ? { patientScreeningId: psid, name: workspace.title ?? "Patient", email: null } : null;
  return (
    <Host testId={`workspace-proof-pdfs-${workspace.id}`}>
      <PortalMarketingTab
        selectedPatient={selectedPatient}
        onComposeEmailWithMaterials={() =>
          dispatchOpenWorkspace({ type: "email", title: "Email" })
        }
      />
    </Host>
  );
}
