import { ReactNode } from "react";
import { Search, X, Lock, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { SERVICE_COLORS, serviceLineOf, type ServiceLine } from "../mockData";

// ---- ServiceChip --------------------------------------------------------
export function ServiceChip({ service, className }: { service: string; className?: string }) {
  const line: ServiceLine = service === "BrainWave" || service === "VitalWave"
    ? (service as ServiceLine)
    : serviceLineOf(service);
  const color = SERVICE_COLORS[line];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", className)}
      style={{ backgroundColor: `${color}1A`, color }}
      data-testid={`chip-service-${line}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {service}
    </span>
  );
}

// ---- StatusPill ---------------------------------------------------------
const PILL_TONE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  gray: "bg-slate-100 text-slate-600 border-slate-200",
  red: "bg-rose-50 text-rose-700 border-rose-200",
};

export function StatusPill({ label, tone = "gray", testId }: { label: string; tone?: keyof typeof PILL_TONE; testId?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", PILL_TONE[tone])}
      data-testid={testId}
    >
      {label}
    </span>
  );
}

// ---- StatCard -----------------------------------------------------------
export function StatCard({
  label, value, delta, accent, icon, testId,
}: {
  label: string;
  value: string;
  delta?: number;
  accent?: string;
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="rounded-[14px] border border-finance-border bg-white p-4 shadow-[0_1px_2px_rgba(16,17,20,0.04)]"
      data-testid={testId}
    >
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-finance-text-muted">{label}</div>
        {icon && <div className="text-finance-periwinkle">{icon}</div>}
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums text-finance-text", accent)}>{value}</div>
      {typeof delta === "number" && (
        <div className={cn("mt-1 inline-flex items-center gap-1 text-xs font-medium", delta >= 0 ? "text-emerald-600" : "text-rose-600")}>
          {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {Math.abs(delta)}% vs prior
        </div>
      )}
    </div>
  );
}

// ---- SideDrawer ---------------------------------------------------------
export function SideDrawer({
  open, onOpenChange, title, subtitle, children, footer, testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto p-0 sm:max-w-lg" data-testid={testId}>
        <div className="flex items-start justify-between border-b border-finance-border px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-finance-text">{title}</h3>
            {subtitle && <p className="text-sm text-finance-text-muted">{subtitle}</p>}
          </div>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="sticky bottom-0 border-t border-finance-border bg-white px-6 py-4">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

// ---- FilterBar ----------------------------------------------------------
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-[14px] border border-finance-border bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(16,17,20,0.04)]", className)}>
      {children}
    </div>
  );
}

// ---- SearchInput --------------------------------------------------------
export function SearchInput({ value, onChange, placeholder, testId, className }: { value: string; onChange: (v: string) => void; placeholder?: string; testId?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-finance-text-muted" />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-finance-text-muted hover:text-finance-text"
          data-testid={`${testId}-clear`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 pl-8 pr-7"
        data-testid={testId}
      />
    </div>
  );
}

// ---- EmptyState ---------------------------------------------------------
export function EmptyState({ message, testId }: { message: string; testId?: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-finance-border bg-finance-bg-soft py-10 text-center text-sm text-finance-text-muted" data-testid={testId}>
      {message}
    </div>
  );
}

// ---- RestrictedAccessCard ----------------------------------------------
export function RestrictedAccessCard({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-[14px] border border-finance-border bg-white p-8 text-center shadow-sm" data-testid="card-restricted-access">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-finance-bg-soft">
        <Lock className="h-6 w-6 text-finance-text-muted" />
      </div>
      <h3 className="text-lg font-semibold text-finance-text">Financial access is restricted</h3>
      <p className="mt-2 text-sm text-finance-text-muted">
        {message ?? "Financial summaries are available to Clinic Admins and Owners. Switch the demo role in the top bar to Clinic Admin or Owner to preview this view."}
      </p>
    </div>
  );
}

// ---- Section ------------------------------------------------------------
export function Section({ title, description, action, children, testId }: { title: string; description?: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-finance-text">{title}</h2>
          {description && <p className="text-sm text-finance-text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---- Card wrapper -------------------------------------------------------
export function PanelCard({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[14px] border border-finance-border bg-white shadow-[0_1px_2px_rgba(16,17,20,0.04)]", className)} data-testid={testId}>
      {children}
    </div>
  );
}
