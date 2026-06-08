import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, FileText, Loader2, Upload, User } from "lucide-react";
import { VALID_FACILITIES } from "@shared/plexus";
import {
  parsePlexusIqClinicalImport,
  type PlexusIqClinicalImportRow,
} from "@/lib/plexusIqClinicalImportParser";

// Two-step bulk-import modal for /plexus-iq.
//
// Step 1 — Source: facility/date/type defaults + paste textarea + .txt/.csv
// upload. Binary formats (PDF / DOCX / XLSX) are not parsed in-browser; the
// user is asked to paste extracted text using Start/End block delimiters.
//
// Step 2 — Preview: parses pasted text into patient blocks delimited by
// case-insensitive "Start" and "End" markers (one block per patient). Also
// supports legacy CSV input (header `facility,date,name,type,time`) if the
// pasted text does not contain Start/End markers but does begin with a
// recognizable header row.
//
// Confirm Import → calls onImport(rows). The page-level handler routes each
// row to the matching screening_batch keyed by (facility, scheduleDate).
//
// No standalone Plexus IQ batch is created.

export type ParsedRow = {
  facility: string;
  scheduleDate: string;
  patientType: "visit" | "outreach";
  name: string;
  time?: string;
  dob?: string;
  phoneNumber?: string;
  email?: string;
  insurance?: string;
  diagnoses?: string;
  history?: string;
  medications?: string;
  notes?: string;
  // Optional fields surfaced in the preview UI for the clinical-paste
  // format so reviewers can see age/sex/MRN/ancillaries at a glance
  // without expanding the notes blob.
  age?: string;
  sex?: string;
  mrn?: string;
  previousAncillaries?: string;
  rowIndex?: number;
  // The raw block text — surfaced in the preview UI; not posted to the
  // server unless one of the structured fields above absorbs it.
  raw?: string;
};

export type ParsedRowError = { line: number; reason: string };

export type DetectedImportFormat =
  | "clinical-spreadsheet"
  | "start-end-labels"
  | "legacy-csv"
  | "empty";

type PatientType = "visit" | "outreach";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FACILITY_LOOKUP: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const f of VALID_FACILITIES) m[f.toLowerCase()] = f;
  return m;
})();

function normalizeFacility(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  if (FACILITY_LOOKUP[k]) return FACILITY_LOOKUP[k];
  for (const v of VALID_FACILITIES) {
    if (v.toLowerCase().includes(k)) return v;
  }
  return null;
}

function normalizeDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const y = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (y) return `${y[1]}-${y[2]}-${y[3]}`;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

function normalizeType(raw: string): PatientType | null {
  const t = raw.trim().toLowerCase();
  if (t === "visit" || t === "v") return "visit";
  if (t === "outreach" || t === "o") return "outreach";
  return null;
}

// ───── Start/End block parser ────────────────────────────────────────────

// Splits the source text into individual blocks delimited by lines that
// are "Start" / "End" (case-insensitive, leading/trailing whitespace ok).
// Returns one entry per Start-…-End pair.
export function splitStartEndBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let inBlock = false;
  let buf: string[] = [];
  for (const line of lines) {
    const t = line.trim().toLowerCase();
    if (!inBlock && t === "start") {
      inBlock = true;
      buf = [];
      continue;
    }
    if (inBlock && t === "end") {
      blocks.push(buf.join("\n").trim());
      inBlock = false;
      buf = [];
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks.filter((b) => b.length > 0);
}

// Best-effort label-driven extraction. Lines beginning with a known label
// (DOB:, Phone:, Insurance:, Hx/History, Dx/Diagnoses, Rx/Medications,
// Time:, Type:, Facility:, Date:) are pulled into structured fields; any
// remaining unmatched line is appended to a free-text notes blob unless it
// can be detected as the patient name (first non-label line).
export function extractFromBlock(
  raw: string,
  defaults: { facility: string; scheduleDate: string; patientType: PatientType },
): ParsedRow {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ParsedRow = {
    facility: defaults.facility,
    scheduleDate: defaults.scheduleDate,
    patientType: defaults.patientType,
    name: "",
    raw,
  };
  const leftover: string[] = [];
  let nameSet = false;

  const matchLabel = (line: string, label: RegExp): string | null => {
    const m = label.exec(line);
    return m ? (m[1] ?? "").trim() : null;
  };

  for (const line of lines) {
    const dob = matchLabel(line, /^(?:dob|date of birth)[:\s]+(.*)$/i);
    if (dob) { out.dob = normalizeDate(dob) ?? dob; continue; }
    const phone = matchLabel(line, /^(?:phone|tel|mobile|cell)[:\s]+(.*)$/i);
    if (phone) { out.phoneNumber = phone; continue; }
    if (!out.phoneNumber) {
      const looksLikePhone = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.exec(line);
      if (looksLikePhone) { out.phoneNumber = line; continue; }
    }
    const ins = matchLabel(line, /^(?:insurance|payer|plan)[:\s]+(.*)$/i);
    if (ins) { out.insurance = ins; continue; }
    const hx = matchLabel(line, /^(?:hx|history|pmh)[:\s]+(.*)$/i);
    if (hx) { out.history = hx; continue; }
    const dx = matchLabel(line, /^(?:dx|diagnoses?|problem(?:s)?)[:\s]+(.*)$/i);
    if (dx) { out.diagnoses = dx; continue; }
    const rx = matchLabel(line, /^(?:rx|medications?|meds)[:\s]+(.*)$/i);
    if (rx) { out.medications = rx; continue; }
    const time = matchLabel(line, /^(?:time|appt|appointment)[:\s]+(.*)$/i);
    if (time) { out.time = time; continue; }
    const fac = matchLabel(line, /^(?:facility|clinic)[:\s]+(.*)$/i);
    if (fac) {
      const norm = normalizeFacility(fac);
      if (norm) out.facility = norm;
      continue;
    }
    const dt = matchLabel(line, /^(?:date|sched(?:ule)? date)[:\s]+(.*)$/i);
    if (dt) {
      const norm = normalizeDate(dt);
      if (norm) out.scheduleDate = norm;
      continue;
    }
    const tp = matchLabel(line, /^(?:type|kind)[:\s]+(.*)$/i);
    if (tp) {
      const norm = normalizeType(tp);
      if (norm) out.patientType = norm;
      continue;
    }
    const nameLabel = matchLabel(line, /^(?:name|patient)[:\s]+(.*)$/i);
    if (nameLabel) { out.name = nameLabel; nameSet = true; continue; }

    if (!nameSet) {
      // First non-label line is a strong candidate for the patient name.
      out.name = line;
      nameSet = true;
      continue;
    }
    leftover.push(line);
  }

  if (leftover.length > 0) {
    out.notes = leftover.join("\n");
  }
  if (!out.name.trim()) {
    out.name = "Imported Patient";
  }
  return out;
}

// ───── Legacy CSV parser (kept as a fallback for users who paste CSV) ───

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { q = false; continue; }
      cur += c;
    } else {
      if (c === '"') { q = true; continue; }
      if (c === ",") { out.push(cur); cur = ""; continue; }
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function looksLikeCsv(text: string): boolean {
  const first = text.split(/\r?\n/)[0]?.toLowerCase() ?? "";
  return /facility/.test(first) && /date/.test(first) && /name/.test(first) && /type/.test(first);
}

function parseCsv(text: string): { rows: ParsedRow[]; errors: ParsedRowError[] } {
  const errors: ParsedRowError[] = [];
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows, errors };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = {
    facility: header.indexOf("facility"),
    date: header.indexOf("date"),
    name: header.indexOf("name"),
    type: header.indexOf("type"),
    time: header.indexOf("time"),
  };
  if (idx.facility < 0 || idx.date < 0 || idx.name < 0 || idx.type < 0) {
    errors.push({ line: 1, reason: "Header must include facility, date, name, type (time optional)." });
    return { rows, errors };
  }
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const facility = normalizeFacility(cells[idx.facility] ?? "");
    const scheduleDate = normalizeDate(cells[idx.date] ?? "");
    const patientType = normalizeType(cells[idx.type] ?? "");
    const name = (cells[idx.name] ?? "").trim();
    const time = idx.time >= 0 ? (cells[idx.time] ?? "").trim() : "";
    if (!facility) { errors.push({ line: i + 1, reason: `Unknown facility "${cells[idx.facility]}"` }); continue; }
    if (!scheduleDate) { errors.push({ line: i + 1, reason: `Invalid date "${cells[idx.date]}"` }); continue; }
    if (!patientType) { errors.push({ line: i + 1, reason: `Invalid type "${cells[idx.type]}"` }); continue; }
    if (!name) { errors.push({ line: i + 1, reason: "Missing name" }); continue; }
    rows.push({
      facility,
      scheduleDate,
      patientType,
      name,
      time: time || undefined,
      raw: lines[i],
    });
  }
  return { rows, errors };
}

// ───── Modal ─────────────────────────────────────────────────────────────

const BINARY_EXTS = /\.(pdf|docx?|xlsx?)$/i;

export function PlexusIQBulkImportModal({
  open,
  onClose,
  onImport,
  onClinicalImport,
  pending,
  progress,
}: {
  open: boolean;
  onClose: () => void;
  // Legacy code-path: per-row POST loop (still used for the Start/End
  // label-block and legacy CSV formats so existing behaviour is preserved).
  onImport: (rows: ParsedRow[]) => Promise<void>;
  // New clinical-spreadsheet code-path: one bulk POST + optional
  // qualification-job kickoff. Supplied by /plexus-iq.tsx.
  onClinicalImport?: (
    rows: PlexusIqClinicalImportRow[],
    defaults: { facility: string; scheduleDate: string; patientType: "visit" | "outreach" },
  ) => Promise<void>;
  pending: boolean;
  progress: { current: number; total: number; uniqueBatches: number; uniqueFacilities: number } | null;
}) {
  const [step, setStep] = useState<"source" | "preview">("source");
  const [defFacility, setDefFacility] = useState<string>("");
  const [defDate, setDefDate] = useState<string>(todayIso());
  const [defType, setDefType] = useState<PatientType>("visit");
  const [text, setText] = useState("");
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<ParsedRowError[]>([]);

  function reset() {
    setStep("source");
    setDefFacility("");
    setDefDate(todayIso());
    setDefType("visit");
    setText("");
    setFileNotice(null);
    setErrors([]);
  }

  async function handleFile(file: File) {
    setFileNotice(null);
    if (BINARY_EXTS.test(file.name)) {
      setFileNotice(
        `${file.name}: PDF / Word / Excel files can't be parsed in the browser. Open the file, copy the patient text, and paste it below using Start/End block markers.`,
      );
      return;
    }
    try {
      const content = await file.text();
      setText((prev) => (prev ? `${prev}\n${content}` : content));
    } catch {
      setFileNotice(`Could not read ${file.name}.`);
    }
  }

  // Parse the current source text into preview rows.
  //
  // Format detection order:
  //   1. Clinical-spreadsheet (tab-separated rows between Start/End markers)
  //      → handled by the new bulk-clinical endpoint.
  //   2. Start/End label-blocks (multi-line text per block)
  //      → handled by the existing per-row POST loop.
  //   3. Legacy CSV (`facility,date,name,type,time`)
  //      → handled by the existing per-row POST loop.
  const preview = useMemo(() => {
    if (!text.trim()) {
      return {
        rows: [] as ParsedRow[],
        clinicalRows: [] as PlexusIqClinicalImportRow[],
        errors: [] as ParsedRowError[],
        format: "empty" as DetectedImportFormat,
      };
    }
    // 1. Clinical spreadsheet
    const clinical = parsePlexusIqClinicalImport(text, {
      facility: defFacility || undefined,
      scheduleDate: defDate || undefined,
      patientType: defType,
    });
    if (clinical.format === "clinical-spreadsheet") {
      const errs: ParsedRowError[] = clinical.errors.map((e) => ({
        line: e.rowIndex,
        reason: e.reason,
      }));
      // Mirror into the legacy ParsedRow shape for the preview card.
      // Age/sex/MRN/previousAncillaries are surfaced as their own
      // optional fields so the preview can display them as dedicated
      // meta chips alongside DOB/Insurance/Time.
      const previewRows: ParsedRow[] = clinical.rows.map((r) => ({
        facility: r.facility ?? defFacility,
        scheduleDate: r.scheduleDate ?? defDate,
        patientType: r.patientType ?? defType,
        name: r.name,
        time: r.time,
        dob: r.dob,
        // BatchFlow surfaces phone + email on the preview card so
        // reviewers can spot missing contact info before importing.
        phoneNumber: r.phone,
        email: r.email,
        insurance: r.insurance,
        diagnoses: r.diagnoses,
        history: r.history,
        medications: r.medications,
        age: r.age,
        sex: r.sex,
        mrn: r.mrn,
        previousAncillaries: r.previousAncillaries,
        rowIndex: r.rowIndex,
        notes: undefined,
        raw: r.raw,
      }));
      return {
        rows: previewRows,
        clinicalRows: clinical.rows,
        errors: errs,
        format: "clinical-spreadsheet" as DetectedImportFormat,
      };
    }
    // 2. Start/End label-blocks
    const blocks = splitStartEndBlocks(text);
    if (blocks.length > 0) {
      const defaults = {
        facility: defFacility,
        scheduleDate: defDate,
        patientType: defType,
      };
      const errs: ParsedRowError[] = [];
      const rows = blocks.map((b, i) => {
        const r = extractFromBlock(b, defaults);
        if (!r.facility) errs.push({ line: i + 1, reason: `Block ${i + 1}: missing facility (set default above)` });
        if (!r.scheduleDate) errs.push({ line: i + 1, reason: `Block ${i + 1}: missing date (set default above)` });
        return r;
      });
      return {
        rows,
        clinicalRows: [] as PlexusIqClinicalImportRow[],
        errors: errs,
        format: "start-end-labels" as DetectedImportFormat,
      };
    }
    // 3. Legacy CSV
    if (looksLikeCsv(text)) {
      const csv = parseCsv(text);
      return {
        rows: csv.rows,
        clinicalRows: [] as PlexusIqClinicalImportRow[],
        errors: csv.errors,
        format: "legacy-csv" as DetectedImportFormat,
      };
    }
    return {
      rows: [] as ParsedRow[],
      clinicalRows: [] as PlexusIqClinicalImportRow[],
      errors: [
        {
          line: 1,
          reason:
            'No recognized format. Paste the clinical-spreadsheet (Start ... End tab-separated rows), Start/End label blocks, or a CSV with header "facility,date,name,type,time".',
        },
      ],
      format: "empty" as DetectedImportFormat,
    };
  }, [text, defFacility, defDate, defType]);

  function goToPreview() {
    setErrors(preview.errors);
    if (preview.rows.length === 0) {
      // Stay on Step 1; user has to fix input or set defaults.
      return;
    }
    setStep("preview");
  }

  async function handleConfirm() {
    if (preview.rows.length === 0) return;
    // Re-validate that every row has facility + scheduleDate. Block parser
    // applied defaults already, but defaults could be empty.
    const incomplete = preview.rows.filter((r) => !r.facility || !r.scheduleDate);
    if (incomplete.length > 0) {
      setErrors([
        {
          line: 0,
          reason:
            "Some preview patients are missing facility or date. Set defaults in Step 1 or include Facility:/Date: lines in each block.",
        },
      ]);
      setStep("source");
      return;
    }
    // Clinical-spreadsheet → bulk path (handles 100-200 rows in one POST).
    // Legacy Start/End label-blocks + CSV → existing per-row POST loop.
    if (
      preview.format === "clinical-spreadsheet" &&
      onClinicalImport &&
      preview.clinicalRows.length > 0
    ) {
      // Per-row Clinic + Appointment Date columns override the modal
      // defaults. We only block when a row has NEITHER row-level value
      // NOR a default. Rows with row-level values import even when
      // both modal defaults are blank — defaults are fallback only.
      const rowProblems: ParsedRowError[] = [];
      preview.clinicalRows.forEach((r, idx) => {
        const fac = (r.facility ?? defFacility ?? "").trim();
        const sd = (r.scheduleDate ?? defDate ?? "").trim();
        if (!fac) {
          rowProblems.push({
            line: r.rowIndex ?? idx + 1,
            reason: "Row missing Clinic — set a default facility or fix the row.",
          });
        }
        if (!sd) {
          rowProblems.push({
            line: r.rowIndex ?? idx + 1,
            reason:
              "Row missing Appointment Date — set a default date or fix the row.",
          });
        }
      });
      if (rowProblems.length > 0) {
        setErrors(rowProblems);
        setStep("source");
        return;
      }
      await onClinicalImport(preview.clinicalRows, {
        // Defaults are still passed so any row with a blank Clinic /
        // Appointment Date cell can fall back. The clinical-import
        // route applies them when row values are missing.
        facility: defFacility || preview.clinicalRows[0].facility || "",
        scheduleDate: defDate || preview.clinicalRows[0].scheduleDate || "",
        patientType: defType,
      });
      return;
    }
    await onImport(preview.rows);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl"
        data-testid="plexus-iq-bulk-import-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            {step === "source" ? "Import — Step 1: Source" : "Import — Step 2: Preview"}
          </DialogTitle>
        </DialogHeader>

        {step === "source" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Default facility
                </Label>
                <Select value={defFacility} onValueChange={setDefFacility}>
                  <SelectTrigger className="mt-1 h-9" data-testid="plexus-iq-bulk-default-facility">
                    <SelectValue placeholder="Pick a facility…" />
                  </SelectTrigger>
                  <SelectContent>
                    {VALID_FACILITIES.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Default date
                </Label>
                <Input
                  type="date"
                  value={defDate}
                  onChange={(e) => setDefDate(e.target.value)}
                  className="mt-1 h-9 text-sm"
                  data-testid="plexus-iq-bulk-default-date"
                />
              </div>
              <div>
                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Default type
                </Label>
                <div className="mt-1 inline-flex rounded-lg border border-slate-200 overflow-hidden">
                  {(["visit", "outreach"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDefType(t)}
                      className={`px-3 h-9 text-xs font-medium ${
                        defType === t
                          ? "bg-plexus-navy-800 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                      data-testid={`plexus-iq-bulk-default-type-${t}`}
                    >
                      {t === "visit" ? "Visit" : "Outreach"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
              <p className="text-[11px] text-slate-600 leading-snug">
                <span className="font-medium text-slate-800">Best option:</span>{" "}
                paste a spreadsheet with a header row (tab- or
                comma-separated). Column order does not matter when
                headers are present —{" "}
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">NAME</code>,{" "}
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">Dx</code>,{" "}
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">Hx</code>,{" "}
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">Rx</code>,{" "}
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">MRN</code>, and{" "}
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">INSURANCE</code>{" "}
                are matched by name.{" "}
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">Start</code>/
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">End</code>{" "}
                markers are only needed for messy multiline pasted text.
                Legacy CSV with header{" "}
                <code className="bg-white px-1 py-0.5 rounded text-[10px]">facility,date,name,type,time</code>{" "}
                also works.{" "}
                <span className="font-medium text-slate-800">
                  Fallbacks only — Clinic, Appointment Date, and Patient Type
                  columns override these values.
                </span>
              </p>
            </div>

            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "Start\nJane Doe\nDOB: 1950-03-14\nInsurance: Medicare\nHx: HTN, DM2\nEnd\n\nStart\nJohn Smith\nDOB: 02/02/1948\nDx: CAD, HLD\nEnd"
              }
              className="min-h-[200px] text-xs font-mono"
              data-testid="textarea-plexus-iq-bulk-import"
            />

            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span className="underline">Upload .txt or .csv</span>
                <input
                  type="file"
                  accept=".txt,.csv,.pdf,.doc,.docx,.xls,.xlsx,text/plain,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                  data-testid="input-plexus-iq-bulk-file"
                />
              </label>
              {fileNotice && (
                <span className="text-[11px] text-amber-700" data-testid="text-plexus-iq-bulk-file-notice">
                  {fileNotice}
                </span>
              )}
            </div>

            {errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 max-h-32 overflow-auto" data-testid="plexus-iq-bulk-errors">
                <p className="text-xs font-semibold text-red-700 mb-1">{errors.length} issue{errors.length === 1 ? "" : "s"}</p>
                <ul className="space-y-0.5 text-[11px] text-red-700">
                  {errors.slice(0, 12).map((e, i) => (
                    <li key={i}>{e.line ? `Line ${e.line}: ` : ""}{e.reason}</li>
                  ))}
                  {errors.length > 12 && (
                    <li className="italic opacity-70">…and {errors.length - 12} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">
              {preview.rows.length} patient{preview.rows.length === 1 ? "" : "s"} ready to import. Review each below
              and click <span className="font-medium">Confirm Import</span> to create the cards.
            </p>
            <div className="flex items-center gap-2 text-[11px]" data-testid="plexus-iq-bulk-format-indicator">
              <span className="text-slate-500">Detected format:</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-800">
                {preview.format === "clinical-spreadsheet"
                  ? "Clinical spreadsheet"
                  : preview.format === "start-end-labels"
                  ? "Start/End labeled blocks"
                  : preview.format === "legacy-csv"
                  ? "Legacy CSV"
                  : "Unknown"}
              </span>
            </div>
            {/* Clinic-first import preview: group counts + missing-info
                counts so the operator sees the routing + completeness
                shape before confirming. Engagement gate later blocks
                the canonical send action on missing DOB/phone. */}
            {preview.format === "clinical-spreadsheet" && preview.clinicalRows.length > 0 && (
              <ClinicalPreviewBreakdown rows={preview.clinicalRows} />
            )}
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {preview.rows.map((row, idx) => (
                <PreviewCard key={idx} index={idx + 1} row={row} />
              ))}
            </div>
            {progress && (
              <div className="text-xs text-slate-700" data-testid="text-plexus-iq-bulk-progress">
                Importing {progress.current} of {progress.total} into {progress.uniqueBatches} batch{progress.uniqueBatches === 1 ? "" : "es"} across {progress.uniqueFacilities} facilit{progress.uniqueFacilities === 1 ? "y" : "ies"}…
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "preview" && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep("source")}
              disabled={pending}
              className="gap-1.5 mr-auto"
              data-testid="button-plexus-iq-bulk-back"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => { reset(); onClose(); }}
            disabled={pending}
            data-testid="button-plexus-iq-bulk-cancel"
          >
            Cancel
          </Button>
          {step === "source" ? (
            <Button
              type="button"
              onClick={goToPreview}
              disabled={!text.trim()}
              className="gap-1.5"
              data-testid="button-plexus-iq-bulk-preview"
            >
              <FileText className="w-4 h-4" />
              Preview
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={pending || preview.rows.length === 0}
              className="gap-1.5"
              data-testid="button-plexus-iq-bulk-confirm"
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirm Import ({preview.rows.length})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewCard({ index, row }: { index: number; row: ParsedRow }) {
  const meta: { label: string; value: string }[] = [];
  if (row.rowIndex != null) meta.push({ label: "Row #", value: String(row.rowIndex) });
  if (row.mrn) meta.push({ label: "MRN", value: row.mrn });
  if (row.dob) meta.push({ label: "DOB", value: row.dob });
  if (row.age) meta.push({ label: "Age", value: row.age });
  if (row.sex) meta.push({ label: "Sex", value: row.sex });
  if (row.phoneNumber) meta.push({ label: "Phone", value: row.phoneNumber });
  if (row.email) meta.push({ label: "Email", value: row.email });
  if (row.insurance) meta.push({ label: "Insurance", value: row.insurance });
  if (row.time) meta.push({ label: "Time", value: row.time });
  if (row.previousAncillaries) meta.push({ label: "Ancillaries", value: row.previousAncillaries });
  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-3"
      data-testid={`plexus-iq-preview-patient-${index}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-slate-900 text-white shrink-0">
            <User className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Patient {index}
            </div>
            <div className="text-sm font-semibold text-slate-900 truncate">
              {row.name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5">{row.facility || "no facility"}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5">{row.scheduleDate || "no date"}</span>
          <span className="rounded-full bg-sky-100 text-sky-700 px-2 py-0.5 capitalize">{row.patientType}</span>
        </div>
      </div>
      {meta.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
          {meta.map((m) => {
            // Preview cells carry canonical-field testIds so QA can
            // confirm Import Preview matches the Edit Patient form.
            // SOURCE MARKER: Import Preview fields match Edit Patient fields
            const previewTestId =
              m.label === "Phone"
                ? "import-preview-phone"
                : m.label === "Email"
                  ? "import-preview-email"
                  : m.label === "MRN"
                    ? "import-preview-mrn"
                    : undefined;
            return (
              <div
                key={m.label}
                className="rounded-md bg-slate-50 px-2 py-1"
                {...(previewTestId ? { "data-testid": previewTestId } : {})}
                data-preview-field={m.label}
              >
                <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{m.label}</dt>
                <dd className="text-slate-900 truncate">{m.value}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {(row.diagnoses || row.history || row.medications) && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[11px]">
          {row.diagnoses && (
            <div className="rounded-md bg-slate-50 px-2 py-1">
              <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Dx</dt>
              <dd className="text-slate-900 line-clamp-3">{row.diagnoses}</dd>
            </div>
          )}
          {row.history && (
            <div className="rounded-md bg-slate-50 px-2 py-1">
              <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Hx</dt>
              <dd className="text-slate-900 line-clamp-3">{row.history}</dd>
            </div>
          )}
          {row.medications && (
            <div className="rounded-md bg-slate-50 px-2 py-1">
              <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Rx</dt>
              <dd className="text-slate-900 line-clamp-3">{row.medications}</dd>
            </div>
          )}
        </div>
      )}
      {row.notes && (
        <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Notes / raw</dt>
          <dd className="text-[11px] text-slate-700 whitespace-pre-wrap line-clamp-4">{row.notes}</dd>
        </div>
      )}
    </div>
  );
}

function ClinicalPreviewBreakdown({
  rows,
}: {
  rows: PlexusIqClinicalImportRow[];
}) {
  const byClinic = new Map<string, PlexusIqClinicalImportRow[]>();
  let missingDob = 0;
  let missingPhone = 0;
  let missingEmail = 0;
  let visitCount = 0;
  let outreachCount = 0;
  for (const r of rows) {
    const fac = r.facility ?? "(no clinic)";
    const arr = byClinic.get(fac);
    if (arr) arr.push(r);
    else byClinic.set(fac, [r]);
    if (!r.dob) missingDob += 1;
    if (!r.phone) missingPhone += 1;
    if (!r.email) missingEmail += 1;
    if ((r.patientType ?? "visit") === "outreach") outreachCount += 1;
    else visitCount += 1;
  }
  const clinics = Array.from(byClinic.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] space-y-2"
      data-testid="plexus-iq-bulk-clinic-breakdown"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-slate-500 font-medium uppercase tracking-wider text-[10px]">
          Routing
        </span>
        <span className="text-slate-700">
          <strong>{rows.length}</strong> patients
        </span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-700">
          <strong>{visitCount}</strong> visit
        </span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-700">
          <strong>{outreachCount}</strong> outreach
        </span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-700">
          <strong>{clinics.length}</strong> {clinics.length === 1 ? "clinic" : "clinics"}
        </span>
      </div>
      <ul className="space-y-0.5">
        {clinics.map(([fac, list]) => (
          <li key={fac} className="flex items-center justify-between gap-2">
            <span className="text-slate-800 truncate">{fac}</span>
            <span className="text-slate-500">
              {list.length} {list.length === 1 ? "patient" : "patients"}
            </span>
          </li>
        ))}
      </ul>
      {(missingDob > 0 || missingPhone > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 pt-2 text-slate-700">
          <span className="text-amber-700 font-medium">Missing Info</span>
          {missingDob > 0 && (
            <span>
              <strong>{missingDob}</strong> missing DOB
            </span>
          )}
          {missingPhone > 0 && (
            <span>
              <strong>{missingPhone}</strong> missing phone
            </span>
          )}
          {missingEmail > 0 && (
            <span className="text-slate-500">
              <strong>{missingEmail}</strong> missing email
            </span>
          )}
        </div>
      )}
      <p className="text-[10px] text-slate-500 leading-snug">
        Missing DOB or phone will not block qualification, but must be
        completed before sending to Engagement.
      </p>
    </div>
  );
}
