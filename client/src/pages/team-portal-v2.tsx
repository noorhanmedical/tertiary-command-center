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

type PreviewLink = {
  href: string;
  title: string;
  subtitle: string;
  group: "Team Portal" | "Executive" | "Home & Nav" | "Clinical" | "Ops & Finance" | "Admin";
  testId: string;
};

const V2_PREVIEW_LINKS: PreviewLink[] = [
  {
    href: "/patient-care-specialist-portal-v2",
    title: "Patient Care Specialist Workspace",
    subtitle:
      "Call list, callbacks, patient coordination, and appointment workflow.",
    group: "Team Portal",
    testId: "link-team-portal-v2-pcs",
  },
  {
    href: "/ancillary-care-specialist-portal-v2",
    title: "Ancillary Care Specialist Workspace",
    subtitle:
      "Clinic schedule, ancillary schedule, call list, consent, procedure completion, uploads.",
    group: "Team Portal",
    testId: "link-team-portal-v2-acs",
  },
  {
    href: "/mission-control",
    title: "Mission Control",
    subtitle: "Executive monitoring dashboard — lanes, role queues, spine.",
    group: "Executive",
    testId: "link-mission-control",
  },
  {
    href: "/physician-portal-v2",
    title: "Physician Portal V2",
    subtitle:
      "Alternate clinician command center — Dashboard, Finance, Orders, Engagement tabs.",
    group: "Clinical",
    testId: "link-physician-portal-v2",
  },
  {
    href: "/home-v2",
    title: "Home V2",
    subtitle: "HomeLiveDashboard + HomeWorldClocks preview.",
    group: "Home & Nav",
    testId: "link-home-v2",
  },
  {
    href: "/home-preview",
    title: "Home Preview",
    subtitle: "Full-page home redesign — flat navy tiles, uniform accents.",
    group: "Home & Nav",
    testId: "link-home-preview",
  },
  {
    href: "/clinical-intelligence",
    title: "Clinical Intelligence & Governance",
    subtitle: "Plexus IQ knowledge tile — 20-module governance prototype.",
    group: "Clinical",
    testId: "link-clinical-intelligence",
  },
  {
    href: "/imaging-central",
    title: "Imaging Central",
    subtitle: "Imaging worklist and reading room UX.",
    group: "Clinical",
    testId: "link-imaging-central",
  },
  {
    href: "/plexus-bank",
    title: "Plexus Bank",
    subtitle:
      "Frontend-only bank/finance ops mock — invoice desk, claims, payer ledger.",
    group: "Ops & Finance",
    testId: "link-plexus-bank",
  },
  {
    href: "/plexus-iq-prototype",
    title: "Plexus IQ Operating Canvas",
    subtitle: "Operating list + row prototype.",
    group: "Clinical",
    testId: "link-plexus-iq-prototype",
  },
  {
    href: "/clinic-analytics",
    title: "Clinic Analytics",
    subtitle: "Facility-level KPI shell.",
    group: "Ops & Finance",
    testId: "link-clinic-analytics",
  },
  {
    href: "/clinic-onboarding",
    title: "Clinic Onboarding",
    subtitle: "New-clinic onboarding checklist shell.",
    group: "Ops & Finance",
    testId: "link-clinic-onboarding",
  },
  {
    href: "/admin-settings",
    title: "Admin Settings (Unified)",
    subtitle:
      "Consolidated admin/settings shell — System, Billing, Team, Facility, Logs sections.",
    group: "Admin",
    testId: "link-admin-settings",
  },
];

function LinkCard({ link }: { link: PreviewLink }) {
  return (
    <a
      href={link.href}
      className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
      data-testid={link.testId}
    >
      <h2 className="text-lg font-semibold text-slate-900">{link.title}</h2>
      <p className="mt-1 text-sm text-slate-600">{link.subtitle}</p>
      <p className="mt-3 font-mono text-[11px] text-slate-400">{link.href}</p>
    </a>
  );
}

export function TeamPortalV2LandingPage() {
  const groups = Array.from(new Set(V2_PREVIEW_LINKS.map((l) => l.group)));
  return (
    <AdminOnly>
      <div className="flex h-full w-full flex-col">
        <PageHeader
          title="Team Portal V2 Preview"
          subtitle="Restored Replit UI/UX — admin only"
        />
        <V2PreviewBanner />
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6">
          {groups.map((group) => (
            <section key={group}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {group}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {V2_PREVIEW_LINKS.filter((l) => l.group === group).map((l) => (
                  <LinkCard key={l.href} link={l} />
                ))}
              </div>
            </section>
          ))}
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
