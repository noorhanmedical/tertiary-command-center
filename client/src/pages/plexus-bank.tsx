// Plexus Bank — complete financial operating workspace.
// Frontend prototype: mock data + localStorage only. No real bank,
// card, payroll, or clearinghouse connections.

import { createContext, useContext, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Landmark, LayoutDashboard, FileSpreadsheet, ShieldCheck, Receipt, Inbox,
  ListOrdered, Sigma, TrendingUp, Wallet, Truck, Users2, CreditCard,
  BarChart3, CheckCircle2, ScrollText, Settings2, X, Lock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  BANK_MODULES, BANK_CLINICS, BANK_REGIONS, BANK_PAYERS, BANK_PROVIDERS,
  BANK_ROLES, CLAIM_STATUS_OPTIONS, usePlexusBank,
  type BankModuleId, type PermissionLevel,
} from "@/pages/plexus-bank/mockData";
import {
  DashboardModule, BillingCenterModule, BillingAuditorModule,
  InvoicingCenterModule, TeamInvoiceMonitorModule,
} from "@/pages/plexus-bank/modules-core";
import {
  FeeScheduleModule, RvuCompensationModule, PnlModule, ExpensesModule,
} from "@/pages/plexus-bank/modules-comp";
import {
  VendorsModule, PayrollModule, BankingModule, ReportsModule,
  ApprovalsModule, AuditLogsModule, SettingsPermissionsModule,
} from "@/pages/plexus-bank/modules-ops";

// ─── Global filter context ──────────────────────────────────────────────────

export type BankFilters = {
  clinic: string;
  region: string;
  state: string;
  provider: string;
  payer: string;
  status: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: BankFilters = {
  clinic: "", region: "", state: "", provider: "", payer: "", status: "", dateFrom: "", dateTo: "",
};

type PlexusBankContextValue = {
  filters: BankFilters;
  setFilter: (key: keyof BankFilters, value: string) => void;
  clearFilters: () => void;
  actor: string;
  /** Acting role for the permissions matrix (Settings & Permissions). */
  role: string;
};

const PlexusBankContext = createContext<PlexusBankContextValue>({
  filters: EMPTY_FILTERS,
  setFilter: () => {},
  clearFilters: () => {},
  actor: "Owner/Admin",
  role: "Owner/Admin",
});

export function usePlexusBankFilters() {
  return useContext(PlexusBankContext);
}

/** Per-module permission for the acting role, read from the Settings &
 *  Permissions matrix persisted in the mock store. */
export function useModulePermission(moduleId: BankModuleId): PermissionLevel {
  const bank = usePlexusBank();
  const { role } = useContext(PlexusBankContext);
  return bank.permissions[role]?.[moduleId] ?? "none";
}

/** Wraps every module's content pane: "none" hides the module entirely,
 *  "read" disables all actions and shows a read-only banner. */
function ModuleGate({ moduleId, children }: { moduleId: BankModuleId; children: React.ReactNode }) {
  const level = useModulePermission(moduleId);
  const { role } = useContext(PlexusBankContext);
  if (level === "none") {
    return (
      <div className="flex h-full items-center justify-center" data-testid={`bank-access-denied-${moduleId}`}>
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
            <Lock className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-sm font-semibold text-slate-800">No access to this module</div>
          <div className="mt-1 text-xs text-slate-500">
            The role <span className="font-semibold">{role}</span> has no permission for this module. Permissions are managed in Settings &amp; Permissions.
          </div>
        </div>
      </div>
    );
  }
  if (level === "read") {
    return (
      <div data-testid={`bank-read-only-${moduleId}`}>
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Read-only — the role <span className="font-semibold">{role}</span> can view this module but all actions are disabled.
        </div>
        <div className="pointer-events-none select-none" aria-disabled="true">
          {children}
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

const STATUS_FILTER_OPTIONS: readonly string[] = Array.from(
  new Set<string>([...CLAIM_STATUS_OPTIONS, "Draft", "Sent", "Unpaid", "Overdue", "Void", "Partially Paid"]),
);

/** Generic row matcher against the global filter bar. Rows expose only the
 *  dimensions they have; missing dimensions are ignored. */
export function matchesFilters(
  filters: BankFilters,
  row: { clinic?: string; region?: string; state?: string; provider?: string; payer?: string; status?: string; date?: string },
): boolean {
  if (filters.clinic && row.clinic && row.clinic !== filters.clinic) return false;
  if (filters.region && row.region && row.region !== filters.region) return false;
  if (filters.state && row.state && row.state !== filters.state) return false;
  if (filters.provider && row.provider && row.provider !== filters.provider) return false;
  if (filters.payer && row.payer && row.payer !== filters.payer) return false;
  if (filters.status && row.status && row.status.toLowerCase() !== filters.status.toLowerCase()) return false;
  if (filters.dateFrom && row.date && row.date < filters.dateFrom) return false;
  if (filters.dateTo && row.date && row.date > filters.dateTo) return false;
  return true;
}

// ─── Module icon mapping ────────────────────────────────────────────────────

const MODULE_ICONS: Record<BankModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  billing: FileSpreadsheet,
  auditor: ShieldCheck,
  invoicing: Receipt,
  invoiceDesk: Inbox,
  fees: ListOrdered,
  rvu: Sigma,
  pnl: TrendingUp,
  expenses: Wallet,
  vendors: Truck,
  payroll: Users2,
  banking: CreditCard,
  reports: BarChart3,
  approvals: CheckCircle2,
  audit: ScrollText,
  settings: Settings2,
};

function FilterSelect({ label, value, options, onChange, testId }: {
  label: string; value: string; options: readonly string[]; onChange: (v: string) => void; testId: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-8 rounded-lg border bg-white px-2 text-xs text-slate-700 ${value ? "border-blue-800 ring-1 ring-blue-800/30" : "border-slate-200"}`}
        data-testid={testId}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export default function PlexusBankPage() {
  const [activeModule, setActiveModule] = useState<BankModuleId>("dashboard");
  const [filters, setFilters] = useState<BankFilters>(EMPTY_FILTERS);
  const [role, setRole] = useState<string>("Owner/Admin");

  const { data: me } = useQuery<{ username?: string } | null>({ queryKey: ["/api/auth/me"] });
  const actor = me?.username ?? "Owner/Admin";

  const ctxValue = useMemo<PlexusBankContextValue>(
    () => ({
      filters,
      setFilter: (key, value) => setFilters((f) => ({ ...f, [key]: value })),
      clearFilters: () => setFilters(EMPTY_FILTERS),
      actor,
      role,
    }),
    [filters, actor, role],
  );

  const anyFilterActive = Object.values(filters).some(Boolean);

  return (
    <PlexusBankContext.Provider value={ctxValue}>
      <div className="flex h-full min-h-0 w-full bg-slate-50" data-testid="plexus-bank-page">
        {/* Left rail — module navigator */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-[#0d1b3e] text-white">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
              <Landmark className="h-4 w-4 text-blue-200" />
            </span>
            <div>
              <div className="text-sm font-bold leading-tight">Plexus Bank</div>
              <div className="text-[10px] text-blue-200/70">Financial Operating System</div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" data-testid="bank-module-nav">
            {BANK_MODULES.map((m) => {
              const Icon = MODULE_ICONS[m.id];
              const active = activeModule === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setActiveModule(m.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                    active ? "bg-white text-[#0d1b3e] font-semibold shadow-sm" : "text-blue-100/80 hover:bg-white/10 hover:text-white"
                  }`}
                  data-testid={`bank-nav-${m.id}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "text-[#0d1b3e]" : "text-blue-200/70"}`} strokeWidth={1.75} />
                  <span className="truncate">{m.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="border-t border-white/10 px-4 py-3 text-[10px] leading-relaxed text-blue-200/60">
            Prototype workspace — sample data only. No live bank, card, or payroll connections.
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Global filter bar — persists across module switches */}
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-5 py-3" data-testid="bank-filter-bar">
            <FilterSelect label="Clinic" value={filters.clinic} options={BANK_CLINICS} onChange={(v) => ctxValue.setFilter("clinic", v)} testId="bank-filter-clinic" />
            <FilterSelect label="Region" value={filters.region} options={BANK_REGIONS} onChange={(v) => ctxValue.setFilter("region", v)} testId="bank-filter-region" />
            <FilterSelect label="State" value={filters.state} options={["TX", "AZ"]} onChange={(v) => ctxValue.setFilter("state", v)} testId="bank-filter-state" />
            <FilterSelect label="Provider" value={filters.provider} options={BANK_PROVIDERS} onChange={(v) => ctxValue.setFilter("provider", v)} testId="bank-filter-provider" />
            <FilterSelect label="Payer" value={filters.payer} options={BANK_PAYERS} onChange={(v) => ctxValue.setFilter("payer", v)} testId="bank-filter-payer" />
            <FilterSelect label="Status" value={filters.status} options={STATUS_FILTER_OPTIONS} onChange={(v) => ctxValue.setFilter("status", v)} testId="bank-filter-status" />
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">From</span>
              <input type="date" value={filters.dateFrom} onChange={(e) => ctxValue.setFilter("dateFrom", e.target.value)} className={`h-8 rounded-lg border bg-white px-2 text-xs text-slate-700 ${filters.dateFrom ? "border-blue-800 ring-1 ring-blue-800/30" : "border-slate-200"}`} data-testid="bank-filter-from" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">To</span>
              <input type="date" value={filters.dateTo} onChange={(e) => ctxValue.setFilter("dateTo", e.target.value)} className={`h-8 rounded-lg border bg-white px-2 text-xs text-slate-700 ${filters.dateTo ? "border-blue-800 ring-1 ring-blue-800/30" : "border-slate-200"}`} data-testid="bank-filter-to" />
            </label>
            {anyFilterActive && (
              <button
                onClick={ctxValue.clearFilters}
                className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-600 hover:bg-slate-100"
                data-testid="bank-filter-clear"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
            <div className="ml-auto flex items-end gap-3">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Acting role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={`h-8 rounded-lg border bg-white px-2 text-xs text-slate-700 ${role !== "Owner/Admin" ? "border-blue-800 ring-1 ring-blue-800/30" : "border-slate-200"}`}
                  data-testid="bank-acting-role"
                >
                  {BANK_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <div className="self-center text-[11px] text-slate-400">
                Signed in as <span className="font-semibold text-slate-600">{actor}</span>
              </div>
            </div>
          </div>

          {/* Content pane */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5" data-testid="bank-module-content">
            <ModuleGate moduleId={activeModule}>
              {activeModule === "dashboard" && <DashboardModule />}
              {activeModule === "billing" && <BillingCenterModule />}
              {activeModule === "auditor" && <BillingAuditorModule />}
              {activeModule === "invoicing" && <InvoicingCenterModule />}
              {activeModule === "invoiceDesk" && <TeamInvoiceMonitorModule />}
              {activeModule === "fees" && <FeeScheduleModule />}
              {activeModule === "rvu" && <RvuCompensationModule />}
              {activeModule === "pnl" && <PnlModule />}
              {activeModule === "expenses" && <ExpensesModule />}
              {activeModule === "vendors" && <VendorsModule />}
              {activeModule === "payroll" && <PayrollModule />}
              {activeModule === "banking" && <BankingModule />}
              {activeModule === "reports" && <ReportsModule />}
              {activeModule === "approvals" && <ApprovalsModule />}
              {activeModule === "audit" && <AuditLogsModule />}
              {activeModule === "settings" && <SettingsPermissionsModule />}
            </ModuleGate>
          </div>
        </div>
      </div>
    </PlexusBankContext.Provider>
  );
}
