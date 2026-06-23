import { useMemo } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  User, Stethoscope, Sparkles, Phone, CalendarClock, FileText, History,
  Receipt, ExternalLink, Clock, CheckCircle2, AlertTriangle, Loader2, Building2,
} from "lucide-react";
import {
  type DirectoryProfile, type DirectoryScreening, fmtDate, testBucket,
  uniqueQualifyingTests,
} from "./profileTypes";

export type LibraryDoc = {
  id: number;
  title?: string | null;
  filename?: string | null;
  kind?: string | null;
  version?: number | null;
  createdAt?: string | null;
  downloadUrl?: string | null;
};

export type BillingRow = {
  id: number;
  patientName: string;
  service: string | null;
  facility: string | null;
  dateOfService: string | null;
  mrn: string | null;
  billingStatus: string | null;
};

export type CallRow = {
  id: number | string;
  outcome?: string | null;
  notes?: string | null;
  callbackAt?: string | null;
  createdAt?: string | null;
};

const BUCKET_STYLES: Record<string, string> = {
  brainwave: "border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-800",
  vitalwave: "border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800",
  ultrasound: "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800",
};
const BUCKET_DOT: Record<string, string> = {
  brainwave: "bg-purple-500",
  vitalwave: "bg-red-500",
  ultrasound: "bg-emerald-500",
};

function EmptyState({ icon, text, testId }: { icon: React.ReactNode; text: string; testId?: string }) {
  return (
    <div className="py-12 text-center text-sm text-muted-foreground" data-testid={testId}>
      <div className="flex justify-center mb-3 opacity-30">{icon}</div>
      {text}
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm leading-snug whitespace-pre-wrap">{value && value.trim() ? value : "—"}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 dark:border-border/40 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function isUpcoming(s: DirectoryScreening): boolean {
  if (!s.scheduleDate) return false;
  return s.scheduleDate >= new Date().toISOString().slice(0, 10);
}

export function PatientProfileTabs({
  profile,
  documents,
  documentsLoading,
  billing,
  billingLoading,
  calls,
  callsLoading,
}: {
  profile: DirectoryProfile;
  documents: LibraryDoc[];
  documentsLoading: boolean;
  billing: BillingRow[];
  billingLoading: boolean;
  calls: CallRow[];
  callsLoading: boolean;
}) {
  const id = profile.identity;
  const qualifying = uniqueQualifyingTests(profile.screenings);

  const mostRecent = profile.screenings[0];
  const workflowStatus = mostRecent?.appointmentStatus || "—";

  const problemList = useMemo(() => {
    const raw = profile.clinical.diagnoses ?? "";
    return raw
      .split(/[\n;,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [profile.clinical.diagnoses]);

  const timeline = useMemo(() => {
    type Ev = { when: string; label: string; sub: string; tone: string };
    const evs: Ev[] = [];
    for (const s of profile.screenings) {
      const when = s.scheduleDate || (s.createdAt ? s.createdAt.slice(0, 10) : "");
      evs.push({
        when,
        label: `Screening · ${s.batchName}`,
        sub: `${s.facility || "—"} · ${s.qualifyingTests.length} qualifying · ${s.appointmentStatus}`,
        tone: "bg-indigo-500",
      });
    }
    for (const n of profile.generatedNotes) {
      evs.push({
        when: n.generatedAt ? n.generatedAt.slice(0, 10) : "",
        label: `Note generated · ${n.title}`,
        sub: `${n.service}`,
        tone: "bg-blue-500",
      });
    }
    for (const t of profile.testHistory) {
      evs.push({
        when: t.dateOfService,
        label: `Test on file · ${t.testName}`,
        sub: `${t.clinic || "—"} · ${t.insuranceType.toUpperCase()}`,
        tone: "bg-emerald-500",
      });
    }
    for (const c of calls) {
      evs.push({
        when: (c.createdAt || c.callbackAt || "").slice(0, 10),
        label: `Call · ${c.outcome || "logged"}`,
        sub: c.notes || "",
        tone: "bg-amber-500",
      });
    }
    return evs
      .filter((e) => e.when)
      .sort((a, b) => b.when.localeCompare(a.when));
  }, [profile, calls]);

  const tabCls = "data-[state=active]:bg-white dark:data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5 text-xs";

  return (
    <Tabs defaultValue="overview" className="flex flex-col h-full">
      <div className="px-5 pt-3 border-b">
        <TabsList className="bg-slate-100/70 dark:bg-muted/40 flex-wrap h-auto justify-start" data-testid="profile-tabs">
          <TabsTrigger value="overview" className={tabCls} data-testid="tab-overview"><User className="w-3.5 h-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="clinical" className={tabCls} data-testid="tab-clinical"><Stethoscope className="w-3.5 h-3.5" />Clinical</TabsTrigger>
          <TabsTrigger value="plexus" className={tabCls} data-testid="tab-plexus"><Sparkles className="w-3.5 h-3.5" />Plexus IQ</TabsTrigger>
          <TabsTrigger value="calls" className={tabCls} data-testid="tab-calls"><Phone className="w-3.5 h-3.5" />Calls</TabsTrigger>
          <TabsTrigger value="scheduling" className={tabCls} data-testid="tab-scheduling"><CalendarClock className="w-3.5 h-3.5" />Scheduling</TabsTrigger>
          <TabsTrigger value="documents" className={tabCls} data-testid="tab-documents"><FileText className="w-3.5 h-3.5" />Documents</TabsTrigger>
          <TabsTrigger value="timeline" className={tabCls} data-testid="tab-timeline"><History className="w-3.5 h-3.5" />Timeline</TabsTrigger>
          <TabsTrigger value="billing" className={tabCls} data-testid="tab-billing"><Receipt className="w-3.5 h-3.5" />Billing Readiness</TabsTrigger>
        </TabsList>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* OVERVIEW */}
        <TabsContent value="overview" className="mt-0 space-y-4" data-testid="panel-overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 font-semibold text-sm mb-2"><User className="w-4 h-4" />Demographics</div>
              <KV label="Name" value={id.name} />
              <KV label="DOB" value={id.dob || "—"} />
              <KV label="Age / Gender" value={[id.age ? `${id.age}yo` : null, id.gender].filter(Boolean).join(" · ") || "—"} />
              <KV label="Phone" value={id.phoneNumber || "—"} />
              <KV label="Insurance" value={id.insurance || "—"} />
              <KV label="Clinic" value={id.clinic} />
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 font-semibold text-sm mb-2"><Sparkles className="w-4 h-4" />Care Snapshot</div>
              <KV label="Workflow status" value={<Badge variant="outline" className="text-[10px]">{workflowStatus}</Badge>} />
              <KV label="Qualifying tests" value={qualifying.length} />
              <KV label="Screenings" value={profile.screenings.length} />
              <KV label="Tests on file" value={profile.testHistory.length} />
              <KV label="Generated notes" value={profile.generatedNotes.length} />
              <KV label="Active cooldowns" value={profile.cooldowns.filter((c) => !c.cleared).length} />
            </Card>
          </div>
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><Clock className="w-4 h-4" />Cooldown Status ({profile.cooldowns.length})</div>
            {profile.cooldowns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No prior tests on file.</p>
            ) : (
              <div className="space-y-1.5">
                {profile.cooldowns.map((cd) => (
                  <div key={`${cd.testName}-${cd.historyId}`} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-cooldown-${cd.historyId}`}>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{cd.testName}</div>
                      <div className="text-[11px] text-muted-foreground">Last {cd.lastDate} · {cd.insuranceType.toUpperCase()} · {cd.cooldownMonths}mo</div>
                    </div>
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
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* CLINICAL */}
        <TabsContent value="clinical" className="mt-0 space-y-4" data-testid="panel-clinical">
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 font-semibold text-sm"><Stethoscope className="w-4 h-4" />Clinical Context</div>
            <Block label="Diagnoses (Dx)" value={profile.clinical.diagnoses} />
            <Block label="History (Hx)" value={profile.clinical.history} />
            <Block label="Medications (Rx)" value={profile.clinical.medications} />
            <Block label="Notes" value={profile.clinical.notes} />
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><AlertTriangle className="w-4 h-4" />Problem List</div>
            {problemList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No diagnoses recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {problemList.map((p, i) => (
                  <Badge key={i} variant="secondary" className="text-[11px]" data-testid={`chip-problem-${i}`}>{p}</Badge>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><History className="w-4 h-4" />Tests on File ({profile.testHistory.length})</div>
            {profile.testHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No imported test records.</p>
            ) : (
              <div className="space-y-1">
                {profile.testHistory.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 dark:border-border/40 last:border-0 text-sm">
                    <span className="font-medium">{h.testName}<span className="text-[11px] text-muted-foreground ml-2">{h.dateOfService}</span></span>
                    <span className="text-[11px] text-muted-foreground">{h.clinic} · {h.insuranceType.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* PLEXUS IQ */}
        <TabsContent value="plexus" className="mt-0 space-y-4" data-testid="panel-plexus">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 font-semibold text-sm"><Sparkles className="w-4 h-4" />Qualifying Ancillary Opportunities</div>
              <Link href="/plexus-iq"><Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs"><ExternalLink className="w-3 h-3" />Open Plexus IQ</Button></Link>
            </div>
            {qualifying.length === 0 ? (
              <EmptyState icon={<Sparkles className="w-8 h-8" />} text="No qualifying tests on record yet." testId="empty-plexus" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {qualifying.map((t) => {
                  const b = testBucket(t);
                  return (
                    <div key={t} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${BUCKET_STYLES[b]}`} data-testid={`row-qualifying-${t}`}>
                      <span className={`w-2 h-2 rounded-full ${BUCKET_DOT[b]}`} />
                      <span className="text-sm font-medium">{t}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><FileText className="w-4 h-4" />Qualification by Screening</div>
            {profile.screenings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No screenings.</p>
            ) : (
              <div className="space-y-2">
                {profile.screenings.map((s) => (
                  <div key={s.id} className="rounded-md bg-slate-50 dark:bg-muted/40 px-3 py-2" data-testid={`row-screening-qual-${s.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{s.batchName}</span>
                      <span className="text-[11px] text-muted-foreground">{s.scheduleDate || fmtDate(s.createdAt)}</span>
                    </div>
                    {s.qualifyingTests.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.qualifyingTests.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-1">No qualifying tests.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-3">Detailed AI reasoning, talking points, and admin review live in Plexus IQ.</p>
          </Card>
        </TabsContent>

        {/* CALLS */}
        <TabsContent value="calls" className="mt-0" data-testid="panel-calls">
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><Phone className="w-4 h-4" />Call History</div>
            {callsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : calls.length === 0 ? (
              <EmptyState icon={<Phone className="w-8 h-8" />} text="No call history available for this patient." testId="empty-calls" />
            ) : (
              <div className="space-y-1.5">
                {calls.map((c) => (
                  <div key={c.id} className="px-3 py-2 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-call-${c.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[10px]">{c.outcome || "logged"}</Badge>
                      <span className="text-[11px] text-muted-foreground">{fmtDate((c.createdAt || c.callbackAt || "").slice(0, 10) || null)}</span>
                    </div>
                    {c.notes && <p className="text-xs text-muted-foreground mt-1">{c.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* SCHEDULING */}
        <TabsContent value="scheduling" className="mt-0 space-y-4" data-testid="panel-scheduling">
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><CalendarClock className="w-4 h-4" />Appointments & Screenings ({profile.screenings.length})</div>
            {profile.screenings.length === 0 ? (
              <EmptyState icon={<CalendarClock className="w-8 h-8" />} text="No screenings scheduled." testId="empty-scheduling" />
            ) : (
              <div className="space-y-1.5">
                {profile.screenings.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-schedule-${s.id}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{s.batchName}</span>
                        {isUpcoming(s) && <Badge className="text-[10px] bg-blue-100 text-blue-800 hover:bg-blue-100">Upcoming</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Building2 className="w-3 h-3" />{s.facility || "—"} · {s.scheduleDate || fmtDate(s.createdAt)}{s.time ? ` · ${s.time}` : ""} · {s.appointmentStatus}
                      </div>
                    </div>
                    <Link href={`/schedule/${s.batchId}`}>
                      <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" data-testid={`button-open-batch-${s.batchId}`}><ExternalLink className="w-3 h-3" />Open</Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* DOCUMENTS */}
        <TabsContent value="documents" className="mt-0 space-y-4" data-testid="panel-documents">
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><FileText className="w-4 h-4" />Patient Documents</div>
            {documentsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : documents.length === 0 ? (
              <EmptyState icon={<FileText className="w-8 h-8" />} text="No documents on file for this patient." testId="empty-documents" />
            ) : (
              <div className="space-y-1.5">
                {documents.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-document-${d.id}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{d.title || d.filename || `Document #${d.id}`}</div>
                      <div className="text-[11px] text-muted-foreground">{[d.kind, d.version ? `v${d.version}` : null, d.createdAt ? fmtDate(d.createdAt.slice(0, 10)) : null].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    {d.downloadUrl && (
                      <a href={d.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-600 hover:underline inline-flex items-center gap-0.5"><ExternalLink className="w-3 h-3" />Open</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><FileText className="w-4 h-4" />Generated Notes ({profile.generatedNotes.length})</div>
            {profile.generatedNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes generated.</p>
            ) : (
              <div className="space-y-1.5">
                {profile.generatedNotes.map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-note-${n.id}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      <div className="text-[11px] text-muted-foreground">{n.service} · {fmtDate(n.generatedAt.slice(0, 10))}</div>
                    </div>
                    {n.driveWebViewLink && (
                      <a href={n.driveWebViewLink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-600 hover:underline inline-flex items-center gap-0.5"><ExternalLink className="w-3 h-3" />Drive</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TIMELINE */}
        <TabsContent value="timeline" className="mt-0" data-testid="panel-timeline">
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-3"><History className="w-4 h-4" />Activity Timeline</div>
            {timeline.length === 0 ? (
              <EmptyState icon={<History className="w-8 h-8" />} text="No activity recorded yet." testId="empty-timeline" />
            ) : (
              <div className="space-y-0">
                {timeline.map((e, i) => (
                  <div key={i} className="flex gap-3 pb-4 last:pb-0" data-testid={`row-timeline-${i}`}>
                    <div className="flex flex-col items-center">
                      <span className={`w-2.5 h-2.5 rounded-full ${e.tone} mt-1`} />
                      {i < timeline.length - 1 && <span className="w-px flex-1 bg-slate-200 dark:bg-border mt-1" />}
                    </div>
                    <div className="min-w-0 flex-1 -mt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{e.label}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">{fmtDate(e.when)}</span>
                      </div>
                      {e.sub && <p className="text-[11px] text-muted-foreground truncate">{e.sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* BILLING READINESS */}
        <TabsContent value="billing" className="mt-0" data-testid="panel-billing">
          <Card className="p-4">
            <div className="flex items-center gap-2 font-semibold text-sm mb-2"><Receipt className="w-4 h-4" />Billing Readiness</div>
            {billingLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : billing.length === 0 ? (
              <EmptyState icon={<Receipt className="w-8 h-8" />} text="No billing records found for this patient." testId="empty-billing" />
            ) : (
              <div className="space-y-1.5">
                {billing.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 dark:bg-muted/40" data-testid={`row-billing-${r.id}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.service || "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{[r.facility, r.dateOfService ? fmtDate(r.dateOfService) : null, r.mrn ? `MRN ${r.mrn}` : null].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{r.billingStatus || "Not Billed"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>
      </div>
    </Tabs>
  );
}
