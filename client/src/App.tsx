import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import SharedSchedule from "@/pages/shared-schedule";
import PatientDatabasePage from "@/pages/patient-database";
import DocumentsPage from "@/pages/documents";
import BillingPage from "@/pages/billing";
import DocumentUploadPage from "@/pages/document-upload";
import AppointmentsPage from "@/pages/appointments";
import OutreachPage from "@/pages/outreach";
import OutreachSchedulerPortalPage from "@/pages/outreach-scheduler-portal";
import AdminOpsPage from "@/pages/admin-ops";
import AdminPage from "@/pages/admin";
import AdminUsersPage from "@/pages/admin-users";
import AuditLogPage from "@/pages/audit-log";
import AdminAnalysisJobsPage from "@/pages/admin-analysis-jobs";
import AdminOutboxPage from "@/pages/admin-outbox";
import ScheduleDashboardPage from "@/pages/schedule-dashboard";
import SettingsPage from "@/pages/settings";
import TeamOpsPage from "@/pages/team-ops";
import TaskBrainPage from "@/pages/task-brain";
import PlexusTasksPage from "@/pages/plexus-tasks";
import LoginPage from "@/pages/login";
import { GlobalNav } from "@/components/GlobalNav";

const SIDEBAR_STYLE = {
  "--sidebar-width": "18rem",
  "--sidebar-width-icon": "3rem",
} as React.CSSProperties;

export type AuthUser = { id: string; username: string; role: string } | null;

function AdminGuard({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  if (!user || user.role !== "admin") {
    return <Redirect to="/schedule" />;
  }
  return <>{children}</>;
}

function AuthenticatedApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return (
    <Switch>
      <Route path="/schedule/:id" component={SharedSchedule} />
      <Route>
        <div className="flex h-screen w-full overflow-hidden">
          <GlobalNav user={user} onLogout={onLogout} />
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <div className="flex-1 min-h-0 overflow-auto">
              <Switch>
                <Route path="/">
                  <Redirect to="/schedule" />
                </Route>
                <Route path="/archive">
                  <Redirect to="/patient-database" />
                </Route>
                <Route path="/plexus">
                  <Redirect to="/documents" />
                </Route>
                <Route path="/schedule">
                  <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                    <Home />
                  </SidebarProvider>
                </Route>
                <Route path="/patient-database" component={PatientDatabasePage} />
                <Route path="/documents" component={DocumentsPage} />
                <Route path="/billing" component={BillingPage} />
                <Route path="/document-upload" component={DocumentUploadPage} />
                <Route path="/appointments" component={AppointmentsPage} />
                <Route path="/outreach/scheduler/:id" component={OutreachSchedulerPortalPage} />
                <Route path="/outreach" component={OutreachPage} />
                <Route path="/team-ops" component={TeamOpsPage} />
                <Route path="/task-brain" component={TaskBrainPage} />
                <Route path="/plexus-tasks" component={PlexusTasksPage} />
                <Route path="/admin">
                  <AdminGuard user={user}><AdminPage /></AdminGuard>
                </Route>
                <Route path="/admin/users">
                  <AdminGuard user={user}><AdminUsersPage /></AdminGuard>
                </Route>
                <Route path="/audit-log">
                  <AdminGuard user={user}><AuditLogPage /></AdminGuard>
                </Route>
                <Route path="/admin/analysis-jobs">
                  <AdminGuard user={user}><AdminAnalysisJobsPage /></AdminGuard>
                </Route>
                <Route path="/admin/outbox">
                  <AdminGuard user={user}><AdminOutboxPage /></AdminGuard>
                </Route>
                <Route path="/admin-ops">
                  <AdminGuard user={user}><AdminOpsPage /></AdminGuard>
                </Route>
                <Route path="/schedule-dashboard" component={ScheduleDashboardPage} />
                <Route path="/settings">
                  <AdminGuard user={user}><SettingsPage /></AdminGuard>
                </Route>
                <Route component={NotFound} />
              </Switch>
            </div>
          </div>
        </div>
      </Route>
    </Switch>
  );
}

function AppShell() {
  const [, navigate] = useLocation();
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
      navigate("/schedule");
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
      <div className="min-h-screen bg-[#0f1b35] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
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
