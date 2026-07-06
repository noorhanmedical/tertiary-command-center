// Small shared UI primitives for the Plexus Bank workspace.

import { type ReactNode } from "react";
import { X } from "lucide-react";

export function ModuleHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`} data-testid={testId}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, tone = "navy", hint, testId }: {
  label: string; value: string; tone?: "navy" | "green" | "amber" | "red" | "violet"; hint?: string; testId?: string;
}) {
  const toneCls: Record<string, string> = {
    navy: "text-[#0d1b3e]",
    green: "text-emerald-700",
    amber: "text-amber-600",
    red: "text-red-600",
    violet: "text-violet-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-testid={testId}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-bold leading-tight ${toneCls[tone]}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}

export function StatusBadge({ value, testId }: { value: string; testId?: string }) {
  const v = value.toLowerCase();
  let cls = "bg-slate-100 text-slate-600 border-slate-200";
  if (["paid", "accepted", "approved", "connected", "active", "succeeded", "verified", "green", "in-network", "ready"].some((k) => v.includes(k)))
    cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
  else if (["pending", "submitted", "sent", "review", "yellow", "partially", "info-requested", "logged", "draft"].some((k) => v.includes(k)))
    cls = "bg-amber-50 text-amber-700 border-amber-200";
  else if (["denied", "rejected", "overdue", "failed", "hold", "red", "out-of-network", "termed", "suspicious", "reauth", "void", "disputed"].some((k) => v.includes(k)))
    cls = "bg-red-50 text-red-700 border-red-200";
  else if (["unpaid", "not billed"].some((k) => v.includes(k)))
    cls = "bg-blue-50 text-blue-700 border-blue-200";
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`} data-testid={testId}>
      {value}
    </span>
  );
}

export function BankButton({ children, onClick, variant = "primary", size = "sm", disabled, testId }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "xs" | "sm";
  disabled?: boolean;
  testId?: string;
}) {
  const base = size === "xs" ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs";
  const variants: Record<string, string> = {
    primary: "bg-[#0d1b3e] text-white hover:bg-[#152a5c] border-transparent",
    secondary: "bg-white text-slate-700 hover:bg-slate-50 border-slate-200",
    danger: "bg-white text-red-600 hover:bg-red-50 border-red-200",
    ghost: "bg-transparent text-slate-500 hover:bg-slate-100 border-transparent",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${base} ${variants[variant]}`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export function BankDrawer({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end" data-testid="bank-drawer">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className={`relative flex h-full ${wide ? "w-[640px]" : "w-[460px]"} max-w-[92vw] flex-col bg-white shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid="bank-drawer-close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function BankModal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" data-testid="bank-modal">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className={`relative max-h-[85vh] w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid="bank-modal-close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-blue-800 focus:outline-none";

export function Th({ children, onClick, className = "" }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <th
      onClick={onClick}
      className={`whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 ${onClick ? "cursor-pointer select-none hover:text-slate-600" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <td className={`whitespace-nowrap px-3 py-2 text-xs text-slate-700 ${className}`} data-testid={testId}>
      {children}
    </td>
  );
}

export function ChartPlaceholder({ title, kind = "bar" }: { title: string; kind?: "bar" | "line" | "donut" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="mt-2 flex h-24 items-end gap-1.5 overflow-hidden rounded-lg bg-slate-50 p-2">
        {kind === "bar" &&
          [40, 65, 30, 80, 55, 70, 45, 90, 60, 35].map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-blue-900/20" style={{ height: `${h}%` }} />
          ))}
        {kind === "line" && (
          <svg viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
            <polyline points="0,32 12,28 25,30 38,20 50,24 62,14 75,18 88,8 100,12" fill="none" stroke="#1e3a8a" strokeOpacity="0.35" strokeWidth="2" />
          </svg>
        )}
        {kind === "donut" && (
          <div className="mx-auto h-20 w-20 rounded-full border-[10px] border-blue-900/20 border-t-emerald-500/40 border-r-amber-400/40" />
        )}
      </div>
      <div className="mt-1 text-center text-[9px] italic text-slate-300">Chart preview — sample visualization</div>
    </div>
  );
}
