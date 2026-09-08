// Phase 4B — shared presentational atoms for the access-management console.
// Compact, enterprise, calm. No business logic lives here.

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Section shell ────────────────────────────────────────────────────────────

/** A titled block inside a section pane — flat, hairline-separated. */
export function AccessGroup({
  title,
  desc,
  actions,
  children,
  className,
}: {
  title?: string;
  desc?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("px-6 py-6", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
            {desc && <p className="mt-0.5 text-sm text-slate-500">{desc}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ─── State views ──────────────────────────────────────────────────────────────

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" data-testid="access-loading">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center" data-testid="access-empty">
      <Inbox className="h-6 w-6 text-slate-300" />
      <div className="text-sm font-medium text-slate-600">{label}</div>
      {hint && <div className="max-w-sm text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center" data-testid="access-error">
      <AlertTriangle className="h-6 w-6 text-amber-400" />
      <div className="text-sm font-medium text-slate-700">{message}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
          data-testid="button-retry"
        >
          Try again
        </button>
      )}
    </div>
  );
}

// ─── Access-state pill ──────────────────────────────────────────────────────────
// The four canonical permission / service-access states, visually distinct.

export type AccessState = "inherited" | "grant" | "deny" | "none";

const STATE_STYLES: Record<AccessState, string> = {
  inherited: "bg-slate-100 text-slate-600 border-slate-200",
  grant: "bg-emerald-50 text-emerald-700 border-emerald-200",
  deny: "bg-rose-50 text-rose-700 border-rose-200",
  none: "bg-transparent text-slate-400 border-slate-200",
};

const STATE_LABELS: Record<AccessState, string> = {
  inherited: "Inherited",
  grant: "Explicit Grant",
  deny: "Explicit Deny",
  none: "Not Granted",
};

export function AccessStateBadge({ state, source }: { state: AccessState; source?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        STATE_STYLES[state],
      )}
      data-testid={`state-${state}`}
      title={source ? `${STATE_LABELS[state]} — ${source}` : STATE_LABELS[state]}
    >
      {STATE_LABELS[state]}
      {state === "inherited" && source ? <span className="ml-1 font-normal text-slate-400">· {source}</span> : null}
    </span>
  );
}

// ─── Small status dot/badge for account status ────────────────────────────────

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "unknown";
  const styles: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    inactive: "bg-slate-100 text-slate-500 border-slate-200",
    suspended: "bg-amber-50 text-amber-700 border-amber-200",
    unknown: "bg-slate-100 text-slate-500 border-slate-200",
  };
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        styles[s] ?? styles.unknown,
      )}
      data-testid={`status-${s}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          s === "active" ? "bg-emerald-500" : s === "suspended" ? "bg-amber-500" : "bg-slate-400",
        )}
      />
      {label}
    </span>
  );
}
