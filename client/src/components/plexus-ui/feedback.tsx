import * as React from "react";
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  Inbox,
  SearchX,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlexusButton } from "./buttons";
import { plexusStatusStyles } from "./tokens";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — feedback & states
   (§41, §42, §43, §44, §45, §67)
   Alerts/toasts stay compact with restrained color. Empty/error/permission
   states are distinct and never conflated.
   ══════════════════════════════════════════════════════════════════════ */

export type FeedbackTone = "success" | "warning" | "error" | "info";

const TONE: Record<FeedbackTone, { icon: LucideIcon; fg: string; bg: string; border: string }> = {
  success: { icon: CheckCircle2, ...plexusStatusStyles.completed },
  warning: { icon: AlertTriangle, ...plexusStatusStyles.pending },
  error: { icon: XCircle, ...plexusStatusStyles.error },
  info: { icon: Info, fg: "#5F7EEA", bg: "#E9EFFD", border: "rgba(95,126,234,0.24)" },
};

/** Alert (§41) — inline banner. Compact, restrained. */
export function Alert({
  tone = "info",
  title,
  children,
  onDismiss,
  className,
}: {
  tone?: FeedbackTone;
  title?: string;
  children?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div
      role="alert"
      className={cn("flex items-start gap-3 rounded-[12px] px-4 py-3", className)}
      style={{ background: t.bg, border: `1px solid ${t.border}` }}
    >
      <Icon className="mt-0.5 size-[18px] shrink-0" style={{ color: t.fg }} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className="text-[13px] font-semibold" style={{ color: "var(--w-text)" }}>{title}</div>}
        {children && <div className="text-[13px]" style={{ color: "var(--w-text-2)" }}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="rounded-full p-1 text-[var(--w-text-muted)] hover:bg-white/60"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Toast (§41) — compact floating notice. Placement handled by caller. */
export function Toast({
  tone = "info",
  title,
  description,
  onDismiss,
}: {
  tone?: FeedbackTone;
  title: string;
  description?: string;
  onDismiss?: () => void;
}) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div
      role="status"
      className="plexus-frost-strong flex w-[340px] max-w-[92vw] items-start gap-3 px-4 py-3"
      style={{ borderColor: t.border }}
    >
      <Icon className="mt-0.5 size-[18px] shrink-0" style={{ color: t.fg }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold" style={{ color: "var(--w-text)" }}>{title}</div>
        {description && <div className="text-[12px]" style={{ color: "var(--w-text-2)" }}>{description}</div>}
      </div>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="rounded-full p-1 text-[var(--w-text-muted)] hover:bg-white/60">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Shared state scaffold — simple icon, short title, one sentence, optional action. */
function StateBlock({
  icon: Icon,
  iconColor,
  title,
  message,
  action,
  testId,
}: {
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  message?: string;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" data-testid={testId}>
      <span className="plexus-icon-frost mb-4 h-12 w-12" aria-hidden>
        <Icon className="size-6" style={{ color: iconColor ?? "var(--w-text-muted)" }} />
      </span>
      <h3 className="text-[16px] font-semibold" style={{ color: "var(--w-text)" }}>
        {title}
      </h3>
      {message && (
        <p className="mt-1 max-w-sm text-[13px]" style={{ color: "var(--w-text-muted)" }}>
          {message}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export type EmptyStateKind = "no-data" | "no-results" | "filtered" | "restricted";
/** EmptyState (§42). */
export function EmptyState({
  kind = "no-data",
  title,
  message,
  action,
}: {
  kind?: EmptyStateKind;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  const icon = kind === "no-results" || kind === "filtered" ? SearchX : kind === "restricted" ? Lock : Inbox;
  return <StateBlock icon={icon} title={title} message={message} action={action} testId="plexus-empty-state" />;
}

/** ErrorState (§44) — what failed, whether retry is possible, what to do. */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <StateBlock
      icon={XCircle}
      iconColor="var(--w-error)"
      title={title}
      message={message}
      testId="plexus-error-state"
      action={
        onRetry ? (
          <PlexusButton variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
            {retryLabel}
          </PlexusButton>
        ) : undefined
      }
    />
  );
}

/** PermissionState (§45) — no-access / read-only / unavailable / role-restricted. */
export function PermissionState({
  variant = "no-access",
  title,
  message,
  action,
}: {
  variant?: "no-access" | "read-only" | "unavailable" | "role-restricted";
  title?: string;
  message?: string;
  action?: React.ReactNode;
}) {
  const defaults: Record<string, { title: string; message: string }> = {
    "no-access": { title: "No access", message: "You do not have permission to view this content." },
    "read-only": { title: "Read-only", message: "You can view this content but cannot make changes." },
    unavailable: { title: "Feature unavailable", message: "This feature is not available yet." },
    "role-restricted": { title: "Restricted", message: "This area is limited to specific roles." },
  };
  const d = defaults[variant];
  return (
    <StateBlock
      icon={Lock}
      iconColor="var(--w-steel)"
      title={title ?? d.title}
      message={message ?? d.message}
      action={action}
      testId="plexus-permission-state"
    />
  );
}
