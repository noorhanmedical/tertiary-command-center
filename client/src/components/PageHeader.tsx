import { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const STAR_FIELD = [
  { x: 4, y: 22, size: 1, glow: 0, op: 0.45 },
  { x: 8, y: 70, size: 1, glow: 0, op: 0.35 },
  { x: 11, y: 38, size: 2, glow: 1, op: 0.85 },
  { x: 14, y: 88, size: 1, glow: 0, op: 0.4 },
  { x: 17, y: 14, size: 1, glow: 0, op: 0.55 },
  { x: 19, y: 56, size: 1, glow: 0, op: 0.3 },
  { x: 22, y: 30, size: 2, glow: 1, op: 0.9 },
  { x: 24, y: 78, size: 1, glow: 0, op: 0.45 },
  { x: 27, y: 12, size: 1, glow: 0, op: 0.35 },
  { x: 29, y: 50, size: 1, glow: 0, op: 0.5 },
  { x: 32, y: 84, size: 1, glow: 0, op: 0.4 },
  { x: 34, y: 24, size: 1, glow: 0, op: 0.55 },
  { x: 37, y: 64, size: 2, glow: 1, op: 0.8 },
  { x: 39, y: 8, size: 1, glow: 0, op: 0.4 },
  { x: 42, y: 42, size: 1, glow: 0, op: 0.35 },
  { x: 44, y: 92, size: 1, glow: 0, op: 0.45 },
  { x: 47, y: 18, size: 2, glow: 1, op: 0.85 },
  { x: 49, y: 58, size: 1, glow: 0, op: 0.3 },
  { x: 52, y: 36, size: 1, glow: 0, op: 0.5 },
  { x: 54, y: 80, size: 1, glow: 0, op: 0.4 },
  { x: 57, y: 10, size: 1, glow: 0, op: 0.55 },
  { x: 59, y: 48, size: 1, glow: 0, op: 0.35 },
  { x: 62, y: 72, size: 2, glow: 1, op: 0.9 },
  { x: 64, y: 26, size: 1, glow: 0, op: 0.45 },
  { x: 67, y: 60, size: 1, glow: 0, op: 0.4 },
  { x: 69, y: 16, size: 1, glow: 0, op: 0.5 },
  { x: 72, y: 88, size: 1, glow: 0, op: 0.35 },
  { x: 74, y: 44, size: 2, glow: 1, op: 0.8 },
  { x: 77, y: 6, size: 1, glow: 0, op: 0.55 },
  { x: 79, y: 68, size: 1, glow: 0, op: 0.4 },
  { x: 82, y: 32, size: 1, glow: 0, op: 0.45 },
  { x: 84, y: 82, size: 1, glow: 0, op: 0.3 },
  { x: 87, y: 20, size: 2, glow: 1, op: 0.85 },
  { x: 89, y: 54, size: 1, glow: 0, op: 0.5 },
  { x: 92, y: 78, size: 1, glow: 0, op: 0.4 },
  { x: 94, y: 12, size: 1, glow: 0, op: 0.55 },
  { x: 96, y: 40, size: 1, glow: 0, op: 0.35 },
  { x: 98, y: 64, size: 1, glow: 0, op: 0.45 },
];

export interface PageHeaderProps {
  /** Tiny uppercase label above the title (e.g. "PLEXUS ANCILLARY"). */
  eyebrow?: string;
  /** The page title. */
  title: string;
  /** One-line description shown beneath the title. */
  subtitle?: string;
  /** Lucide icon component to render in the icon box. */
  icon?: LucideIcon;
  /**
   * Tailwind classes for the icon container background+text color.
   * Defaults to a neutral slate accent.
   */
  iconAccent?: string;
  /** Optional back link, renders an "← Back" button above the title block. */
  backHref?: string;
  backLabel?: string;
  /** Right-aligned action area (buttons, badges, etc). */
  actions?: ReactNode;
  /** Extra content rendered below the title (status pills, sub-nav, etc). */
  children?: ReactNode;
  /** "light" (default) for app surfaces, "dark" for cockpit-style pages. */
  variant?: "light" | "dark";
  /** Override the data-testid on the title. */
  titleTestId?: string;
  className?: string;
}

/**
 * Canonical page header used across every interior page.
 *
 * The light variant is a translucent glass strip; the dark variant renders
 * the cockpit-style starfield used by the scheduler portal and schedule
 * dashboard. Both share identical typography, eyebrow, icon, subtitle, and
 * action-area positioning so the app feels visually consistent.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  iconAccent,
  backHref,
  backLabel = "Back",
  actions,
  children,
  variant = "light",
  titleTestId = "text-page-header-title",
  className = "",
}: PageHeaderProps) {
  const isDark = variant === "dark";

  const shellClass = isDark
    ? "relative overflow-hidden rounded-3xl plexus-cockpit-bg"
    : "relative overflow-hidden rounded-3xl border border-white/60 bg-white/75 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.10)]";

  const shellStyle = undefined;

  const eyebrowClass = isDark
    ? "text-[11px] font-semibold tracking-[0.2em] text-slate-300/80 uppercase"
    : "text-[11px] font-semibold tracking-[0.2em] text-slate-500 uppercase";

  const titleClass = isDark
    ? "text-[26px] sm:text-[30px] leading-tight font-bold text-white tracking-tight"
    : "text-[24px] sm:text-[28px] leading-tight font-semibold text-slate-900 tracking-tight";

  const subtitleClass = isDark
    ? "text-sm text-slate-300/85"
    : "text-sm text-slate-600";

  const iconBoxClass = isDark
    ? "rounded-2xl bg-white/10 p-3 text-white"
    : `rounded-2xl p-3 ${iconAccent ?? "bg-slate-900/8 text-slate-700"}`;

  const backBtnClass = isDark
    ? "gap-1.5 text-slate-300 hover:text-white hover:bg-white/10"
    : "gap-1.5 text-slate-600 hover:text-slate-900";

  return (
    <div
      className={`${shellClass} ${className}`}
      style={shellStyle}
      data-testid="page-header"
    >
      {isDark && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(80% 120% at 80% -10%, hsl(var(--plexus-blue-300) / 0.22) 0%, transparent 55%)," +
                "radial-gradient(60% 100% at 5% 110%, hsl(var(--plexus-blue-500) / 0.15) 0%, transparent 55%)",
            }}
          />
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {STAR_FIELD.map((s, i) => (
              <span
                key={i}
                className="absolute rounded-full bg-white"
                style={{
                  top: `${s.y}%`,
                  left: `${s.x}%`,
                  width: `${s.size}px`,
                  height: `${s.size}px`,
                  opacity: s.op,
                  boxShadow: s.glow
                    ? "0 0 4px rgba(255,255,255,0.85), 0 0 10px rgba(165,180,252,0.55)"
                    : undefined,
                }}
              />
            ))}
          </div>
        </>
      )}

      <div className="relative px-5 sm:px-7 py-5 sm:py-6">
        {backHref && (
          <div className="mb-3">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={backBtnClass}
              data-testid="button-page-header-back"
            >
              <Link href={backHref}>
                <ArrowLeft className="w-4 h-4" />
                {backLabel}
              </Link>
            </Button>
          </div>
        )}

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            {Icon && (
              <div className={iconBoxClass}>
                <Icon className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              {eyebrow && <div className={eyebrowClass}>{eyebrow}</div>}
              <h1
                className={`${titleClass} ${eyebrow ? "mt-1" : ""}`}
                data-testid={titleTestId}
              >
                {title}
              </h1>
              {subtitle && <p className={`${subtitleClass} mt-1`}>{subtitle}</p>}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {actions}
            </div>
          )}
        </div>

        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}

// ─── Dark-variant pill helpers (preserved from CalendarPageHeader) ──────────

interface HeaderPillProps {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  active?: boolean;
  testId?: string;
}

export function HeaderPill({ children, onClick, icon, active, testId }: HeaderPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-[12px] font-medium transition-colors ${
        active
          ? "bg-slate-900 border-slate-900 text-white"
          : "bg-white/80 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300 hover:text-slate-900"
      }`}
    >
      {icon}
      <span className="tracking-wide uppercase">{children}</span>
    </button>
  );
}

export function HeaderStatusPill({ label = "SYSTEM ACTIVE" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-slate-600 uppercase">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {label}
    </span>
  );
}
