import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  ArrowLeft,
  DollarSign,
  Building2,
  Copy,
  Printer,
  X,
  FileText,
  Plus,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

type BillingRecord = {
  id: number;
  patientId: number | null;
  batchId: number | null;
  service: string;
  facility: string | null;
  dateOfService: string | null;
  patientName: string;
  clinician: string | null;
  report: string | null;
  insuranceInfo: string | null;
  historicalProblemList: string | null;
  comments: string | null;
  billing: string | null;
  nextAncillaries: string | null;
  billingComments: string | null;
  paid: boolean | null;
  ptResponsibility: string | null;
  billingComments2: string | null;
  nextgenAppt: string | null;
  billed: boolean | null;
  drImranComments: string | null;
  response: string | null;
  nwpgInvoiceSent: boolean | null;
  paidFinal: boolean | null;
  createdAt: string;
};

type NoteSection = { heading: string; body: string };
type GeneratedNote = {
  id: number;
  patientId: number;
  batchId: number;
  facility: string | null;
  scheduleDate: string | null;
  patientName: string;
  service: string;
  docKind: string;
  title: string;
  sections: NoteSection[];
  generatedAt: string;
};

// ─── Constants ─────────────────────────────────────────────────────────────

const SERVICES = ["BrainWave", "VitalWave", "Ultrasounds"] as const;
type ServiceTab = (typeof SERVICES)[number];

const FACILITIES = ["All Facilities", "Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"];

const DOC_KIND_LABELS: Record<string, string> = {
  preProcedureOrder: "Pre-Procedure Order",
  postProcedureNote: "Post-Procedure Note",
  billing: "Billing Document",
  screening: "Screening",
};

const DOC_KIND_COLORS: Record<string, string> = {
  preProcedureOrder: "bg-blue-100 text-blue-800",
  postProcedureNote: "bg-teal-100 text-teal-800",
  billing: "bg-emerald-100 text-emerald-800",
  screening: "bg-slate-100 text-slate-800",
};

// Text fields that can be inline edited (maps col key → db field)
type TextField = "dateOfService" | "patientName" | "clinician" | "facility" | "report" |
  "insuranceInfo" | "historicalProblemList" | "comments" | "billing" | "nextAncillaries" |
  "billingComments" | "ptResponsibility" | "billingComments2" | "nextgenAppt" |
  "drImranComments" | "response";

type BoolField = "paid" | "billed" | "nwpgInvoiceSent" | "paidFinal";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return dateStr;
  const [yyyy, mm, dd] = parts;
  const d = new Date(yyyy, mm - 1, dd);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Document modal ─────────────────────────────────────────────────────────

function NotesModal({
  notes,
  title,
  onClose,
}: {
  notes: GeneratedNote[];
  title: string;
  onClose: () => void;
}) {
  const visible = notes.filter(
    (n) => !n.sections.every((s) => s.heading === "__screening_meta__")
  );

  function handleCopy(note: GeneratedNote) {
    const text = note.sections
      .filter((s) => s.heading !== "__screening_meta__")
      .map((s) => `${s.heading}\n${"─".repeat(s.heading.length)}\n${s.body}`)
      .join("\n\n");
    navigator.clipboard.writeText(`${note.title}\n\n${text}`);
  }

  function handlePrint(note: GeneratedNote) {
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(
      `<html><head><title>${esc(note.title)}</title><style>` +
      `body{font-family:Arial,sans-serif;font-size:12pt;padding:1in}` +
      `h1{font-size:14pt;border-bottom:2px solid #000;padding-bottom:6px}` +
      `h2{font-size:11pt;text-transform:uppercase;letter-spacing:.05em;margin-top:20px;margin-bottom:4px;color:#555;font-weight:700}` +
      `p{white-space:pre-wrap;margin:0 0 8px 0;font-size:11pt}` +
      `</style></head><body>` +
      `<h1>${esc(note.title)}</h1>` +
      note.sections
        .filter((s) => s.heading !== "__screening_meta__")
        .map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>`)
        .join("") +
      `</body></html>`
    );
    w.document.close();
    w.print();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <span className="font-semibold text-slate-800 text-sm">{title}</span>
          </div>
          <button
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            onClick={onClose}
            data-testid="button-close-notes-modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {visible.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm font-medium">No documents generated yet</p>
              <p className="text-slate-400 text-xs mt-1">
                Mark the appointment as Completed to auto-generate notes.
              </p>
            </div>
          ) : (
            visible.map((note) => (
              <Card
                key={note.id}
                className="overflow-hidden border border-slate-200"
                data-testid={`billing-doc-card-${note.id}`}
              >
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={`text-[10px] font-semibold ${DOC_KIND_COLORS[note.docKind] ?? "bg-slate-100 text-slate-600"}`}
                    >
                      {DOC_KIND_LABELS[note.docKind] ?? note.docKind}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-700">{note.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                      onClick={() => handleCopy(note)}
                      title="Copy"
                      data-testid={`button-copy-billing-doc-${note.id}`}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                      onClick={() => handlePrint(note)}
                      title="Print"
                      data-testid={`button-print-billing-doc-${note.id}`}
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {note.sections
                    .filter((s) => s.heading !== "__screening_meta__")
                    .map((section, si) => (
                      <div key={si}>
                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                          {section.heading}
                        </h4>
                        <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                          {section.body}
                        </p>
                      </div>
                    ))}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Add Row Modal ──────────────────────────────────────────────────────────

function AddRowModal({
  service,
  onClose,
  onAdd,
}: {
  service: ServiceTab;
  onClose: () => void;
  onAdd: (data: { patientName: string; dateOfService: string; facility: string; clinician: string }) => void;
}) {
  const [patientName, setPatientName] = useState("");
  const [dateOfService, setDateOfService] = useState("");
  const [facility, setFacility] = useState("");
  const [clinician, setClinician] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!patientName.trim()) return;
    onAdd({ patientName: patientName.trim(), dateOfService, facility, clinician });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <span className="font-semibold text-slate-800 text-sm">Add {service} Row</span>
          <button
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Patient Name *</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Full name"
              autoFocus
              data-testid="input-add-row-patient-name"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Date of Service</label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={dateOfService}
              onChange={(e) => setDateOfService(e.target.value)}
              data-testid="input-add-row-date"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Facility</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={facility}
              onChange={(e) => setFacility(e.target.value)}
              data-testid="select-add-row-facility"
            >
              <option value="">— select —</option>
              {FACILITIES.filter((f) => f !== "All Facilities").map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Clinician</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={clinician}
              onChange={(e) => setClinician(e.target.value)}
              placeholder="Clinician name"
              data-testid="input-add-row-clinician"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="flex-1" disabled={!patientName.trim()} data-testid="button-add-row-submit">
              Add Row
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Editable cell ───────────────────────────────────────────────────────────

function EditableCell({
  value,
  recordId,
  field,
  onSave,
  placeholder,
}: {
  value: string | null;
  recordId: number;
  field: TextField;
  onSave: (id: number, field: TextField, value: string | null) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(value ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value ?? "")) {
      // patientName must never be set to null/empty
      if (field === "patientName" && !trimmed) return;
      onSave(recordId, field, trimmed || null);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-full px-1.5 py-0.5 text-xs border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white min-w-[80px]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        data-testid={`input-billing-${field}-${recordId}`}
      />
    );
  }

  return (
    <div
      className="px-1.5 py-0.5 text-xs text-slate-700 cursor-pointer hover:bg-blue-50 rounded min-w-[80px] min-h-[22px] whitespace-nowrap overflow-hidden text-ellipsis"
      onClick={startEdit}
      title={value ?? placeholder ?? "Click to edit"}
      data-testid={`cell-billing-${field}-${recordId}`}
    >
      {value ? (
        field === "dateOfService" ? formatDate(value) : value
      ) : (
        <span className="text-slate-300 italic">{placeholder ?? "—"}</span>
      )}
    </div>
  );
}

// ─── Checkbox cell ───────────────────────────────────────────────────────────

function CheckboxCell({
  value,
  recordId,
  field,
  onSave,
}: {
  value: boolean | null;
  recordId: number;
  field: BoolField;
  onSave: (id: number, field: BoolField, value: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      className="w-3.5 h-3.5 cursor-pointer accent-blue-600"
      checked={value === true}
      onChange={(e) => onSave(recordId, field, e.target.checked)}
      data-testid={`checkbox-billing-${field}-${recordId}`}
    />
  );
}

// ─── Column definition ───────────────────────────────────────────────────────

type ColDef = {
  key: string;
  label: string;
  width: number;
  type: "text" | "bool" | "doc" | "date";
  field?: TextField;
  boolField?: BoolField;
};

const COLUMNS: ColDef[] = [
  { key: "dateOfService", label: "Date of Service", width: 110, type: "text", field: "dateOfService" },
  { key: "patientName", label: "Patient", width: 130, type: "text", field: "patientName" },
  { key: "screeningForm", label: "Screening Form", width: 110, type: "doc" },
  { key: "clinician", label: "Clinician", width: 110, type: "text", field: "clinician" },
  { key: "preProcedureOrder", label: "Preprocedure Order Note", width: 140, type: "doc" },
  { key: "report", label: "Report", width: 100, type: "text", field: "report" },
  { key: "procedureNote", label: "Procedure Note", width: 120, type: "doc" },
  { key: "billingDocument", label: "Billing Document", width: 120, type: "doc" },
  { key: "insuranceInfo", label: "Insurance Info", width: 110, type: "text", field: "insuranceInfo" },
  { key: "historicalProblemList", label: "Historical Problem List", width: 140, type: "text", field: "historicalProblemList" },
  { key: "comments", label: "Comments", width: 110, type: "text", field: "comments" },
  { key: "billing", label: "Billing", width: 90, type: "text", field: "billing" },
  { key: "nextAncillaries", label: "Next ancillaries", width: 120, type: "text", field: "nextAncillaries" },
  { key: "billingComments", label: "Billing Comments", width: 120, type: "text", field: "billingComments" },
  { key: "paid", label: "paid", width: 60, type: "bool", boolField: "paid" },
  { key: "ptResponsibility", label: "pt responsibility", width: 110, type: "text", field: "ptResponsibility" },
  { key: "billingComments2", label: "Billing Comments", width: 120, type: "text", field: "billingComments2" },
  { key: "nextgenAppt", label: "NextGen Appt.", width: 110, type: "text", field: "nextgenAppt" },
  { key: "billed", label: "Billed", width: 60, type: "bool", boolField: "billed" },
  { key: "drImranComments", label: "Dr Imran Comments", width: 140, type: "text", field: "drImranComments" },
  { key: "response", label: "Response", width: 100, type: "text", field: "response" },
  { key: "nwpgInvoiceSent", label: "NWPG Invoice Sent?", width: 130, type: "bool", boolField: "nwpgInvoiceSent" },
  { key: "paidFinal", label: "PAID?", width: 60, type: "bool", boolField: "paidFinal" },
];

// ─── Main page ───────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ServiceTab>("BrainWave");
  const [facility, setFacility] = useState("All Facilities");
  const [docModal, setDocModal] = useState<{ notes: GeneratedNote[]; title: string } | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);

  const { data: records = [], isLoading } = useQuery<BillingRecord[]>({
    queryKey: ["/api/billing-records"],
  });

  const { data: allNotes = [] } = useQuery<GeneratedNote[]>({
    queryKey: ["/api/generated-notes"],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Record<string, string | boolean | null> }) =>
      apiRequest("PATCH", `/api/billing-records/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing-records"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      apiRequest("POST", "/api/billing-records", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing-records"] });
      toast({ title: "Row added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add row", description: err.message, variant: "destructive" });
    },
  });

  function handleTextSave(id: number, field: TextField, value: string | null) {
    updateMutation.mutate({ id, updates: { [field]: value } });
  }

  function handleBoolSave(id: number, field: BoolField, value: boolean) {
    updateMutation.mutate({ id, updates: { [field]: value } });
  }

  function handleAddRow(data: { patientName: string; dateOfService: string; facility: string; clinician: string }) {
    const svc = activeTab === "Ultrasounds" ? "Ultrasound" : activeTab;
    createMutation.mutate({
      service: svc,
      patientName: data.patientName,
      dateOfService: data.dateOfService || null,
      facility: data.facility || null,
      clinician: data.clinician || null,
    });
  }

  const serviceKey = activeTab === "Ultrasounds" ? "Ultrasound" : activeTab;

  const filtered = records.filter((r) => {
    const matchService = r.service === serviceKey;
    const matchFacility = facility === "All Facilities" || r.facility === facility;
    return matchService && matchFacility;
  });

  function openDocModal(record: BillingRecord) {
    if (record.patientId === null) {
      setDocModal({ notes: [], title: `${record.patientName} — ${record.service}` });
      return;
    }
    const svc = record.service;
    const notesForPatient = allNotes.filter(
      (n) => n.patientId === record.patientId && n.service === svc
    );
    setDocModal({
      notes: notesForPatient,
      title: `${record.patientName} — ${record.service}`,
    });
  }

  function hasNotes(record: BillingRecord): boolean {
    if (record.patientId === null) return false;
    return allNotes.some((n) => n.patientId === record.patientId && n.service === record.service);
  }

  function DocButton({ record }: { record: BillingRecord }) {
    const has = hasNotes(record);
    return (
      <button
        className={`text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
          has
            ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
            : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
        }`}
        onClick={() => openDocModal(record)}
        data-testid={`button-doc-${record.id}`}
      >
        {has ? "View" : "None"}
      </button>
    );
  }

  return (
    <main className="flex-1 overflow-hidden flex flex-col bg-[hsl(210,35%,96%)]" data-testid="billing-page">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-slate-600 hover:text-slate-900"
              data-testid="button-back-home"
            >
              <ArrowLeft className="w-4 h-4" />
              Home
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <DollarSign className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-slate-900" data-testid="text-billing-title">
                Billing
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">Track billing status for screened patients</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={facility}
              onChange={(e) => setFacility(e.target.value)}
              data-testid="select-billing-facility"
            >
              {FACILITIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Service tabs + Add Row button */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1">
            {SERVICES.map((s) => {
              const sKey = s === "Ultrasounds" ? "Ultrasound" : s;
              const count = records.filter(
                (r) => r.service === sKey && (facility === "All Facilities" || r.facility === facility)
              ).length;
              return (
                <button
                  key={s}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === s
                      ? s === "BrainWave"
                        ? "bg-purple-100 text-purple-800"
                        : s === "VitalWave"
                        ? "bg-red-100 text-red-800"
                        : "bg-emerald-100 text-emerald-800"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  onClick={() => setActiveTab(s)}
                  data-testid={`tab-billing-${s.toLowerCase()}`}
                >
                  {s}
                  <span
                    className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                      activeTab === s ? "bg-white/60" : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={() => setShowAddRow(true)}
            data-testid="button-add-billing-row"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Row
          </Button>
        </div>
      </div>

      {/* Spreadsheet */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <DollarSign className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">No {activeTab} records yet</p>
            <p className="text-sm text-slate-400 mt-1">
              Complete a schedule with {activeTab === "Ultrasounds" ? "ultrasound studies" : activeTab}{" "}
              to auto-populate billing rows, or click Add Row to enter one manually.
            </p>
          </div>
        ) : (
          <div className="min-w-max">
            <table className="border-collapse text-xs" data-testid="billing-table">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 sticky top-0 z-10">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide border-r border-slate-200 whitespace-nowrap last:border-r-0"
                      style={{ minWidth: col.width, maxWidth: col.width + 40 }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((record, ri) => (
                  <tr
                    key={record.id}
                    className={`border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${
                      ri % 2 === 0 ? "bg-white" : "bg-slate-50/30"
                    }`}
                    data-testid={`billing-row-${record.id}`}
                  >
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className="px-2 py-1.5 border-r border-slate-100 last:border-r-0 align-middle"
                        style={{ minWidth: col.width, maxWidth: col.width + 40 }}
                      >
                        {col.type === "text" && col.field ? (
                          <EditableCell
                            value={record[col.field] as string | null}
                            recordId={record.id}
                            field={col.field}
                            onSave={handleTextSave}
                          />
                        ) : col.type === "bool" && col.boolField ? (
                          <div className="flex justify-center">
                            <CheckboxCell
                              value={record[col.boolField] as boolean | null}
                              recordId={record.id}
                              field={col.boolField}
                              onSave={handleBoolSave}
                            />
                          </div>
                        ) : col.type === "doc" ? (
                          <DocButton record={record} />
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Document modal — always shows all docs for the patient+service trio */}
      {docModal && (
        <NotesModal
          notes={docModal.notes}
          title={docModal.title}
          onClose={() => setDocModal(null)}
        />
      )}

      {/* Add Row modal */}
      {showAddRow && (
        <AddRowModal
          service={activeTab}
          onClose={() => setShowAddRow(false)}
          onAdd={handleAddRow}
        />
      )}
    </main>
  );
}
