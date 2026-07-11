// Physician Portal — Reports tab.
//
// Live-data-backed: consumes GET /api/physician-portal/reports. Renders
// the outstanding report worklist by default. Empty state when nothing
// is outstanding; error state when the endpoint fails; loading skeleton
// while fetching.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface ReportRow {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  patientName: string | null;
  patientFacility: string | null;
  serviceType: string | null;
  documentStatus: string | null;
  blocksBilling: boolean | null;
  updatedAt: string | null;
  createdAt: string | null;
}

const SERVICE_TYPES = ["BrainWave", "VitalWave", "Ultrasound", "PGx"];

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export function ReportsTab() {
  const [serviceType, setServiceType] = useState<string>("");
  const [onlyOpen, setOnlyOpen] = useState<boolean>(true);

  const q = useQuery<ReportRow[]>({
    queryKey: [
      "/api/physician-portal/reports",
      { serviceType: serviceType || undefined, onlyOpen },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (serviceType) params.set("serviceType", serviceType);
      if (!onlyOpen) params.set("onlyOpen", "false");
      const res = await fetch(
        `/api/physician-portal/reports?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load reports (${res.status})`);
      return res.json();
    },
  });

  return (
    <div className="space-y-4" data-testid="physician-reports-tab">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Service:</span>
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            data-testid="reports-filter-service-type"
          >
            <option value="">All</option>
            {SERVICE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
            data-testid="reports-filter-only-open"
          />
          <span className="text-slate-600">Only outstanding</span>
        </label>
        {q.isFetching && (
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </span>
        )}
      </div>

      {q.isError && (
        <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Failed to load reports. Try again later.
        </div>
      )}

      {q.isSuccess && q.data.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          {onlyOpen
            ? "No outstanding reports for the selected filter."
            : "No reports match the selected filter."}
        </div>
      ) : q.isSuccess ? (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.map((r) => (
                <TableRow key={r.id} data-testid={`reports-row-${r.id}`}>
                  <TableCell>{r.patientName ?? "—"}</TableCell>
                  <TableCell>{r.patientFacility ?? "—"}</TableCell>
                  <TableCell>{r.serviceType ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.documentStatus === "uploaded" || r.documentStatus === "approved" || r.documentStatus === "completed" ? "default" : "outline"}>
                      {r.documentStatus ?? "missing"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.blocksBilling ? (
                      <Badge variant="destructive">Blocks</Badge>
                    ) : (
                      <span className="text-xs text-slate-500">ok</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {fmtDate(r.updatedAt ?? r.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
