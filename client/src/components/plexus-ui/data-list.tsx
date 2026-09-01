import * as React from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "./forms";
import { StatusBadge, CountBadge, PriorityIndicator } from "./status";
import type { PlexusStatusTone } from "./tokens";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — table / list & row patterns
   (§24, §25, §26, §54, §55, §56, §57, §58, §59)
   Not a spreadsheet: minimal grid lines, soft row fills, clear hover/selected.
   ══════════════════════════════════════════════════════════════════════ */

/** DataList — the shared list container. Rows sit on the winter canvas. */
export function DataList({
  children,
  className,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="list" aria-label={ariaLabel} className={cn("flex flex-col gap-2", className)} data-testid="plexus-data-list">
      {children}
    </div>
  );
}

/** Column-label header for lists (§24) — 10–11px muted. */
export function DataListHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("px-4 text-[11px] font-semibold uppercase tracking-[0.06em]", className)}
      style={{ color: "var(--w-text-muted)" }}
    >
      {children}
    </div>
  );
}

/** Base row surface with hover + selected states (§24, §69). */
export function DataRow({
  children,
  selected,
  onClick,
  className,
  testId,
}: {
  children: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  testId?: string;
}) {
  const interactive = !!onClick;
  return (
    <div
      role="listitem"
      data-testid={testId}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        "flex min-h-[52px] items-center gap-3 rounded-[14px] px-4 py-2.5 transition-colors",
        "border border-transparent",
        interactive && "cursor-pointer hover:bg-[#F7FAFD] focus-visible:outline-none",
        className,
      )}
      style={selected ? { background: "var(--w-blue-soft)" } : { background: "rgba(255,255,255,0.40)" }}
    >
      {children}
    </div>
  );
}

/** RowActions (§26) — one consistent overflow menu. 40px trigger. */
export interface RowAction {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  destructive?: boolean;
  /** Optional test id forwarded to the rendered menu item. */
  testId?: string;
}
export function RowActions({ actions, label = "Row actions" }: { actions: RowAction[]; label?: string }) {
  const normal = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-[var(--w-text-2)] transition-colors hover:bg-[var(--w-blue-soft)] focus-visible:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-[18px]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[176px] rounded-[12px]">
        {normal.map((a) => (
          <DropdownMenuItem
            key={a.label}
            data-testid={a.testId}
            onClick={(e) => {
              e.stopPropagation();
              a.onSelect?.();
            }}
            className="gap-2 text-[13px]"
          >
            {a.icon && <a.icon className="size-4" aria-hidden />}
            {a.label}
          </DropdownMenuItem>
        ))}
        {destructive.length > 0 && normal.length > 0 && <DropdownMenuSeparator />}
        {destructive.map((a) => (
          <DropdownMenuItem
            key={a.label}
            data-testid={a.testId}
            onClick={(e) => {
              e.stopPropagation();
              a.onSelect?.();
            }}
            className="gap-2 text-[13px] text-[var(--w-error)] focus:text-[var(--w-error)]"
          >
            {a.icon && <a.icon className="size-4" aria-hidden />}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** BulkActionToolbar (§25) — appears only when rows are selected. */
export function BulkActionToolbar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="plexus-frost-secondary flex items-center gap-3 px-4 py-2.5" data-testid="plexus-bulk-toolbar">
      <span className="text-[13px] font-medium text-[var(--w-text)]">{count} selected</span>
      <div className="flex items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-[13px] font-medium text-[var(--w-blue)] hover:text-[var(--w-blue-hover)]"
      >
        Clear selection
      </button>
    </div>
  );
}

// ─── Domain rows ────────────────────────────────────────────────────────

function primaryName(name: string) {
  return (
    <span className="text-[15px] font-semibold leading-tight" style={{ color: "var(--w-text)" }}>
      {name}
    </span>
  );
}
function meta(text: React.ReactNode) {
  return (
    <span className="text-[12px] leading-tight" style={{ color: "var(--w-text-muted)" }}>
      {text}
    </span>
  );
}

/** PatientRow (§55). */
export function PatientRow({
  name,
  mrn,
  demographics,
  status,
  statusTone = "neutral",
  reviewCount,
  selectable,
  selected,
  onSelectedChange,
  actions,
  onOpen,
}: {
  name: string;
  mrn: string;
  demographics?: string;
  status?: string;
  statusTone?: PlexusStatusTone;
  reviewCount?: number;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (v: boolean) => void;
  actions?: RowAction[];
  onOpen?: () => void;
}) {
  return (
    <DataRow selected={selected} onClick={onOpen} testId="plexus-patient-row">
      {selectable && (
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onSelectedChange} label={<span className="sr-only">Select {name}</span>} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {primaryName(name)}
          {status && <StatusBadge tone={statusTone}>{status}</StatusBadge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          {meta(`MRN ${mrn}`)}
          {demographics && meta(demographics)}
        </div>
      </div>
      {typeof reviewCount === "number" && reviewCount > 0 && (
        <span className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--w-text-2)" }}>
          Reviews <CountBadge count={reviewCount} tone="review" />
        </span>
      )}
      {actions && <RowActions actions={actions} label={`Actions for ${name}`} />}
    </DataRow>
  );
}

/** ClinicRow (§56). */
export function ClinicRow({
  name,
  location,
  providers,
  patients,
  status,
  statusTone = "neutral",
  actions,
  onOpen,
}: {
  name: string;
  location: string;
  providers: number;
  patients: number;
  status?: string;
  statusTone?: PlexusStatusTone;
  actions?: RowAction[];
  onOpen?: () => void;
}) {
  return (
    <DataRow onClick={onOpen} testId="plexus-clinic-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {primaryName(name)}
          {status && <StatusBadge tone={statusTone}>{status}</StatusBadge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          {meta(location)}
          {/* Mobile: reflow counts into the metadata line instead of hiding them. */}
          <span className="sm:hidden">{meta(`${providers} providers`)}</span>
          <span className="sm:hidden">{meta(`${patients} patients`)}</span>
        </div>
      </div>
      <span className="hidden text-[13px] sm:inline" style={{ color: "var(--w-text-2)" }}>
        {providers} providers
      </span>
      <span className="hidden text-[13px] sm:inline" style={{ color: "var(--w-text-2)" }}>
        {patients} patients
      </span>
      {actions && <RowActions actions={actions} label={`Actions for ${name}`} />}
    </DataRow>
  );
}

/** ScheduleRow (§57). */
export function ScheduleRow({
  time,
  patient,
  visitType,
  provider,
  status,
  statusTone = "scheduled",
  actions,
  onOpen,
}: {
  time: string;
  patient: string;
  visitType: string;
  provider?: string;
  status?: string;
  statusTone?: PlexusStatusTone;
  actions?: RowAction[];
  onOpen?: () => void;
}) {
  return (
    <DataRow onClick={onOpen} testId="plexus-schedule-row">
      <span className="w-16 shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: "var(--w-text)" }}>
        {time}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {primaryName(patient)}
          {status && <StatusBadge tone={statusTone}>{status}</StatusBadge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          {meta(visitType)}
          {provider && meta(provider)}
        </div>
      </div>
      {actions && <RowActions actions={actions} label={`Actions for ${patient}`} />}
    </DataRow>
  );
}

/** DocumentRow (§59). */
export function DocumentRow({
  name,
  type,
  owner,
  uploadedDate,
  status,
  statusTone = "neutral",
  actions,
  onOpen,
}: {
  name: string;
  type: string;
  owner?: string;
  uploadedDate: string;
  status?: string;
  statusTone?: PlexusStatusTone;
  actions?: RowAction[];
  onOpen?: () => void;
}) {
  return (
    <DataRow onClick={onOpen} testId="plexus-document-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {primaryName(name)}
          {status && <StatusBadge tone={statusTone}>{status}</StatusBadge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          {meta(type)}
          {owner && meta(owner)}
          {meta(`Uploaded ${uploadedDate}`)}
        </div>
      </div>
      {actions && <RowActions actions={actions} label={`Actions for ${name}`} />}
    </DataRow>
  );
}

/** ReviewQueueRow (§58) — priority never color-only. */
export function ReviewQueueRow({
  item,
  priority,
  age,
  owner,
  status,
  statusTone = "pending",
  actions,
  onOpen,
}: {
  item: string;
  priority: "high" | "medium" | "low";
  age: string;
  owner?: string;
  status?: string;
  statusTone?: PlexusStatusTone;
  actions?: RowAction[];
  onOpen?: () => void;
}) {
  return (
    <DataRow onClick={onOpen} testId="plexus-review-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {primaryName(item)}
          {status && <StatusBadge tone={statusTone}>{status}</StatusBadge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          {meta(`Age ${age}`)}
          {owner && meta(owner)}
        </div>
      </div>
      <PriorityIndicator level={priority} />
      {actions && <RowActions actions={actions} label={`Actions for ${item}`} />}
    </DataRow>
  );
}
