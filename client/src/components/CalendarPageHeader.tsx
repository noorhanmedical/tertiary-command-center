import { ReactNode } from "react";

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

interface CalendarPageHeaderProps {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function CalendarPageHeader({
  eyebrow = "PLEXUS ANCILLARY",
  title,
  actions,
  children,
  className = "",
}: CalendarPageHeaderProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl ${className}`}
      style={{
        background:
          "linear-gradient(120deg, #07101F 0%, #0B1830 45%, #0A1428 100%)",
      }}
      data-testid="calendar-page-header"
    >
      {/* faint nebula wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 120% at 80% -10%, rgba(99,102,241,0.18) 0%, transparent 55%), radial-gradient(60% 100% at 5% 110%, rgba(16,185,129,0.10) 0%, transparent 55%)",
        }}
      />
      {/* starfield */}
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

      <div className="relative px-6 sm:px-8 py-6 sm:py-7 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] font-semibold tracking-[0.2em] text-slate-300/80 uppercase">
              {eyebrow}
            </div>
          )}
          <h1
            className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mt-1"
            data-testid="text-calendar-header-title"
          >
            {title}
          </h1>
          {children}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap">{actions}</div>
        )}
      </div>
    </div>
  );
}

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
          ? "bg-white/15 border-white/30 text-white"
          : "bg-white/[0.04] border-white/10 text-slate-200 hover:bg-white/10 hover:border-white/20 hover:text-white"
      }`}
    >
      {icon}
      <span className="tracking-wide uppercase">{children}</span>
    </button>
  );
}

export function HeaderStatusPill({ label = "SYSTEM ACTIVE" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-slate-300/90 uppercase">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      {label}
    </span>
  );
}
