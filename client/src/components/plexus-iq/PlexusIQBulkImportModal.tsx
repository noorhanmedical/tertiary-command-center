import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload } from "lucide-react";
import { VALID_FACILITIES } from "@shared/plexus";

export type ParsedRow = {
  facility: string;
  scheduleDate: string;
  name: string;
  patientType: "visit" | "outreach";
  time?: string;
};

export type ParsedRowError = { line: number; raw: string; reason: string };

// Split a CSV-like row supporting double-quoted fields. Returns string[]
// trimmed of surrounding whitespace; empty cells preserve as "".
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      cur += ch;
    } else {
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === ",") { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const FACILITY_LOOKUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const f of VALID_FACILITIES) map[f.toLowerCase()] = f;
  return map;
})();

function normalizeFacility(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  if (FACILITY_LOOKUP[k]) return FACILITY_LOOKUP[k];
  // Loose match: pick the first valid facility whose lowercased name contains
  // the raw token (handles "Taylor" → "Taylor Family Practice").
  for (const v of VALID_FACILITIES) {
    if (v.toLowerCase().includes(k)) return v;
  }
  return null;
}

function normalizeDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (mdy) {
    const mm = mdy[1].padStart(2, "0");
    const dd = mdy[2].padStart(2, "0");
    return `${mdy[3]}-${mm}-${dd}`;
  }
  return null;
}

function normalizeType(raw: string): "visit" | "outreach" | null {
  const t = raw.trim().toLowerCase();
  if (t === "visit" || t === "v") return "visit";
  if (t === "outreach" || t === "o") return "outreach";
  return null;
}

// Parse a CSV string with a header row (case-insensitive). Required headers:
//   facility, date, name, type
// Optional: time
// Rows missing facility, date, name, or type → push to errors.
export function parseBulkCsv(text: string): { rows: ParsedRow[]; errors: ParsedRowError[] } {
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
    errors.push({
      line: 1,
      raw: lines[0],
      reason: "Header must include facility, date, name, type (time is optional).",
    });
    return { rows, errors };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const facilityRaw = cells[idx.facility] ?? "";
    const dateRaw = cells[idx.date] ?? "";
    const nameRaw = cells[idx.name] ?? "";
    const typeRaw = cells[idx.type] ?? "";
    const timeRaw = idx.time >= 0 ? cells[idx.time] ?? "" : "";

    const facility = normalizeFacility(facilityRaw);
    const scheduleDate = normalizeDate(dateRaw);
    const patientType = normalizeType(typeRaw);
    const name = nameRaw.trim();

    if (!facility) {
      errors.push({ line: i + 1, raw: lines[i], reason: `Unknown facility: "${facilityRaw}"` });
      continue;
    }
    if (!scheduleDate) {
      errors.push({ line: i + 1, raw: lines[i], reason: `Invalid or missing date: "${dateRaw}"` });
      continue;
    }
    if (!patientType) {
      errors.push({ line: i + 1, raw: lines[i], reason: `Invalid or missing type: "${typeRaw}" (expected visit or outreach)` });
      continue;
    }
    if (!name) {
      errors.push({ line: i + 1, raw: lines[i], reason: "Missing patient name" });
      continue;
    }
    rows.push({
      facility,
      scheduleDate,
      name,
      patientType,
      time: timeRaw ? timeRaw.trim() : undefined,
    });
  }
  return { rows, errors };
}

export function PlexusIQBulkImportModal({
  open,
  onClose,
  onImport,
  pending,
  progress,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (rows: ParsedRow[]) => Promise<void>;
  pending: boolean;
  progress: { current: number; total: number; uniqueBatches: number; uniqueFacilities: number } | null;
}) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<ParsedRowError[]>([]);

  function reset() {
    setText("");
    setErrors([]);
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setText(result);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const { rows, errors: parseErrors } = parseBulkCsv(text);
    setErrors(parseErrors);
    if (rows.length === 0) return;
    await onImport(rows);
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
      <DialogContent className="max-w-2xl rounded-2xl" data-testid="plexus-iq-bulk-import-modal">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Bulk Import
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-slate-600">
            CSV with header row: <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">facility, date, name, type, time</code>.
            Type is <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">visit</code> or <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">outreach</code>.
            Date in <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">YYYY-MM-DD</code> or <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">MM/DD/YYYY</code>. Time is optional.
          </p>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"facility,date,name,type,time\nTaylor Family Practice,2026-05-12,Jane Doe,visit,9:00 AM\nNWPG - Spring,2026-05-13,John Smith,outreach,"}
            className="min-h-[160px] text-xs font-mono"
            data-testid="textarea-plexus-iq-bulk-import"
          />

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span className="underline">Upload CSV file</span>
              <input
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
                data-testid="input-plexus-iq-bulk-file"
              />
            </label>
          </div>

          {progress && (
            <div className="text-xs text-slate-700" data-testid="text-plexus-iq-bulk-progress">
              Importing {progress.current} of {progress.total} rows into {progress.uniqueBatches} batches across {progress.uniqueFacilities} facilities…
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 max-h-40 overflow-auto" data-testid="plexus-iq-bulk-errors">
              <p className="text-xs font-semibold text-red-700 mb-1">{errors.length} row{errors.length === 1 ? "" : "s"} skipped</p>
              <ul className="space-y-0.5 text-[11px] text-red-700">
                {errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.reason}
                  </li>
                ))}
                {errors.length > 20 && (
                  <li className="italic opacity-70">…and {errors.length - 20} more</li>
                )}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => { reset(); onClose(); }}
            disabled={pending}
            data-testid="button-plexus-iq-bulk-cancel"
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={pending || !text.trim()}
            className="gap-1.5"
            data-testid="button-plexus-iq-bulk-import"
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
