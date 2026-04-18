import { useState, useRef, useEffect, useMemo, type CSSProperties } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  DollarSign,
  Copy,
  Printer,
  X,
  FileText,
  Plus,
  RefreshCw,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Check,
  Building2,
  User,
  Scan,
  Brain,
  Activity,
  Shield,
  ClipboardList,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Banknote,
  CircleDot,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Receipt,
  Wallet,
  Timer,
  Download,
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
  paidAmount: string | null;
  totalCharges: string | null;
  allowedAmount: string | null;
  patientResponsibility: string | null;
  adjustmentAmount: string | null;
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

const FACILITY_OPTIONS = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"];

const SERVICE_TYPE_OPTIONS = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex",
  "Echocardiogram TTE",
  "Renal Artery Doppler",
  "Lower Extremity Arterial Doppler",
  "Abdominal Aortic Aneurysm Duplex",
  "Lower Extremity Venous Duplex",
  "Stress Echocardiogram",
  "Upper Extremity Arterial Doppler",
  "Upper Extremity Venous Duplex",
];

const PRIMARY_INSURANCE_OPTIONS = ["Medicare", "Medicare Advantage", "PPO", "HMO", "Medicaid", "Self Pay"];
const DOC_STATUS_OPTIONS = ["Not Started", "Preprocedure Order Note", "Post-Procedure Note", "Billing Document", "Complete"];
const CLAIM_STATUS_OPTIONS = ["Not Billed", "Submitted", "Accepted", "Pending", "Denied", "Rejected"];
const PAYER_STATUS_OPTIONS = ["Pending", "Accepted", "Denied", "Rejected", "Paid In Full", "Partial Payment"];
const PAYMENT_STATUS_OPTIONS = ["Unpaid", "Partial", "Paid"];

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

// ─── Smart Status Logic ─────────────────────────────────────────────────────

function applySmartStatus(
  current: Partial<BillingRecord>,
  field: keyof BillingRecord,
  value: string | null
): Record<string, string | null> {
  const updates: Record<string, string | null> = { [field]: value };

  const paidAmount = field === "paidAmount" ? value : current.paidAmount;
  const balanceRemaining = field === "balanceRemaining" ? value : current.balanceRemaining;

  if (field === "billingStatus") {
    if (value === "Denied") updates.response = "Denied";
    else if (value === "Rejected") updates.response = "Rejected";
  }

  if (field === "paidAmount" || field === "balanceRemaining") {
    const effectivePaid = parseFloat((field === "paidAmount" ? value : paidAmount) ?? "0") || 0;
    const effectiveBalance = parseFloat((field === "balanceRemaining" ? value : balanceRemaining) ?? "0") || 0;
    if (effectiveBalance === 0 && effectivePaid > 0) {
      updates.paidStatus = "Paid";
    } else if (effectivePaid > 0 && effectiveBalance > 0) {
      updates.paidStatus = "Partial";
    }
  } else {
    const paid = parseFloat(paidAmount ?? "0") || 0;
    const balance = parseFloat(balanceRemaining ?? "0") || 0;
    if (balance === 0 && paid > 0) updates.paidStatus = "Paid";
    else if (paid > 0 && balance > 0) updates.paidStatus = "Partial";
  }

  return updates;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return dateStr;
  const [yyyy, mm, dd] = parts;
  return new Date(yyyy, mm - 1, dd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function calcDaysInAR(dateSubmitted: string | null): number | null {
  if (!dateSubmitted) return null;
  const start = new Date(dateSubmitted);
  if (isNaN(start.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000));
}

function rowAccentClass(record: BillingRecord): string {
  const cs = record.billingStatus ?? "";
  const ps = record.paidStatus ?? "";
  const rs = record.response ?? "";
  const days = calcDaysInAR(record.dateSubmitted);
  if (cs === "Denied" || cs === "Rejected" || rs === "Denied" || rs === "Rejected") return "bg-red-50/70 border-l-2 border-l-red-300";
  if (days !== null && days >= 90) return "bg-red-50/50 border-l-2 border-l-red-200";
  if (ps === "Paid") return "bg-emerald-50/60 border-l-2 border-l-emerald-300";
  if (cs === "Pending" || rs === "Pending") return "bg-amber-50/50 border-l-2 border-l-amber-200";
  return "";
}

function statusBadgeClass(value: string | null): string {
  if (!value) return "bg-slate-100 text-slate-500 border-slate-200";
  const v = value.toLowerCase();
  if (v === "paid" || v === "accepted" || v === "paid in full" || v === "complete") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (v === "denied" || v === "rejected") return "bg-red-100 text-red-800 border-red-200";
  if (v === "pending" || v === "submitted") return "bg-amber-100 text-amber-800 border-amber-200";
  if (v === "partial" || v === "partial payment") return "bg-blue-100 text-blue-800 border-blue-200";
  if (v === "not billed" || v === "not started") return "bg-slate-100 text-slate-600 border-slate-200";
  if (v === "preprocedure order note" || v === "post-procedure note" || v === "billing document") return "bg-indigo-100 text-indigo-800 border-indigo-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

// ─── Status helpers ──────────────────────────────────────────────────────────

function statusDotColor(value: string | null): string {
  const v = (value ?? "").toLowerCase();
  if (v === "paid" || v === "accepted" || v === "paid in full" || v === "complete") return "bg-emerald-500";
  if (v === "denied" || v === "rejected") return "bg-red-500";
  if (v === "pending" || v === "submitted") return "bg-amber-400";
  if (v === "partial" || v === "partial payment") return "bg-blue-500";
  if (v === "not billed" || v === "not started") return "bg-slate-300";
  return "bg-slate-300";
}

function StatusDot({ value }: { value: string | null }) {
  return <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor(value)}`} />;
}

// ─── Cell components ────────────────────────────────────────────────────────

type SaveFn = (id: number, field: keyof BillingRecord, value: string | null, record: BillingRecord) => void;

function EditableCell({ value, recordId, field, onSave, record, placeholder }: {
  value: string | null;
  recordId: number;
  field: keyof BillingRecord;
  onSave: SaveFn;
  record: BillingRecord;
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
      onSave(recordId, field, trimmed || null, record);
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

function DateCell({ value, recordId, field, onSave, record }: {
  value: string | null;
  recordId: number;
  field: keyof BillingRecord;
  onSave: SaveFn;
  record: BillingRecord;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(v: string) {
    setEditing(false);
    const newVal = v || null;
    if (newVal !== value) onSave(recordId, field, newVal, record);
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

function NumericCell({ value, recordId, field, onSave, record }: {
  value: string | null;
  recordId: number;
  field: keyof BillingRecord;
  onSave: SaveFn;
  record: BillingRecord;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const newVal = trimmed ? trimmed : null;
    if (newVal !== value) onSave(recordId, field, newVal, record);
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
        data-testid={`input-billing-${String(field)}-${recordId}`}
      />
    );
  }
  return (
    <div
      className="px-1.5 py-0.5 text-xs text-slate-700 cursor-pointer hover:bg-blue-50 rounded min-h-[22px] whitespace-nowrap"
      style={{ minWidth: 70 }}
      onClick={() => { setDraft(value ?? ""); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
      data-testid={`cell-billing-${String(field)}-${recordId}`}
    >
      {value ? `$${parseFloat(value).toFixed(2)}` : <span className="text-slate-300 italic">$0.00</span>}
    </div>
  );
}

function DropdownCell({ value, recordId, field, options, onSave, record, badgeStyle }: {
  value: string | null;
  recordId: number;
  field: keyof BillingRecord;
  options: string[];
  onSave: SaveFn;
  record: BillingRecord;
  badgeStyle?: boolean;
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
    if (opt !== value) onSave(recordId, field, opt, record);
  }

  const display = value ?? "—";
  const isStatus = badgeStyle !== false;

  return (
    <div ref={ref} className="relative" data-testid={`dropdown-billing-${String(field)}-${recordId}`}>
      <button
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium whitespace-nowrap transition-all hover:shadow-sm ${
          isStatus && value
            ? `${statusBadgeClass(value)} hover:opacity-90`
            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
        }`}
        onClick={() => setOpen((o) => !o)}
        data-testid={`button-dropdown-${String(field)}-${recordId}`}
      >
        {isStatus && <StatusDot value={value} />}
        <span>{display}</span>
        <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 bg-white border border-slate-100 rounded-2xl shadow-2xl min-w-[180px] py-1.5 overflow-hidden" style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.12)" }}>
          {options.map((opt) => (
            <button
              key={opt}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] transition-colors hover:bg-slate-50 ${opt === value ? "bg-slate-50/80" : ""}`}
              onClick={() => select(opt)}
              data-testid={`option-${String(field)}-${opt.replace(/\s+/g, "-").toLowerCase()}-${recordId}`}
            >
              {isStatus && <StatusDot value={opt} />}
              <span className={opt === value ? "font-semibold text-slate-900" : "text-slate-700"}>{opt}</span>
              {opt === value && <Check className="w-3 h-3 text-primary ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Filter Pill ─────────────────────────────────────────────────────────────

function FilterPill({ icon: Icon, label, value, options, onChange, testId }: {
  icon: LucideIcon;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  testId?: string;
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

  const isActive = !!value;

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <button
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-medium transition-all hover:shadow-sm whitespace-nowrap ${
          isActive
            ? "bg-primary text-primary-foreground border-primary shadow-sm"
            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon className="w-3 h-3 shrink-0" />
        <span>{value || label}</span>
        <ChevronDown className={`w-3 h-3 opacity-60 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 bg-white border border-slate-100 rounded-2xl shadow-2xl min-w-[200px] py-1.5 overflow-hidden" style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.12)" }}>
          <button
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-slate-500 hover:bg-slate-50 transition-colors"
            onClick={() => { onChange(""); setOpen(false); }}
          >
            <span className="italic">All {label}</span>
            {!value && <Check className="w-3 h-3 text-primary ml-auto" />}
          </button>
          <div className="border-t border-slate-100 my-0.5" />
          {options.map((opt) => (
            <button
              key={opt}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] transition-colors hover:bg-slate-50 ${opt === value ? "bg-slate-50/80" : ""}`}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              <StatusDot value={opt} />
              <span className={opt === value ? "font-semibold text-slate-900" : "text-slate-700"}>{opt}</span>
              {opt === value && <Check className="w-3 h-3 text-primary ml-auto" />}
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
  const visible = notes.filter((n) => !n.sections.every((s) => s.heading.startsWith("__")));

  function handleCopy(note: GeneratedNote) {
    const text = note.sections
      .filter((s) => !s.heading.startsWith("__"))
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
      note.sections.filter((s) => !s.heading.startsWith("__"))
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
                  {note.sections.filter((s) => !s.heading.startsWith("__")).map((section, si) => (
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

function AddRowModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (data: { patientName: string; dateOfService: string; facility: string; clinician: string; service: string; insuranceInfo: string }) => void;
}) {
  const [patientName, setPatientName] = useState("");
  const [dateOfService, setDateOfService] = useState("");
  const [facility, setFacility] = useState("");
  const [clinician, setClinician] = useState("");
  const [service, setService] = useState("");
  const [insuranceInfo, setInsuranceInfo] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!patientName.trim()) return;
    onAdd({ patientName: patientName.trim(), dateOfService, facility, clinician, service, insuranceInfo });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <span className="font-semibold text-slate-800 text-sm">Add Billing Row</span>
          <button className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
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
              {FACILITY_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Rendering Provider</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={clinician} onChange={(e) => setClinician(e.target.value)} placeholder="Clinician name" data-testid="input-add-row-clinician" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Service Type</label>
            <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={service} onChange={(e) => setService(e.target.value)} data-testid="select-add-row-service">
              <option value="">— select —</option>
              {SERVICE_TYPE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Primary Insurance</label>
            <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={insuranceInfo} onChange={(e) => setInsuranceInfo(e.target.value)} data-testid="select-add-row-insurance">
              <option value="">— select —</option>
              {PRIMARY_INSURANCE_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
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

// ─── Sort Icon ──────────────────────────────────────────────────────────────

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string | null; sortDir: "asc" | "desc" }) {
  if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 opacity-40" />;
  return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
}

// ─── Main page ───────────────────────────────────────────────────────────────

type SortableField = "facility" | "clinician" | "service" | "billingStatus" | "response" | "paidStatus";

export default function BillingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [docModal, setDocModal] = useState<{ notes: GeneratedNote[]; title: string } | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [billingSyncedAt, setBillingSyncedAt] = useState<string | null>(null);
  const [billingSheetUrl, setBillingSheetUrl] = useState<string | null>(null);
  const [masterSheetUrl, setMasterSheetUrl] = useState<string | null>(null);
  const [facilitySheetUrls, setFacilitySheetUrls] = useState<Record<string, string>>({});
  const [exportingNoteIds, setExportingNoteIds] = useState<Set<number>>(new Set());

  const [facilityTab, setFacilityTab] = useState<string>("All");
  const [filterProvider, setFilterProvider] = useState("");
  const [filterService, setFilterService] = useState("");
  const [filterClaimStatus, setFilterClaimStatus] = useState("");
  const [filterPayerStatus, setFilterPayerStatus] = useState("");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState("");

  const [sortField, setSortField] = useState<SortableField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data: records = [], isLoading } = useQuery<BillingRecord[]>({ queryKey: ["/api/billing-records"] });
  const { data: allNotes = [] } = useQuery<GeneratedNote[]>({ queryKey: ["/api/generated-notes"] });

  const { data: googleStatus } = useQuery<{
    sheets: {
      connected: boolean;
      lastSyncedBilling: string | null;
      billingSpreadsheetUrl: string | null;
      masterBillingSpreadsheetUrl: string | null;
      facilityBillingSpreadsheetUrls: Record<string, string>;
    };
    drive: { connected: boolean; email: string | null };
  }>({ queryKey: ["/api/google/status"], refetchInterval: 30000 });

  useEffect(() => {
    if (!googleStatus?.sheets) return;
    setBillingSyncedAt(googleStatus.sheets.lastSyncedBilling ?? null);
    const master = googleStatus.sheets.masterBillingSpreadsheetUrl ?? googleStatus.sheets.billingSpreadsheetUrl ?? null;
    setBillingSheetUrl(master);
    setMasterSheetUrl(googleStatus.sheets.masterBillingSpreadsheetUrl ?? null);
    const facUrls = googleStatus.sheets.facilityBillingSpreadsheetUrls;
    if (facUrls && typeof facUrls === "object") setFacilitySheetUrls(facUrls);
  }, [googleStatus]);

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Record<string, string | null> }) =>
      apiRequest("PATCH", `/api/billing-records/${id}`, updates),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/billing-records"] }); },
    onError: (err: Error) => { toast({ title: "Save failed", description: err.message, variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/billing-records/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/billing-records"] }); toast({ title: "Record deleted" }); },
    onError: (err: Error) => { toast({ title: "Delete failed", description: err.message, variant: "destructive" }); },
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
        if (data.masterSpreadsheetUrl) {
          setMasterSheetUrl(data.masterSpreadsheetUrl);
          setBillingSheetUrl(data.masterSpreadsheetUrl);
        } else if (data.spreadsheetUrl) {
          setBillingSheetUrl(data.spreadsheetUrl);
        }
        if (data.facilitySpreadsheetUrls) setFacilitySheetUrls(data.facilitySpreadsheetUrls);
        if (data.masterSyncError) {
          toast({ title: "Synced (master tracker error)", description: `Facility sheets updated but master tracker failed: ${data.masterSyncError}`, variant: "destructive" });
        } else {
          toast({ title: "Synced to Google Sheets", description: `${data.recordCount} records pushed` });
        }
      } else {
        toast({ title: "Sync queued" });
      }
    },
    onError: (err: Error) => { toast({ title: "Sync failed", description: err.message, variant: "destructive" }); },
  });

  const importFromSheetMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", "/api/billing-records/import-from-sheet"); return res.json(); },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing-records"] });
      if (data.total === 0) {
        toast({ title: "Nothing to import", description: "No records found in connected sheets." });
      } else {
        toast({ title: "Import complete", description: `${data.created} created, ${data.updated} updated from Google Sheets.` });
      }
    },
    onError: (err: Error) => { toast({ title: "Import failed", description: err.message, variant: "destructive" }); },
  });

  function handleSave(id: number, field: keyof BillingRecord, value: string | null, record: BillingRecord) {
    const updates = applySmartStatus(record, field, value);
    updateMutation.mutate({ id, updates });
  }

  function handleAddRow(data: { patientName: string; dateOfService: string; facility: string; clinician: string; service: string; insuranceInfo: string }) {
    createMutation.mutate({
      service: data.service || "BrainWave",
      patientName: data.patientName,
      dateOfService: data.dateOfService || null,
      facility: data.facility || null,
      clinician: data.clinician || null,
      insuranceInfo: data.insuranceInfo || null,
    });
  }

  const uniqueProviders = useMemo(() => {
    const set = new Set(records.map((r) => r.clinician).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [records]);

  const metrics = useMemo(() => {
    const src = facilityTab === "All" ? records : records.filter(r => r.facility === facilityTab);
    const totalRecords = src.length;
    const totalCharges = src.reduce((s, r) => s + (parseFloat(r.totalCharges ?? "0") || 0), 0);
    const totalPaid = src.reduce((s, r) => s + (parseFloat(r.paidAmount ?? "0") || 0), 0);
    const totalBalance = src.reduce((s, r) => s + (parseFloat(r.balanceRemaining ?? "0") || 0), 0);
    const arDays = src.map(r => calcDaysInAR(r.dateSubmitted)).filter((d): d is number => d !== null);
    const avgAR = arDays.length > 0 ? Math.round(arDays.reduce((a, b) => a + b, 0) / arDays.length) : null;
    return { totalRecords, totalCharges, totalPaid, totalBalance, avgAR };
  }, [records, facilityTab]);

  const filtered = useMemo(() => {
    let result = records;
    if (facilityTab !== "All") result = result.filter((r) => r.facility === facilityTab);
    if (filterProvider) result = result.filter((r) => r.clinician === filterProvider);
    if (filterService) result = result.filter((r) => r.service === filterService);
    if (filterClaimStatus) result = result.filter((r) => r.billingStatus === filterClaimStatus);
    if (filterPayerStatus) result = result.filter((r) => r.response === filterPayerStatus);
    if (filterPaymentStatus) result = result.filter((r) => r.paidStatus === filterPaymentStatus);

    if (sortField) {
      const fieldMap: Record<SortableField, keyof BillingRecord> = {
        facility: "facility",
        clinician: "clinician",
        service: "service",
        billingStatus: "billingStatus",
        response: "response",
        paidStatus: "paidStatus",
      };
      const key = fieldMap[sortField];
      result = [...result].sort((a, b) => {
        const av = (a[key] as string | null) ?? "";
        const bv = (b[key] as string | null) ?? "";
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return result;
  }, [records, facilityTab, filterProvider, filterService, filterClaimStatus, filterPayerStatus, filterPaymentStatus, sortField, sortDir]);

  function toggleSort(field: SortableField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function openDocModal(record: BillingRecord) {
    if (record.patientId === null) { setDocModal({ notes: [], title: `${record.patientName} — ${record.service}` }); return; }
    const notesForPatient = allNotes.filter((n) => n.patientId === record.patientId && n.service === record.service);
    setDocModal({ notes: notesForPatient, title: `${record.patientName} — ${record.service}` });
  }

  function hasNotes(record: BillingRecord) {
    if (record.patientId === null) return false;
    return allNotes.some((n) => n.patientId === record.patientId && n.service === record.service);
  }

  const sortableHeaders: { label: string; field: SortableField }[] = [
    { label: "Facility", field: "facility" },
    { label: "Rendering Provider", field: "clinician" },
    { label: "Service Type", field: "service" },
    { label: "Claim Status", field: "billingStatus" },
    { label: "Payer Status", field: "response" },
    { label: "Payment Status", field: "paidStatus" },
  ];

  const isSortable = (label: string) => sortableHeaders.some((h) => h.label === label);
  const getSortField = (label: string) => sortableHeaders.find((h) => h.label === label)?.field ?? null;

  const columns = [
    { label: "Date of Service", w: 120 },
    { label: "Patient Name", w: 150 },
    { label: "Facility", w: 160 },
    { label: "Rendering Provider", w: 150 },
    { label: "Service Type", w: 185 },
    { label: "Primary Insurance", w: 145 },
    { label: "Documentation Status", w: 200 },
    { label: "Claim Status", w: 130 },
    { label: "Payer Status", w: 140 },
    { label: "Date Submitted", w: 130 },
    { label: "Days in A/R", w: 90 },
    { label: "Follow-Up Date", w: 130 },
    { label: "Payment Status", w: 120 },
    { label: "Paid Amount", w: 110 },
    { label: "Total Charges", w: 110 },
    { label: "Allowed Amount", w: 120 },
    { label: "Patient Responsibility", w: 150 },
    { label: "Adjustment Amount", w: 135 },
    { label: "Balance Remaining", w: 135 },
    { label: "", w: 48 },
  ];

  const fmtMoney = (v: number) => v === 0 ? "$0" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <main className="flex-1 overflow-hidden flex flex-col bg-slate-50" data-testid="billing-page">
      {/* Header */}
      <div className="shrink-0 bg-white border-b border-slate-200">
        {/* Top bar */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-1.5 text-slate-500 hover:text-slate-800 -ml-2" data-testid="button-back-home">
                <ArrowLeft className="w-3.5 h-3.5" />Back
              </Button>
            </Link>
            <div className="h-5 w-px bg-slate-200" />
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-emerald-700" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900 leading-none" data-testid="text-billing-title">Billing Tracker</h1>
                <p className="text-[11px] text-slate-400 mt-0.5">Ancillary service claims &amp; payments</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button size="sm" variant="outline" onClick={() => syncBillingMutation.mutate()} disabled={syncBillingMutation.isPending || importFromSheetMutation.isPending}
              className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 h-8 text-xs" data-testid="button-sync-billing-sheets">
              {syncBillingMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <SiGooglesheets className="w-3.5 h-3.5" />}
              Sync to Sheets
            </Button>
            <Button size="sm" variant="outline" onClick={() => importFromSheetMutation.mutate()} disabled={importFromSheetMutation.isPending || syncBillingMutation.isPending}
              className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50 h-8 text-xs" data-testid="button-import-from-sheet">
              {importFromSheetMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Import from Sheet
            </Button>
            <div className="h-4 w-px bg-slate-200" />
            {(masterSheetUrl || billingSheetUrl) && (
              <a href={masterSheetUrl ?? billingSheetUrl!} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-emerald-600 hover:underline inline-flex items-center gap-1"
                title="Open master Plexus Billing Tracker"
                data-testid="link-master-billing-sheet">
                <SiGooglesheets className="w-3 h-3" />Master Sheet
              </a>
            )}
            {billingSyncedAt && (
              <span className="text-[10px] text-slate-400 whitespace-nowrap">
                Synced {new Date(billingSyncedAt).toLocaleTimeString()}
              </span>
            )}
            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8 text-slate-600" onClick={() => setShowAddRow(true)} data-testid="button-add-billing-row">
              <Plus className="w-3.5 h-3.5" />Add Row
            </Button>
          </div>
        </div>

        {/* Metrics bar */}
        <div className="px-5 pb-3 grid grid-cols-5 gap-3" data-testid="billing-metrics">
          {[
            { icon: Receipt, label: "Total Records", value: String(metrics.totalRecords), color: "text-slate-700", bg: "bg-slate-100" },
            { icon: TrendingUp, label: "Total Charges", value: fmtMoney(metrics.totalCharges), color: "text-blue-700", bg: "bg-blue-50" },
            { icon: Wallet, label: "Total Paid", value: fmtMoney(metrics.totalPaid), color: "text-emerald-700", bg: "bg-emerald-50" },
            { icon: Banknote, label: "Balance Outstanding", value: fmtMoney(metrics.totalBalance), color: "text-amber-700", bg: "bg-amber-50" },
            { icon: Timer, label: "Avg Days in A/R", value: metrics.avgAR !== null ? `${metrics.avgAR}d` : "—", color: metrics.avgAR !== null && metrics.avgAR >= 90 ? "text-red-700" : "text-slate-700", bg: metrics.avgAR !== null && metrics.avgAR >= 90 ? "bg-red-50" : "bg-slate-100" },
          ].map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} className={`rounded-xl px-3.5 py-2.5 ${bg} flex items-center gap-3`} data-testid={`metric-${label.replace(/\s+/g, "-").toLowerCase()}`}>
              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
              <div>
                <div className={`text-sm font-bold leading-none ${color}`}>{value}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 leading-none">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Facility tabs */}
        <div className="px-5 flex items-center gap-1 border-t border-slate-100 pt-2 pb-0" data-testid="facility-tabs">
          {["All", ...FACILITY_OPTIONS].map((fac) => {
            const facUrl = fac !== "All" ? facilitySheetUrls[fac] : null;
            return (
              <div key={fac} className="flex items-center gap-0">
                <button
                  onClick={() => setFacilityTab(fac)}
                  data-testid={`tab-facility-${fac.replace(/\s+/g, "-").toLowerCase()}`}
                  className={`px-3.5 py-2 text-[12px] font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap ${
                    facilityTab === fac
                      ? "border-emerald-500 text-emerald-700 bg-emerald-50/50"
                      : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {fac}
                  <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-500 rounded-full px-1.5 py-0.5">
                    {fac === "All" ? records.length : records.filter(r => r.facility === fac).length}
                  </span>
                </button>
                {facUrl && (
                  <a href={facUrl} target="_blank" rel="noopener noreferrer"
                    className="ml-0.5 p-1 text-slate-300 hover:text-emerald-500 transition-colors"
                    title={`Open ${fac} billing sheet`}
                    data-testid={`link-sheet-${fac.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {/* Secondary filter bar */}
        <div className="flex items-center gap-2 px-5 py-2 border-t border-slate-100 flex-wrap bg-slate-50/60">
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <FilterPill icon={User} label="Provider" value={filterProvider} options={uniqueProviders} onChange={setFilterProvider} testId="select-filter-provider" />
          <FilterPill icon={Scan} label="Service" value={filterService} options={SERVICE_TYPE_OPTIONS} onChange={setFilterService} testId="select-filter-service" />
          <FilterPill icon={ClipboardList} label="Claim Status" value={filterClaimStatus} options={CLAIM_STATUS_OPTIONS} onChange={setFilterClaimStatus} testId="select-filter-claim-status" />
          <FilterPill icon={AlertCircle} label="Payer Status" value={filterPayerStatus} options={PAYER_STATUS_OPTIONS} onChange={setFilterPayerStatus} testId="select-filter-payer-status" />
          <FilterPill icon={Banknote} label="Payment" value={filterPaymentStatus} options={PAYMENT_STATUS_OPTIONS} onChange={setFilterPaymentStatus} testId="select-filter-payment-status" />
          {(filterProvider || filterService || filterClaimStatus || filterPayerStatus || filterPaymentStatus) && (
            <button
              className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-600 px-2.5 py-1 rounded-full border border-red-200 hover:border-red-300 hover:bg-red-50 transition-colors"
              onClick={() => { setFilterProvider(""); setFilterService(""); setFilterClaimStatus(""); setFilterPayerStatus(""); setFilterPaymentStatus(""); }}
              data-testid="button-clear-filters">
              <X className="w-3 h-3" />Clear
            </button>
          )}
          <span className="text-[10px] text-slate-400 ml-auto font-medium">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Spreadsheet */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <DollarSign className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">No billing records found</p>
            <p className="text-sm text-slate-400 mt-1">Complete a schedule or click Add Row to enter one manually.</p>
          </div>
        ) : (
          <div className="min-w-max">
            <table className="border-collapse w-full" style={{ fontSize: 11 }} data-testid="billing-table">
              <thead>
                <tr className="bg-white border-b-2 border-slate-200 sticky top-0 z-20" style={{ boxShadow: "0 2px 4px rgba(0,0,0,0.06)" }}>
                  {columns.map((col, ci) => {
                    const sortable = isSortable(col.label);
                    const sf = getSortField(col.label);
                    const isSticky0 = ci === 0;
                    const isSticky1 = ci === 1;
                    const stickyStyle: CSSProperties = isSticky0
                      ? { minWidth: col.w, position: "sticky", left: 0, zIndex: 30, background: "white", boxShadow: "2px 0 4px rgba(0,0,0,0.04)" }
                      : isSticky1
                      ? { minWidth: col.w, position: "sticky", left: 120, zIndex: 30, background: "white", boxShadow: "2px 0 4px rgba(0,0,0,0.04)" }
                      : { minWidth: col.w };
                    return (
                      <th key={col.label || "_actions"}
                        className={`px-3 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider border-r border-slate-100 whitespace-nowrap last:border-r-0 text-[10px] ${sortable ? "cursor-pointer hover:bg-slate-50 select-none" : ""}`}
                        style={stickyStyle}
                        onClick={sortable && sf ? () => toggleSort(sf as SortableField) : undefined}
                        data-testid={col.label ? `th-billing-${col.label.replace(/\s+/g, "-").toLowerCase()}` : "th-billing-actions"}
                      >
                        <span className="flex items-center gap-1">
                          {col.label}
                          {sortable && sf && <SortIcon field={sf} sortField={sortField} sortDir={sortDir} />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((record, ri) => {
                  const days = calcDaysInAR(record.dateSubmitted);
                  const accent = rowAccentClass(record);
                  const isEven = ri % 2 === 0;
                  const rowBg = accent || (isEven ? "bg-white" : "bg-slate-50/60");
                  return (
                    <tr key={record.id}
                      className={`border-b border-slate-100 hover:bg-blue-50/30 transition-colors ${rowBg}`}
                      data-testid={`billing-row-${record.id}`}>
                      {/* Date of Service — sticky col 0 */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle"
                        style={{ position: "sticky", left: 0, zIndex: 1, background: isEven ? "white" : "rgb(248 250 252 / 0.6)" }}>
                        <DateCell value={record.dateOfService} recordId={record.id} field="dateOfService" onSave={handleSave} record={record} />
                      </td>
                      {/* Patient Name — sticky col 1 */}
                      <td className="px-3 py-2 border-r border-slate-200 align-middle font-medium text-slate-800"
                        style={{ position: "sticky", left: 120, zIndex: 1, background: isEven ? "white" : "rgb(248 250 252 / 0.6)", boxShadow: "2px 0 4px rgba(0,0,0,0.04)" }}>
                        <EditableCell value={record.patientName} recordId={record.id} field="patientName" onSave={handleSave} record={record} />
                      </td>
                      {/* Facility */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.facility} recordId={record.id} field="facility" options={FACILITY_OPTIONS} onSave={handleSave} record={record} badgeStyle={false} />
                      </td>
                      {/* Rendering Provider */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <EditableCell value={record.clinician} recordId={record.id} field="clinician" onSave={handleSave} record={record} placeholder="—" />
                      </td>
                      {/* Service Type */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.service} recordId={record.id} field="service" options={SERVICE_TYPE_OPTIONS} onSave={handleSave} record={record} badgeStyle={false} />
                      </td>
                      {/* Primary Insurance */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.insuranceInfo} recordId={record.id} field="insuranceInfo" options={PRIMARY_INSURANCE_OPTIONS} onSave={handleSave} record={record} badgeStyle={false} />
                      </td>
                      {/* Documentation Status */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <div className="flex items-center gap-1.5">
                          <DropdownCell value={record.documentationStatus} recordId={record.id} field="documentationStatus" options={DOC_STATUS_OPTIONS} onSave={handleSave} record={record} />
                          {hasNotes(record) && (
                            <button
                              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 font-medium whitespace-nowrap transition-all"
                              onClick={() => openDocModal(record)}
                              data-testid={`button-doc-${record.id}`}
                            >
                              <FileText className="w-2.5 h-2.5" />Docs
                            </button>
                          )}
                        </div>
                      </td>
                      {/* Claim Status */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.billingStatus} recordId={record.id} field="billingStatus" options={CLAIM_STATUS_OPTIONS} onSave={handleSave} record={record} />
                      </td>
                      {/* Payer Status */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.response} recordId={record.id} field="response" options={PAYER_STATUS_OPTIONS} onSave={handleSave} record={record} />
                      </td>
                      {/* Date Submitted */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <DateCell value={record.dateSubmitted} recordId={record.id} field="dateSubmitted" onSave={handleSave} record={record} />
                      </td>
                      {/* Days in A/R — computed */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle text-center" data-testid={`cell-billing-days-ar-${record.id}`}>
                        {days !== null ? (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${days >= 90 ? "bg-red-100 text-red-700" : days >= 30 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{days}d</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      {/* Follow-Up Date */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <DateCell value={record.followUpDate} recordId={record.id} field="followUpDate" onSave={handleSave} record={record} />
                      </td>
                      {/* Payment Status */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <DropdownCell value={record.paidStatus} recordId={record.id} field="paidStatus" options={PAYMENT_STATUS_OPTIONS} onSave={handleSave} record={record} />
                      </td>
                      {/* Paid Amount */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <NumericCell value={record.paidAmount} recordId={record.id} field="paidAmount" onSave={handleSave} record={record} />
                      </td>
                      {/* Total Charges */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <NumericCell value={record.totalCharges} recordId={record.id} field="totalCharges" onSave={handleSave} record={record} />
                      </td>
                      {/* Allowed Amount */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <NumericCell value={record.allowedAmount} recordId={record.id} field="allowedAmount" onSave={handleSave} record={record} />
                      </td>
                      {/* Patient Responsibility */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <NumericCell value={record.patientResponsibility} recordId={record.id} field="patientResponsibility" onSave={handleSave} record={record} />
                      </td>
                      {/* Adjustment Amount */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <NumericCell value={record.adjustmentAmount} recordId={record.id} field="adjustmentAmount" onSave={handleSave} record={record} />
                      </td>
                      {/* Balance Remaining */}
                      <td className="px-3 py-2 border-r border-slate-100 align-middle">
                        <NumericCell value={record.balanceRemaining} recordId={record.id} field="balanceRemaining" onSave={handleSave} record={record} />
                      </td>
                      {/* Actions */}
                      <td className="px-2 py-2 align-middle text-center">
                        <button
                          className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors"
                          onClick={() => { if (confirm(`Delete record for ${record.patientName}?`)) deleteMutation.mutate(record.id); }}
                          data-testid={`button-delete-${record.id}`}
                          title="Delete row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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
        <AddRowModal onClose={() => setShowAddRow(false)} onAdd={handleAddRow} />
      )}
    </main>
  );
}
