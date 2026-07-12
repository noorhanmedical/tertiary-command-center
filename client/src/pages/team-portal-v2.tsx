// Team Portal V2 — Replit UI/UX restore preview.
//
// Renders the expanded Team Portal shell brought over from the Replit
// build (archive/plexus-iq-multibundle-2026-07). Mounted on parallel
// routes so the current production PortalShell/TeamPortalShell (served
// under /patient-care-specialist-portal and /ancillary-care-specialist-portal)
// keeps working unchanged.
//
// Notes on backing surfaces:
//   - Call list / clinic schedule / ancillary schedule / signatures /
//     workflow panel / patient chart / plexus tasks / templates /
//     document library / email composer / internal contacts / quick note
//     → all wired to live server APIs.
//   - Messaging tab + floating window → local-only UI state (no vendor
//     SMS, no Direct Messages persistence); the mockPortalMessages hook
//     is honestly labeled and does not touch any backend.
//   - Invoice Desk panel → Plexus Bank frontend-only mock store with
//     localStorage persistence; no real bank/payroll/clearinghouse.
//   - Workspace prefs / widgets → local-only React state; the visual
//     shell is preserved but nothing is persisted server-side.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { TeamPortalShellV2 } from "@/components/portal/TeamPortalShellV2";

type WorkspaceRole =
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist";

type TeamMemberWorkspaceMode = "clinicSchedule" | "ancillarySchedule" | "callList";

const INTERNAL_ROLE: Record<WorkspaceRole, "technician" | "liaison"> = {
  ancillaryCareSpecialist: "technician",
  patientCareSpecialist: "liaison",
};

const WORKSPACE_LABEL: Record<WorkspaceRole, string> = {
  ancillaryCareSpecialist: "Ancillary Care Specialist Workspace (V2 Preview)",
  patientCareSpecialist: "Patient Care Specialist Workspace (V2 Preview)",
};

const DEFAULT_MODE: Record<WorkspaceRole, TeamMemberWorkspaceMode> = {
  ancillaryCareSpecialist: "clinicSchedule",
  patientCareSpecialist: "callList",
};

type CurrentUser = { role?: string | null } | null;

function useCurrentUser(): { data: CurrentUser; isLoading: boolean } {
  const q = useQuery<CurrentUser>({
    queryKey: ["/api/user"],
    queryFn: async () => {
      const res = await fetch("/api/user", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
    staleTime: 60_000,
  });
  return { data: q.data ?? null, isLoading: q.isLoading };
}

function V2PreviewBanner() {
  return (
    <div
      role="status"
      className="border-b border-amber-200/60 bg-amber-50 px-4 py-2 text-[13px] leading-snug text-amber-900"
      data-testid="team-portal-v2-preview-banner"
    >
      <strong className="font-semibold">Team Portal V2 Preview — Replit UI restored.</strong>{" "}
      This route renders the expanded portal shell for admin review. The
      canonical production portals at{" "}
      <code className="font-mono">/patient-care-specialist-portal</code> and{" "}
      <code className="font-mono">/ancillary-care-specialist-portal</code>{" "}
      are unchanged. Messaging, workspace prefs/widgets, and the invoice
      desk panel run on local UI state only.
    </div>
  );
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="team-portal-v2-loading">
        Loading…
      </div>
    );
  }
  if (!user || user.role !== "admin") {
    return <Redirect to="/team-member-portals" />;
  }
  return <>{children}</>;
}

function V2Renderer({ role }: { role: WorkspaceRole }) {
  const label = useMemo(() => WORKSPACE_LABEL[role], [role]);
  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title={label}
        subtitle="Preview of the restored Replit UI shell — admin only"
      />
      <V2PreviewBanner />
      <div className="flex-1 overflow-hidden">
        <TeamPortalShellV2
          role={INTERNAL_ROLE[role]}
          workspaceLabel={label}
          defaultMode={DEFAULT_MODE[role]}
          workspaceRole={role}
        />
      </div>
    </div>
  );
}

export function TeamPortalV2LandingPage() {
  return (
    <AdminOnly>
      <div className="flex h-full w-full flex-col">
        <PageHeader
          title="Team Portal V2 Preview"
          subtitle="Restored Replit UI/UX — admin only"
        />
        <V2PreviewBanner />
        <div className="mx-auto grid w-full max-w-3xl gap-4 p-6 sm:grid-cols-2">
          <a
            href="/patient-care-specialist-portal-v2"
            className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            data-testid="link-team-portal-v2-pcs"
          >
            <h2 className="text-lg font-semibold text-slate-900">
              Patient Care Specialist Workspace
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              V2 preview — call list, callbacks, patient coordination, and
              appointment workflow.
            </p>
          </a>
          <a
            href="/ancillary-care-specialist-portal-v2"
            className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            data-testid="link-team-portal-v2-acs"
          >
            <h2 className="text-lg font-semibold text-slate-900">
              Ancillary Care Specialist Workspace
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              V2 preview — clinic schedule, ancillary schedule, call list,
              consent, procedure completion, uploads, and reports.
            </p>
          </a>
        </div>
      </div>
    </AdminOnly>
  );
}

export function PatientCareSpecialistPortalV2Page() {
  return (
    <AdminOnly>
      <V2Renderer role="patientCareSpecialist" />
    </AdminOnly>
  );
}

export function AncillaryCareSpecialistPortalV2Page() {
  return (
    <AdminOnly>
      <V2Renderer role="ancillaryCareSpecialist" />
    </AdminOnly>
  );
}
