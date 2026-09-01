// Engagement Center — Call Results record list.
//
// The operational, searchable list of individual call records (distinct from
// the KPI dashboard). Backed by GET /api/engagement/call-results-list, whose
// primary source is the canonical outreach_calls log enriched with
// execution-case + patient context. Server enforces facility/staff scope;
// this component only presents + filters.
//
// Row actions dispatch the EXISTING patient_ehr Playground workspace (deduped
// by the provider) — no new patient-navigation path.

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, Phone, ExternalLink, PhoneOutgoing, PhoneMissed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dispatchOpenWorkspace } from "@/components/playground/playgroundEvents";

// ── Types (mirror server callResultsService.CallResultRow) ──────────
interface CallResultRow {
  id: number;
  startedAt: string;
  endedAt: string | null;
  outcome: string;
  disposition: string | null;
  channel: string;
  direction: string;
  attemptNumber: number;
  durationSeconds: number | null;
  callbackAt: string | null;
  hasCallback: boolean;
  notesPreview: string | null;
  patientScreeningId: number;
  patientName: string | null;
  facility: string | null;
  serviceType: string | null;
  executionCaseId: number | null;
  engagementBucket: string | null;
  engagementStatus: string | null;
  assignedTeamMemberId: number | null;
  staffUserId: string | null;
  staffName: string | null;
}

interface CallResultsPage {
  rows: CallResultRow[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

const ALL = "__all__";
const PAGE_SIZE = 50;

// Common outcomes for the filter dropdown. Free-text search still covers the
// long tail; this is just quick-access for the frequent ones.
const OUTCOME_OPTIONS = [
  "scheduled",
  "reached",
  "no_answer",
  "voicemail",
  "callback",
  "declined",
  "wrong_number",
  "needs_records",
] as const;

const CHANNEL_OPTIONS = ["phone", "email", "sms", "portal"] as const;
const CALLBACK_OPTIONS = [
  { value: "with", label: "Has callback" },
  { value: "without", label: "No callback" },
] as const;

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function outcomeTone(outcome: string): string {
  const o = outcome.toLowerCase();
  if (o === "scheduled" || o === "completed") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (o === "declined" || o === "wrong_number" || o === "dnc") return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
  if (o === "callback" || o === "no_answer" || o === "voicemail") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export function EngagementCallResults() {
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<string>(ALL);
  const [channel, setChannel] = useState<string>(ALL);
  const [callbackStatus, setCallbackStatus] = useState<string>(ALL);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [offset, setOffset] = useState(0);

  // Reset pagination whenever a filter changes.
  const filterKey = `${search}|${outcome}|${channel}|${callbackStatus}|${startDate}|${endDate}`;
  const resetOffsetOnChange = useMemo(() => {
    setOffset(0);
    return filterKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);
  void resetOffsetOnChange;

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("search", search.trim());
    if (outcome !== ALL) p.set("outcome", outcome);
    if (channel !== ALL) p.set("channel", channel);
    if (callbackStatus !== ALL) p.set("callbackStatus", callbackStatus);
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(offset));
    return p.toString();
  }, [search, outcome, channel, callbackStatus, startDate, endDate, offset]);

  const { data, isLoading, isError, error } = useQuery<CallResultsPage>({
    queryKey: ["/api/engagement/call-results-list", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/engagement/call-results-list?${queryString}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to load call results (${res.status})`);
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;

  function openPatient(row: CallResultRow) {
    if (row.patientScreeningId > 0) {
      dispatchOpenWorkspace({
        type: "patient_ehr",
        title: row.patientName ?? "Patient",
        patientScreeningId: row.patientScreeningId,
        executionCaseId: row.executionCaseId ?? null,
        serviceKey: row.serviceType ?? null,
        facilityId: row.facility ?? null,
        focusSection: "ancillary-journey",
      });
    }
  }

  return (
    <section className="mt-6" data-testid="engagement-call-results">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Call Results
          </h2>
          <p className="text-xs text-slate-500">
            Individual call records from the canonical call log.
          </p>
        </div>
        <span className="text-xs tabular-nums text-slate-500" data-testid="call-results-total">
          {total} record{total === 1 ? "" : "s"}
        </span>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, outcome, notes…"
            className="h-9 pl-8 text-sm"
            data-testid="input-call-results-search"
          />
        </div>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="h-9 w-[150px] text-xs" data-testid="select-call-results-outcome">
            <SelectValue placeholder="Any outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any outcome</SelectItem>
            {OUTCOME_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="h-9 w-[130px] text-xs" data-testid="select-call-results-channel">
            <SelectValue placeholder="Any type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any call type</SelectItem>
            {CHANNEL_OPTIONS.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={callbackStatus} onValueChange={setCallbackStatus}>
          <SelectTrigger className="h-9 w-[140px] text-xs" data-testid="select-call-results-callback">
            <SelectValue placeholder="Callback" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any callback</SelectItem>
            {CALLBACK_OPTIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="h-9 w-[140px] text-xs"
          data-testid="input-call-results-start"
          aria-label="Start date"
        />
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="h-9 w-[140px] text-xs"
          data-testid="input-call-results-end"
          aria-label="End date"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2 font-semibold">Patient</th>
              <th className="px-3 py-2 font-semibold">Staff</th>
              <th className="px-3 py-2 font-semibold">Date/Time</th>
              <th className="px-3 py-2 font-semibold">Outcome</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Callback</th>
              <th className="px-3 py-2 font-semibold">Service / Case</th>
              <th className="px-3 py-2 font-semibold">Facility</th>
              <th className="px-3 py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                  Loading call results…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-rose-500">
                  {error instanceof Error ? error.message : "Failed to load."}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-400" data-testid="call-results-empty">
                  No call records match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-900/40"
                  data-testid={`call-result-row-${r.id}`}
                >
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                    {r.patientName ?? `#${r.patientScreeningId}`}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {r.staffName ?? "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                    {fmtDateTime(r.startedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${outcomeTone(r.outcome)}`}>
                      {r.direction === "inbound" ? (
                        <PhoneMissed className="h-3 w-3" />
                      ) : (
                        <PhoneOutgoing className="h-3 w-3" />
                      )}
                      {r.disposition ?? r.outcome}
                    </span>
                  </td>
                  <td className="px-3 py-2 capitalize text-slate-600 dark:text-slate-300">
                    {r.channel}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                    {r.hasCallback && r.callbackAt ? fmtDateTime(r.callbackAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {r.serviceType ?? (r.engagementBucket ?? "—")}
                    {r.executionCaseId ? (
                      <span className="ml-1 text-[10px] text-slate-400">#{r.executionCaseId}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {r.facility ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => openPatient(r)}
                      data-testid={`call-result-open-patient-${r.id}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {hasMore ? (
        <div className="mt-3 flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            data-testid="button-call-results-load-more"
          >
            <Phone className="mr-1.5 h-3.5 w-3.5" />
            Load more ({total - rows.length - offset} remaining)
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export default EngagementCallResults;
