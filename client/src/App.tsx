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
import WinterHomePage from "@/pages/winter-home";
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
import OutreachPage from "@/pages/outreach";
import OutreachSchedulerPortalPage from "@/pages/outreach-scheduler-portal";
import TechnicianPortalPage from "@/pages/technician-portal";
import LiaisonPortalPage from "@/pages/liaison-portal";
import PhysicianPortalPage from "@/pages/physician-portal";
import AdminSettingsPage from "@/pages/admin-settings";
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
import { GlobalNav } from "@/components/GlobalNav";
import { TopBanner } from "@/components/TopBanner";
import { GlobalFloatingDock } from "@/components/navigation/GlobalFloatingDock";
import { shouldShowGlobalNav } from "@/lib/navigation/navigationRegistry";
import ClinicWorkflowDemoPage from "@/pages/clinic-workflow-demo";
import QualificationPage from "@/pages/qualification";
import OutreachQualificationPage from "@/pages/outreach-qualification";
import PlexusIQPage from "@/pages/plexus-iq";
import ClinicalIntelligencePage from "@/pages/clinical-intelligence";
// Temporary design-prototype route — mock data only, not production.
import PlexusIqPrototypePage from "@/pages/plexus-iq-prototype";
import TeamMemberPortalsPage from "@/pages/team-member-portals";
import PatientCareSpecialistPortalPage from "@/pages/patient-care-specialist-portal";
import AncillaryCareSpecialistPortalPage from "@/pages/ancillary-care-specialist-portal";
import EngagementCenterPage from "@/pages/engagement-center";
// Slice 1.5: PatientDirectoryLiveRoute import removed — the
// /patient-directory/live route now redirects to /patient-directory.

const SIDEBAR_STYLE = {
  "--sidebar-width": "18rem",
  "--sidebar-width-icon": "3rem",
} as React.CSSProperties;

export type AuthUser = { id: string; username: string; role: string } | null;

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

function AuthenticatedApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [currentPath] = useLocation();
  const showGlobalNav = shouldShowGlobalNav(currentPath);
  const isWinterHome = currentPath === "/winter-home" || currentPath.startsWith("/winter-home/");
  return (
    <Switch>
      <Route path="/schedule/:id" component={SharedSchedule} />
      <Route>
        <div className="flex flex-col h-screen w-full overflow-hidden">
          {!isWinterHome && <TopBanner user={user} onLogout={onLogout} />}
          {!isWinterHome && <GlobalFloatingDock />}
          <div className="flex flex-1 min-h-0 min-w-0">
            {showGlobalNav && <GlobalNav user={user} onLogout={onLogout} />}
            <div className="flex flex-col flex-1 min-w-0 min-h-0">
              <div className="flex-1 min-h-0 overflow-auto">
              <Switch>
                <Route path="/">
                  <Redirect to="/home" />
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
                <Route path="/winter-home">
                  <WinterHomePage user={user} />
                </Route>
                <Route path="/home-preview">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <HomePreview />
                  </SidebarProvider>
                </Route>
                <Route path="/mission-control">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <MissionControlPage />
                  </SidebarProvider>
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
                <Route path="/outreach/scheduler/:id" component={OutreachSchedulerPortalPage} />
                <Route path="/outreach-center">
                  <Redirect to="/scheduler-portal" />
                </Route>
                <Route path="/scheduler-portal" component={OutreachPage} />
                <Route path="/outreach">
                  <Redirect to="/scheduler-portal" />
                </Route>
        <Route path="/clinic-workflow-demo" component={ClinicWorkflowDemoPage} />
                <Route path="/technician-portal" component={TechnicianPortalPage} />
                <Route path="/liaison-technician-portal" component={LiaisonPortalPage} />
                <Route path="/clinician-portal">
                  <RoleGuard user={user} roles={["admin", "clinician"]}><PhysicianPortalPage /></RoleGuard>
                </Route>
                <Route path="/physician-portal">
                  <Redirect to="/clinician-portal" />
                </Route>
                <Route path="/liaison-portal">
                  <Redirect to="/liaison-technician-portal" />
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
              </div>
            </div>
          </div>
        </div>
      </Route>
    </Switch>
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
      navigate("/home");
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
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
