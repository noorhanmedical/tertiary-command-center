import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { plexusChartPalette } from "./tokens";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — date picker (§35) & chart frame (§51)
   ══════════════════════════════════════════════════════════════════════ */

/** DatePicker (§35) — winter input + shadcn Calendar in a popover. */
export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  ariaLabel = "Select date",
  className,
}: {
  value?: Date;
  onChange?: (date?: Date) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-[12px] bg-white px-3.5 text-[14px]",
            "border border-[var(--w-edge)] transition-[border-color,box-shadow] focus-visible:outline-none",
            "focus-visible:border-[var(--w-blue)] focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)]",
            className,
          )}
          style={{ color: value ? "var(--w-text)" : "var(--w-text-muted)" }}
        >
          <CalendarIcon className="size-[18px] text-[var(--w-text-2)]" aria-hidden />
          {value ? format(value, "MMM d, yyyy") : placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-[14px] p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange?.(d ?? undefined);
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * ChartFrame (§51) — standardizes chart chrome: title, restrained palette
 * legend, no-data + loading states, and an accessible summary. The actual
 * plotting (recharts, etc.) is passed as children so this stays presentational.
 */
export function ChartFrame({
  title,
  summary,
  legend,
  loading,
  empty,
  children,
  className,
}: {
  title?: string;
  summary?: string;
  legend?: { label: string; color?: string }[];
  loading?: boolean;
  empty?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("plexus-card p-6", className)} data-testid="plexus-chart-frame">
      {(title || legend) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && (
            <figcaption className="text-[14px] font-semibold" style={{ color: "var(--w-text)" }}>
              {title}
            </figcaption>
          )}
          {legend && (
            <ul className="flex flex-wrap items-center gap-3">
              {legend.map((l, i) => (
                <li key={l.label} className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--w-text-2)" }}>
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: l.color ?? plexusChartPalette[i % plexusChartPalette.length] }}
                    aria-hidden
                  />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {summary && <p className="sr-only">{summary}</p>}
      <div className="relative">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-[13px]" style={{ color: "var(--w-text-muted)" }}>
            Loading chart…
          </div>
        ) : empty ? (
          <div className="flex h-48 items-center justify-center text-[13px]" style={{ color: "var(--w-text-muted)" }}>
            No data available
          </div>
        ) : (
          children
        )}
      </div>
    </figure>
  );
}
