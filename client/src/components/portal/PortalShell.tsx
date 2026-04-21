import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Stethoscope, HeartHandshake, Calendar as CalendarIcon, Phone, FileSignature,
  Upload, FileText, ChevronLeft, ChevronRight, Check, AlertCircle, ClipboardList,
  Sparkles, Send, Minimize2, FileBarChart, FilePlus, User, Bell,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SignaturePad } from "./SignaturePad";

type Role = "technician" | "liaison";
type CenterMode = "patient" | "scheduleDay" | "plexusPdf" | "clinicianPdf" | "consent" | "patientChart";

type PortalTask = {
  id: number;
  title: string;
  description: string | null;
  taskType: string;
  urgency: string;
  patientScreeningId: number | null;
  dueDate: string | null;
  status: string;
};

type ConsentByTest = { testType: string; signed: boolean; documentId: number | null };

type TodayPatient = {
  patientScreeningId: number | null;
  name: string;
  dob: string | null;
  time: string | null;
  facility: string;
  clinicianName: string | null;
  qualifyingTests: string[];
  appointmentStatus: string;
  consentByTest: ConsentByTest[];
  consentSigned: boolean;
  appointments: Array<{ id: number; testType: string; scheduledTime: string; status: string }>;
  batchId: number | null;
  plexusPdfUrl: string | null;
  clinicianPdfUrl: string | null;
  scheduleUrl: string | null;
};

type LibraryDoc = {
  id: number;
  title: string;
  description: string | null;
  filename: string;
  contentType: string;
};

type PatientDoc = {
  id: number;
  title: string;
  kind: string;
  filename: string;
  contentType: string;
  createdAt: string;
  sourceNotes: string | null;
  downloadUrl: string;
};

type OutreachItem = {
  patientScreeningId: number;
  name: string;
  phoneNumber: string | null;
  insurance: string | null;
  qualifyingTests: string[];
  facility: string;
  appointmentStatus: string;
};

const POLL_MS = 30_000;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(t: string | null) {
  if (!t) return "—";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const mm = m[2];
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm} ${period}`;
}

function MonthlyMiniCalendar({ facility, selectedDate, onSelect }: { facility: string; selectedDate: string; onSelect: (d: string) => void }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(selectedDate);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const monthIso = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const { data } = useQuery<{ days: { date: string; appointmentCount: number }[] }>({
    queryKey: ["/api/portal/month-summary", facility, monthIso],
    queryFn: async () => {
      const u = new URL("/api/portal/month-summary", window.location.origin);
      u.searchParams.set("facility", facility);
      u.searchParams.set("month", monthIso);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!facility,
  });
  const counts = new Map<string, number>();
  for (const d of data?.days ?? []) counts.set(d.date, d.appointmentCount);
  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = first.getDay();
  const lastDate = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: Array<{ date: string | null; count: number }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ date: null, count: 0 });
  for (let day = 1; day <= lastDate; day++) {
    const ds = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date: ds, count: counts.get(ds) ?? 0 });
  }
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString("default", { month: "long", year: "numeric" });
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))} className="p-1 hover:bg-slate-100 rounded" data-testid="button-cal-prev">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold" data-testid="text-cal-month">{monthLabel}</span>
        <button onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))} className="p-1 hover:bg-slate-100 rounded" data-testid="button-cal-next">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-slate-400 mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => (
          <button
            key={i}
            disabled={!c.date}
            onClick={() => c.date && onSelect(c.date)}
            className={`aspect-square flex flex-col items-center justify-center rounded text-xs ${
              !c.date ? "" : c.date === selectedDate ? "bg-indigo-600 text-white" : c.count > 0 ? "bg-indigo-50 text-indigo-900 hover:bg-indigo-100" : "hover:bg-slate-100"
            }`}
            data-testid={c.date ? `cal-day-${c.date}` : undefined}
          >
            {c.date && <span>{parseInt(c.date.slice(-2), 10)}</span>}
            {c.date && c.count > 0 && <span className="text-[8px] opacity-80">{c.count}</span>}
          </button>
        ))}
      </div>
    </Card>
  );
}

function ConsentDialog({
  patient,
  testType,
  open,
  onOpenChange,
  role,
}: {
  patient: TodayPatient;
  testType: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role: Role;
}) {
  const { toast } = useToast();
  const [signature, setSignature] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>("");

  const { data: templates } = useQuery<LibraryDoc[]>({
    queryKey: ["/api/portal/consent-templates", testType ?? ""],
    queryFn: async () => {
      const u = new URL("/api/portal/consent-templates", window.location.origin);
      if (testType) u.searchParams.set("testType", testType);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    enabled: open,
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!signature || !templateId) throw new Error("Missing signature or template");
      const res = await apiRequest("POST", "/api/portal/sign-consent", {
        patientScreeningId: patient.patientScreeningId,
        templateDocumentId: parseInt(templateId, 10),
        signatureDataUrl: signature,
        signedBy: "patient",
        testType: testType ?? "",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Consent signed", description: `${patient.name} consent saved to chart.` });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/today-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-documents", patient.patientScreeningId] });
      onOpenChange(false);
      setSignature(null);
      setTemplateId("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to sign consent", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-consent">
        <DialogHeader>
          <DialogTitle>Consent — {patient.name}{testType ? ` · ${testType}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Consent template{testType ? ` (filtered by ${testType})` : ""}</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger data-testid="select-consent-template">
                <SelectValue placeholder={(templates ?? []).length === 0 ? "No matching templates available" : "Choose a consent template"} />
              </SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} data-testid={`option-template-${t.id}`}>{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Patient signature</Label>
            <SignaturePad onCapture={setSignature} />
            {signature && <div className="text-xs text-emerald-700 mt-1">✓ Signature captured</div>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-consent-cancel">Cancel</Button>
          <Button
            onClick={() => signMutation.mutate()}
            disabled={!signature || !templateId || signMutation.isPending || patient.patientScreeningId == null}
            data-testid="button-consent-submit"
          >
            {signMutation.isPending ? "Saving…" : "Sign & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PatientUploadCard({ patient }: { patient: TodayPatient }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("other");
  const [busy, setBusy] = useState(false);

  async function onUpload() {
    if (!file || patient.patientScreeningId == null) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientScreeningId", String(patient.patientScreeningId));
      fd.append("title", title || file.name);
      fd.append("kind", kind);
      const res = await fetch("/api/portal/uploads", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      toast({ title: "Uploaded", description: file.name });
      setFile(null);
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-documents", patient.patientScreeningId] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-upload-file" />
      <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-upload-title" />
      <Select value={kind} onValueChange={setKind}>
        <SelectTrigger data-testid="select-upload-kind"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="informed_consent">Informed consent</SelectItem>
          <SelectItem value="screening_form">Screening form</SelectItem>
          <SelectItem value="report">Report</SelectItem>
          <SelectItem value="reference">Reference</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>
      <Button onClick={onUpload} disabled={!file || busy || patient.patientScreeningId == null} className="w-full" data-testid="button-upload-submit">
        <Upload className="mr-1 h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload to chart"}
      </Button>
    </div>
  );
}

// Compact patient-scoped upload card rendered in the LEFT RAIL when a patient
// is selected. Mirrors PatientUploadCard but with header + density tuned for
// the rail. Per spec, the upload affordance lives in the left tools rail —
// not in the center patient tabs — so it is reachable without opening the
// patient chart.
function LeftRailUpload({ patientScreeningId, patientName }: { patientScreeningId: number; patientName: string }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("other");
  const [busy, setBusy] = useState(false);
  async function onUpload() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientScreeningId", String(patientScreeningId));
      fd.append("title", file.name);
      fd.append("kind", kind);
      const res = await fetch("/api/portal/uploads", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      toast({ title: "Uploaded to chart", description: file.name });
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-documents", patientScreeningId] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-3" data-testid="left-rail-upload">
      <div className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Upload className="h-4 w-4" /> Upload to chart
      </div>
      <div className="text-[11px] text-slate-500 mb-2 truncate">For: {patientName}</div>
      <div className="space-y-2">
        <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="leftrail-input-file" />
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-8 text-xs" data-testid="leftrail-select-kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="informed_consent">Informed consent</SelectItem>
            <SelectItem value="screening_form">Screening form</SelectItem>
            <SelectItem value="report">Report</SelectItem>
            <SelectItem value="reference">Reference</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={onUpload} disabled={!file || busy} className="w-full" data-testid="leftrail-button-upload">
          <Upload className="mr-1 h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </Card>
  );
}

function PatientDetail({ patient, role, onConsent }: { patient: TodayPatient; role: Role; onConsent: (testType: string | null) => void }) {
  const { data: docs } = useQuery<PatientDoc[]>({
    queryKey: ["/api/portal/patient-documents", patient.patientScreeningId],
    queryFn: async () => {
      const res = await fetch(`/api/portal/patient-documents/${patient.patientScreeningId}`, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: patient.patientScreeningId != null,
  });

  return (
    <div className="space-y-3" data-testid={`patient-detail-${patient.patientScreeningId}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold" data-testid="text-patient-name">{patient.name}</div>
          <div className="text-sm text-slate-500">
            DOB {patient.dob ?? "—"} · {patient.facility} · Time {formatTime(patient.time)}
          </div>
        </div>
        <div className="flex gap-2">
          {patient.consentSigned ? (
            <Badge className="bg-emerald-100 text-emerald-700" data-testid="badge-consent-signed">
              <Check className="h-3 w-3 mr-1" /> All consent signed
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-800" data-testid="badge-consent-needed">
              <AlertCircle className="h-3 w-3 mr-1" /> Consent needed
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="consent" className="w-full">
        <TabsList>
          <TabsTrigger value="consent" data-testid="tab-consent">Consent</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>
          <TabsTrigger value="tests" data-testid="tab-tests">Tests</TabsTrigger>
          <TabsTrigger value="upload" data-testid="tab-upload">Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="consent" className="space-y-3">
          {patient.consentByTest.length === 0 && (
            <Card className="p-4 text-sm text-slate-500">No tests scheduled for today.</Card>
          )}
          {patient.consentByTest.map((c) => (
            <Card key={c.testType} className="p-4 flex items-center justify-between" data-testid={`consent-row-${c.testType}`}>
              <div>
                <div className="font-medium">{c.testType}</div>
                <div className="text-sm text-slate-500">
                  {c.signed ? "Consent on file for today." : "No signed consent for this test today."}
                </div>
              </div>
              {c.signed ? (
                <Badge className="bg-emerald-100 text-emerald-700" data-testid={`pill-consent-${c.testType}`}>
                  <Check className="h-3 w-3 mr-1" /> Consent ✓
                </Badge>
              ) : (
                <Button onClick={() => onConsent(c.testType)} disabled={patient.patientScreeningId == null} data-testid={`button-sign-${c.testType}`}>
                  <FileSignature className="h-4 w-4 mr-2" />
                  Sign now
                </Button>
              )}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="documents" className="space-y-2">
          {(docs ?? []).length === 0 && <div className="text-sm text-slate-500">No documents on file.</div>}
          {(docs ?? []).map((d) => (
            <Card key={d.id} className="p-3 flex items-center justify-between" data-testid={`patient-doc-${d.id}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{d.title}</div>
                <div className="text-xs text-slate-500">{d.kind} · {new Date(d.createdAt).toLocaleString()}</div>
              </div>
              <Button asChild variant="outline" size="sm">
                <a href={d.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-doc-${d.id}`}>
                  <FileText className="h-3.5 w-3.5 mr-1" /> Open
                </a>
              </Button>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="tests">
          <Card className="p-4">
            <div className="font-medium mb-2">Qualifying tests</div>
            <div className="flex flex-wrap gap-2">
              {patient.qualifyingTests.length === 0 && <span className="text-sm text-slate-500">None</span>}
              {patient.qualifyingTests.map((t) => (
                <Badge key={t} variant="outline" data-testid={`badge-test-${t}`}>{t}</Badge>
              ))}
            </div>
            {patient.appointments.length > 0 && (
              <>
                <div className="font-medium mt-4 mb-2">Today's appointments</div>
                <div className="space-y-1">
                  {patient.appointments.map((a) => (
                    <div key={a.id} className="text-sm">
                      <span className="font-medium">{formatTime(a.scheduledTime)}</span> — {a.testType}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="upload">
          <Card className="p-4">
            <div className="text-sm text-slate-500 mb-3">Upload a document to this patient's chart.</div>
            <PatientUploadCard patient={patient} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExpandedSectionView({ mode, src, title, onClose }: { mode: CenterMode; src: string; title: string; onClose: () => void }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm h-full flex flex-col" data-testid={`expanded-${mode}`}>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <FileBarChart className="h-4 w-4 text-indigo-600" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-slate-50"
          data-testid="expanded-close"
        >
          <Minimize2 className="h-3.5 w-3.5" /> Collapse
        </button>
      </div>
      <iframe src={src} className="flex-1 w-full" title={title} data-testid={`iframe-${mode}`} />
    </div>
  );
}

function AiBar({ context }: { context: string }) {
  const [q, setQ] = useState("");
  const { toast } = useToast();
  return (
    <div className="border-t bg-white/80 backdrop-blur-sm px-4 py-3 flex items-center gap-2" data-testid="ai-bar">
      <Sparkles className="h-4 w-4 text-indigo-600" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Ask about ${context}…`}
        className="flex-1"
        data-testid="input-ai-question"
      />
      <Button
        size="sm"
        disabled={!q.trim()}
        onClick={() => {
          toast({ title: "Coming soon", description: "AI assistant will answer questions about this clinic day." });
          setQ("");
        }}
        data-testid="button-ai-send"
      >
        <Send className="h-3.5 w-3.5 mr-1" /> Ask
      </Button>
    </div>
  );
}

export function PortalShell({ role }: { role: Role }) {
  const { data: facData } = useQuery<{ facilities: string[] }>({
    queryKey: ["/api/portal/my-facilities"],
    queryFn: async () => {
      const res = await fetch("/api/portal/my-facilities", { credentials: "include" });
      return res.json();
    },
  });
  const facilities = facData?.facilities ?? [];

  const [facility, setFacility] = useState<string>("");
  useEffect(() => {
    if (!facility && facilities.length > 0) setFacility(facilities[0]);
  }, [facilities, facility]);

  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [centerMode, setCenterMode] = useState<CenterMode>("patient");
  const [centerSrc, setCenterSrc] = useState<string>("");
  const [centerTitle, setCenterTitle] = useState<string>("");
  const [consentDialog, setConsentDialog] = useState<{ patient: TodayPatient; testType: string | null } | null>(null);

  const { data: scheduleData } = useQuery<{ patients: TodayPatient[] }>({
    queryKey: ["/api/portal/today-schedule", facility, selectedDate],
    queryFn: async () => {
      const u = new URL("/api/portal/today-schedule", window.location.origin);
      u.searchParams.set("facility", facility);
      u.searchParams.set("date", selectedDate);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!facility,
  });

  // Once we have today's schedule for the chosen clinic, fire-and-forget a
  // POST to ensure tech_assignment Plexus tasks exist for each consent gap.
  // Read endpoints stay side-effect free; this side-effect lives explicitly
  // on the client so failures degrade gracefully (toast/log only).
  useEffect(() => {
    if (!facility || selectedDate !== todayIso() || !scheduleData?.patients) return;
    const hasGaps = scheduleData.patients.some((p) => p.consentByTest.some((c) => !c.signed));
    if (!hasGaps) return;
    apiRequest("POST", "/api/portal/ensure-tech-tasks", { facility, date: selectedDate })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/portal/my-tasks"] }))
      .catch(() => { /* best effort */ });
  }, [facility, selectedDate, scheduleData?.patients?.length]);

  const { data: tasksData } = useQuery<{ urgent: PortalTask[]; open: PortalTask[] }>({
    queryKey: ["/api/portal/my-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/portal/my-tasks", { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
  });

  const { data: outreachData } = useQuery<{ patients: OutreachItem[]; heavyDay?: boolean; cap?: number; totalPool?: number }>({
    queryKey: ["/api/portal/outreach-call-list", facility],
    queryFn: async () => {
      const u = new URL("/api/portal/outreach-call-list", window.location.origin);
      u.searchParams.set("facility", facility);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!facility,
  });

  const patients = scheduleData?.patients ?? [];
  const selected = useMemo(() => patients.find((p) => p.patientScreeningId === selectedPatientId) ?? null, [patients, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatientId && patients.length > 0 && patients[0].patientScreeningId != null) {
      setSelectedPatientId(patients[0].patientScreeningId);
    }
  }, [patients, selectedPatientId]);

  const RoleIcon = role === "technician" ? Stethoscope : HeartHandshake;
  const title = role === "technician" ? "Technician Portal" : "Liaison Portal";
  const subtitle = role === "technician"
    ? "Run today's tests · sign consents · upload chart docs"
    : "Consent patients post-clinician · upload to chart · outreach";

  function openCenterMode(mode: CenterMode, url: string | null, label: string) {
    if (!url) return;
    setCenterMode(mode);
    setCenterSrc(url);
    setCenterTitle(label);
  }

  function openPatientChart(p: TodayPatient) {
    if (p.patientScreeningId == null) return;
    openCenterMode("patientChart", `/patient-database#patient-${p.patientScreeningId}`, `Chart — ${p.name}`);
  }

  function openConsentPane(p: TodayPatient) {
    if (p.patientScreeningId != null) {
      setSelectedPatientId(p.patientScreeningId);
    }
    setCenterMode("consent");
  }

  return (
    <div className="min-h-full flex flex-col bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" data-testid={`portal-${role}`}>
      <header className="px-6 py-4 border-b bg-white/70 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${role === "technician" ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"}`}>
              <RoleIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold" data-testid="text-portal-title">{title}</h1>
              <p className="text-sm text-slate-500">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="facility-select" className="text-sm">Clinic</Label>
            <Select value={facility} onValueChange={setFacility}>
              <SelectTrigger id="facility-select" className="w-[220px]" data-testid="select-facility">
                <SelectValue placeholder={facilities.length === 0 ? "No clinic assignments" : "Choose clinic"} />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr_340px] gap-4 p-4 min-h-0">
        {/* Left rail: monthly calendar */}
        <div className="space-y-3 overflow-y-auto">
          <MonthlyMiniCalendar facility={facility} selectedDate={selectedDate} onSelect={(d) => { setSelectedDate(d); setCenterMode("patient"); }} />

          {selected && selected.patientScreeningId != null && (
            <LeftRailUpload
              patientScreeningId={selected.patientScreeningId}
              patientName={selected.name}
            />
          )}

          <Card className="p-3">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Phone className="h-4 w-4" /> Outreach call list
            </div>
            <div className="text-[11px] text-slate-500 mb-2">
              Your share{outreachData?.heavyDay ? " (heavy day — outreach cap reduced)" : ""}
              {typeof outreachData?.totalPool === "number" ? ` · ${outreachData.totalPool} in pool` : ""}
            </div>
            <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
              {(outreachData?.patients ?? []).length === 0 && (
                <div className="text-xs text-slate-500 py-2 text-center">No outreach candidates.</div>
              )}
              {(outreachData?.patients ?? []).map((p) => (
                <div key={p.patientScreeningId} className="rounded-lg border px-2.5 py-2 bg-white" data-testid={`outreach-row-${p.patientScreeningId}`}>
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500">{p.phoneNumber ?? "No phone"} · {p.insurance ?? "—"}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Center: patient detail OR expanded mode */}
        <div className="overflow-y-auto min-h-0">
          {centerMode === "consent" && selected ? (
            <Card className="p-6 space-y-4" data-testid="expanded-consent">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold">Consent — {selected.name}</div>
                  <div className="text-sm text-slate-500">{selected.facility} · {formatTime(selected.time)}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCenterMode("patient")} data-testid="consent-close">
                  <Minimize2 className="h-3.5 w-3.5 mr-1" /> Back to chart
                </Button>
              </div>
              <div className="space-y-2">
                {selected.consentByTest.map((c) => (
                  <Card key={c.testType} className="p-3 flex items-center justify-between" data-testid={`consent-pane-row-${c.testType}`}>
                    <div className="font-medium">{c.testType}</div>
                    {c.signed ? (
                      <Badge className="bg-emerald-100 text-emerald-700">
                        <Check className="h-3 w-3 mr-1" /> Consent ✓
                      </Badge>
                    ) : (
                      <Button size="sm" onClick={() => setConsentDialog({ patient: selected, testType: c.testType })} data-testid={`consent-pane-sign-${c.testType}`}>
                        <FileSignature className="h-3.5 w-3.5 mr-1" /> Sign now
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            </Card>
          ) : centerMode !== "patient" && centerSrc ? (
            <div className="h-[70vh]">
              <ExpandedSectionView mode={centerMode} src={centerSrc} title={centerTitle} onClose={() => setCenterMode("patient")} />
            </div>
          ) : selected ? (
            <PatientDetail
              patient={selected}
              role={role}
              onConsent={(testType) => setConsentDialog({ patient: selected, testType })}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400" data-testid="empty-state">
              <div className="text-center">
                <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <div>{facility ? "Select a patient to begin." : "Choose your clinic to get started."}</div>
              </div>
            </div>
          )}
        </div>

        {/* Right rail: today's schedule with row icons */}
        <div className="space-y-3 overflow-y-auto">
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                {selectedDate === todayIso() ? "Today" : selectedDate}
              </div>
              <Badge variant="outline" data-testid="badge-patient-count">{patients.length}</Badge>
            </div>
            {patients.length === 0 && (
              <div className="text-xs text-slate-500 py-4 text-center">No patients scheduled.</div>
            )}
            <div className="space-y-2">
              {patients.map((p) => {
                const isSelected = p.patientScreeningId === selectedPatientId;
                return (
                  <div
                    key={(p.patientScreeningId ?? p.name) + ""}
                    className={`rounded-lg border px-2.5 py-2 transition-colors ${
                      isSelected ? "bg-indigo-50 border-indigo-300" : "bg-white hover:bg-slate-50"
                    }`}
                    data-testid={`patient-row-${p.patientScreeningId ?? p.name}`}
                  >
                    <button
                      onClick={() => {
                        if (p.patientScreeningId == null) return;
                        setSelectedPatientId(p.patientScreeningId);
                        // Per spec: row click opens the consent panel for this
                        // patient (the primary in-clinic action).
                        setCenterMode("consent");
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{p.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {formatTime(p.time)} · {p.appointments.length} test{p.appointments.length === 1 ? "" : "s"}
                          </div>
                        </div>
                        {p.consentSigned ? (
                          <Badge className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0" data-testid={`pill-consent-${p.patientScreeningId}`}>
                            <Check className="h-2.5 w-2.5 mr-0.5" /> Consent ✓
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0" data-testid={`pill-consent-${p.patientScreeningId}`}>
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Needed
                          </Badge>
                        )}
                      </div>
                    </button>
                    <div className="mt-1.5 flex gap-1 justify-end">
                      <button
                        type="button"
                        title="Patient chart"
                        disabled={p.patientScreeningId == null}
                        onClick={() => openPatientChart(p)}
                        className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                        data-testid={`row-icon-chart-${p.patientScreeningId}`}
                      >
                        <User className="h-3.5 w-3.5 text-slate-700" />
                      </button>
                      {!p.consentSigned && (
                        <button
                          type="button"
                          title="Consent"
                          disabled={p.patientScreeningId == null}
                          onClick={() => openConsentPane(p)}
                          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                          data-testid={`row-icon-consent-${p.patientScreeningId}`}
                        >
                          <FileSignature className="h-3.5 w-3.5 text-rose-600" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Plexus PDF"
                        disabled={!p.plexusPdfUrl}
                        onClick={() => openCenterMode("plexusPdf", p.plexusPdfUrl, `Plexus PDF — ${p.name}`)}
                        className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                        data-testid={`row-icon-plexus-${p.patientScreeningId}`}
                      >
                        <FilePlus className="h-3.5 w-3.5 text-violet-600" />
                      </button>
                      <button
                        type="button"
                        title="Clinician PDF"
                        disabled={!p.clinicianPdfUrl}
                        onClick={() => openCenterMode("clinicianPdf", p.clinicianPdfUrl, `Clinician PDF — ${p.name}`)}
                        className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                        data-testid={`row-icon-clinician-${p.patientScreeningId}`}
                      >
                        <FileText className="h-3.5 w-3.5 text-emerald-600" />
                      </button>
                      <button
                        type="button"
                        title="Day schedule"
                        disabled={!p.scheduleUrl}
                        onClick={() => openCenterMode("scheduleDay", p.scheduleUrl, `Schedule — ${p.name}`)}
                        className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                        data-testid={`row-icon-schedule-${p.patientScreeningId}`}
                      >
                        <CalendarIcon className="h-3.5 w-3.5 text-blue-600" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Tasks pane (urgent inline + open list) */}
          <Card className="p-3" data-testid="tasks-pane">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Bell className="h-4 w-4 text-rose-600" /> My tasks
              </div>
              <Badge variant="outline" data-testid="badge-task-count">
                {(tasksData?.urgent.length ?? 0) + (tasksData?.open.length ?? 0)}
              </Badge>
            </div>
            {(tasksData?.urgent ?? []).length > 0 && (
              <div className="mb-2 space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-rose-600 font-semibold">Urgent</div>
                {tasksData!.urgent.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.patientScreeningId != null) {
                        setSelectedPatientId(t.patientScreeningId);
                        if (t.taskType === "tech_assignment") setCenterMode("consent");
                        else setCenterMode("patient");
                      }
                    }}
                    className="w-full text-left rounded-lg border border-rose-200 bg-rose-50/50 px-2.5 py-2 hover:bg-rose-50"
                    data-testid={`task-urgent-${t.id}`}
                  >
                    <div className="text-sm font-medium truncate">{t.title}</div>
                    <div className="text-[11px] text-rose-700">{t.taskType} · {t.urgency}</div>
                  </button>
                ))}
              </div>
            )}
            {(tasksData?.open ?? []).length === 0 && (tasksData?.urgent ?? []).length === 0 && (
              <div className="text-xs text-slate-500 py-2 text-center">No open tasks.</div>
            )}
            <div className="space-y-1">
              {(tasksData?.open ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (t.patientScreeningId != null) {
                      setSelectedPatientId(t.patientScreeningId);
                      setCenterMode("patient");
                    }
                  }}
                  className="w-full text-left rounded-lg border bg-white px-2.5 py-2 hover:bg-slate-50"
                  data-testid={`task-open-${t.id}`}
                >
                  <div className="text-sm font-medium truncate">{t.title}</div>
                  <div className="text-[11px] text-slate-500">{t.taskType}</div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <AiBar context={facility ? `${facility} · ${selectedDate}` : "today's clinic"} />

      {consentDialog && (
        <ConsentDialog
          patient={consentDialog.patient}
          testType={consentDialog.testType}
          open={!!consentDialog}
          onOpenChange={(o) => !o && setConsentDialog(null)}
          role={role}
        />
      )}
    </div>
  );
}
