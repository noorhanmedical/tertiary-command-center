import { cn } from "@/lib/utils";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — loading skeletons (§43)
   Winter-tinted skeletons for list row / card / KPI / table / form.
   ══════════════════════════════════════════════════════════════════════ */

function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md", className)}
      style={{ background: "linear-gradient(90deg, var(--w-icy), var(--w-cool), var(--w-icy))" }}
    />
  );
}

export function SkeletonRow() {
  return (
    <div className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-white/55 px-4 py-2.5" data-testid="plexus-skeleton-row">
      <Bar className="h-9 w-9 rounded-full" />
      <div className="flex-1 space-y-2">
        <Bar className="h-3.5 w-1/3" />
        <Bar className="h-3 w-1/2" />
      </div>
      <Bar className="h-6 w-16 rounded-full" />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="plexus-card space-y-3 p-6" data-testid="plexus-skeleton-card">
      <Bar className="h-4 w-1/2" />
      <Bar className="h-3 w-full" />
      <Bar className="h-3 w-4/5" />
      <Bar className="h-20 w-full rounded-[12px]" />
    </div>
  );
}

export function SkeletonKpi() {
  return (
    <div className="flex items-center gap-3" data-testid="plexus-skeleton-kpi">
      <Bar className="h-10 w-10 rounded-full" />
      <div className="space-y-2">
        <Bar className="h-2.5 w-16" />
        <Bar className="h-7 w-24" />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" data-testid="plexus-skeleton-table">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4" data-testid="plexus-skeleton-form">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Bar className="h-2.5 w-24" />
          <Bar className="h-11 w-full rounded-[12px]" />
        </div>
      ))}
    </div>
  );
}
