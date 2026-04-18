import { Switch, Route, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Settings, Shield } from "lucide-react";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import SharedSchedule from "@/pages/shared-schedule";
import ArchivePage from "@/pages/archive";
import PlexusPage from "@/pages/plexus";
import DocumentsPage from "@/pages/documents";
import BillingPage from "@/pages/billing";
import DocumentUploadPage from "@/pages/document-upload";
import AppointmentsPage from "@/pages/appointments";
import OutreachPage from "@/pages/outreach";
import AdminOpsPage from "@/pages/admin-ops";
import ScheduleDashboardPage from "@/pages/schedule-dashboard";
import SettingsPage from "@/pages/settings";

function App() {
  const style = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          <Route path="/schedule/:id" component={SharedSchedule} />
          <Route>
            <div className="flex flex-col h-screen w-full">
              <div className="bg-[#1a365d] backdrop-blur-md px-5 py-3 z-[100] shrink-0 flex items-center justify-between" data-testid="banner-top">
                <div>
                  <h1 className="text-lg font-bold tracking-tight text-white" data-testid="text-app-title-banner">Plexus Ancillary Screening</h1>
                  <p className="text-sm text-blue-200/70 leading-tight">AI-powered patient qualification</p>
                </div>
                <div className="flex items-center gap-1">
                  <Link href="/settings">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-blue-200/80 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium" data-testid="banner-link-settings">
                      <Settings className="w-4 h-4" strokeWidth={1.75} />
                      <span className="hidden sm:inline">Settings</span>
                    </button>
                  </Link>
                  <Link href="/admin-ops">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-blue-200/80 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium" data-testid="banner-link-admin">
                      <Shield className="w-4 h-4" strokeWidth={1.75} />
                      <span className="hidden sm:inline">Admin</span>
                    </button>
                  </Link>
                </div>
              </div>
              <div className="flex flex-1 min-h-0 w-full">
                <Toaster />
                <Switch>
                  <Route path="/archive" component={ArchivePage} />
                  <Route path="/plexus" component={PlexusPage} />
                  <Route path="/documents" component={DocumentsPage} />
                  <Route path="/billing" component={BillingPage} />
                  <Route path="/document-upload" component={DocumentUploadPage} />
                  <Route path="/appointments" component={AppointmentsPage} />
                  <Route path="/admin-ops" component={AdminOpsPage} />
                  <Route path="/schedule-dashboard" component={ScheduleDashboardPage} />
                  <Route path="/outreach" component={OutreachPage} />
                  <Route path="/settings" component={SettingsPage} />
                  <Route>
                    <SidebarProvider defaultOpen={false} style={style as React.CSSProperties}>
                      <Switch>
                        <Route path="/" component={Home} />
                        <Route component={NotFound} />
                      </Switch>
                    </SidebarProvider>
                  </Route>
                </Switch>
              </div>
            </div>
          </Route>
        </Switch>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
