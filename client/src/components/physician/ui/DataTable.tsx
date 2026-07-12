import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T extends { id: string }>({
  columns, rows, onRowClick, rowTestId, emptyMessage = "No records.", selectable, selectedIds, onToggle,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  rowTestId?: (row: T) => string;
  emptyMessage?: string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const alignClass = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  return (
    <div className="overflow-x-auto rounded-[14px] border border-finance-border bg-white shadow-[0_1px_2px_rgba(16,17,20,0.04)]">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-finance-border bg-finance-bg-soft">
            {selectable && <th className="w-10 px-3 py-2.5" />}
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn("px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-finance-text-secondary", alignClass(c.align), c.className)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-8 text-center text-sm text-finance-text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-finance-border/60 last:border-0",
                  onRowClick && "cursor-pointer hover:bg-finance-bg-soft",
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                data-testid={rowTestId ? rowTestId(row) : undefined}
              >
                {selectable && (
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-finance-border-strong accent-finance-periwinkle"
                      checked={selectedIds?.has(row.id) ?? false}
                      onChange={() => onToggle?.(row.id)}
                      data-testid={`checkbox-${row.id}`}
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2.5 text-finance-text", alignClass(c.align), c.className)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
