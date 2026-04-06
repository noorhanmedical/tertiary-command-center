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
} from "lucide-react";

type BillingRecord = {
  id: number;
  patientId: number;
  batchId: number;
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

const SERVICES = ["BrainWave", "VitalWave", "Ultrasounds"] as const;
type ServiceTab = (typeof SERVICES)[number];

const FACILITIES = ["All Facilities", "Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"];

const SERVICE_COLORS: Record<string, string> = {
  BrainWave: "bg-purple-100 text-purple-700 border-purple-200",
  VitalWave: "bg-red-100 text-red-700 border-red-200",
  Ultrasound: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const [yyyy, mm, dd] = dateStr.split("-").map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function NotesModal({
  notes,
  title,
  onClose,
}: {
  notes: GeneratedNote[];
  title: string;
  onClose: () => void;
}) {
  const visibleNotes = notes.filter((n) => !n.sections.every((s) => s.heading === "__screening_meta__"));

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
      `h2{font-size:12pt;text-transform:uppercase;letter-spacing:.05em;margin-top:20px;margin-bottom:4px;color:#555;font-weight:700}` +
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <span className="font-semibold text-slate-800">{title}</span>
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
          {visibleNotes.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No documents generated yet.</p>
              <p className="text-slate-400 text-xs mt-1">Mark the appointment as Completed to auto-generate notes.</p>
            </div>
          ) : (
            visibleNotes.map((note, i) => (
              <Card key={note.id} className="overflow-hidden border border-slate-200" data-testid={`billing-doc-card-${note.id}`}>
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] font-semibold ${DOC_KIND_COLORS[note.docKind] || "bg-slate-100 text-slate-600"}`}>
                      {DOC_KIND_LABELS[note.docKind] || note.docKind}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-700">{note.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                      onClick={() => handleCopy(note)}
                      data-testid={`button-copy-billing-doc-${note.id}`}
                      title="Copy"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                      onClick={() => handlePrint(note)}
                      data-testid={`button-print-billing-doc-${note.id}`}
                      title="Print"
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

type DocModalState = {
  patientId: number;
  patientName: string;
  service: string;
  filterKind?: string;
} | null;

function EditableCell({
  value,
  recordId,
  field,
  onSave,
  placeholder,
}: {
  value: string | null;
  recordId: number;
  field: string;
  onSave: (id: number, field: string, value: string | null) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(value || "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || "")) {
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
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        data-testid={`input-billing-${field}-${recordId}`}
      />
    );
  }

  return (
    <div
      className="px-1.5 py-0.5 text-xs text-slate-700 cursor-pointer hover:bg-blue-50 rounded min-w-[80px] min-h-[22px] whitespace-nowrap overflow-hidden text-ellipsis"
      onClick={startEdit}
      title={value || placeholder || "Click to edit"}
      data-testid={`cell-billing-${field}-${recordId}`}
    >
      {value || <span className="text-slate-300 italic">{placeholder || "—"}</span>}
    </div>
  );
}

function CheckboxCell({
  value,
  recordId,
  field,
  onSave,
}: {
  value: boolean | null;
  recordId: number;
  field: string;
  onSave: (id: number, field: string, value: boolean) => void;
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

export default function BillingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ServiceTab>("BrainWave");
  const [facility, setFacility] = useState("All Facilities");
  const [docModal, setDocModal] = useState<DocModalState>(null);

  const { data: records = [], isLoading } = useQuery<BillingRecord[]>({
    queryKey: ["/api/billing-records"],
  });

  const { data: allNotes = [] } = useQuery<GeneratedNote[]>({
    queryKey: ["/api/generated-notes"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Record<string, any> }) => {
      return apiRequest("PATCH", `/api/billing-records/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing-records"] });
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  function handleTextSave(id: number, field: string, value: string | null) {
    updateMutation.mutate({ id, updates: { [field]: value } });
  }

  function handleBoolSave(id: number, field: string, value: boolean) {
    updateMutation.mutate({ id, updates: { [field]: value } });
  }

  const serviceKey = activeTab === "Ultrasounds" ? "Ultrasound" : activeTab;

  const filtered = records.filter((r) => {
    const matchService = r.service === serviceKey;
    const matchFacility = facility === "All Facilities" || r.facility === facility;
    return matchService && matchFacility;
  });

  const modalNotes = docModal
    ? allNotes.filter(
        (n) =>
          n.patientId === docModal.patientId &&
          n.service === docModal.service &&
          (!docModal.filterKind || n.docKind === docModal.filterKind)
      )
    : [];

  const facilityOptions = FACILITIES;

  const columns = [
    { key: "dateOfService", label: "Date of Service", width: 110, type: "readonly" },
    { key: "patientName", label: "Patient", width: 130, type: "readonly" },
    { key: "screeningForm", label: "Screening Form", width: 110, type: "doc-all" },
    { key: "clinician", label: "Clinician", width: 110, type: "readonly" },
    { key: "preProcedureOrder", label: "Preprocedure Order Note", width: 140, type: "doc-pre" },
    { key: "report", label: "Report", width: 100, type: "text" },
    { key: "procedureNote", label: "Procedure Note", width: 120, type: "doc-post" },
    { key: "billingDocument", label: "Billing Document", width: 120, type: "doc-billing" },
    { key: "insuranceInfo", label: "Insurance Info", width: 110, type: "text" },
    { key: "historicalProblemList", label: "Historical Problem List", width: 140, type: "text" },
    { key: "comments", label: "Comments", width: 110, type: "text" },
    { key: "billing", label: "Billing", width: 90, type: "text" },
    { key: "nextAncillaries", label: "Next ancillaries", width: 120, type: "text" },
    { key: "billingComments", label: "Billing Comments", width: 120, type: "text" },
    { key: "paid", label: "paid", width: 60, type: "bool" },
    { key: "ptResponsibility", label: "pt responsibility", width: 110, type: "text" },
    { key: "billingComments2", label: "Billing Comments", width: 120, type: "text" },
    { key: "nextgenAppt", label: "NextGen Appt.", width: 110, type: "text" },
    { key: "billed", label: "Billed", width: 60, type: "bool" },
    { key: "drImranComments", label: "Dr Imran Comments", width: 140, type: "text" },
    { key: "response", label: "Response", width: 100, type: "text" },
    { key: "nwpgInvoiceSent", label: "NWPG Invoice Sent?", width: 130, type: "bool" },
    { key: "paidFinal", label: "PAID?", width: 60, type: "bool" },
  ] as const;

  function openDocModal(record: BillingRecord, filterKind?: string) {
    const modalService =
      record.service === "Ultrasound" ? "Ultrasound" :
      record.service === "BrainWave" ? "BrainWave" :
      "VitalWave";
    setDocModal({
      patientId: record.patientId,
      patientName: record.patientName,
      service: modalService,
      filterKind,
    });
  }

  function docButtonLabel(record: BillingRecord, kind?: string) {
    const notesForPatient = allNotes.filter(
      (n) => n.patientId === record.patientId &&
        n.service === (record.service === "Ultrasound" ? "Ultrasound" : record.service) &&
        (!kind || n.docKind === kind)
    );
    const hasNotes = notesForPatient.length > 0;
    return (
      <button
        className={`text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
          hasNotes
            ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
            : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
        }`}
        onClick={() => openDocModal(record, kind)}
        title={hasNotes ? "View document" : "No document generated yet"}
      >
        {hasNotes ? "View" : "None"}
      </button>
    );
  }

  return (
    <main className="flex-1 overflow-hidden flex flex-col bg-[hsl(210,35%,96%)]" data-testid="billing-page">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-1.5 text-slate-600 hover:text-slate-900" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4" />
              Home
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <DollarSign className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-slate-900" data-testid="text-billing-title">Billing</h1>
              <p className="text-xs text-slate-500 mt-0.5">Track billing status for screened patients</p>
            </div>
          </div>
          {/* Facility filter */}
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={facility}
              onChange={(e) => setFacility(e.target.value)}
              data-testid="select-billing-facility"
            >
              {facilityOptions.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
        {/* Service tabs */}
        <div className="flex items-center gap-1 mt-4">
          {SERVICES.map((s) => {
            const sKey = s === "Ultrasounds" ? "Ultrasound" : s;
            const count = records.filter((r) => r.service === sKey && (facility === "All Facilities" || r.facility === facility)).length;
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
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === s ? "bg-white/60" : "bg-slate-200 text-slate-500"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Spreadsheet */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <DollarSign className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">No {activeTab} records yet</p>
            <p className="text-sm text-slate-400 mt-1">
              Complete a schedule with {activeTab === "Ultrasounds" ? "ultrasound studies" : activeTab} to populate billing rows.
            </p>
          </div>
        ) : (
          <div className="min-w-max">
            <table className="border-collapse text-xs" data-testid="billing-table">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 sticky top-0 z-10">
                  {columns.map((col) => (
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
                    className={`border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${ri % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}
                    data-testid={`billing-row-${record.id}`}
                  >
                    {columns.map((col) => {
                      const key = col.key as string;
                      return (
                        <td
                          key={key}
                          className="px-2 py-1.5 border-r border-slate-100 last:border-r-0 align-middle"
                          style={{ minWidth: col.width, maxWidth: col.width + 40 }}
                        >
                          {col.type === "readonly" ? (
                            <span className="text-xs text-slate-700 whitespace-nowrap">
                              {key === "dateOfService" ? formatDate(record.dateOfService) : (record as any)[key] || ""}
                            </span>
                          ) : col.type === "bool" ? (
                            <div className="flex justify-center">
                              <CheckboxCell
                                value={(record as any)[key]}
                                recordId={record.id}
                                field={key}
                                onSave={handleBoolSave}
                              />
                            </div>
                          ) : col.type === "text" ? (
                            <EditableCell
                              value={(record as any)[key]}
                              recordId={record.id}
                              field={key}
                              onSave={handleTextSave}
                            />
                          ) : col.type === "doc-all" ? (
                            docButtonLabel(record)
                          ) : col.type === "doc-pre" ? (
                            docButtonLabel(record, "preProcedureOrder")
                          ) : col.type === "doc-post" ? (
                            docButtonLabel(record, "postProcedureNote")
                          ) : col.type === "doc-billing" ? (
                            docButtonLabel(record, "billing")
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Document modal */}
      {docModal && (
        <NotesModal
          notes={modalNotes}
          title={`${docModal.patientName} — ${docModal.service}`}
          onClose={() => setDocModal(null)}
        />
      )}
    </main>
  );
}
