import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Stethoscope, HeartHandshake, Calendar as CalendarIcon, Phone, FileSignature,
  Upload, FileText, ChevronLeft, ChevronRight, Check, AlertCircle, ClipboardList,
  Sparkles, Send, Minimize2, FileBarChart, FilePlus, User, Bell, Bot,
  ClipboardPen, Pill, History, ShieldCheck,
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
import PortalWorkflowPanel from "@/components/workflow/PortalWorkflowPanel";

type Role = "technician" | "liaison";
type CenterMode = "playground" | "patient" | "scheduleDay" | "plexusPdf" | "clinicianPdf" | "consent" | "patientChart";

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

type DemoProfile = {
  demographics: { mrn: string; sex: string; phone: string; insurance: string };
  history: string[];
  diagnoses: string[];
  medications: string[];
  previousAncillaries: Array<{ test: string; completedOn: string }>;
  cooldowns: Array<{ test: string; cooldownUntil: string }>;
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


function DemoPatientProfile({
  patient,
  profile,
  consentComplete,
  screeningComplete,
  onOpenConsent,
}: {
  patient: TodayPatient;
  profile: DemoProfile;
  consentComplete: boolean;
  screeningComplete: boolean;
  onOpenConsent: () => void;
}) {
  return (
    <div className="space-y-5" data-testid="demo-patient-profile">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold text-slate-900">{patient.name}</div>
          <div className="mt-1 text-sm text-slate-500">
            DOB {patient.dob ?? "—"} · {profile.demographics.sex} · MRN {profile.demographics.mrn}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {profile.demographics.phone} · {profile.demographics.insurance}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge className={consentComplete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}>
            <ShieldCheck className="h-3 w-3 mr-1" /> {consentComplete ? "Consent Complete" : "Consent Needed"}
          </Badge>
          <Badge className={screeningComplete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}>
            <ClipboardPen className="h-3 w-3 mr-1" /> {screeningComplete ? "Screening Form Complete" : "Screening Form Needed"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4 bg-white">
          <div className="text-sm font-semibold text-slate-900 mb-2">Demographics</div>
          <div className="space-y-1 text-sm text-slate-700">
            <div><span className="font-medium">Facility:</span> {patient.facility}</div>
            <div><span className="font-medium">Time Today:</span> {formatTime(patient.time)}</div>
            <div><span className="font-medium">Clinician:</span> {patient.clinicianName ?? "—"}</div>
            <div><span className="font-medium">Phone:</span> {profile.demographics.phone}</div>
            <div><span className="font-medium">Insurance:</span> {profile.demographics.insurance}</div>
          </div>
        </Card>

        <Card className="p-4 bg-white">
          <div className="text-sm font-semibold text-slate-900 mb-2">Scheduled Today / Qualified For</div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Scheduled Today</div>
          <div className="mb-3 flex flex-wrap gap-2">
            {patient.appointments.map((appt) => (
              <Badge key={appt.id} variant="outline">
                {appt.testType} · {formatTime(appt.scheduledTime)}
              </Badge>
            ))}
          </div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Qualified For</div>
          <div className="flex flex-wrap gap-2">
            {patient.qualifyingTests.map((test) => (
              <Badge key={test} className="bg-indigo-100 text-indigo-700">{test}</Badge>
            ))}
          </div>
        </Card>

        <Card className="p-4 bg-white">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
            <History className="h-4 w-4 text-slate-500" /> History / Diagnoses
          </div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">HX</div>
          <ul className="mb-3 list-disc pl-5 text-sm text-slate-700 space-y-1">
            {profile.history.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">DX</div>
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            {profile.diagnoses.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Card>

        <Card className="p-4 bg-white">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
            <Pill className="h-4 w-4 text-slate-500" /> Medications / Prior Ancillaries
          </div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">RX</div>
          <ul className="mb-3 list-disc pl-5 text-sm text-slate-700 space-y-1">
            {profile.medications.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Previous Ancillary Tests</div>
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            {profile.previousAncillaries.map((item) => <li key={item.test}>{item.test} · {item.completedOn}</li>)}
          </ul>
        </Card>

        <Card className="p-4 bg-white xl:col-span-2">
          <div className="text-sm font-semibold text-slate-900 mb-2">Cooldown / Documents</div>
          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Cooldown Status</div>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                {profile.cooldowns.map((item) => <li key={item.test}>{item.test} cooldown until {item.cooldownUntil}</li>)}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2 self-start">
              <Button variant="outline" size="sm">
                <FilePlus className="h-3.5 w-3.5 mr-1" /> Plexus PDF
              </Button>
              <Button variant="outline" size="sm">
                <FileText className="h-3.5 w-3.5 mr-1" /> Clinician PDF
              </Button>
              <Button size="sm" onClick={onOpenConsent}>
                <FileSignature className="h-3.5 w-3.5 mr-1" /> Open Consent
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ExpandedSectionView({ mode, src, title, onClose }: { mode: CenterMode; src: string; title: string; onClose: () => void }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm h-full flex flex-col" data-testid={`expanded-${mode}`}>
      <div className="flex items-center gap-2 px-4 py-2">
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
  const { toast } = useToast();
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
  const [centerMode, setCenterMode] = useState<CenterMode>("playground");
  const [centerSrc, setCenterSrc] = useState<string>("");
  const [centerTitle, setCenterTitle] = useState<string>("");
  const [consentDialog, setConsentDialog] = useState<{ patient: TodayPatient; testType: string | null } | null>(null);
  const [playgroundTab, setPlaygroundTab] = useState<"overview" | "tasks" | "documents">("overview");
  const [scheduleDialogPatient, setScheduleDialogPatient] = useState<TodayPatient | null>(null);
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [aiMinimized, setAiMinimized] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [schedulePeekPatient, setSchedulePeekPatient] = useState<TodayPatient | null>(null);
  const [aliConsentComplete, setAliConsentComplete] = useState(false);
  const [aliScreeningComplete, setAliScreeningComplete] = useState(false);
  const [dockOpenApps, setDockOpenApps] = useState<Array<"tasks" | "schedule" | "consent" | "chart" | "documents">>([]);
  const [dockActiveApp, setDockActiveApp] = useState<null | "tasks" | "schedule" | "consent" | "chart" | "documents">(null);

  const aliBoomayePatient = useMemo<TodayPatient>(() => ({
    patientScreeningId: 900001,
    name: "Ali Boomaye",
    dob: "05/14/1968",
    time: "09:30",
    facility: facility || "NWPG - Spring",
    clinicianName: "Dr. Imran",
    qualifyingTests: ["BrainWave", "VitalWave"],
    appointmentStatus: "scheduled",
    consentByTest: [{ testType: "BrainWave", signed: aliConsentComplete, documentId: null }],
    consentSigned: aliConsentComplete,
    appointments: [
      { id: 1, testType: "BrainWave", scheduledTime: "09:30", status: "scheduled" },
      { id: 2, testType: "VitalWave", scheduledTime: "10:30", status: "scheduled" },
    ],
    batchId: 9001,
    plexusPdfUrl: "about:blank",
    clinicianPdfUrl: "about:blank",
    scheduleUrl: "about:blank",
  }), [facility, aliConsentComplete]);

  const aliBoomayeProfile = useMemo<DemoProfile>(() => ({
    demographics: {
      mrn: "ALI-900001",
      sex: "Male",
      phone: "(602) 555-0199",
      insurance: "Straight Medicare",
    },
    history: ["Hypertension", "Type 2 diabetes mellitus", "Chronic fatigue symptoms"],
    diagnoses: ["Neuropathy", "Cognitive concern", "Dizziness"],
    medications: ["Metformin", "Losartan", "Atorvastatin"],
    previousAncillaries: [
      { test: "Urinalysis", completedOn: "2026-03-14" },
      { test: "VitalWave", completedOn: "2026-02-01" },
    ],
    cooldowns: [
      { test: "VitalWave", cooldownUntil: "2026-05-01" },
      { test: "BrainWave", cooldownUntil: "2026-04-30" },
    ],
  }), []);

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

  const livePatients = scheduleData?.patients ?? [];
  const patients = useMemo(() => {
    const withoutAli = livePatients.filter((p) => p.patientScreeningId !== aliBoomayePatient.patientScreeningId);
    return [aliBoomayePatient, ...withoutAli];
  }, [livePatients, aliBoomayePatient]);

  const selected = useMemo(() => patients.find((p) => p.patientScreeningId === selectedPatientId) ?? null, [patients, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatientId && patients.length > 0 && patients[0].patientScreeningId != null) {
      setSelectedPatientId(patients[0].patientScreeningId);
    }
  }, [patients, selectedPatientId]);

  const RoleIcon = role === "technician" ? Stethoscope : HeartHandshake;
  const title = role === "technician" ? "Technician Portal" : "Liaison Technician Portal";
  const subtitle = role === "technician"
    ? "Run today's tests · sign consents · upload chart docs"
    : "";

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

  function togglePatientInPlayground(p: TodayPatient) {
    const samePatient = p.patientScreeningId === selectedPatientId;

    if (samePatient && centerMode === "patient") {
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle("");
      setDockActiveApp(null);
      return;
    }

    if (p.patientScreeningId != null) {
      setSelectedPatientId(p.patientScreeningId);
    }

    setCenterMode("patient");
    setCenterSrc("");
    setCenterTitle("");
    markDockOpen("chart");
  }

  function openScheduleDialog(p: TodayPatient) {
    if (p.patientScreeningId != null) setSelectedPatientId(p.patientScreeningId);
    setScheduleDialogPatient(p);
  }

  function expandScheduleToPlayground(p: TodayPatient) {
    if (p.patientScreeningId != null) setSelectedPatientId(p.patientScreeningId);
    setCenterMode("scheduleDay");
    setCenterSrc(p.scheduleUrl || "about:blank");
    setCenterTitle(`Schedule — ${p.name}`);
    setScheduleDialogPatient(null);
    markDockOpen("schedule");
  }

  function openCalendarInPlayground() {
    setCenterMode("playground");
    setDockOpenApps((prev) => (prev.includes("schedule") ? prev : [...prev, "schedule"]));
    setDockActiveApp("schedule");
    setCenterSrc("");
    setCenterTitle(`Calendar — ${facility ? `${facility} · ${selectedDate}` : selectedDate}`);
  }

  function openTasksInPlayground() {
    setCenterMode("playground");
    setDockOpenApps((prev) => (prev.includes("tasks") ? prev : [...prev, "tasks"]));
    setDockActiveApp("tasks");
    setCenterSrc("");
    setCenterTitle("Tasks");
  }

  function openDocumentsInPlayground() {
    setCenterMode("playground");
    setDockOpenApps((prev) => (prev.includes("documents") ? prev : [...prev, "documents"]));
    setDockActiveApp("documents");
    setCenterSrc("");
    setCenterTitle("Documents");
  }

  function markDockOpen(app: "tasks" | "schedule" | "consent" | "chart" | "documents") {
    setDockOpenApps((prev) => (prev.includes(app) ? prev : [...prev, app]));
    setDockActiveApp(app);
  }

  function toggleDockApp(app: "tasks" | "schedule" | "consent" | "chart" | "documents") {
    if (dockActiveApp === app) {
      setDockOpenApps((prev) => prev.filter((x) => x !== app));
      setDockActiveApp(null);
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle("");
      return;
    }

    setDockOpenApps((prev) => (prev.includes(app) ? prev : [...prev, app]));
    setDockActiveApp(app);

    if (app === "tasks" || app === "documents") {
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle("");
      return;
    }

    if (!selected) {
      setCenterMode("playground");
      return;
    }

    if (app === "chart") {
      setCenterMode("patient");
      setCenterSrc("");
      setCenterTitle("");
      return;
    }

    if (app === "consent") {
      setCenterMode("consent");
      return;
    }

    if (app === "schedule") {
      expandScheduleToPlayground(selected);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-white" data-testid={`portal-${role}`}>
      <header className="relative z-20 overflow-hidden px-6 py-4 border-b border-white/10 bg-[radial-gradient(circle_at_14%_28%,rgba(255,255,255,0.18)_0,rgba(255,255,255,0.18)_1px,transparent_2px),radial-gradient(circle_at_33%_62%,rgba(255,255,255,0.12)_0,rgba(255,255,255,0.12)_1px,transparent_2px),radial-gradient(circle_at_57%_24%,rgba(255,255,255,0.14)_0,rgba(255,255,255,0.14)_1px,transparent_2px),radial-gradient(circle_at_74%_54%,rgba(255,255,255,0.10)_0,rgba(255,255,255,0.10)_1px,transparent_2px),radial-gradient(circle_at_88%_22%,rgba(255,255,255,0.16)_0,rgba(255,255,255,0.16)_1px,transparent_2px),linear-gradient(180deg,rgba(0,0,0,0.88),rgba(10,10,18,0.84))] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
                        <div>
              <h1 className="text-lg font-semibold text-[#6F8FD6] drop-shadow-[0_0_14px_rgba(111,143,214,0.95)]" data-testid="text-portal-title">{title}</h1>
              {subtitle ? <p className="text-sm text-white/70">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="facility-select" className="text-sm text-white/80">Clinic</Label>
            <Select value={facility} onValueChange={setFacility}>
              <SelectTrigger id="facility-select" className="w-[220px] border-white/20 bg-white/90 text-slate-900" data-testid="select-facility">
                <SelectValue placeholder={facilities.length === 0 ? "No clinic assignments" : "Choose clinic"} />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-white" />
          <div className="absolute inset-0 px-6 py-5">
            <div className="h-full w-full rounded-[32px] bg-white" />
          </div>
        </div>

        <div className="absolute inset-0 z-[1] overflow-auto px-6 py-5">
          <div className="relative mx-auto flex h-full max-w-[1600px] flex-col px-[10%] pt-14">
            <button
              type="button"
              onClick={() => {
                const collapse = !(leftRailCollapsed && rightRailCollapsed);
                setLeftRailCollapsed(collapse);
                setRightRailCollapsed(collapse);
              }}
              className="absolute left-1/2 top-0 z-30 -translate-x-1/2 text-center"
              data-testid="button-toggle-both-rails"
            >
              <div className="rounded-full border border-white/35 bg-[rgba(72,99,160,0.40)] px-5 py-2 text-base font-semibold tracking-tight text-white shadow-[0_16px_40px_rgba(15,23,42,0.28)] backdrop-blur-2xl">
                Playground
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {facility ? `${facility} · ${selectedDate}` : "Choose your clinic to get started."}
              </div>
            </button>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {centerMode === "consent" && selected ? (
                <div className="h-full rounded-[28px] bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.12)] overflow-y-auto" data-testid="expanded-consent">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-lg font-semibold">Consent — {selected.name}</div>
                      <div className="text-sm text-slate-500">{selected.facility} · {formatTime(selected.time)}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setCenterMode("patient")} data-testid="consent-close">
                      <Minimize2 className="h-3.5 w-3.5 mr-1" /> Back to chart
                    </Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {selected.consentByTest.map((c) => (
                      <Card key={c.testType} className="p-3 flex items-center justify-between bg-white/90" data-testid={`consent-pane-row-${c.testType}`}>
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
                </div>
              ) : centerMode !== "patient" && centerMode !== "playground" && centerSrc ? (
                <div className="h-full min-h-[70vh]">
                  <ExpandedSectionView mode={centerMode} src={centerSrc} title={centerTitle} onClose={() => setCenterMode("playground")} />
                </div>
              ) : centerMode === "patient" && selected ? (
                <div className="h-full rounded-[28px] bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-y-auto">
                  {selected.patientScreeningId === aliBoomayePatient.patientScreeningId ? (
                    <DemoPatientProfile
                      patient={selected}
                      profile={aliBoomayeProfile}
                      consentComplete={aliConsentComplete}
                      screeningComplete={aliScreeningComplete}
                      onOpenConsent={() => setCenterMode("consent")}
                    />
                  ) : (
                    <PatientDetail
                      patient={selected}
                      role={role}
                      onConsent={(testType) => setConsentDialog({ patient: selected, testType })}
                    />
                  )}
                </div>
              ) : (
                <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-y-auto" data-testid="playground-home">
                  {dockActiveApp === "schedule" ? (
                    <div className="p-6">
                      <div className="mb-4 text-xl font-semibold text-slate-900">Calendar</div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Clinic Day</div>
                          <div className="text-sm text-slate-600">{facility ? `${facility} · ${selectedDate}` : selectedDate}</div>
                        </Card>
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Ancillary Count</div>
                          <div className="text-sm text-slate-600">{patients.length} patient(s) on the right rail for this day.</div>
                        </Card>
                      </div>
                    </div>
                  ) : dockActiveApp === "tasks" ? (
                    <div className="p-6">
                      <div className="mb-4 text-xl font-semibold text-slate-900">Tasks</div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Urgent Tasks</div>
                          {(tasksData?.urgent ?? []).length === 0 ? (
                            <div className="text-sm text-slate-500">No urgent tasks.</div>
                          ) : (
                            <div className="space-y-2">
                              {(tasksData?.urgent ?? []).map((t) => (
                                <div key={t.id} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                                  <div className="text-sm font-medium text-slate-900">{t.title}</div>
                                  <div className="text-xs text-rose-700">{t.taskType} · {t.urgency}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </Card>
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Open Tasks</div>
                          {(tasksData?.open ?? []).length === 0 ? (
                            <div className="text-sm text-slate-500">No open tasks.</div>
                          ) : (
                            <div className="space-y-2">
                              {(tasksData?.open ?? []).map((t) => (
                                <div key={t.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                  <div className="text-sm font-medium text-slate-900">{t.title}</div>
                                  <div className="text-xs text-slate-500">{t.taskType}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </Card>
                      </div>
                    </div>
                  ) : dockActiveApp === "documents" ? (
                    <div className="p-6">
                      <div className="mb-4 text-xl font-semibold text-slate-900">Documents</div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Selected Patient Documents</div>
                          {selected ? (
                            <div className="text-sm text-slate-600">Use Plexus PDF, Clinician PDF, screening, and consent actions from the right rail or patient profile.</div>
                          ) : (
                            <div className="text-sm text-slate-500">Select a patient to work with documents.</div>
                          )}
                        </Card>
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Clinic Day Context</div>
                          <div className="text-sm text-slate-600">{facility ? `${facility} · ${selectedDate}` : "Choose your clinic to get started."}</div>
                        </Card>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className={`absolute left-4 top-4 bottom-4 z-20 rounded-[28px] text-white shadow-[0_24px_70px_rgba(15,23,42,0.34)] backdrop-blur-2xl transition-all duration-300 ${
            leftRailCollapsed
              ? "w-10 bg-[rgba(71,85,105,0.22)]"
              : "w-[320px] bg-[rgba(72,99,160,0.80)]"
          }`}
          data-testid="portal-left-rail"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-3 py-3 border-b border-white/40">
              {!leftRailCollapsed && <div className="text-sm font-semibold text-white">Tools</div>}
              <button
                type="button"
                onClick={() => setLeftRailCollapsed((v) => !v)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/35 bg-white/90 text-[#4863A0] hover:bg-white"
                data-testid="button-toggle-left-rail"
              >
                {leftRailCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
            </div>

            {!leftRailCollapsed && (
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <Card className="p-3 bg-white text-slate-900">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900">Calendar</div>
                    <button
                      type="button"
                      onClick={openCalendarInPlayground}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50"
                      data-testid="button-left-calendar-expand"
                      title="Expand to Playground"
                    >
                      <ChevronLeft className="h-4 w-4 rotate-180 text-[#4863A0]" />
                    </button>
                  </div>
                  <MonthlyMiniCalendar facility={facility} selectedDate={selectedDate} onSelect={(d) => { setSelectedDate(d); setCenterMode("patient"); }} />
                </Card>

                {selected && selected.patientScreeningId != null && (
                  <Card className="p-3 bg-white text-slate-900">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-900">Documents / Upload</div>
                      <button
                        type="button"
                        onClick={openDocumentsInPlayground}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50"
                        data-testid="button-left-documents-expand"
                        title="Expand to Playground"
                      >
                        <ChevronLeft className="h-4 w-4 rotate-180 text-[#4863A0]" />
                      </button>
                    </div>
                    <LeftRailUpload
                      patientScreeningId={selected.patientScreeningId}
                      patientName={selected.name}
                    />
                  </Card>
                )}

                <Card className="p-3 bg-white text-slate-900">
                  <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Phone className="h-4 w-4" /> Outreach call list
                  </div>
                  <div className="text-[11px] text-slate-500 mb-2">
                    Your share{outreachData?.heavyDay ? " (heavy day — outreach cap reduced)" : ""}
                    {typeof outreachData?.totalPool === "number" ? ` · ${outreachData.totalPool} in pool` : ""}
                  </div>
                  <div className="space-y-1.5 max-h-[28vh] overflow-y-auto">
                    {(outreachData?.patients ?? []).length === 0 && (
                      <div className="text-xs text-slate-500 py-2 text-center">No outreach candidates.</div>
                    )}
                    {(outreachData?.patients ?? []).map((p) => (
                      <div key={p.patientScreeningId} className="rounded-lg border border-white/60 px-2.5 py-2 bg-white text-slate-900" data-testid={`outreach-row-${p.patientScreeningId}`}>
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-[11px] text-slate-500">{p.phoneNumber ?? "No phone"} · {p.insurance ?? "—"}</div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-3 bg-white text-slate-900" data-testid="tasks-pane">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Bell className="h-4 w-4 text-rose-600" /> My tasks
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" data-testid="badge-task-count">
                        {(tasksData?.urgent.length ?? 0) + (tasksData?.open.length ?? 0)}
                      </Badge>
                      <button
                        type="button"
                        onClick={openTasksInPlayground}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50"
                        data-testid="button-left-tasks-expand"
                        title="Expand to Playground"
                      >
                        <ChevronLeft className="h-4 w-4 rotate-180 text-[#4863A0]" />
                      </button>
                    </div>
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
                        className="w-full text-left rounded-lg border bg-white px-2.5 py-2 text-slate-900 hover:bg-slate-50"
                        data-testid={`task-open-${t.id}`}
                      >
                        <div className="text-sm font-medium truncate">{t.title}</div>
                        <div className="text-[11px] text-slate-500">{t.taskType}</div>
                      </button>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>

        <div
          className={`absolute right-4 top-4 bottom-4 z-20 rounded-[28px] text-white shadow-[0_24px_70px_rgba(15,23,42,0.34)] backdrop-blur-2xl transition-all duration-300 ${
            rightRailCollapsed
              ? "w-10 bg-[rgba(71,85,105,0.22)]"
              : "w-[340px] bg-[rgba(72,99,160,0.80)]"
          }`}
          data-testid="portal-right-rail"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-3 py-3 border-b border-white/40">
              {!rightRailCollapsed && (
                <div>
                  <div className="text-sm font-semibold text-white">Ancillary Test Schedule</div>
                  <div className="text-[11px] text-slate-200">{selectedDate === todayIso() ? "Today" : selectedDate}</div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setRightRailCollapsed((v) => !v)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/35 bg-white/90 text-[#4863A0] hover:bg-white"
                data-testid="button-toggle-right-rail"
              >
                {rightRailCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </div>

            {!rightRailCollapsed && (
              <div className="flex-1 overflow-y-auto p-3">
                <div className="mb-3 flex items-center justify-between">
                  <Badge variant="outline" data-testid="badge-patient-count">{patients.length}</Badge>
                </div>
                {patients.length === 0 ? (
                  <div className="text-xs text-slate-200 py-4 text-center">No patients scheduled.</div>
                ) : (
                  <div className="space-y-2">
                    {patients.map((p) => {
                      const isSelected = p.patientScreeningId === selectedPatientId;
                      const isAli = p.patientScreeningId === aliBoomayePatient.patientScreeningId;
                      const consentDone = isAli ? aliConsentComplete : p.consentSigned;
                      const screeningDone = isAli ? aliScreeningComplete : false;

                      return (
                        <div
                          key={(p.patientScreeningId ?? p.name) + ""}
                          className={`rounded-lg border px-2.5 py-2 text-slate-900 transition-colors ${
                            isSelected && centerMode === "patient" ? "bg-indigo-50 border-indigo-300" : "bg-white hover:bg-slate-50"
                          }`}
                          data-testid={`patient-row-${p.patientScreeningId ?? p.name}`}
                        >
                          <button
                            onClick={() => {
                              togglePatientInPlayground(p);
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
                              {consentDone ? (
                                <Badge className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0">
                                  <Check className="h-2.5 w-2.5 mr-0.5" /> Consent ✓
                                </Badge>
                              ) : (
                                <Badge className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0">
                                  <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Needed
                                </Badge>
                              )}
                            </div>
                          </button>

                          <div className="mt-2 flex items-center justify-end gap-1">
                            <div className="inline-flex rounded-full border border-slate-200 bg-white overflow-hidden">
                              <button
                                type="button"
                                onClick={() => openScheduleDialog(p)}
                                className="inline-flex h-8 w-8 items-center justify-center hover:bg-slate-50"
                                data-testid={`button-patient-calendar-${p.patientScreeningId ?? p.name}`}
                                title="Schedule popup"
                              >
                                <CalendarIcon className="h-4 w-4 text-[#4863A0]" />
                              </button>
                              <button
                                type="button"
                                onClick={() => expandScheduleToPlayground(p)}
                                className="inline-flex h-8 w-8 items-center justify-center border-l border-slate-200 hover:bg-slate-50"
                                data-testid={`button-patient-calendar-expand-${p.patientScreeningId ?? p.name}`}
                                title="Expand schedule into Playground"
                              >
                                <ChevronLeft className="h-4 w-4 rotate-180 text-[#4863A0]" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                if (p.patientScreeningId != null) setSelectedPatientId(p.patientScreeningId);
                                if (isAli) setAliConsentComplete((v) => !v);
                                setCenterMode("consent");
                                markDockOpen("consent");
                              }}
                              className={`inline-flex h-8 items-center justify-center rounded-full border px-2 ${
                                consentDone
                                  ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              data-testid={`button-patient-consent-${p.patientScreeningId ?? p.name}`}
                              title="Informed Consent"
                            >
                              <FileSignature className="h-4 w-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (p.patientScreeningId != null) setSelectedPatientId(p.patientScreeningId);
                                if (isAli) setAliScreeningComplete((v) => !v);
                                setCenterMode("patient");
                                markDockOpen("chart");
                              }}
                              className={`inline-flex h-8 items-center justify-center rounded-full border px-2 ${
                                screeningDone
                                  ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              data-testid={`button-patient-screening-${p.patientScreeningId ?? p.name}`}
                              title="Screening Form"
                            >
                              <ClipboardPen className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="absolute bottom-5 left-1/2 z-50 -translate-x-1/2 w-full max-w-[95vw] overflow-x-auto">
          <div className="group/dock mx-auto flex w-fit items-center gap-1 rounded-2xl border border-white/10 bg-slate-900/40 px-2 py-2 opacity-60 backdrop-blur-xl transition-all duration-300 ease-out hover:gap-2 hover:border-white/20 hover:bg-slate-900/60 hover:px-3 hover:py-2 hover:opacity-100 hover:shadow-2xl">
            {[
              { key: "tasks", icon: Bell },
              { key: "schedule", icon: CalendarIcon },
              { key: "consent", icon: FileSignature },
              { key: "chart", icon: User },
              { key: "documents", icon: FileText },
              { key: "ai", icon: Bot },
            ].map((app, index) => {
              const Icon = app.icon;
              const isActive = dockActiveApp === app.key || (app.key === "ai" && aiOpen);
              const isOpen = app.key === "ai" ? aiOpen : dockOpenApps.includes(app.key as any);

              return (
                <div key={app.key} className="flex items-center">
                  {index > 0 && <div className="mx-1 h-6 w-px bg-white/15" />}
                  <button
                    type="button"
                    onClick={() => {
                      if (app.key === "ai") {
                        setAiOpen((v) => !v);
                        setAiMinimized(false);
                        return;
                      }
                      toggleDockApp(app.key as "tasks" | "schedule" | "consent" | "chart" | "documents");
                    }}
                    className={`relative flex h-10 w-10 items-center justify-center rounded-xl bg-[#4863A0]/25 text-[#6F8FD6] shadow-md transition-all duration-300 ease-out group-hover/dock:h-11 group-hover/dock:w-11 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#4863A0]/35 ${
                      isActive ? "ring-2 ring-white bg-[#4863A0]/45 text-white" : ""
                    }`}
                    data-testid={`dock-icon-${app.key}`}
                  >
                    <Icon className="h-5 w-5 text-white" />
                    {isOpen && <div className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {aiOpen ? (
          <div className="absolute bottom-20 right-5 z-30 w-[340px] rounded-[24px] border border-white/60 bg-white/70 shadow-[0_18px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl" data-testid="floating-ai-panel">
            <div className="flex items-center gap-2 border-b border-white/50 px-4 py-3">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <div className="text-sm font-semibold text-slate-900">AI Assistant</div>
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-white/70 hover:bg-white"
                data-testid="button-ai-minimize"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="text-xs text-slate-500">
                Ask about {facility ? `${facility} · ${selectedDate}` : "today's clinic"}.
              </div>
              <Input
                value={aiDraft}
                onChange={(e) => setAiDraft(e.target.value)}
                placeholder="Ask about this clinic day…"
                className="w-full bg-white/90"
                data-testid="input-ai-question"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!aiDraft.trim()}
                  onClick={() => {
                    toast({ title: "Coming soon", description: "AI assistant will answer questions about this clinic day." });
                    setAiDraft("");
                  }}
                  data-testid="button-ai-send"
                >
                  <Send className="h-3.5 w-3.5 mr-1" /> Ask
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {scheduleDialogPatient && (
        <Dialog open={!!scheduleDialogPatient} onOpenChange={(o) => !o && setScheduleDialogPatient(null)}>
          <DialogContent className="max-w-md" data-testid="dialog-schedule-peek">
            <DialogHeader>
              <DialogTitle>{scheduleDialogPatient.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm text-slate-700">
              <div><span className="font-medium">DOB:</span> {scheduleDialogPatient.dob ?? "—"}</div>
              <div><span className="font-medium">Facility:</span> {scheduleDialogPatient.facility}</div>
              <div><span className="font-medium">Time:</span> {formatTime(scheduleDialogPatient.time)}</div>
              <div><span className="font-medium">Clinician:</span> {scheduleDialogPatient.clinicianName ?? "—"}</div>
              <div><span className="font-medium">Qualifying Tests:</span> {scheduleDialogPatient.qualifyingTests.length ? scheduleDialogPatient.qualifyingTests.join(", ") : "None"}</div>
              <div><span className="font-medium">Appointment Status:</span> {scheduleDialogPatient.appointmentStatus || "pending"}</div>
              {scheduleDialogPatient.patientScreeningId === aliBoomayePatient.patientScreeningId && (
                <>
                  <div><span className="font-medium">Insurance:</span> {aliBoomayeProfile.demographics.insurance}</div>
                  <div><span className="font-medium">Previous Ancillary Tests:</span> {aliBoomayeProfile.previousAncillaries.map((x) => `${x.test} (${x.completedOn})`).join(", ")}</div>
                  <div><span className="font-medium">Cooldown:</span> {aliBoomayeProfile.cooldowns.map((x) => `${x.test} until ${x.cooldownUntil}`).join(", ")}</div>
                </>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setScheduleDialogPatient(null)}>
                Close
              </Button>
              <Button onClick={() => expandScheduleToPlayground(scheduleDialogPatient)}>
                Expand to Playground
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

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
