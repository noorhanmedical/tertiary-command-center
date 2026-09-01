import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Loader2, Search, Database, Users, Building2, Clock, CheckCircle2,
  Upload, X, UserSearch, Plus, User as UserIcon, ChevronLeft, ChevronRight,
} from "lucide-react";
import { PatientProfileWorkspace } from "@/components/patient-directory/PatientProfileWorkspace";
import { PatientChartSkeleton } from "@/components/patient-directory/PatientChart";
import { RecentImportsPanel } from "@/components/patient-directory/RecentImportsPanel";
import { fmtDate } from "@/components/patient-directory/profileTypes";

type RosterPatient = {
  key: string;
  encodedKey: string;
  representativeScreeningId: number;
  name: string;
  dob: string | null;
  age: number | null;
  gender: string | null;
  phoneNumber: string | null;
  insurance: string | null;
  clinic: string;
  lastVisit: string | null;
  testCount: number;
  screeningCount: number;
  generatedNoteCount: number;
  cooldownActiveCount: number;
  nextCooldownClearsAt: string | null;
  daysUntilNextClear: number | null;
  plexusId: string | null;
};

type ClinicGroup = { clinic: string; patients: RosterPatient[] };
type ClinicTotal = { clinic: string; count: number };
type RosterResponse = {
  groups: ClinicGroup[];
  clinicTotals: ClinicTotal[];
  totals: { patients: number; clinics: number };
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean };
};
type CooldownSummary = {
  oneDay: number; oneWeek: number; oneMonth: number;
  totals: { patients: number; clinics: number };
  byClinic: Array<{ clinic: string; oneDay: number; oneWeek: number; oneMonth: number }>;
  allClinics: string[];
};

function CooldownBadge({ p }: { p: RosterPatient }) {
  if (p.cooldownActiveCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
        <CheckCircle2 className="w-3 h-3" />Clear
      </span>
    );
  }
  const days = p.daysUntilNextClear ?? 999;
  const color = days <= 1 ? "bg-red-100 text-red-800" : days <= 7 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700";
  const label = days <= 1 ? "Clears <1d" : days <= 7 ? `Clears in ${days}d` : `${p.cooldownActiveCount} on cooldown`;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${color}`} title={p.nextCooldownClearsAt ? `Next clears ${p.nextCooldownClearsAt}` : undefined}>
      <Clock className="w-3 h-3" />{label}
    </span>
  );
}

export default function PatientDatabasePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  const urlParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const urlPatientId = urlParams.get("patientId");

  const [search, setSearch] = useState(() => urlParams.get("search") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => (urlParams.get("search") ?? "").trim());
  const [clinicFilter, setClinicFilter] = useState<string>("");
  const [windowFilter, setWindowFilter] = useState<"" | "1d" | "1w" | "1m">("");
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Keep ?search= in the URL in sync (without spamming history) while preserving
  // any active ?patientId= deep link.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (debouncedSearch) sp.set("search", debouncedSearch);
    else sp.delete("search");
    const qs = sp.toString();
    window.history.replaceState(null, "", `/patient-directory${qs ? `?${qs}` : ""}`);
  }, [debouncedSearch]);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [addPatientOpen, setAddPatientOpen] = useState(false);
  const [addPatientText, setAddPatientText] = useState("");
  const [addPatientBusy, setAddPatientBusy] = useState(false);

  const PAGE_SIZE = 100;
  const rosterQuery = useInfiniteQuery<RosterResponse>({
    queryKey: ["/api/patients/database", { search: debouncedSearch, clinic: clinicFilter, cooldownWindow: windowFilter, pageSize: PAGE_SIZE }],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (clinicFilter) params.set("clinic", clinicFilter);
      if (windowFilter) params.set("cooldownWindow", windowFilter);
      params.set("page", String(pageParam ?? 1));
      params.set("pageSize", String(PAGE_SIZE));
      const res = await fetch(`/api/patients/database?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load patient database");
      return res.json();
    },
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
  });

  const mergedRoster = useMemo(() => {
    const pages = rosterQuery.data?.pages ?? [];
    const groupOrder: string[] = [];
    const groupMap = new Map<string, { patients: RosterPatient[]; seen: Set<string> }>();
    for (const pg of pages) {
      for (const grp of pg.groups) {
        let entry = groupMap.get(grp.clinic);
        if (!entry) {
          entry = { patients: [], seen: new Set() };
          groupMap.set(grp.clinic, entry);
          groupOrder.push(grp.clinic);
        }
        for (const p of grp.patients) {
          if (entry.seen.has(p.encodedKey)) continue;
          entry.seen.add(p.encodedKey);
          entry.patients.push(p);
        }
      }
    }
    const groups: ClinicGroup[] = groupOrder.map((clinic) => ({
      clinic,
      patients: groupMap.get(clinic)!.patients,
    }));
    const last = pages[pages.length - 1];
    return {
      groups,
      clinicTotals: last?.clinicTotals ?? [],
      totals: last?.totals ?? { patients: 0, clinics: 0 },
      pagination: last?.pagination ?? { page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false },
      loadedCount: groups.reduce((s, g) => s + g.patients.length, 0),
    };
  }, [rosterQuery.data]);

  const clinicTotalByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const ct of mergedRoster.clinicTotals) m.set(ct.clinic, ct.count);
    return m;
  }, [mergedRoster.clinicTotals]);

  const summaryQuery = useQuery<CooldownSummary>({
    queryKey: ["/api/patients/database/cooldown-summary"],
  });

  // ── Selection / deep-link resolution ──────────────────────────────────────
  // Try to satisfy ?patientId= from the already-loaded roster first; fall back
  // to a tiny resolve endpoint (screening id -> roster key) for inbound deep
  // links (e.g. the Team Member Portal call list).
  const rosterMatch = useMemo(() => {
    if (!urlPatientId) return null;
    const idNum = Number(urlPatientId);
    if (!Number.isFinite(idNum)) return null;
    for (const g of mergedRoster.groups) {
      for (const p of g.patients) {
        if (p.representativeScreeningId === idNum) return p;
      }
    }
    return null;
  }, [urlPatientId, mergedRoster.groups]);

  const resolveQuery = useQuery<{ encodedKey: string; name: string; dob: string | null }>({
    queryKey: ["/api/patients/database/resolve", urlPatientId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/database/resolve/${urlPatientId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to resolve patient");
      return res.json();
    },
    enabled: !!urlPatientId && !rosterMatch,
  });

  const selectedKey = rosterMatch?.encodedKey ?? resolveQuery.data?.encodedKey ?? null;
  const selectedRepId = rosterMatch?.representativeScreeningId
    ?? (urlPatientId && Number.isFinite(Number(urlPatientId)) ? Number(urlPatientId) : null);
  // Name shown instantly in the chart shell before the heavy profile resolves.
  // Prefer roster/resolve data; fall back to a name passed on the deep link.
  const seedName = rosterMatch?.name ?? resolveQuery.data?.name ?? urlParams.get("name") ?? null;

  function selectPatient(p: RosterPatient) {
    const sp = new URLSearchParams(window.location.search);
    sp.set("patientId", String(p.representativeScreeningId));
    setLocation(`/patient-directory?${sp.toString()}`);
  }

  function clearSelection() {
    const sp = new URLSearchParams(window.location.search);
    sp.delete("patientId");
    const qs = sp.toString();
    setLocation(`/patient-directory${qs ? `?${qs}` : ""}`);
  }

  const importTextMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/test-history/import", { text });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Imported ${Array.isArray(data) ? data.length : (data?.imported ?? 0)} records` });
      setImportOpen(false);
      setImportText("");
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/database"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/database/cooldown-summary"] });
    },
    onError: (e: unknown) => toast({ title: "Import failed", description: e instanceof Error ? e.message : "Import failed", variant: "destructive" }),
  });

  const importFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/test-history/import", { method: "POST", credentials: "include", body: formData });
      if (!res.ok) throw new Error((await res.json()).error || "Import failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Imported ${Array.isArray(data) ? data.length : (data?.imported ?? 0)} records` });
      setImportOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/database"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/database/cooldown-summary"] });
    },
    onError: (e: unknown) => toast({ title: "Import failed", description: e instanceof Error ? e.message : "Import failed", variant: "destructive" }),
  });

  const allClinics = useMemo(() => {
    const fromSummary = summaryQuery.data?.allClinics;
    if (fromSummary && fromSummary.length > 0) return fromSummary;
    return mergedRoster.clinicTotals.map((c) => c.clinic);
  }, [summaryQuery.data?.allClinics, mergedRoster.clinicTotals]);

  const totalPatients = mergedRoster.totals.patients;
  const loadedCount = mergedRoster.loadedCount;
  const hasMore = mergedRoster.pagination.hasMore;
  const isLoading = rosterQuery.isLoading;

  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const isFetchingNextPage = rosterQuery.isFetchingNextPage;
  const fetchNextPage = rosterQuery.fetchNextPage;
  useEffect(() => {
    const node = loadMoreSentinelRef.current;
    if (!node || !hasMore || isFetchingNextPage) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isFetchingNextPage, fetchNextPage]);

  const hasSelection = !!urlPatientId;
  const resolving = resolveQuery.isLoading && !rosterMatch;

  return (
    <div className="flex h-full relative z-10 bg-finance-bg overflow-hidden">
      {/* ── Left rail: roster + filters (collapsible) ── */}
      {railCollapsed && hasSelection ? (
        <div
          className="hidden lg:flex flex-col items-center shrink-0 pt-3 border-r border-border/60 bg-white/40 dark:bg-card/30"
          style={{ width: "40px" }}
          data-testid="patient-directory-rail-collapsed"
        >
          <button
            onClick={() => setRailCollapsed(false)}
            title="Expand patient list"
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-200/60"
            data-testid="button-rail-expand"
          >
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      ) : (
      <aside
        className={`${hasSelection ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-[280px] xl:w-[300px] shrink-0 border-r border-border/60 bg-white/40 dark:bg-card/30`}
        data-testid="patient-directory-rail"
      >
        <div className="px-4 pt-4 pb-3 border-b border-border/60 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-slate-900/8 text-slate-700 flex items-center justify-center shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Plexus Ancillary</div>
                <h1 className="text-base font-bold leading-tight truncate">Plexus EHR</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="default" onClick={() => setAddPatientOpen(true)} className="gap-1.5" data-testid="button-add-patient-ehr">
                <Plus className="w-3.5 h-3.5" />Add Patient
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5" data-testid="button-import-test-history">
                <Upload className="w-3.5 h-3.5" />Import
              </Button>
              {hasSelection && (
                <Button size="icon" variant="ghost" className="h-8 w-8 hidden lg:inline-flex" onClick={() => setRailCollapsed(true)} title="Collapse patient list" data-testid="button-rail-collapse">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="text-roster-summary">
            {totalPatients} patient{totalPatients !== 1 ? "s" : ""}{loadedCount < totalPatients ? ` · showing ${loadedCount}` : ""}
          </p>

          {/* Cooldown tiles (compact) */}
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: "1d" as const, label: "≤1 day", count: summaryQuery.data?.oneDay ?? 0, tone: "border-red-200 text-red-900 bg-red-50 dark:bg-red-900/20" },
              { key: "1w" as const, label: "≤1 week", count: summaryQuery.data?.oneWeek ?? 0, tone: "border-amber-200 text-amber-900 bg-amber-50 dark:bg-amber-900/20" },
              { key: "1m" as const, label: "≤1 month", count: summaryQuery.data?.oneMonth ?? 0, tone: "border-blue-200 text-blue-900 bg-blue-50 dark:bg-blue-900/20" },
            ]).map((tile) => {
              const active = windowFilter === tile.key;
              return (
                <button
                  key={tile.key}
                  onClick={() => setWindowFilter(active ? "" : tile.key)}
                  className={`text-left rounded-lg border p-2 transition-all hover:shadow-sm ${tile.tone} ${active ? "ring-2 ring-offset-1 ring-slate-400" : ""}`}
                  data-testid={`tile-cooldown-${tile.key}`}
                >
                  <div className="text-xl font-bold tabular-nums leading-none" data-testid={`text-cooldown-count-${tile.key}`}>{tile.count}</div>
                  <div className="text-[10px] mt-1 opacity-80">{tile.label}</div>
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Search by name or DOB..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-sm h-9"
              data-testid="input-search-patients"
            />
          </div>

          {/* Clinic chips */}
          {allClinics.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap" data-testid="row-clinic-chips">
              <button
                onClick={() => setClinicFilter("")}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${clinicFilter === "" ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-muted dark:text-foreground"}`}
                data-testid="chip-clinic-all"
              >
                All
              </button>
              {allClinics.map((c) => (
                <button
                  key={c}
                  onClick={() => setClinicFilter(clinicFilter === c ? "" : c)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors flex items-center gap-1 ${clinicFilter === c ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-muted dark:text-foreground"}`}
                  data-testid={`chip-clinic-${c.replace(/\s+/g, "-")}`}
                >
                  <Building2 className="w-3 h-3" />{c}
                </button>
              ))}
            </div>
          )}
          {(clinicFilter || windowFilter || debouncedSearch) && (
            <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setClinicFilter(""); setWindowFilter(""); }} className="gap-1 text-xs h-7 px-2" data-testid="button-clear-all-filters">
              <X className="w-3 h-3" />Clear filters
            </Button>
          )}
        </div>

        {/* Recent imports (collapsible) */}
        <div className="px-2 pt-2">
          <RecentImportsPanel />
        </div>

        {/* Roster list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : mergedRoster.groups.length === 0 ? (
            <div className="text-center py-16 px-4 text-muted-foreground" data-testid="empty-roster">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {debouncedSearch || clinicFilter || windowFilter
                  ? "No patients match your filters."
                  : "No patients yet. Import test history or add a schedule to get started."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {mergedRoster.groups.map((group) => {
                const clinicTotal = clinicTotalByName.get(group.clinic) ?? group.patients.length;
                const partial = group.patients.length < clinicTotal;
                return (
                  <section key={group.clinic} data-testid={`section-clinic-${group.clinic.replace(/\s+/g, "-")}`}>
                    <div className="flex items-center gap-2 px-2 mb-1.5 sticky top-0 bg-white/80 dark:bg-card/80 backdrop-blur py-1 z-10">
                      <Building2 className="w-3.5 h-3.5 text-slate-500" />
                      <h2 className="text-xs font-semibold text-slate-800 dark:text-foreground truncate">{group.clinic}</h2>
                      <Badge variant="outline" className="text-[10px]" data-testid={`badge-clinic-count-${group.clinic.replace(/\s+/g, "-")}`}>
                        {partial ? `${group.patients.length} / ${clinicTotal}` : clinicTotal}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {group.patients.map((p) => {
                        const selected = selectedKey === p.encodedKey;
                        return (
                          <button
                            key={p.encodedKey}
                            onClick={() => selectPatient(p)}
                            className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors flex items-start gap-2.5 ${selected ? "bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-indigo-300 dark:ring-indigo-700" : "hover:bg-slate-100 dark:hover:bg-muted/50"}`}
                            data-testid={`card-patient-${p.encodedKey}`}
                          >
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0" data-testid={`avatar-patient-${p.encodedKey}`}>
                              <UserIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-semibold text-xs truncate" data-testid={`text-patient-name-${p.encodedKey}`}>{p.name}</p>
                                <CooldownBadge p={p} />
                              </div>
                              {p.plexusId && (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-medium text-slate-600 dark:text-slate-300 mt-0.5" data-testid={`badge-plexus-id-${p.encodedKey}`}>
                                  {p.plexusId}
                                </span>
                              )}
                              <p className="text-[10px] text-muted-foreground truncate">
                                {p.dob ? `DOB ${p.dob} · ` : ""}{fmtDate(p.lastVisit)}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {p.testCount} test{p.testCount !== 1 ? "s" : ""} · {p.screeningCount} screening{p.screeningCount !== 1 ? "s" : ""}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {hasMore && (
                <div className="flex flex-col items-center gap-2 py-3" data-testid="region-load-more">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rosterQuery.fetchNextPage()}
                    disabled={rosterQuery.isFetchingNextPage}
                    data-testid="button-load-more-patients"
                  >
                    {rosterQuery.isFetchingNextPage ? (
                      <><Loader2 className="w-3 h-3 animate-spin mr-1" />Loading…</>
                    ) : (
                      <>Load more ({totalPatients - loadedCount} remaining)</>
                    )}
                  </Button>
                  <div ref={loadMoreSentinelRef} aria-hidden className="h-1 w-1" />
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
      )}

      {/* ── Right area: patient chart ── */}
      <section
        className={`${hasSelection ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col bg-finance-bg`}
        data-testid="patient-directory-detail"
      >
        {resolving ? (
          <PatientChartSkeleton seedName={seedName} onBack={clearSelection} />
        ) : selectedKey ? (
          <PatientProfileWorkspace
            key={selectedKey}
            encodedKey={selectedKey}
            representativeScreeningId={selectedRepId}
            seedName={seedName}
            onBack={clearSelection}
          />
        ) : hasSelection ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-6" data-testid="profile-not-found">
            <UserSearch className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-base">We couldn't find that patient.</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={clearSelection} data-testid="button-clear-selection">Back to EHR</Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-6" data-testid="profile-empty-state">
            <UserSearch className="w-14 h-14 mb-4 opacity-25" />
            <p className="text-lg font-medium text-slate-700 dark:text-foreground">Select a patient</p>
            <p className="text-sm mt-1 max-w-sm">Choose a patient from the EHR to open their full clinical chart, qualifying opportunities, calls, scheduling, and billing readiness.</p>
          </div>
        )}
      </section>

      {/* Import history dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent data-testid="dialog-import-history">
          <DialogHeader>
            <DialogTitle>Import Test History</DialogTitle>
            <DialogDescription>Upload an Excel/CSV file or paste rows. Columns: PatientName, DOB, TestName, DateOfService, InsuranceType.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium block mb-1">Upload file</label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                className="text-xs"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFileMutation.mutate(f);
                  e.target.value = "";
                }}
                data-testid="input-import-file"
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Or paste data</label>
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste rows here..."
                className="text-xs min-h-[120px]"
                data-testid="input-import-text"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>Close</Button>
            <Button
              size="sm"
              disabled={!importText.trim() || importTextMutation.isPending}
              onClick={() => importTextMutation.mutate(importText)}
              data-testid="button-import-text-submit"
            >
              {importTextMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Import pasted data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Patient dialog */}
      <Dialog open={addPatientOpen} onOpenChange={setAddPatientOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-add-patient-ehr">
          <DialogHeader>
            <DialogTitle>Add Patient to Plexus EHR</DialogTitle>
            <DialogDescription>
              Paste any clinical information — name, DOB, diagnoses, medications, insurance, notes. AI will parse it into a structured patient record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Textarea
              placeholder={"Example:\nTestguy Robot\nDOB: 1960-05-15\nM\nPhone: 555-000-1234\nInsurance: Medicare\nDx: Hypertension, Type 2 Diabetes, AFib, PAD\nMeds: Metformin 1000mg, Lisinopril 20mg, Warfarin 5mg, Cilostazol\nHx: Prior stroke 2022, CABG 2019\n\nOr just paste a free-form clinical note..."}
              value={addPatientText}
              onChange={(e) => setAddPatientText(e.target.value)}
              rows={10}
              className="text-sm font-mono"
              data-testid="textarea-add-patient"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setAddPatientOpen(false); setAddPatientText(""); }}>Cancel</Button>
            <Button
              size="sm"
              disabled={!addPatientText.trim() || addPatientBusy}
              onClick={async () => {
                setAddPatientBusy(true);
                try {
                  const resp = await apiRequest("POST", "/api/plexus-ehr/patients/parse-and-create", {
                    text: addPatientText,
                  });
                  const result = await resp.json();
                  toast({ title: `Patient created: ${result.patient?.name ?? "Unknown"}` });
                  setAddPatientOpen(false);
                  setAddPatientText("");
                  queryClient.invalidateQueries({ queryKey: ["/api/patients/database"] });
                  // Navigate to the new patient
                  if (result.patient?.id) {
                    setLocation(`/patient-directory?patientId=${result.patient.id}`);
                  }
                } catch (err: any) {
                  toast({ title: "Failed to create patient", description: err?.message ?? "Unknown error", variant: "destructive" });
                } finally {
                  setAddPatientBusy(false);
                }
              }}
              data-testid="button-add-patient-submit"
            >
              {addPatientBusy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
              Create Patient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
