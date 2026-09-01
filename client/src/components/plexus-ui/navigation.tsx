import * as React from "react";
import {
  ChevronRight,
  ChevronLeft,
  Check,
  UploadCloud,
  File as FileIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Accordion as UIAccordion,
  AccordionItem as UIAccordionItem,
  AccordionTrigger as UIAccordionTrigger,
  AccordionContent as UIAccordionContent,
} from "@/components/ui/accordion";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — navigation & workflow primitives
   (§37, §38, §36, §48, §49, §53, §54)
   ══════════════════════════════════════════════════════════════════════ */

/** Breadcrumb (§38) — muted, current page dark. Does not duplicate the title. */
export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string; onClick?: () => void }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px]">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {last || (!item.href && !item.onClick) ? (
              <span
                aria-current={last ? "page" : undefined}
                style={{ color: last ? "var(--w-text)" : "var(--w-text-muted)" }}
                className={last ? "font-medium" : undefined}
              >
                {item.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={item.onClick}
                className="text-[var(--w-text-muted)] hover:text-[var(--w-text)]"
              >
                {item.label}
              </button>
            )}
            {!last && <ChevronRight className="size-3.5 text-[var(--w-text-disabled)]" aria-hidden />}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

/** Accordion (§37) — wraps shadcn/Radix accordion with winter styling. */
export function Accordion({
  items,
  type = "single",
}: {
  items: { value: string; title: string; content: React.ReactNode }[];
  type?: "single" | "multiple";
}) {
  return (
    <UIAccordion type={type as "single"} collapsible className="flex flex-col gap-2">
      {items.map((item) => (
        <UIAccordionItem
          key={item.value}
          value={item.value}
          className="plexus-card-secondary overflow-hidden border-0 px-4"
        >
          <UIAccordionTrigger className="py-3 text-[14px] font-medium hover:no-underline" style={{ color: "var(--w-text)" }}>
            {item.title}
          </UIAccordionTrigger>
          <UIAccordionContent className="pb-3 text-[13px]" style={{ color: "var(--w-text-2)" }}>
            {item.content}
          </UIAccordionContent>
        </UIAccordionItem>
      ))}
    </UIAccordion>
  );
}

/** Pagination (§36) — quiet, below lists. */
export function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total?: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).slice(
    Math.max(0, page - 3),
    Math.max(0, page - 3) + 5,
  );
  const btn =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-[10px] px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none";
  return (
    <div className="flex items-center justify-between gap-3">
      {typeof total === "number" && (
        <span className="text-[12px]" style={{ color: "var(--w-text-muted)" }}>
          {total} total
        </span>
      )}
      <nav aria-label="Pagination" className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={cn(btn, "text-[var(--w-text-2)] hover:bg-[var(--w-blue-soft)] disabled:opacity-40")}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPageChange(p)}
            className={cn(
              btn,
              p === page
                ? "bg-[var(--w-blue)] text-white"
                : "text-[var(--w-text-2)] hover:bg-[var(--w-blue-soft)]",
            )}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className={cn(btn, "text-[var(--w-text-2)] hover:bg-[var(--w-blue-soft)] disabled:opacity-40")}
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </nav>
    </div>
  );
}

/** Stepper (§49) — current / completed / upcoming states. */
export function Stepper({
  steps,
  current,
}: {
  steps: { label: string }[];
  current: number;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => {
        const completed = i < current;
        const active = i === current;
        return (
          <React.Fragment key={s.label}>
            <li className="flex items-center gap-2">
              <span
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold"
                style={{
                  background: completed ? "var(--w-green)" : active ? "var(--w-blue)" : "var(--w-blue-soft)",
                  color: completed || active ? "#fff" : "var(--w-text-muted)",
                }}
                aria-current={active ? "step" : undefined}
              >
                {completed ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span
                className="text-[13px]"
                style={{ color: active ? "var(--w-text)" : "var(--w-text-muted)", fontWeight: active ? 600 : 400 }}
              >
                {s.label}
              </span>
            </li>
            {i < steps.length - 1 && <span className="h-px w-6 bg-[var(--w-divider)]" aria-hidden />}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

/** Timeline (§53) / AuditHistory (§54) — timestamp, actor, action, detail. */
export interface TimelineEntry {
  timestamp: string;
  actor: string;
  action: React.ReactNode;
  detail?: React.ReactNode;
}
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ul className="flex flex-col gap-0">
      {entries.map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full" style={{ background: "var(--w-blue)" }} aria-hidden />
            {i < entries.length - 1 && <span className="w-px flex-1 bg-[var(--w-divider)]" aria-hidden />}
          </div>
          <div className="pb-5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-semibold" style={{ color: "var(--w-text)" }}>
                {e.actor}
              </span>
              <span className="text-[13px]" style={{ color: "var(--w-text-2)" }}>
                {e.action}
              </span>
            </div>
            {e.detail && (
              <div className="text-[12px]" style={{ color: "var(--w-text-muted)" }}>
                {e.detail}
              </div>
            )}
            <div className="text-[11px]" style={{ color: "var(--w-text-muted)" }}>
              {e.timestamp}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** UploadArea (§48) — light frosted drop zone, not overstyled. */
export function UploadArea({
  onFiles,
  accept,
  hint = "Drag & drop or browse to upload",
  files = [],
  onRemove,
}: {
  onFiles?: (files: FileList) => void;
  accept?: string;
  hint?: string;
  files?: { name: string; size?: string }[];
  onRemove?: (index: number) => void;
}) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) onFiles?.(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[16px] px-6 py-10 text-center transition-colors",
          "border-2 border-dashed focus-visible:outline-none",
        )}
        style={{
          borderColor: dragging ? "var(--w-blue)" : "var(--w-edge)",
          background: dragging ? "var(--w-blue-soft)" : "var(--w-bg-light)",
        }}
        data-testid="plexus-upload-area"
      >
        <span className="plexus-icon-frost h-11 w-11" aria-hidden>
          <UploadCloud className="size-5 text-[var(--w-blue)]" />
        </span>
        <span className="text-[13px] font-medium" style={{ color: "var(--w-text)" }}>
          {hint}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="sr-only"
          onChange={(e) => e.target.files && onFiles?.(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2.5 rounded-[10px] bg-white px-3 py-2 text-[13px]"
              style={{ border: "1px solid var(--w-edge)" }}
            >
              <FileIcon className="size-4 text-[var(--w-text-muted)]" aria-hidden />
              <span className="flex-1 truncate" style={{ color: "var(--w-text)" }}>
                {f.name}
              </span>
              {f.size && <span style={{ color: "var(--w-text-muted)" }}>{f.size}</span>}
              {onRemove && (
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onRemove(i)}
                  className="rounded-full p-1 text-[var(--w-text-muted)] hover:bg-[var(--w-blue-soft)]"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
