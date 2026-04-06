import { useState, useRef, useEffect } from "react";
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
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { SiGooglesheets, SiGoogledrive } from "react-icons/si";

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
  insuranceInfo: string | null;
  documentationStatus: string | null;
  billingStatus: string | null;
  response: string | null;
  paidStatus: string | null;
  balanceRemaining: string | null;
  dateSubmitted: string | null;
  followUpDate: string | null;
  datePaid: string | null;
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
  driveFileId: string | null;
  driveWebViewLink: string | null;
};

// ─── Constants ─────────────────────────────────────────────────────────────

const SERVICES = ["BrainWave", "VitalWave", "Ultrasounds"] as const;
type ServiceTab = (typeof SERVICES)[number];

const FACILITIES = ["All Facilities", "Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"];

const DOC_STATUS_OPTIONS = ["Preprocedure Order Note", "Billing Document", "HX, Rx, Dx"];
const BILLING_STATUS_OPTIONS = ["Not Started", "Ready to Bill", "Submitted", "Pending", "Rejected", "Denied", "Paid"];
const RESPONSE_OPTIONS = ["Pending", "Accepted", "Rejected", "Denied"];
const PAID_STATUS_OPTIONS = ["Unpaid", "Partial", "Paid"];

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

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return dateStr;
  const [yyyy, mm, dd] = parts;
  return new Date(yyyy, mm - 1, dd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function calcDaysInAR(dateSubmitted: string | null, datePaid: string | null): number | null {
  if (!dateSubmitted) return null;
  const start = new Date(dateSubmitted);
  if (isNaN(start.getTime())) return null;
  const end = datePaid ? new Date(datePaid) : new Date();
  if (isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function daysInARColor(days: number | null): string {
  if (days === null) return "text-slate-400";
  if (days < 30) return "text-emerald-700 font-semibold";
  if (days < 90) return "text-amber-600 font-semibold";
  return "text-red-600 font-bold";
}

function rowAccentClass(record: BillingRecord): string {
  const bs = record.billingStatus ?? "";
  const ps = record.paidStatus ?? "";
  const days = calcDaysInAR(record.dateSubmitted, record.datePaid);
  if (bs === "Denied" || bs === "Rejected") return "bg-red-50/60";
  if (ps === "Paid" || bs === "Paid") return "bg-emerald-50/50";
  if (bs === "Pending" || record.response === "Pending") return "bg-amber-50/40";
  if (days !== null && days >= 90) return "bg-red-50/40";
  return "";
}

function statusBadgeClass(value: string | null): string {
  if (!value) return "bg-slate-100 text-slate-500";
  const v = value.toLowerCase();
  if (v === "paid" || v === "accepted") return "bg-emerald-100 text-emerald-800";
  if (v === "denied" || v === "rejected") return "bg-red-100 text-red-800";
  if (v === "pending" || v === "submitted") return "bg-amber-100 text-amber-800";
  if (v === "partial") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-600";
}

// ─── Cell components ────────────────────────────────────────────────────────

type SaveFn = (id: number, field: keyof BillingRecord, value: string | null) => void;

function EditableCell({ value, recordId, field, onSave, placeholder }: {
  value: string | null;
  recordId: number;
  field: keyof BillingRecord;
  onSave: SaveFn;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() { setDraft(value ?? ""); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value ?? "")) {
      if (field === "patientName" && !trimmed) return;
      onSave(recordId, field, trimmed || null);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-full px-1.5 py-0.5 text-xs border border-blue-400 rounded focus:outline-none bg-white"
        style={{ minWidth: 80 }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        data-testid={`input-billing-${String(field)}-${recordId}`}
      />
    );
  }
  return (
    <div
      className="px-1.5 py-0.5 text-xs text-slate-700 cursor-pointer hover:bg-blue-50 rounded min-h-[22px] whitespace-nowrap overflow-hidden text-ellipsis"
      style={{ minWidth: 80 }}
      onClick={startEdit}
      title={value ?? placeholder ?? "Click to edit"}
      data-testid={`cell-billing-${String(field)}-${recordId}`}
    >
      {value ? value : <span className="text-slate-300 italic">{placeholder ?? "—"}</span>}
    </div>
  );
}

function DateCell({ value, recordId, field, onSave }: {
  value: string | null;
  recordId: number;
  field: keyof BillingRecord;
  onSave: SaveFn;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(v: string) {
    setEditing(false);
    const newVal = v || null;
    if (newVal !== value) onSave(recordId, field, newVal);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        className="px-1 py-0.5 text-xs border border-blue-400 rounded focus:outline-none bg-white"
        defaultValue={value ?? ""}
        onBlur={(e) => commit(e.target.value)}
        onChange={(e) => { if (e.target.value) commit(e.target.value); }}
        autoFocus
        data-testid={`input-billing-date-${String(field)}-${recordId}`}
      />
    );
  }
  return (
    <div
      className="px-1.5 py-0.5 text-xs text-slate-700 cursor-pointer hover:bg-blue-50 rounded min-h-[22px] whitespace-nowrap"
      onClick={() => setEditing(true)}
      data-testid={`cell-billing-date-${String(field)}-${recordId}`}
    >
      {value ? formatDate(value) : <span className="text-slate-300 italic">— pick date</span>}
    </div>
  );
}

function NumericCell({ value, recordId, field, onSave }: {
  value: string | null;
  recordId: number;
  field: keyof BillingRecord;
  onSave: SaveFn;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const newVal = trimmed ? trimmed : null;
    if (newVal !== value) onSave(recordId, field, newVal);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="0.01"
        min="0"
        className="w-full px-1.5 py-0.5 text-xs border border-blue-400 rounded focus:outline-none bg-white"
        style={{ minWidth: 70 }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        autoFocus
        data-testid={`input-billing-balance-${recordId}`}
      />
    );
  }
  return (
    <div
      className="px-1.5 py-0.5 text-xs text-slate-700 cursor-pointer hover:bg-blue-50 rounded min-h-[22px] whitespace-nowrap"
      style={{ minWidth: 70 }}
      onClick={() => { setDraft(value ?? ""); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
      data-testid={`cell-billing-balance-${recordId}`}
    >
      {value ? `$${parseFloat(value).toFixed(2)}` : <span className="text-slate-300 italic">$0.00</span>}
    </div>
  );
}

function DropdownCell({ value, recordId, field, options, onSave }: {
  value: string | null;
  recordId: number;
  field: keyof BillingRecord;
  options: string[];
  onSave: SaveFn;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function select(opt: string) {
    setOpen(false);
    if (opt !== value) onSave(recordId, field, opt);
  }

  const display = value ?? "—";

  return (
    <div ref={ref} className="relative" data-testid={`dropdown-billing-${String(field)}-${recordId}`}>
      <button
        className={`text-[10px] px-2 py-0.5 rounded border font-medium whitespace-nowrap transition-colors hover:opacity-80 ${statusBadgeClass(value)}`}
        onClick={() => setOpen((o) => !o)}
        data-testid={`button-dropdown-${String(field)}-${recordId}`}
      >
        {display}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-0.5 z-30 bg-white border border-slate-200 rounded-lg shadow-xl min-w-[140px] py-1 overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt}
              className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-slate-50 transition-colors ${opt === value ? "font-semibold" : ""}`}
              onClick={() => select(opt)}
              data-testid={`option-${String(field)}-${opt.replace(/\s+/g, "-").toLowerCase()}-${recordId}`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Document modal ─────────────────────────────────────────────────────────

function NotesModal({
  notes,
  title,
  onClose,
  onExportToDrive,
  exportingNoteIds,
}: {
  notes: GeneratedNote[];
  title: string;
  onClose: () => void;
  onExportToDrive?: (noteId: number) => void;
  exportingNoteIds?: Set<number>;
}) {
  const visible = notes.filter((n) => !n.sections.every((s) => s.heading === "__screening_meta__"));

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
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(
      `<html><head><title>${esc(note.title)}</title><style>` +
      `body{font-family:Arial,sans-serif;font-size:12pt;padding:1in}` +
      `h1{font-size:14pt;border-bottom:2px solid #000;padding-bottom:6px}` +
      `h2{font-size:11pt;text-transform:uppercase;letter-spacing:.05em;margin-top:20px;margin-bottom:4px;color:#555;font-weight:700}` +
      `p{white-space:pre-wrap;margin:0 0 8px 0;font-size:11pt}` +
      `</style></head><body>` +
      `<h1>${esc(note.title)}</h1>` +
      note.sections.filter((s) => s.heading !== "__screening_meta__")
        .map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>`)
        .join("") +
      `</body></html>`
    );
    w.document.close();
    w.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <span className="font-semibold text-slate-800 text-sm">{title}</span>
          </div>
          <button className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" onClick={onClose} data-testid="button-close-notes-modal">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {visible.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm font-medium">No documents generated yet</p>
              <p className="text-slate-400 text-xs mt-1">Mark the appointment as Completed to auto-generate notes.</p>
            </div>
          ) : (
            visible.map((note) => (
              <Card key={note.id} className="overflow-hidden border border-slate-200" data-testid={`billing-doc-card-${note.id}`}>
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] font-semibold ${DOC_KIND_COLORS[note.docKind] ?? "bg-slate-100 text-slate-600"}`}>
                      {DOC_KIND_LABELS[note.docKind] ?? note.docKind}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-700">{note.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {note.driveWebViewLink ? (
                      <a href={note.driveWebViewLink} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 flex items-center gap-1"
                        data-testid={`link-drive-billing-${note.id}`}>
                        <ExternalLink className="w-3 h-3" />Drive
                      </a>
                    ) : onExportToDrive ? (
                      <button
                        className="text-[10px] text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 flex items-center gap-1"
                        onClick={() => onExportToDrive(note.id)}
                        disabled={exportingNoteIds?.has(note.id)}
                        data-testid={`button-save-drive-billing-${note.id}`}>
                        {exportingNoteIds?.has(note.id) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <SiGoogledrive className="w-3 h-3" />}
                        Save to Drive
                      </button>
                    ) : null}
                    <button className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors" onClick={() => handleCopy(note)} title="Copy" data-testid={`button-copy-billing-doc-${note.id}`}>
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors" onClick={() => handlePrint(note)} title="Print" data-testid={`button-print-billing-doc-${note.id}`}>
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {note.sections.filter((s) => s.heading !== "__screening_meta__").map((section, si) => (
                    <div key={si}>
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{section.heading}</h4>
                      <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{section.body}</p>
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

function AddRowModal({ service, onClose, onAdd }: {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <span className="font-semibold text-slate-800 text-sm">Add {service} Row</span>
          <button className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Patient Name *</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Full name" autoFocus data-testid="input-add-row-patient-name" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Date of Service</label>
            <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={dateOfService} onChange={(e) => setDateOfService(e.target.value)} data-testid="input-add-row-date" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Facility</label>
            <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={facility} onChange={(e) => setFacility(e.target.value)} data-testid="select-add-row-facility">
              <option value="">— select —</option>
              {FACILITIES.filter((f) => f !== "All Facilities").map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Clinician</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={clinician} onChange={(e) => setClinician(e.target.value)} placeholder="Clinician name" data-testid="input-add-row-clinician" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" className="flex-1" disabled={!patientName.trim()} data-testid="button-add-row-submit">Add Row</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ServiceTab>("BrainWave");
  const [facility, setFacility] = useState("All Facilities");
  const [docModal, setDocModal] = useState<{ notes: GeneratedNote[]; title: string } | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [billingSyncedAt, setBillingSyncedAt] = useState<string | null>(null);
  const [billingSheetUrl, setBillingSheetUrl] = useState<string | null>(null);
  const [exportingNoteIds, setExportingNoteIds] = useState<Set<number>>(new Set());

  const { data: records = [], isLoading } = useQuery<BillingRecord[]>({ queryKey: ["/api/billing-records"] });
  const { data: allNotes = [] } = useQuery<GeneratedNote[]>({ queryKey: ["/api/generated-notes"] });

  const { data: googleStatus } = useQuery<{
    sheets: { connected: boolean; lastSyncedBilling: string | null; billingSpreadsheetUrl: string | null };
  }>({ queryKey: ["/api/google/status"], refetchInterval: 30000 });

  useEffect(() => {
    if (!googleStatus?.sheets) return;
    setBillingSyncedAt(googleStatus.sheets.lastSyncedBilling ?? null);
    setBillingSheetUrl(googleStatus.sheets.billingSpreadsheetUrl ?? null);
  }, [googleStatus]);

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Record<string, string | null> }) =>
      apiRequest("PATCH", `/api/billing-records/${id}`, updates),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/billing-records"] }); },
    onError: (err: Error) => { toast({ title: "Save failed", description: err.message, variant: "destructive" }); },
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, string | null>) => apiRequest("POST", "/api/billing-records", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/billing-records"] }); toast({ title: "Row added" }); },
    onError: (err: Error) => { toast({ title: "Failed to add row", description: err.message, variant: "destructive" }); },
  });

  const exportNoteMutation = useMutation({
    mutationFn: async (noteId: number) => {
      setExportingNoteIds((prev) => new Set(prev).add(noteId));
      const res = await apiRequest("POST", "/api/google/drive/export-note", { noteId });
      return res.json();
    },
    onSuccess: (data) => {
      setExportingNoteIds((prev) => { const s = new Set(prev); s.delete(data.note?.id); return s; });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
      toast({ title: "Saved to Google Drive" });
    },
    onError: (err: Error, noteId) => {
      setExportingNoteIds((prev) => { const s = new Set(prev); s.delete(noteId); return s; });
      toast({ title: "Drive export failed", description: err.message, variant: "destructive" });
    },
  });

  const syncBillingMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", "/api/google/sync/billing"); return res.json(); },
    onSuccess: (data) => {
      if (data.syncedAt) {
        setBillingSyncedAt(data.syncedAt);
        if (data.spreadsheetUrl) setBillingSheetUrl(data.spreadsheetUrl);
        toast({ title: "Synced to Google Sheets", description: `${data.recordCount} records pushed` });
      } else {
        toast({ title: "Sync queued" });
      }
    },
    onError: (err: Error) => { toast({ title: "Sync failed", description: err.message, variant: "destructive" }); },
  });

  function handleSave(id: number, field: keyof BillingRecord, value: string | null) {
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
  const filtered = records.filter((r) => r.service === serviceKey && (facility === "All Facilities" || r.facility === facility));

  function openDocModal(record: BillingRecord) {
    if (record.patientId === null) { setDocModal({ notes: [], title: `${record.patientName} — ${record.service}` }); return; }
    const notesForPatient = allNotes.filter((n) => n.patientId === record.patientId && n.service === record.service);
    setDocModal({ notes: notesForPatient, title: `${record.patientName} — ${record.service}` });
  }

  function hasNotes(record: BillingRecord) {
    if (record.patientId === null) return false;
    return allNotes.some((n) => n.patientId === record.patientId && n.service === record.service);
  }

  return (
    <main className="flex-1 overflow-hidden flex flex-col bg-[hsl(210,35%,96%)]" data-testid="billing-page">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-1.5 text-slate-600 hover:text-slate-900" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4" />Home
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <DollarSign className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-slate-900" data-testid="text-billing-title">Billing</h1>
              <p className="text-xs text-slate-500 mt-0.5">Track billing status for screened patients</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => syncBillingMutation.mutate()} disabled={syncBillingMutation.isPending}
                className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50" data-testid="button-sync-billing-sheets">
                {syncBillingMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <SiGooglesheets className="w-3.5 h-3.5" />}
                Sync to Sheets
              </Button>
              {billingSyncedAt && (
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  Synced {new Date(billingSyncedAt).toLocaleTimeString()}
                  {billingSheetUrl && (
                    <a href={billingSheetUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-emerald-600 hover:underline inline-flex items-center gap-0.5">
                      <ExternalLink className="w-2.5 h-2.5" />Open
                    </a>
                  )}
                </span>
              )}
            </div>
            <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
            <select className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={facility} onChange={(e) => setFacility(e.target.value)} data-testid="select-billing-facility">
              {FACILITIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        {/* Service tabs + Add Row */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1">
            {SERVICES.map((s) => {
              const sKey = s === "Ultrasounds" ? "Ultrasound" : s;
              const count = records.filter((r) => r.service === sKey && (facility === "All Facilities" || r.facility === facility)).length;
              return (
                <button key={s}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === s
                    ? s === "BrainWave" ? "bg-purple-100 text-purple-800"
                    : s === "VitalWave" ? "bg-red-100 text-red-800"
                    : "bg-emerald-100 text-emerald-800"
                    : "text-slate-600 hover:bg-slate-100"}`}
                  onClick={() => setActiveTab(s)} data-testid={`tab-billing-${s.toLowerCase()}`}>
                  {s}
                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${activeTab === s ? "bg-white/60" : "bg-slate-200 text-slate-500"}`}>{count}</span>
                </button>
              );
            })}
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={() => setShowAddRow(true)} data-testid="button-add-billing-row">
            <Plus className="w-3.5 h-3.5" />Add Row
          </Button>
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
              Complete a schedule with {activeTab === "Ultrasounds" ? "ultrasound studies" : activeTab} to auto-populate billing rows, or click Add Row to enter one manually.
            </p>
          </div>
        ) : (
          <div className="min-w-max">
            <table className="border-collapse text-xs" data-testid="billing-table">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 sticky top-0 z-10">
                  {[
                    { label: "Date of Service", w: 110 },
                    { label: "Patient Name", w: 130 },
                    { label: "Facility", w: 120 },
                    { label: "Clinician", w: 110 },
                    { label: "Service Type", w: 100 },
                    { label: "Insurance Info", w: 110 },
                    { label: "Documentation Status", w: 150 },
                    { label: "Billing Status", w: 120 },
                    { label: "Response", w: 100 },
                    { label: "Paid Status", w: 100 },
                    { label: "Balance Remaining", w: 120 },
                    { label: "Days in AR", w: 80 },
                    { label: "Date Submitted", w: 120 },
                    { label: "Follow-Up Date", w: 120 },
                    { label: "Docs", w: 60 },
                  ].map((col) => (
                    <th key={col.label}
                      className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide border-r border-slate-200 whitespace-nowrap last:border-r-0 text-[10px]"
                      style={{ minWidth: col.w }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((record, ri) => {
                  const days = calcDaysInAR(record.dateSubmitted, record.datePaid);
                  const accent = rowAccentClass(record);
                  const base = ri % 2 === 0 ? "bg-white" : "bg-slate-50/30";
                  return (
                    <tr key={record.id}
                      className={`border-b border-slate-100 hover:brightness-95 transition-all ${accent || base}`}
                      data-testid={`billing-row-${record.id}`}>
                      {/* Date of Service */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <DateCell value={record.dateOfService} recordId={record.id} field="dateOfService" onSave={handleSave} />
                      </td>
                      {/* Patient Name */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <EditableCell value={record.patientName} recordId={record.id} field="patientName" onSave={handleSave} />
                      </td>
                      {/* Facility */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <EditableCell value={record.facility} recordId={record.id} field="facility" onSave={handleSave} />
                      </td>
                      {/* Clinician */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <EditableCell value={record.clinician} recordId={record.id} field="clinician" onSave={handleSave} />
                      </td>
                      {/* Service Type — read only */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <span className="text-[10px] font-medium text-slate-600 whitespace-nowrap">{record.service}</span>
                      </td>
                      {/* Insurance Info */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <EditableCell value={record.insuranceInfo} recordId={record.id} field="insuranceInfo" onSave={handleSave} />
                      </td>
                      {/* Documentation Status */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.documentationStatus} recordId={record.id} field="documentationStatus" options={DOC_STATUS_OPTIONS} onSave={handleSave} />
                      </td>
                      {/* Billing Status */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.billingStatus} recordId={record.id} field="billingStatus" options={BILLING_STATUS_OPTIONS} onSave={handleSave} />
                      </td>
                      {/* Response */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.response} recordId={record.id} field="response" options={RESPONSE_OPTIONS} onSave={handleSave} />
                      </td>
                      {/* Paid Status */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.paidStatus} recordId={record.id} field="paidStatus" options={PAID_STATUS_OPTIONS} onSave={handleSave} />
                      </td>
                      {/* Balance Remaining */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <NumericCell value={record.balanceRemaining} recordId={record.id} field="balanceRemaining" onSave={handleSave} />
                      </td>
                      {/* Days in AR — computed */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle text-center" data-testid={`cell-billing-days-ar-${record.id}`}>
                        {days !== null ? (
                          <span className={`text-xs ${daysInARColor(days)}`}>{days}d</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      {/* Date Submitted */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <DateCell value={record.dateSubmitted} recordId={record.id} field="dateSubmitted" onSave={handleSave} />
                      </td>
                      {/* Follow-Up Date */}
                      <td className="px-2 py-1 border-r border-slate-100 align-middle">
                        <DateCell value={record.followUpDate} recordId={record.id} field="followUpDate" onSave={handleSave} />
                      </td>
                      {/* Docs button */}
                      <td className="px-2 py-1 align-middle">
                        <button
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
                            hasNotes(record)
                              ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                              : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
                          }`}
                          onClick={() => openDocModal(record)}
                          data-testid={`button-doc-${record.id}`}>
                          {hasNotes(record) ? "View" : "None"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Document modal */}
      {docModal && (
        <NotesModal notes={docModal.notes} title={docModal.title} onClose={() => setDocModal(null)}
          onExportToDrive={(noteId) => exportNoteMutation.mutate(noteId)} exportingNoteIds={exportingNoteIds} />
      )}

      {/* Add Row modal */}
      {showAddRow && (
        <AddRowModal service={activeTab} onClose={() => setShowAddRow(false)} onAdd={handleAddRow} />
      )}
    </main>
  );
}
