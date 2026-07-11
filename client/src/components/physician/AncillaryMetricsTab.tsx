// Physician Portal — Ancillary Metrics tab.
//
// Live-data-backed: consumes GET /api/physician-portal/ancillary-metrics.
// Per-service rollup over a scoped window (default 30 days). The
// backend enforces the query bounds so a runaway URL can't request an
// unbounded window.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface MetricsRow {
  serviceType: string;
  proceduresCompleted: number;
  reportsUploaded: number;
  notesSigned: number;
  reportsOutstanding: number;
}

const WINDOW_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

export function AncillaryMetricsTab() {
  const [days, setDays] = useState<number>(30);

  const q = useQuery<MetricsRow[]>({
    queryKey: ["/api/physician-portal/ancillary-metrics", { days }],
    queryFn: async () => {
      const res = await fetch(
        `/api/physician-portal/ancillary-metrics?days=${days}`,
        { credentials: "include" },
      );
      if (!res.ok)
        throw new Error(`Failed to load ancillary metrics (${res.status})`);
      return res.json();
    },
  });

  const totals = q.data
    ? q.data.reduce(
        (acc, r) => {
          acc.proceduresCompleted += r.proceduresCompleted;
          acc.reportsUploaded += r.reportsUploaded;
          acc.notesSigned += r.notesSigned;
          acc.reportsOutstanding += r.reportsOutstanding;
          return acc;
        },
        {
          proceduresCompleted: 0,
          reportsUploaded: 0,
          notesSigned: 0,
          reportsOutstanding: 0,
        },
      )
    : null;

  return (
    <div className="space-y-4" data-testid="physician-ancillary-metrics-tab">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Window:</span>
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            data-testid="ancillary-metrics-window"
          >
            {WINDOW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {q.isFetching && (
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </span>
        )}
      </div>

      {q.isError && (
        <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Failed to load ancillary metrics. Try again later.
        </div>
      )}

      {q.isSuccess && q.data.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          No ancillary activity in the selected window.
        </div>
      ) : q.isSuccess ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Procedures completed</TableHead>
                  <TableHead className="text-right">Reports uploaded</TableHead>
                  <TableHead className="text-right">Notes signed</TableHead>
                  <TableHead className="text-right">Reports outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.map((r) => (
                  <TableRow
                    key={r.serviceType}
                    data-testid={`ancillary-metrics-row-${r.serviceType}`}
                  >
                    <TableCell className="font-medium">{r.serviceType}</TableCell>
                    <TableCell className="text-right">{r.proceduresCompleted}</TableCell>
                    <TableCell className="text-right">{r.reportsUploaded}</TableCell>
                    <TableCell className="text-right">{r.notesSigned}</TableCell>
                    <TableCell className="text-right">{r.reportsOutstanding}</TableCell>
                  </TableRow>
                ))}
                {totals && (
                  <TableRow className="border-t-2 border-slate-300 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">
                      {totals.proceduresCompleted}
                    </TableCell>
                    <TableCell className="text-right">
                      {totals.reportsUploaded}
                    </TableCell>
                    <TableCell className="text-right">{totals.notesSigned}</TableCell>
                    <TableCell className="text-right">
                      {totals.reportsOutstanding}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-slate-500">
            Procedures completed / Reports uploaded / Notes signed are counted
            within the selected window. Reports outstanding is the current
            backlog and is not date-scoped.
          </p>
        </div>
      ) : null}
    </div>
  );
}
