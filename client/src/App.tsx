import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import SharedSchedule from "@/pages/shared-schedule";
import ArchivePage from "@/pages/archive";
import DocumentsPage from "@/pages/documents";
import BillingPage from "@/pages/billing";
import DocumentUploadPage from "@/pages/document-upload";
import AppointmentsPage from "@/pages/appointments";
import OutreachPage from "@/pages/outreach";
import OutreachSchedulerPortalPage from "@/pages/outreach-scheduler-portal";
import AdminOpsPage from "@/pages/admin-ops";
import AdminPage from "@/pages/admin";
import ScheduleDashboardPage from "@/pages/schedule-dashboard";
import SettingsPage from "@/pages/settings";
import TeamOpsPage from "@/pages/team-ops";
import TaskBrainPage from "@/pages/task-brain";
import { GlobalNav } from "@/components/GlobalNav";

const SIDEBAR_STYLE = {
  "--sidebar-width": "18rem",
  "--sidebar-width-icon": "3rem",
} as React.CSSProperties;

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          <Route path="/schedule/:id" component={SharedSchedule} />
          <Route>
            <div className="flex h-screen w-full overflow-hidden">
              <GlobalNav />
              <div className="flex flex-col flex-1 min-w-0 min-h-0">
                <Toaster />
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
                    <Route path="/patient-database" component={ArchivePage} />
                    <Route path="/documents" component={DocumentsPage} />
                    <Route path="/billing" component={BillingPage} />
                    <Route path="/document-upload" component={DocumentUploadPage} />
                    <Route path="/appointments" component={AppointmentsPage} />
                    <Route path="/outreach/scheduler/:id" component={OutreachSchedulerPortalPage} />
                    <Route path="/outreach" component={OutreachPage} />
                    <Route path="/team-ops" component={TeamOpsPage} />
                    <Route path="/task-brain" component={TaskBrainPage} />
                    <Route path="/admin" component={AdminPage} />
                    <Route path="/admin-ops" component={AdminOpsPage} />
                    <Route path="/schedule-dashboard" component={ScheduleDashboardPage} />
                    <Route path="/settings" component={SettingsPage} />
                    <Route component={NotFound} />
                  </Switch>
                </div>
              </div>
            </div>
          </Route>
        </Switch>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
