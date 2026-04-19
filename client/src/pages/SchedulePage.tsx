import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Calendar as CalendarIcon, Users, Building2, Filter, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ScreeningBatch, OutreachScheduler } from "@shared/schema";
import { VALID_FACILITIES } from "@shared/plexus";

type ScreeningBatchWithScheduler = ScreeningBatch & { assignedScheduler?: OutreachScheduler | null };

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  processing: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function SchedulePage() {
  const { data: batches = [], isLoading } = useQuery<ScreeningBatchWithScheduler[]>({
    queryKey: ["/api/screening-batches"],
  });
  const { data: schedulers = [] } = useQuery<OutreachScheduler[]>({
    queryKey: ["/api/outreach/schedulers"],
  });

  const [clinicFilter, setClinicFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [schedulerFilter, setSchedulerFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const clinicOptions = useMemo(() => {
    const set = new Set<string>(VALID_FACILITIES);
    batches.forEach((b) => { if (b.facility) set.add(b.facility); });
    return Array.from(set).sort();
  }, [batches]);

  const filtered = useMemo(() => {
    return batches.filter((b) => {
      if (clinicFilter !== "all" && (b.facility || "") !== clinicFilter) return false;
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (schedulerFilter !== "all") {
        if (schedulerFilter === "unassigned") {
          if (b.assignedSchedulerId != null) return false;
        } else {
          if (String(b.assignedSchedulerId ?? "") !== schedulerFilter) return false;
        }
      }
      if (startDate && (!b.scheduleDate || b.scheduleDate < startDate)) return false;
      if (endDate && (!b.scheduleDate || b.scheduleDate > endDate)) return false;
      return true;
    }).sort((a, b) => {
      const da = a.scheduleDate || "";
      const db = b.scheduleDate || "";
      if (da !== db) return db.localeCompare(da);
      return b.id - a.id;
    });
  }, [batches, clinicFilter, statusFilter, schedulerFilter, startDate, endDate]);

  const hasActiveFilters =
    clinicFilter !== "all" ||
    statusFilter !== "all" ||
    schedulerFilter !== "all" ||
    !!startDate ||
    !!endDate;

  const clearFilters = () => {
    setClinicFilter("all");
    setStatusFilter("all");
    setSchedulerFilter("all");
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-white to-blue-50/40">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900" data-testid="text-page-title">Global Schedule</h1>
          <p className="text-sm text-slate-600 mt-1">All screening batches across every clinic.</p>
        </div>

        <Card className="p-4 mb-6">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700">
            <Filter className="w-4 h-4" />
            Filters
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs gap-1"
                onClick={clearFilters}
                data-testid="button-clear-filters"
              >
                <X className="w-3 h-3" /> Clear
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Clinic</label>
              <Select value={clinicFilter} onValueChange={setClinicFilter}>
                <SelectTrigger data-testid="select-clinic-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clinics</SelectItem>
                  {clinicOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Scheduler</label>
              <Select value={schedulerFilter} onValueChange={setSchedulerFilter}>
                <SelectTrigger data-testid="select-scheduler-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All schedulers</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {schedulers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">From date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">To date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-end-date"
              />
            </div>
          </div>
        </Card>

        <div className="text-xs text-slate-500 mb-2" data-testid="text-result-count">
          {isLoading ? "Loading…" : `${filtered.length} of ${batches.length} batches`}
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold">Batch</th>
                  <th className="text-left px-4 py-3 font-semibold">Clinic</th>
                  <th className="text-left px-4 py-3 font-semibold">Patients</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-left px-4 py-3 font-semibold">Scheduler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400" data-testid="text-empty-state">
                      {batches.length === 0 ? "No batches yet." : "No batches match these filters."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70" data-testid={`row-batch-${b.id}`}>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
                          {formatDate(b.scheduleDate)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/schedule/${b.id}`}>
                          <a
                            className="text-indigo-600 hover:underline font-medium"
                            data-testid={`link-batch-${b.id}`}
                          >
                            {b.name}
                          </a>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {b.facility || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          {b.patientCount}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`${STATUS_STYLES[b.status] || "bg-slate-100 text-slate-700"} border-0 capitalize`}>
                          {b.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {b.assignedScheduler?.name || (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
