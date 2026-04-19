import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Loader2, Search, Database, Users, Building2, Clock, CheckCircle2, AlertTriangle,
  Calendar, FileText, Stethoscope, Upload, Phone, Shield, ExternalLink, X,
} from "lucide-react";

type RosterPatient = {
  key: string;
  encodedKey: string;
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
};

type ClinicGroup = { clinic: string; patients: RosterPatient[] };
type RosterResponse = { groups: ClinicGroup[]; totals: { patients: number; clinics: number } };
type CooldownSummary = {
  oneDay: number; oneWeek: number; oneMonth: number;
  totals: { patients: number; clinics: number };
  byClinic: Array<{ clinic: string; oneDay: number; oneWeek: number; oneMonth: number }>;
};

type TestCooldown = {
  testName: string;
  lastDate: string;
  insuranceType: string;
  cooldownMonths: number;
  clearsAt: string;
  daysUntilClear: number;
  cleared: boolean;
  clinic: string | null;
  historyId: number;
};
type ProfileResponse = {
  key: string;
  encodedKey: string;
  identity: { name: string; dob: string | null; age: number | null; gender: string | null; phoneNumber: string | null; insurance: string | null; clinic: string };
  clinical: { diagnoses: string | null; history: string | null; medications: string | null; notes: string | null };
  testHistory: Array<{ id: number; testName: string; dateOfService: string; insuranceType: string; clinic: string }>;
  cooldowns: TestCooldown[];
  screenings: Array<{ id: number; batchId: number; batchName: string; facility: string | null; scheduleDate: string | null; createdAt: string; time: string | null; qualifyingTests: string[]; appointmentStatus: string; patientType: string }>;
  generatedNotes: Array<{ id: number; batchId: number; patientId: number; service: string; docKind: string; title: string; generatedAt: string; driveWebViewLink: string | null; facility: string | null; scheduleDate: string | null }>;
};

function initials(name: string): string {
  return name
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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
  const [search, setSearch] = useState("");
  const [clinicFilter, setClinicFilter] = useState<string>("");
  const [windowFilter, setWindowFilter] = useState<"" | "1d" | "1w" | "1m">("");
  const [openProfileKey, setOpenProfileKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const rosterQuery = useQuery<RosterResponse>({
    queryKey: ["/api/patients/database", { search, clinic: clinicFilter, cooldownWindow: windowFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (clinicFilter) params.set("clinic", clinicFilter);
      if (windowFilter) params.set("cooldownWindow", windowFilter);
      const res = await fetch(`/api/patients/database${params.toString() ? `?${params}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load patient database");
      return res.json();
    },
  });

  const summaryQuery = useQuery<CooldownSummary>({
    queryKey: ["/api/patients/database/cooldown-summary"],
  });

  const profileQuery = useQuery<ProfileResponse>({
    queryKey: ["/api/patients/database", openProfileKey],
    queryFn: async () => {
      const res = await fetch(`/api/patients/database/${openProfileKey}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load patient profile");
      return res.json();
    },
    enabled: !!openProfileKey,
  });

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

  const allClinics = useMemo(
    () => (rosterQuery.data?.groups ?? []).map((g) => g.clinic),
    [rosterQuery.data],
  );

  const totalPatients = rosterQuery.data?.totals.patients ?? 0;
  const isLoading = rosterQuery.isLoading;

  return (
    <div className="flex flex-col h-full relative z-10">
      <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50 border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-slate-600" />
            <div>
              <h1 className="text-base font-bold tracking-tight">Patient Database</h1>
              <p className="text-xs text-muted-foreground" data-testid="text-roster-summary">
                {totalPatients} patient{totalPatients !== 1 ? "s" : ""} · {(rosterQuery.data?.groups ?? []).length} clinic{(rosterQuery.data?.groups ?? []).length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5" data-testid="button-import-test-history">
              <Upload className="w-3.5 h-3.5" />Import test history
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <div className="max-w-6xl mx-auto space-y-4">
          {/* Cooldown dashboard */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              { key: "1d" as const, label: "Cooldowns clearing in 1 day", count: summaryQuery.data?.oneDay ?? 0, tone: "from-red-500/10 to-red-500/5 border-red-200 text-red-900" },
              { key: "1w" as const, label: "Clearing in 1 week", count: summaryQuery.data?.oneWeek ?? 0, tone: "from-amber-500/10 to-amber-500/5 border-amber-200 text-amber-900" },
              { key: "1m" as const, label: "Clearing in 1 month", count: summaryQuery.data?.oneMonth ?? 0, tone: "from-blue-500/10 to-blue-500/5 border-blue-200 text-blue-900" },
            ]).map((tile) => {
              const active = windowFilter === tile.key;
              return (
                <button
                  key={tile.key}
                  onClick={() => setWindowFilter(active ? "" : tile.key)}
                  className={`text-left rounded-xl border bg-gradient-to-br p-4 transition-all hover:shadow-sm ${tile.tone} ${active ? "ring-2 ring-offset-1 ring-slate-400 dark:ring-slate-500" : ""}`}
                  data-testid={`tile-cooldown-${tile.key}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <Clock className="w-4 h-4 opacity-70" />
                    {active && <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">Filter active</span>}
                  </div>
                  <div className="text-3xl font-bold tabular-nums leading-tight" data-testid={`text-cooldown-count-${tile.key}`}>{tile.count}</div>
                  <div className="text-xs mt-1 opacity-80">{tile.label}</div>
                </button>
              );
            })}
          </div>

          {/* Search + clinic chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Search by name or DOB..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm h-9 max-w-md"
                data-testid="input-search-patients"
              />
            </div>
            {windowFilter && (
              <Button size="sm" variant="ghost" onClick={() => setWindowFilter("")} className="gap-1 text-xs" data-testid="button-clear-window">
                <X className="w-3 h-3" />Clear cooldown filter
              </Button>
            )}
          </div>

          {allClinics.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap" data-testid="row-clinic-chips">
              <button
                onClick={() => setClinicFilter("")}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${clinicFilter === "" ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-muted dark:text-foreground"}`}
                data-testid="chip-clinic-all"
              >
                All clinics
              </button>
              {allClinics.map((c) => (
                <button
                  key={c}
                  onClick={() => setClinicFilter(clinicFilter === c ? "" : c)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${clinicFilter === c ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-muted dark:text-foreground"}`}
                  data-testid={`chip-clinic-${c.replace(/\s+/g, "-")}`}
                >
                  <Building2 className="w-3 h-3" />{c}
                </button>
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (rosterQuery.data?.groups ?? []).length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-base">No patients match your filters.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {(rosterQuery.data?.groups ?? []).map((group) => (
                <section key={group.clinic} data-testid={`section-clinic-${group.clinic.replace(/\s+/g, "-")}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="w-4 h-4 text-slate-500" />
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-foreground">{group.clinic}</h2>
                    <Badge variant="outline" className="text-[10px]">{group.patients.length}</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {group.patients.map((p) => (
                      <button
                        key={p.encodedKey}
                        onClick={() => setOpenProfileKey(p.encodedKey)}
                        className="text-left"
                        data-testid={`card-patient-${p.encodedKey}`}
                      >
                        <Card className="p-3 hover:shadow-md hover:border-slate-300 transition-all h-full">
                          <div className="flex items-start gap-2 mb-2">
                            <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold shrink-0">
                              {initials(p.name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-xs truncate" data-testid={`text-patient-name-${p.encodedKey}`}>{p.name}</p>
                              {p.dob && <p className="text-[10px] text-muted-foreground truncate">DOB {p.dob}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            <CooldownBadge p={p} />
                          </div>
                          <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
                            <div>Last visit: {fmtDate(p.lastVisit)}</div>
                            <div>{p.testCount} test{p.testCount !== 1 ? "s" : ""} · {p.screeningCount} screening{p.screeningCount !== 1 ? "s" : ""}</div>
                          </div>
                        </Card>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Profile drawer */}
      <Sheet open={!!openProfileKey} onOpenChange={(o) => !o && setOpenProfileKey(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="drawer-patient-profile">
          {profileQuery.isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : profileQuery.data ? (
            <ProfileBody profile={profileQuery.data} />
          ) : (
            <div className="py-20 text-center text-sm text-muted-foreground">Failed to load profile.</div>
          )}
        </SheetContent>
      </Sheet>

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
    </div>
  );
}

function ProfileBody({ profile }: { profile: ProfileResponse }) {
  const id = profile.identity;
  return (
    <>
      <SheetHeader className="mb-4">
        <SheetTitle className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold shrink-0">{initials(id.name)}</div>
          <span data-testid="text-profile-name">{id.name}</span>
        </SheetTitle>
        <SheetDescription className="text-xs">
          {id.clinic} · {id.dob ? `DOB ${id.dob}` : "DOB unknown"}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 pb-8">
        {/* Identity */}
        <Card className="p-3 text-xs space-y-1.5" data-testid="card-identity">
          <div className="flex items-center gap-2 font-semibold text-sm mb-1.5"><Shield className="w-3.5 h-3.5" />Identity</div>
          <Row label="Age / Gender" value={[id.age ? `${id.age}yo` : null, id.gender].filter(Boolean).join(" · ") || "—"} />
          <Row label="Phone" value={id.phoneNumber || "—"} icon={<Phone className="w-3 h-3" />} />
          <Row label="Insurance" value={id.insurance || "—"} />
          <Row label="Clinic" value={id.clinic} icon={<Building2 className="w-3 h-3" />} />
        </Card>

        {/* Clinical */}
        {(profile.clinical.diagnoses || profile.clinical.history || profile.clinical.medications) && (
          <Card className="p-3 text-xs space-y-2" data-testid="card-clinical">
            <div className="flex items-center gap-2 font-semibold text-sm mb-1.5"><Stethoscope className="w-3.5 h-3.5" />Clinical Context</div>
            {profile.clinical.diagnoses && <Row label="Diagnoses" value={profile.clinical.diagnoses} block />}
            {profile.clinical.history && <Row label="History" value={profile.clinical.history} block />}
            {profile.clinical.medications && <Row label="Medications" value={profile.clinical.medications} block />}
          </Card>
        )}

        {/* Cooldowns */}
        <Card className="p-3 text-xs" data-testid="card-cooldowns">
          <div className="flex items-center gap-2 font-semibold text-sm mb-2"><Clock className="w-3.5 h-3.5" />Cooldown Status ({profile.cooldowns.length})</div>
          {profile.cooldowns.length === 0 ? (
            <p className="text-muted-foreground">No prior tests on file.</p>
          ) : (
            <div className="space-y-1.5">
              {profile.cooldowns.map((cd) => (
                <div key={`${cd.testName}-${cd.historyId}`} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-cooldown-${cd.historyId}`}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{cd.testName}</div>
                    <div className="text-[10px] text-muted-foreground">Last {cd.lastDate} · {cd.insuranceType.toUpperCase()} · {cd.cooldownMonths}mo</div>
                  </div>
                  <div className="text-right shrink-0">
                    {cd.cleared ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3 h-3" />Eligible
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${cd.daysUntilClear <= 1 ? "bg-red-100 text-red-800" : cd.daysUntilClear <= 7 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
                        Clears {fmtDate(cd.clearsAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Test history */}
        <Card className="p-3 text-xs" data-testid="card-test-history">
          <div className="flex items-center gap-2 font-semibold text-sm mb-2"><Calendar className="w-3.5 h-3.5" />Tests on File ({profile.testHistory.length})</div>
          {profile.testHistory.length === 0 ? (
            <p className="text-muted-foreground">No imported test records.</p>
          ) : (
            <div className="space-y-1">
              {profile.testHistory.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 last:border-0">
                  <div className="min-w-0">
                    <span className="font-medium">{h.testName}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{h.dateOfService}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{h.clinic} · {h.insuranceType.toUpperCase()}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Prior screenings */}
        <Card className="p-3 text-xs" data-testid="card-prior-screenings">
          <div className="flex items-center gap-2 font-semibold text-sm mb-2"><AlertTriangle className="w-3.5 h-3.5" />Prior Screenings ({profile.screenings.length})</div>
          {profile.screenings.length === 0 ? (
            <p className="text-muted-foreground">No screenings.</p>
          ) : (
            <div className="space-y-1.5">
              {profile.screenings.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-screening-${s.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.batchName}</div>
                    <div className="text-[10px] text-muted-foreground">{s.scheduleDate || fmtDate(s.createdAt)} · {s.facility || "—"} · {s.qualifyingTests.length} qualifying</div>
                  </div>
                  <Link href={`/schedule/${s.batchId}`}>
                    <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" data-testid={`button-open-batch-${s.batchId}`}>
                      <ExternalLink className="w-3 h-3" />Open
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Generated notes */}
        <Card className="p-3 text-xs" data-testid="card-generated-notes">
          <div className="flex items-center gap-2 font-semibold text-sm mb-2"><FileText className="w-3.5 h-3.5" />Generated Notes ({profile.generatedNotes.length})</div>
          {profile.generatedNotes.length === 0 ? (
            <p className="text-muted-foreground">No notes generated.</p>
          ) : (
            <div className="space-y-1.5">
              {profile.generatedNotes.map((n) => (
                <div key={n.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-note-${n.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{n.title}</div>
                    <div className="text-[10px] text-muted-foreground">{n.service} · {fmtDate(n.generatedAt)}</div>
                  </div>
                  {n.driveWebViewLink && (
                    <a href={n.driveWebViewLink} target="_blank" rel="noopener noreferrer" className="text-[10px] text-emerald-600 hover:underline inline-flex items-center gap-0.5">
                      <ExternalLink className="w-3 h-3" />Drive
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, icon, block }: { label: string; value: string; icon?: React.ReactNode; block?: boolean }) {
  if (block) {
    return (
      <div>
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-xs leading-snug">{value}</div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className="text-xs font-medium text-right truncate max-w-[60%]">{value}</div>
    </div>
  );
}
