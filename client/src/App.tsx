import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import HomePreview from "@/pages/home-preview";
import MissionControlPage from "@/pages/mission-control";
import ImagingCentralPage from "@/pages/imaging-central";
import ClinicAnalyticsPage from "@/pages/clinic-analytics";
import ClinicOnboardingPage from "@/pages/clinic-onboarding";
import SchedulePage from "@/pages/SchedulePage";
import SharedSchedule from "@/pages/shared-schedule";
import PatientDatabasePage from "@/pages/patient-database";
import DocumentsPage from "@/pages/documents";
import BillingPage from "@/pages/billing";
import InvoicesPage from "@/pages/invoices";
import DocumentUploadPage from "@/pages/document-upload";
import AppointmentsPage from "@/pages/appointments";
// NOTE: OutreachPage (@/pages/outreach) is intentionally retained on disk but
// no longer imported/mounted. /scheduler-portal now redirects to
// /engagement-center (see routes below). Kept pending a dead-code audit.
import OutreachSchedulerPortalPage from "@/pages/outreach-scheduler-portal";
// NOTE: TechnicianPortalPage (@/pages/technician-portal) and
// LiaisonPortalPage (@/pages/liaison-portal) are intentionally retained on
// disk but no longer imported/mounted. Their old routes now redirect to the
// canonical ACS/PCS workspaces (see routes below). Kept pending a separate
// dead-code audit.
import PhysicianPortalPage from "@/pages/physician-portal";
import AdminSettingsPage from "@/pages/admin-settings";
import AdminAccessPage from "@/pages/admin-access";
import BillingReadinessPage from "@/pages/billing-readiness";
import InvoiceBatchesPage from "@/pages/invoice-batches";
import InvoiceReviewPage from "@/pages/invoice-review";
import InvoiceDeliveryPage from "@/pages/invoice-delivery";
import BillingReportsPage from "@/pages/billing-reports";
import ScheduleDashboardPage from "@/pages/schedule-dashboard";
import TeamOpsPage from "@/pages/team-ops";
import PlexusTasksPage from "@/pages/plexus-tasks";
import PlexusBankPage from "@/pages/plexus-bank";
import DocumentLibraryPage from "@/pages/document-library";
import LoginPage from "@/pages/login";
import { PlexusAdminShell } from "@/components/workspace/PlexusAdminShell";
import { WorkspaceTabsProvider, clearWorkspaceTabsStorage } from "@/lib/navigation/workspaceTabs";
import {
  clearSession as clearPlaygroundSession,
  clearAllCallDrafts,
} from "@/components/playground/sessionPersistence";
import { resolveDefaultWorkspaceRoute } from "@/lib/navigation/defaultWorkspaceRoutes";
import { AccessProvider, canEnterAccessSettings } from "@/lib/access/accessContext";
import AccessPendingPage from "@/pages/access-pending";
import { isTeamPortalRoute } from "@/lib/navigation/workspaceRegistry";
import ClinicWorkflowDemoPage from "@/pages/clinic-workflow-demo";
import QualificationPage from "@/pages/qualification";
import OutreachQualificationPage from "@/pages/outreach-qualification";
import PlexusIQPage from "@/pages/plexus-iq";
import ClinicalIntelligencePage from "@/pages/clinical-intelligence";
// Temporary design-prototype route — mock data only, not production.
import PlexusIqPrototypePage from "@/pages/plexus-iq-prototype";
import TeamMemberPortalsPage from "@/pages/team-member-portals";
// Preview-only route — real Team Portal with iOS-frosted rails scoped under
// .rail-glass-preview. Live portals unchanged. Not production.
import TeamPortalGlassPreviewPage from "@/pages/team-portal-glass-preview";
import PatientCareSpecialistPortalPage from "@/pages/patient-care-specialist-portal";
import AncillaryCareSpecialistPortalPage from "@/pages/ancillary-care-specialist-portal";
import AncillaryScreeningPage from "@/pages/ancillary-screening";
import EngagementCenterPage from "@/pages/engagement-center";
// Preview-only route — isolated Plexus winter design-system gallery. Uses the
// production primitives under client/src/components/plexus-ui; scoped by the
// `.plexus-ui` wrapper so no live page is affected. Not production.
import UiSystemPreviewPage from "@/pages/ui-system-preview";
// Design mockup (static sample data) — pixel-faithful Ancillary Documents
// reference. Not production, not wired to live data.
import AncillaryDocumentsMockupPage from "@/pages/ancillary-documents-mockup";
// Slice 1.5: PatientDirectoryLiveRoute import removed — the
// /patient-directory/live route now redirects to /patient-directory.

const SIDEBAR_STYLE = {
  "--sidebar-width": "18rem",
  "--sidebar-width-icon": "3rem",
} as React.CSSProperties;

// `defaultWorkspace` is the backend-derived controlled landing identifier
// (see AccessContextService). It is additive/optional; legacy `role` remains
// the transition-era authority for the app's existing role guards.
//
// Phase 4B: the additive access-context fields below are ALREADY returned by
// GET /api/auth/me (they were additive since Phase 2.5). They are typed here so
// the access-management Settings UI can read effective permissions/scope/
// service access WITHOUT recomputing anything on the client — the backend is
// authoritative. All are optional so the ~20 legacy consumers are unaffected.
export interface AuthUserAccessRole {
  key: string;
  displayName: string;
  scopeType: string;
  defaultWorkspace: string;
  isPrimary: boolean;
}
export type AuthUser = {
  id: string;
  username: string;
  role: string;
  clinicId?: number | null;
  defaultWorkspace?: string | null;
  email?: string | null;
  displayName?: string | null;
  jobTitle?: string | null;
  accountStatus?: string;
  roles?: AuthUserAccessRole[];
  permissions?: string[];
  scope?: { platform: boolean; organizationIds: number[]; clinicIds: number[] };
  serviceAccess?: string[];
} | null;

function AdminGuard({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  if (!user || user.role !== "admin") {
    return <Redirect to="/home" />;
  }
  return <>{children}</>;
}

function RoleGuard({ user, roles, children }: { user: AuthUser; roles: string[]; children: React.ReactNode }) {
  if (!user || !roles.includes(user.role)) {
    return <Redirect to="/home" />;
  }
  return <>{children}</>;
}

// Team-portal (ACS/PCS) access. Mirrors the server-side PORTAL_ROLES set plus
// the DB-derived access context (defaultWorkspace / roles[]) so a user
// provisioned under the new RBAC model is recognized. The backend remains
// authoritative (every /api/portal|scheduler-portal|technician-liaison route
// is scoped); this guard is defense-in-depth + correct UX so an unauthorized
// user is sent to their own workspace instead of an empty/erroring portal.
const PORTAL_ACCESS_ROLES = [
  "admin", "technician", "liaison", "acs", "pcs", "ancillary_technician", "scheduler",
];
function hasPortalAccess(user: AuthUser): boolean {
  if (!user) return false;
  if (PORTAL_ACCESS_ROLES.includes(user.role)) return true;
  const dw = user.defaultWorkspace ?? "";
  if (dw === "pcs" || dw === "acs" || dw === "technician") return true;
  const keys = (user.roles ?? []).map((r) => r.key);
  return keys.some((k) => ["acs", "pcs", "ancillary_technician", "scheduler"].includes(k));
}
function PortalAccessGuard({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  if (!hasPortalAccess(user)) {
    return <Redirect to={resolveDefaultWorkspaceRoute(user?.defaultWorkspace ?? undefined)} />;
  }
  return <>{children}</>;
}

// Phase 4B — permission-aware entry to the access-management Settings console.
// A user may enter if they hold ANY settings-entry capability (users/org/clinic
// view-or-manage, or an audit-view permission). This deliberately does NOT
// require the legacy `admin` role, so an Organization Admin or Clinic Admin can
// enter and see only the sections they're authorized for. Denied users are sent
// to their own default workspace (Investor → /access-pending), never granted a
// broader surface. The backend enforces every /api/access/* call regardless.
function AccessSettingsGuard({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  if (!user) return <Redirect to="/home" />;
  if (!canEnterAccessSettings(user.permissions)) {
    return <Redirect to={resolveDefaultWorkspaceRoute(user.defaultWorkspace)} />;
  }
  return <>{children}</>;
}

function AuthenticatedApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [location] = useLocation();

  // ACS / PCS FULL isolation: dedicated Team Portal routes render ONLY their
  // own portal experience — no TopBanner, GlobalDock, GlobalNav, or
  // WorkspaceTabs. They never mount the main-app shell.
  if (isTeamPortalRoute(location)) {
    return (
      <Switch>
        <Route path="/technician-portal">
          <Redirect to="/ancillary-care-specialist-portal" />
        </Route>
        <Route path="/liaison-technician-portal">
          <Redirect to="/patient-care-specialist-portal" />
        </Route>
        <Route path="/liaison-portal">
          <Redirect to="/patient-care-specialist-portal" />
        </Route>
        <Route path="/team-portal-glass-preview" component={TeamPortalGlassPreviewPage} />
        <Route path="/patient-care-specialist-portal">
          <PortalAccessGuard user={user}>
            <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
              <PatientCareSpecialistPortalPage />
            </SidebarProvider>
          </PortalAccessGuard>
        </Route>
        <Route path="/ancillary-care-specialist-portal">
          <PortalAccessGuard user={user}>
            <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
              <AncillaryCareSpecialistPortalPage />
            </SidebarProvider>
          </PortalAccessGuard>
        </Route>
      </Switch>
    );
  }

  return (
    <AccessProvider>
      <WorkspaceTabsProvider role={user?.role}>
        <PlexusAdminShell user={user} onLogout={onLogout}>
        <Switch>
          {/* Schedule detail belongs to the Global Schedule workspace and now
              renders INSIDE the persistent Admin shell (no longer a bypass).
              It resolves to workspace "global-schedule" — no extra tab. */}
          <Route path="/schedule/:id" component={SharedSchedule} />
          <Route path="/">
            <Redirect to="/home" />
          </Route>
          {/* Neutral safe landing for authenticated users with no supported
              workspace yet (e.g. Investor). Renders full-screen; exposes no
              operational/PHI data. TEMPORARY / UNSUPPORTED — not a portal. */}
          <Route path="/access-pending">
            <AccessPendingPage onLogout={onLogout} />
          </Route>
                <Route path="/archive">
                  <Redirect to="/patient-directory" />
                </Route>
                <Route path="/plexus">
                  <Redirect to="/ancillary-documents" />
                </Route>
                <Route path="/home">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <Home />
                  </SidebarProvider>
                </Route>
                <Route path="/home-preview">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <HomePreview />
                  </SidebarProvider>
                </Route>
                {/* iOS-frosted rails preview on the real Team Portal (not production). */}
                <Route path="/team-portal-glass-preview" component={TeamPortalGlassPreviewPage} />
                <Route path="/ancillary-screening/:ancillaryCaseId" component={AncillaryScreeningPage} />
                {/* Plexus winter design-system gallery (§78). Route-isolated preview. */}
                <Route path="/ui-system-preview" component={UiSystemPreviewPage} />
                {/* Pixel-faithful design mockup (static data). Not production. */}
                <Route path="/ancillary-documents-mockup" component={AncillaryDocumentsMockupPage} />
                <Route path="/mission-control">
                  {/* Full-page layout — Mission Control uses no Sidebar, so it
                      renders directly in the shell's full-width content outlet.
                      Wrapping it in SidebarProvider (a flex row expecting a
                      Sidebar + SidebarInset) collapsed it into a narrow left
                      column. */}
                  <MissionControlPage />
                </Route>
                <Route path="/imaging-central">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <ImagingCentralPage />
                  </SidebarProvider>
                </Route>
                {/* Compatibility redirects: the imaging execution module was
                    renamed from Ultrasound/Technician Central to Imaging Central.
                    Old deep links keep working. */}
                <Route path="/ultrasound-central">
                  <Redirect to="/imaging-central" />
                </Route>
                <Route path="/technician-central">
                  <Redirect to="/imaging-central" />
                </Route>
                <Route path="/clinic-analytics">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <ClinicAnalyticsPage />
                  </SidebarProvider>
                </Route>
                {/* /analytics is preserved and renders Clinic Analytics. */}
                <Route path="/analytics">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <ClinicAnalyticsPage />
                  </SidebarProvider>
                </Route>
                <Route path="/clinic-onboarding">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <ClinicOnboardingPage />
                  </SidebarProvider>
                </Route>
                <Route path="/schedule" component={SchedulePage} />
                {/* Phase 1 Slice 1.5: /patient-directory/live consolidated
                    back into the canonical /patient-directory route.
                    The redirect (instead of 404) preserves existing
                    bookmarks. PatientDirectoryLivePage components
                    remain in client/src/components/patient-directory/
                    for reuse inside the canonical surface. */}
                <Route path="/patient-directory/live">
                  <Redirect to="/patient-directory" />
                </Route>
                <Route path="/patient-directory" component={PatientDatabasePage} />
                <Route path="/patient-database">
                  <Redirect to="/patient-directory" />
                </Route>
                <Route path="/ancillary-documents" component={DocumentsPage} />
                <Route path="/documents">
                  <Redirect to="/ancillary-documents" />
                </Route>
                <Route path="/billing" component={BillingPage} />
                <Route path="/invoices">
                  <RoleGuard user={user} roles={["admin", "biller"]}><InvoicesPage /></RoleGuard>
                </Route>
                <Route path="/document-upload" component={DocumentUploadPage} />
                <Route path="/appointments" component={AppointmentsPage} />
                {/* Per-scheduler live call console. Retained on disk and
                    routable by direct/deep link, but no longer surfaced via
                    the (removed) Outreach Center dashboard tiles. */}
                <Route path="/outreach/scheduler/:id" component={OutreachSchedulerPortalPage} />
                {/* Legacy Outreach Center surface removed from nav. The
                    OutreachPage dashboard was mostly UI placeholders; the
                    active canonical outreach surface is the Engagement Center.
                    These legacy URLs now redirect there. OutreachPage remains
                    on disk pending a dead-code audit. */}
                <Route path="/scheduler-portal">
                  <Redirect to="/engagement-center" />
                </Route>
                <Route path="/outreach-center">
                  <Redirect to="/engagement-center" />
                </Route>
                <Route path="/outreach">
                  <Redirect to="/engagement-center" />
                </Route>
        <Route path="/clinic-workflow-demo" component={ClinicWorkflowDemoPage} />
                {/* Legacy direct mounts removed from user-facing nav. These
                    URLs no longer render the old PortalShell; they redirect
                    to the canonical team-member workspaces:
                      /technician-portal          → ACS workspace
                      /liaison-technician-portal  → PCS workspace
                    Back-compat with existing bookmarks/deep links. */}
                <Route path="/technician-portal">
                  <Redirect to="/ancillary-care-specialist-portal" />
                </Route>
                <Route path="/liaison-technician-portal">
                  <Redirect to="/patient-care-specialist-portal" />
                </Route>
                <Route path="/clinician-portal">
                  <RoleGuard user={user} roles={["admin", "clinician"]}><PhysicianPortalPage /></RoleGuard>
                </Route>
                <Route path="/physician-portal">
                  <Redirect to="/clinician-portal" />
                </Route>
                <Route path="/liaison-portal">
                  <Redirect to="/patient-care-specialist-portal" />
                </Route>
        <Route path="/patient-intake" component={QualificationPage} />
        <Route path="/qualification">
          <Redirect to="/patient-intake" />
        </Route>
        <Route path="/visit-patients">
          <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
            <Home />
          </SidebarProvider>
        </Route>
        <Route path="/visit-qualification">
          <Redirect to="/visit-patients" />
        </Route>
        <Route path="/outreach-patients">
          <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
            <OutreachQualificationPage />
          </SidebarProvider>
        </Route>
        <Route path="/outreach-qualification">
          <Redirect to="/outreach-patients" />
        </Route>
        <Route path="/plexus-iq">
          <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
            <PlexusIQPage />
          </SidebarProvider>
        </Route>
        {/* Plexus IQ knowledge tile — Clinical Intelligence & Governance
            (localStorage-backed prototype). */}
        <Route path="/clinical-intelligence">
          <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
            <ClinicalIntelligencePage />
          </SidebarProvider>
        </Route>
        {/* Temporary design-prototype route — mock data only. */}
        <Route path="/plexus-iq-prototype">
          <PlexusIqPrototypePage />
        </Route>
        <Route path="/team-member-portals">
          <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
            <TeamMemberPortalsPage />
          </SidebarProvider>
        </Route>
        <Route path="/patient-care-specialist-portal">
          <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
            <PatientCareSpecialistPortalPage />
          </SidebarProvider>
        </Route>
        <Route path="/ancillary-care-specialist-portal">
          <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
            <AncillaryCareSpecialistPortalPage />
          </SidebarProvider>
        </Route>
        <Route path="/engagement-center">
          <EngagementCenterPage />
        </Route>
                <Route path="/team-ops" component={TeamOpsPage} />
                <Route path="/task-brain">
                  <Redirect to="/plexus-tasks" />
                </Route>
                <Route path="/plexus-tasks" component={PlexusTasksPage} />
                <Route path="/plexus-bank">
                  <AdminGuard user={user}><PlexusBankPage /></AdminGuard>
                </Route>
                <Route path="/document-library">
                  <AdminGuard user={user}><DocumentLibraryPage /></AdminGuard>
                </Route>
                {/* Task #530: unified admin settings hub. */}
                <Route path="/admin/access">
                  <AccessSettingsGuard user={user}><AdminAccessPage /></AccessSettingsGuard>
                </Route>
                <Route path="/admin/settings">
                  <AdminGuard user={user}><AdminSettingsPage /></AdminGuard>
                </Route>
                <Route path="/admin">
                  <Redirect to="/admin/settings?tab=system" />
                </Route>
                <Route path="/admin/stovetop-heat-settings">
                  <Redirect to="/admin/settings?tab=facility" />
                </Route>
                <Route path="/admin/settings-center">
                  <Redirect to="/admin/settings?tab=system" />
                </Route>
                <Route path="/admin/billing-settings">
                  <Redirect to="/admin/settings?tab=billing" />
                </Route>
                <Route path="/billing/readiness">
                  <AdminGuard user={user}><BillingReadinessPage /></AdminGuard>
                </Route>
                <Route path="/billing/invoice-batches">
                  <AdminGuard user={user}><InvoiceBatchesPage /></AdminGuard>
                </Route>
                <Route path="/billing/invoice-review">
                  <AdminGuard user={user}><InvoiceReviewPage /></AdminGuard>
                </Route>
                <Route path="/billing/invoice-delivery">
                  <AdminGuard user={user}><InvoiceDeliveryPage /></AdminGuard>
                </Route>
                <Route path="/billing/remittance">
                  <Redirect to="/admin/settings?tab=logs&log=remittance" />
                </Route>
                <Route path="/billing/auditor">
                  <Redirect to="/admin/settings?tab=logs&log=billing-auditor" />
                </Route>
                <Route path="/billing/reports">
                  <AdminGuard user={user}><BillingReportsPage /></AdminGuard>
                </Route>
                <Route path="/admin/users">
                  <Redirect to="/admin/settings?tab=team" />
                </Route>
                <Route path="/audit-log">
                  <Redirect to="/admin/settings?tab=logs&log=audit" />
                </Route>
                <Route path="/admin/analysis-jobs">
                  <Redirect to="/admin/settings?tab=logs&log=analysis-jobs" />
                </Route>
                <Route path="/admin/outbox">
                  <Redirect to="/admin/settings?tab=logs&log=outbox" />
                </Route>
                <Route path="/admin-ops">
                  <Redirect to="/admin/settings?tab=system" />
                </Route>
                <Route path="/call-list-audit">
                  <Redirect to="/admin/settings?tab=logs&log=call-list-audit" />
                </Route>
                <Route path="/dashboard" component={ScheduleDashboardPage} />
                <Route path="/schedule-dashboard">
                  <Redirect to="/dashboard" />
                </Route>
                <Route path="/settings">
                  <Redirect to="/admin/settings#team" />
                </Route>
                <Route component={NotFound} />
        </Switch>
        </PlexusAdminShell>
      </WorkspaceTabsProvider>
    </AccessProvider>
  );
}

function AppShell() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();

  const { data: user, isLoading, refetch } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  function handleLogin() {
    refetch().then(({ data }) => {
      if (data && (data as AuthUser)?.username === "admin") {
        toast({
          title: "⚠ Default admin account",
          description: "You are using the default admin/admin account. Please change your password in Settings.",
          duration: 8000,
        });
      }
      // Route from the backend-derived default workspace via the controlled
      // identifier→route map. Never navigate to a raw identifier; unknown/null
      // falls back to /home. PCS/ACS resolve to their full-screen Team Portals.
      const target = resolveDefaultWorkspaceRoute((data as AuthUser)?.defaultWorkspace);
      navigate(target);
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    // Clear persisted workspace tabs so the next user in this browser session
    // does not inherit the previous user's open-workspace history.
    clearWorkspaceTabsStorage();
    // Clear the Playground workspace session (open patient EHR tabs + PHI
    // descriptors) so the next user in the SAME browser tab cannot inherit the
    // previous user's open patients (Scenario G — logout isolation).
    clearPlaygroundSession();
    // Phase 5B — clear any in-progress call-interaction drafts (PHI notes) so
    // the next user in the same tab never inherits the previous user's draft.
    clearAllCallDrafts();
    queryClient.clear();
    refetch();
    navigate("/");
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-plexus-navy-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-plexus-blue-300 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <AuthenticatedApp user={user} onLogout={handleLogout} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AppShell />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
