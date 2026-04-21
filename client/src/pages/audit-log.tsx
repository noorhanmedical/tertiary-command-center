import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, Filter, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import type { AuditLog } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";

const ACTION_COLORS: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
};

const ENTITY_LABELS: Record<string, string> = {
  patient: "Patient",
  batch: "Batch",
  billing: "Billing",
  appointment: "Appointment",
};

function formatTimestamp(ts: string | Date) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditLogPage() {
  const [userFilter, setUserFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const params = new URLSearchParams();
  if (entityTypeFilter && entityTypeFilter !== "all") params.set("entityType", entityTypeFilter);
  if (fromDate) params.set("fromDate", new Date(fromDate).toISOString());
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    params.set("toDate", end.toISOString());
  }

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit-log", entityTypeFilter, fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(`/api/audit-log?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit log");
      return res.json();
    },
  });

  const { data: users = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ["/api/audit-log/users"],
  });

  const filtered = userFilter
    ? logs.filter((l) => l.userId === userFilter)
    : logs;

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">

        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/admin" className="hover:text-slate-700 transition">Admin</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-slate-700 font-medium">Audit Log</span>
        </div>

        <PageHeader
          eyebrow="PLEXUS ANCILLARY · AUDIT"
          icon={Shield}
          title="Audit Log"
          subtitle="A read-only record of who changed what and when."
        />

        <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex items-center gap-2 text-slate-500">
              <Filter className="w-4 h-4" />
              <span className="text-sm font-medium">Filters</span>
            </div>

            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-slate-500 mb-1 block">User</label>
              <Select value={userFilter} onValueChange={setUserFilter} data-testid="filter-user">
                <SelectTrigger className="h-9 text-sm" data-testid="select-user">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All users</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-slate-500 mb-1 block">Entity type</label>
              <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter} data-testid="filter-entity-type">
                <SelectTrigger className="h-9 text-sm" data-testid="select-entity-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="patient">Patient</SelectItem>
                  <SelectItem value="batch">Batch</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="appointment">Appointment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-slate-500 mb-1 block">From date</label>
              <Input
                type="date"
                className="h-9 text-sm"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                data-testid="input-from-date"
              />
            </div>

            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-slate-500 mb-1 block">To date</label>
              <Input
                type="date"
                className="h-9 text-sm"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                data-testid="input-to-date"
              />
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-slate-500"
              onClick={() => {
                setUserFilter("");
                setEntityTypeFilter("all");
                setFromDate("");
                setToDate("");
              }}
              data-testid="button-clear-filters"
            >
              Clear
            </Button>
          </div>
        </Card>

        <Card className="rounded-3xl border border-white/60 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
              Loading audit log…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
              <Shield className="w-8 h-8 opacity-30" />
              <p className="text-sm">No activity found matching your filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="audit-log-table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Time</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">User</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Entity</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">ID</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log, idx) => (
                    <tr
                      key={log.id}
                      className={`border-b border-slate-50 transition hover:bg-slate-50/60 ${idx % 2 === 0 ? "" : "bg-slate-50/30"}`}
                      data-testid={`audit-row-${log.id}`}
                    >
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="px-5 py-3 font-medium text-slate-700 whitespace-nowrap" data-testid={`audit-user-${log.id}`}>
                        {log.username ?? <span className="text-slate-400 italic">system</span>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge className={`text-xs font-semibold capitalize ${ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-600"}`} data-testid={`audit-action-${log.id}`}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-600 capitalize" data-testid={`audit-entity-${log.id}`}>
                        {ENTITY_LABELS[log.entityType] ?? log.entityType}
                      </td>
                      <td className="px-5 py-3 text-slate-500 font-mono text-xs">
                        {log.entityId ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-slate-500 max-w-xs">
                        {log.changes ? (
                          <span className="truncate block max-w-[260px] text-xs font-mono text-slate-400" title={JSON.stringify(log.changes)}>
                            {JSON.stringify(log.changes)}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-center text-xs text-slate-400">
          Showing the {filtered.length} most recent entries (max 200 per query).
        </p>
      </div>
    </div>
  );
}
