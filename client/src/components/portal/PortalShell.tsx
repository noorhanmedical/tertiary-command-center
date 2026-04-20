import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Stethoscope, HeartHandshake, Calendar as CalendarIcon, Phone, FileSignature, Upload, FileText, ChevronLeft, ChevronRight, Check, AlertCircle, ClipboardList } from "lucide-react";
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
import { VALID_FACILITIES } from "@shared/plexus";
import { SignaturePad } from "./SignaturePad";

type Role = "technician" | "liaison";

type TodayPatient = {
  patientScreeningId: number;
  name: string;
  dob: string | null;
  time: string | null;
  facility: string;
  clinicianName: string | null;
  qualifyingTests: string[];
  appointmentStatus: string;
  commitStatus: string;
  consentSignedDocumentId: number | null;
  consentSigned: boolean;
  appointments: Array<{ id: number; testType: string; scheduledTime: string; status: string }>;
  batchId: number;
};

type LibraryDoc = {
  id: number;
  title: string;
  kind: string;
  filename: string;
  contentType: string;
  surfaces: string[];
  downloadUrl: string;
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
  const { data } = useQuery<{ days: { date: string; patientCount: number }[] }>({
    queryKey: ["/api/portal/month-summary", facility, monthIso],
    queryFn: async () => {
      const u = new URL("/api/portal/month-summary", window.location.origin);
      u.searchParams.set("facility", facility);
      u.searchParams.set("month", monthIso);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
  });
  const counts = new Map<string, number>();
  for (const d of data?.days ?? []) counts.set(d.date, d.patientCount);
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
  open,
  onOpenChange,
  role,
}: {
  patient: TodayPatient;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role: Role;
}) {
  const { toast } = useToast();
  const [signature, setSignature] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>("");

  const { data: templates } = useQuery<LibraryDoc[]>({
    queryKey: ["/api/documents-library", "informed_consent", "tech_consent_picker"],
    queryFn: async () => {
      const u = new URL("/api/documents-library", window.location.origin);
      u.searchParams.set("kind", "informed_consent");
      u.searchParams.set("surface", "tech_consent_picker");
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
        signedBy: role === "liaison" ? "patient" : "patient",
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

  const pdfTemplates = (templates ?? []).filter((t) => t.contentType === "application/pdf");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-consent">
        <DialogHeader>
          <DialogTitle>Consent — {patient.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Consent template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger data-testid="select-consent-template">
                <SelectValue placeholder={pdfTemplates.length === 0 ? "No PDF templates available" : "Choose a consent template"} />
              </SelectTrigger>
              <SelectContent>
                {pdfTemplates.map((t) => (
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
            disabled={!signature || !templateId || signMutation.isPending}
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
    if (!file) return;
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
      <Button onClick={onUpload} disabled={!file || busy} className="w-full" data-testid="button-upload-submit">
        <Upload className="mr-1 h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload to chart"}
      </Button>
    </div>
  );
}

function PatientDetail({ patient, role }: { patient: TodayPatient; role: Role }) {
  const [consentOpen, setConsentOpen] = useState(false);
  const { data: docs } = useQuery<PatientDoc[]>({
    queryKey: ["/api/portal/patient-documents", patient.patientScreeningId],
    queryFn: async () => {
      const res = await fetch(`/api/portal/patient-documents/${patient.patientScreeningId}`, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
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
              <Check className="h-3 w-3 mr-1" /> Consent signed
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
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Informed consent</div>
                <div className="text-sm text-slate-500">
                  {patient.consentSigned ? "Signed and saved to patient chart." : "No signed consent on file yet."}
                </div>
              </div>
              <Button onClick={() => setConsentOpen(true)} data-testid="button-open-consent">
                <FileSignature className="h-4 w-4 mr-2" />
                {patient.consentSigned ? "Re-sign" : "Sign now"}
              </Button>
            </div>
          </Card>
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

      <ConsentDialog patient={patient} open={consentOpen} onOpenChange={setConsentOpen} role={role} />
    </div>
  );
}

export function PortalShell({ role }: { role: Role }) {
  const [facility, setFacility] = useState<string>(VALID_FACILITIES[0]);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);

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
  });

  const { data: outreachData } = useQuery<{ patients: OutreachItem[] }>({
    queryKey: ["/api/portal/outreach-call-list", facility],
    queryFn: async () => {
      const u = new URL("/api/portal/outreach-call-list", window.location.origin);
      u.searchParams.set("facility", facility);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
  });

  const patients = scheduleData?.patients ?? [];
  const selected = useMemo(() => patients.find((p) => p.patientScreeningId === selectedPatientId) ?? null, [patients, selectedPatientId]);

  // Auto-select first patient when list loads
  useEffect(() => {
    if (!selectedPatientId && patients.length > 0) setSelectedPatientId(patients[0].patientScreeningId);
  }, [patients, selectedPatientId]);

  const RoleIcon = role === "technician" ? Stethoscope : HeartHandshake;
  const title = role === "technician" ? "Technician Portal" : "Liaison Portal";
  const subtitle = role === "technician"
    ? "Run today's tests · sign consents · upload chart docs"
    : "Consent patients post-clinician · upload to chart · outreach";

  return (
    <div className="min-h-full flex flex-col bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" data-testid={`portal-${role}`}>
      {/* Header */}
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
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALID_FACILITIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      {/* 3-column layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-4 p-4 min-h-0">
        {/* Left rail: today's schedule + monthly calendar + outreach */}
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
            <div className="space-y-1.5">
              {patients.map((p) => {
                const isSelected = p.patientScreeningId === selectedPatientId;
                return (
                  <button
                    key={p.patientScreeningId}
                    onClick={() => setSelectedPatientId(p.patientScreeningId)}
                    className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors ${
                      isSelected ? "bg-indigo-50 border-indigo-300" : "bg-white hover:bg-slate-50 border-slate-200"
                    }`}
                    data-testid={`patient-row-${p.patientScreeningId}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatTime(p.time)} · {p.qualifyingTests.length} tests
                        </div>
                      </div>
                      {p.consentSigned ? (
                        <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500" title="Consent signed" data-testid={`pill-consent-${p.patientScreeningId}`} />
                      ) : (
                        <span className="shrink-0 w-2 h-2 rounded-full bg-amber-500" title="Consent needed" data-testid={`pill-consent-${p.patientScreeningId}`} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
          <MonthlyMiniCalendar facility={facility} selectedDate={selectedDate} onSelect={setSelectedDate} />
        </div>

        {/* Center: patient detail */}
        <div className="overflow-y-auto">
          {selected ? (
            <PatientDetail patient={selected} role={role} />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400" data-testid="empty-state">
              <div className="text-center">
                <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <div>Select a patient to begin.</div>
              </div>
            </div>
          )}
        </div>

        {/* Right rail: outreach call list */}
        <div className="space-y-3 overflow-y-auto">
          <Card className="p-3">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Phone className="h-4 w-4" /> Outreach call list
            </div>
            <div className="text-[11px] text-slate-500 mb-2">
              Patients without a visit in the next 90 days.
            </div>
            <div className="space-y-1.5">
              {(outreachData?.patients ?? []).length === 0 && (
                <div className="text-xs text-slate-500 py-2 text-center">No outreach candidates.</div>
              )}
              {(outreachData?.patients ?? []).map((p) => (
                <div key={p.patientScreeningId} className="rounded-lg border border-slate-200 px-2.5 py-2 bg-white" data-testid={`outreach-row-${p.patientScreeningId}`}>
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500">{p.phoneNumber ?? "No phone"} · {p.insurance ?? "—"}</div>
                  {p.qualifyingTests.length > 0 && (
                    <div className="text-[10px] text-slate-400 mt-1 truncate">{p.qualifyingTests.join(", ")}</div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
