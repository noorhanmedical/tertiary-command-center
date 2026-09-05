import * as React from "react";
import { cn } from "@/lib/utils";
import {
  plexusStatusStyles,
  plexusBillingStatus,
  type PlexusStatusTone,
} from "./tokens";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — status & badge system (§29, §30, §58, §60, §76)
   One canonical style per state. Never color-only: each badge carries text.
   ══════════════════════════════════════════════════════════════════════ */

/** StatusBadge (§29) — soft-bg pill with exact wording + accessible label. */
export function StatusBadge({
  tone,
  children,
  className,
  ariaLabel,
}: {
  tone: PlexusStatusTone;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const s = plexusStatusStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
        className,
      )}
      style={{ color: s.fg, background: s.bg, border: `1px solid ${s.border}` }}
      aria-label={ariaLabel}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: s.fg }}
        aria-hidden
      />
      {children}
    </span>
  );
}

/** BillingStatus (§60) — canonical claim states, exact wording + tone. */
export function BillingStatus({
  status,
  className,
}: {
  status: keyof typeof plexusBillingStatus;
  className?: string;
}) {
  const { label, tone } = plexusBillingStatus[status];
  return (
    <StatusBadge tone={tone} className={className} ariaLabel={`Billing status: ${label}`}>
      {label}
    </StatusBadge>
  );
}

/** CountBadge (§30) — compact numeric badge. */
export function CountBadge({
  count,
  tone = "neutral",
  className,
}: {
  count: number;
  tone?: "neutral" | "blue" | "review";
  className?: string;
}) {
  const styles =
    tone === "blue"
      ? { bg: "var(--w-blue)", fg: "#fff" }
      : tone === "review"
        ? { bg: "var(--w-purple)", fg: "#fff" }
        : { bg: "var(--w-blue-soft)", fg: "var(--w-text)" };
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
        className,
      )}
      style={{ background: styles.bg, color: styles.fg }}
    >
      {count}
    </span>
  );
}

/** NotificationBadge (§30) — tiny dot / count anchored to an icon. */
export function NotificationBadge({ count }: { count?: number }) {
  return (
    <span
      className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
      style={{ background: "var(--w-error)" }}
      aria-label={count ? `${count} unread` : "unread"}
    >
      {count && count > 0 ? count : ""}
    </span>
  );
}

/** RoleBadge (§30) — role label on soft steel background. */
export function RoleBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]"
      style={{ color: "var(--w-steel)", background: "rgba(109,143,191,0.12)" }}
    >
      {children}
    </span>
  );
}

/** PriorityIndicator (§58) — priority WITHOUT relying on color alone. */
export function PriorityIndicator({
  level,
}: {
  level: "high" | "medium" | "low";
}) {
  const map = {
    high: { tone: "error" as const, label: "High", bars: 3 },
    medium: { tone: "pending" as const, label: "Medium", bars: 2 },
    low: { tone: "neutral" as const, label: "Low", bars: 1 },
  };
  const { tone, label, bars } = map[level];
  const s = plexusStatusStyles[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: s.fg }}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-[3px] rounded-sm"
            style={{ height: 5 + i * 3, background: i < bars ? s.fg : "rgba(126,140,161,0.3)" }}
          />
        ))}
      </span>
      {label}
    </span>
  );
}
