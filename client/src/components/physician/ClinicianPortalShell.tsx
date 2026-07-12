import { Search, ChevronLeft } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PortalProvider, usePortal, type DemoRole } from "./portalContext";
import { DashboardHome } from "./DashboardHome";
import { FinancePage } from "./finance/FinancePage";
import { OrdersNotesPage } from "./orders/OrdersNotesPage";
import { PlexusEngagementPage } from "./engagement/PlexusEngagementPage";

const ROLES: DemoRole[] = ["Clinician", "Clinic Admin", "Owner"];

function TopBar() {
  const { role, setRole } = usePortal();
  const today = new Date(2026, 5, 25).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  return (
    <header className="sticky top-0 z-30 border-b border-finance-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-finance-dark text-sm font-bold text-white">P</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-finance-text">Plexus EMR</div>
            <div className="text-[11px] text-finance-text-muted">Clinician Portal</div>
          </div>
        </div>

        <div className="relative ml-2 hidden flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-finance-text-muted" />
          <Input
            placeholder="Search patients, claims, notes…"
            className="h-9 max-w-md pl-9"
            data-testid="input-global-search"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right lg:block">
            <div className="text-xs font-medium text-finance-text">TFP — Humble</div>
            <div className="text-[11px] text-finance-text-muted">{today}</div>
          </div>

          <Select value={role} onValueChange={(v) => setRole(v as DemoRole)}>
            <SelectTrigger className="h-9 w-[150px]" data-testid="select-demo-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r} data-testid={`role-option-${r}`}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="hidden rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 sm:inline" data-testid="label-demo-data">
            Demo data only
          </span>

          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-finance-periwinkle/20 text-sm font-semibold text-finance-periwinkle" title="Dr. J. Taylor" data-testid="avatar-user">
            JT
          </div>
        </div>
      </div>
    </header>
  );
}

export function BackToDashboard() {
  const { setActivePage } = usePortal();
  return (
    <button
      type="button"
      onClick={() => setActivePage("dashboard")}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-finance-periwinkle hover:underline"
      data-testid="button-back-to-dashboard"
    >
      <ChevronLeft className="h-4 w-4" /> Back to Dashboard
    </button>
  );
}

function PortalBody() {
  const { activePage } = usePortal();
  return (
    <div className="min-h-screen bg-finance-bg">
      <TopBar />
      <main className="mx-auto max-w-[1500px] px-6 py-6">
        {activePage === "dashboard" && <DashboardHome />}
        {activePage === "finance" && <FinancePage />}
        {activePage === "orders-notes" && <OrdersNotesPage />}
        {activePage === "engagement" && <PlexusEngagementPage />}
      </main>
    </div>
  );
}

export function ClinicianPortalShell() {
  return (
    <PortalProvider>
      <PortalBody />
    </PortalProvider>
  );
}
