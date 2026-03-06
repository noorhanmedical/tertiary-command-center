import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import SharedSchedule from "@/pages/shared-schedule";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/schedule/:id" component={SharedSchedule} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider defaultOpen={false} style={style as React.CSSProperties}>
          <div className="flex flex-col h-screen w-full">
            <div className="bg-black/60 backdrop-blur-md px-4 py-2.5 z-[100] shrink-0" data-testid="banner-top">
              <h1 className="text-sm font-bold tracking-tight text-white" data-testid="text-app-title-banner">Plexus Ancillary Screening</h1>
              <p className="text-[10px] text-white/60 leading-tight">AI-powered patient qualification</p>
            </div>
            <div className="flex flex-1 min-h-0 w-full">
              <Toaster />
              <Router />
            </div>
          </div>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
