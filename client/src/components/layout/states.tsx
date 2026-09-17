import type { ReactNode } from "react";
import { AlertTriangle, Inbox, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* ══════════════════════════════════════════════════════════════════════
   Canonical LOADING / EMPTY / ERROR states.
   One implementation each so every page presents the same treatment:
   skeletons for loading, an explained empty state with an optional action,
   and a plain-language error that never surfaces raw backend text.
   ══════════════════════════════════════════════════════════════════════ */

export interface EmptyStateProps {
  /** Short headline describing what is empty. */
  title: string;
  /** One or two sentences explaining why / what to do next. */
  description?: ReactNode;
  /** Optional icon (defaults to an inbox). */
  icon?: LucideIcon;
  /** Optional primary action (e.g. "Add patient"). */
  action?: ReactNode;
  className?: string;
}

/**
 * EmptyState — shown when a list/section has no data. Always explains what is
 * empty and, where useful, offers an action rather than a bare "No results".
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-finance-border bg-finance-card-soft px-6 py-12 text-center",
        className,
      )}
      data-testid="empty-state"
    >
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-finance-bg-soft text-finance-text-muted">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-finance-text">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-finance-text-secondary">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  /** Short plain-language headline. Defaults to a generic message. */
  title?: string;
  /** Optional plain-language detail. NEVER pass raw backend error text here. */
  description?: ReactNode;
  /** Optional request id for support correlation (safe, non-PHI). */
  requestId?: string | null;
  /** Optional retry handler; renders a "Try again" button when provided. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * ErrorState — canonical error surface. Plain language, optional retry, and an
 * optional request id for support. Deliberately has no prop for raw error
 * objects/messages so callers can't leak backend/PHI detail into the UI.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this right now. Please try again.",
  requestId,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-finance-border bg-finance-card px-6 py-12 text-center",
        className,
      )}
      data-testid="error-state"
      role="alert"
    >
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-finance-text">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-finance-text-secondary">{description}</p>
      )}
      {requestId && (
        <p className="mt-2 font-mono text-xs text-finance-text-muted">
          Reference: {requestId}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} data-testid="button-error-retry">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export interface LoadingSkeletonProps {
  /** Number of skeleton rows to render. Defaults to 3. */
  rows?: number;
  className?: string;
}

/**
 * LoadingSkeleton — canonical list/section loading placeholder. Prefer this
 * (and other skeletons) over spinners for content areas.
 */
export function LoadingSkeleton({ rows = 3, className }: LoadingSkeletonProps) {
  return (
    <div className={cn("space-y-3", className)} data-testid="loading-skeleton" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-xl border border-finance-border bg-finance-card p-4"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      ))}
    </div>
  );
}
