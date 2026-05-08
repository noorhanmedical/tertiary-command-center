import { useEffect, useMemo, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stethoscope, FileText, Pill, ClipboardList, Plus, X } from "lucide-react";
import type { PatientScreening } from "@shared/schema";

const TEST_TYPE_OPTIONS = ["BrainWave", "VitalWave", "Ultrasound", "Other"] as const;
const SOURCE_OPTIONS = ["Plexus", "HGA", "Other"] as const;
type TestSource = (typeof SOURCE_OPTIONS)[number];

type PrevTestRow = {
  id: string;
  testType: string;
  date: string;
  source: TestSource | "";
  notes: string;
  legacyText?: string;
};

let rowSeed = 0;
function newRowId(): string {
  rowSeed += 1;
  return `prev-test-${Date.now()}-${rowSeed}`;
}

function isValidYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function ymdToMdy(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function mdyToYmd(value: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!m) return value;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

// Parse a serialized previousTests text back into structured rows. The
// expected serialized format is:
//   "<TestType> on <MM/DD/YYYY> (<Source>) — <notes>; …"
// If the format does not match, return one legacy row carrying the raw
// text so users can read/edit existing free-text data without loss.
function parsePrevTestsText(raw: string): PrevTestRow[] {
  const text = (raw || "").trim();
  if (!text) return [];
  const segments = text.split(/\s*;\s*/).filter(Boolean);
  const rows: PrevTestRow[] = [];
  let allMatched = true;
  for (const seg of segments) {
    const match = /^(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*\(\s*(Plexus|HGA|Other)\s*\)(?:\s*[—\-]\s*(.+))?$/.exec(seg);
    if (!match) {
      allMatched = false;
      break;
    }
    const testType = match[1].trim();
    const date = mdyToYmd(match[2]);
    const source = match[3] as TestSource;
    const notes = (match[4] || "").trim();
    const matchedTestType = TEST_TYPE_OPTIONS.find((t) => t.toLowerCase() === testType.toLowerCase()) ?? "Other";
    rows.push({
      id: newRowId(),
      testType: matchedTestType,
      date,
      source,
      notes: matchedTestType === "Other" && testType.toLowerCase() !== "other" ? `${testType}${notes ? ` — ${notes}` : ""}` : notes,
    });
  }
  if (allMatched && rows.length > 0) return rows;
  return [
    {
      id: newRowId(),
      testType: "",
      date: "",
      source: "",
      notes: "",
      legacyText: text,
    },
  ];
}

function isRowComplete(row: PrevTestRow): boolean {
  return !!row.testType && isValidYmd(row.date) && !!row.source;
}

function serializeRows(rows: PrevTestRow[]): { text: string; latestDate: string } {
  const completed = rows.filter(isRowComplete);
  if (completed.length === 0) return { text: "", latestDate: "" };
  const segments = completed.map((r) => {
    const base = `${r.testType} on ${ymdToMdy(r.date)} (${r.source})`;
    const trimmedNotes = r.notes.trim();
    return trimmedNotes ? `${base} — ${trimmedNotes}` : base;
  });
  const latestDate = completed
    .map((r) => r.date)
    .sort()
    .reverse()[0] ?? "";
  return { text: segments.join("; "), latestDate };
}

interface ClinicalDataEditorProps {
  patient: PatientScreening;
  localDx: string;
  setLocalDx: (v: string) => void;
  localHx: string;
  setLocalHx: (v: string) => void;
  localRx: string;
  setLocalRx: (v: string) => void;
  localPrevTests: string;
  setLocalPrevTests: (v: string) => void;
  localPrevTestsDate: string;
  setLocalPrevTestsDate: (v: string) => void;
  localNoPrevTests: boolean;
  setLocalNoPrevTests: (v: boolean) => void;
  onUpdate: (field: string, value: string | string[] | boolean) => void;
  onExtractDate: (text: string) => string | null;
}

export function ClinicalDataEditor({
  patient,
  localDx, setLocalDx,
  localHx, setLocalHx,
  localRx, setLocalRx,
  localPrevTests, setLocalPrevTests,
  localPrevTestsDate, setLocalPrevTestsDate,
  localNoPrevTests, setLocalNoPrevTests,
  onUpdate,
}: ClinicalDataEditorProps) {
  const initialRows = useMemo(() => parsePrevTestsText(patient.previousTests || ""), [patient.id]);
  const [prevTestRows, setPrevTestRows] = useState<PrevTestRow[]>(initialRows);

  // Re-hydrate rows when the underlying patient.previousTests string changes
  // from outside (e.g. AI analyze fills the field). Compare against the
  // currently-serialized rows so user-driven row edits don't get clobbered.
  useEffect(() => {
    const incoming = patient.previousTests || "";
    const { text } = serializeRows(prevTestRows);
    if (incoming !== text) {
      setPrevTestRows(parsePrevTestsText(incoming));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.previousTests]);

  function persistRows(rows: PrevTestRow[]) {
    const { text, latestDate } = serializeRows(rows);
    setLocalPrevTests(text);
    if (text !== (patient.previousTests || "")) onUpdate("previousTests", text);
    if (latestDate && latestDate !== localPrevTestsDate) {
      setLocalPrevTestsDate(latestDate);
      onUpdate("previousTestsDate", latestDate);
    }
    if (!latestDate && localPrevTestsDate) {
      setLocalPrevTestsDate("");
      onUpdate("previousTestsDate", "");
    }
  }

  function updateRow(rowId: string, patch: Partial<PrevTestRow>) {
    setPrevTestRows((prev) => {
      const next = prev.map((r) => (r.id === rowId ? { ...r, ...patch, legacyText: undefined } : r));
      persistRows(next);
      return next;
    });
  }

  function removeRow(rowId: string) {
    setPrevTestRows((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      persistRows(next);
      return next;
    });
  }

  function addRow() {
    setPrevTestRows((prev) => [
      ...prev,
      { id: newRowId(), testType: "", date: "", source: "", notes: "" },
    ]);
  }

  const hasLegacyRow = prevTestRows.some((r) => !!r.legacyText);

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted flex items-center gap-1.5 mb-1.5">
            <Stethoscope className="w-3 h-3" /> Dx — Diagnoses
          </label>
          <Textarea
            placeholder="HTN, DM2, HLD…"
            className="min-h-[60px] resize-none text-sm bg-white border-finance-border"
            value={localDx}
            onChange={(e) => setLocalDx(e.target.value)}
            onBlur={() => {
              if (localDx !== (patient.diagnoses || "")) onUpdate("diagnoses", localDx);
            }}
            data-testid={`input-dx-${patient.id}`}
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted flex items-center gap-1.5 mb-1.5">
            <FileText className="w-3 h-3" /> Hx — History / PMH
          </label>
          <Textarea
            placeholder="CAD, CVA, PAD…"
            className="min-h-[60px] resize-none text-sm bg-white border-finance-border"
            value={localHx}
            onChange={(e) => setLocalHx(e.target.value)}
            onBlur={() => {
              if (localHx !== (patient.history || "")) onUpdate("history", localHx);
            }}
            data-testid={`input-hx-${patient.id}`}
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted flex items-center gap-1.5 mb-1.5">
            <Pill className="w-3 h-3" /> Rx — Medications
          </label>
          <Textarea
            placeholder="Metformin, Lisinopril…"
            className="min-h-[60px] resize-none text-sm bg-white border-finance-border"
            value={localRx}
            onChange={(e) => setLocalRx(e.target.value)}
            onBlur={() => {
              if (localRx !== (patient.medications || "")) onUpdate("medications", localRx);
            }}
            data-testid={`input-rx-${patient.id}`}
          />
        </div>
      </div>

      <div className="rounded-xl border border-finance-border bg-white p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted flex items-center gap-1.5">
            <ClipboardList className="w-3 h-3" />
            Previous Tests
            {!localNoPrevTests && <span className="text-red-500 font-bold ml-0.5">*</span>}
          </label>
          <div className="flex items-center gap-3">
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none"
              data-testid={`label-no-prev-tests-${patient.id}`}
            >
              <input
                type="checkbox"
                checked={localNoPrevTests}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setLocalNoPrevTests(checked);
                  if (checked) {
                    setPrevTestRows([]);
                    setLocalPrevTests("");
                    setLocalPrevTestsDate("");
                    onUpdate("noPreviousTests", true);
                    onUpdate("previousTests", "");
                    onUpdate("previousTestsDate", "");
                  } else {
                    onUpdate("noPreviousTests", false);
                  }
                }}
                className="w-3.5 h-3.5 accent-primary"
                data-testid={`checkbox-no-prev-tests-${patient.id}`}
              />
              <span className="text-xs text-finance-text-secondary">No previous tests</span>
            </label>
            {!localNoPrevTests && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                className="h-7 text-xs gap-1"
                data-testid={`button-add-prev-test-${patient.id}`}
              >
                <Plus className="w-3 h-3" />
                Add Previous Test
              </Button>
            )}
          </div>
        </div>

        {!localNoPrevTests && (
          <div className="space-y-2">
            {prevTestRows.length === 0 ? (
              <p className="text-xs text-finance-text-muted italic">
                No previous tests added. Click <span className="font-medium">Add Previous Test</span> to log one, or check
                <span className="font-medium"> No previous tests</span>.
              </p>
            ) : null}

            {prevTestRows.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-finance-border bg-finance-bg-soft p-3"
                data-testid={`row-prev-test-${patient.id}-${row.id}`}
              >
                {row.legacyText ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                      Existing entry — review and replace
                    </p>
                    <Textarea
                      readOnly
                      value={row.legacyText}
                      className="min-h-[50px] resize-none text-xs bg-white"
                      data-testid={`input-prev-test-legacy-${patient.id}`}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => removeRow(row.id)}
                        data-testid={`button-remove-prev-test-${patient.id}-${row.id}`}
                      >
                        <X className="w-3 h-3" />
                        Clear
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                    <div className="md:col-span-3">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                        Test
                      </label>
                      <Select
                        value={row.testType}
                        onValueChange={(v) => updateRow(row.id, { testType: v })}
                      >
                        <SelectTrigger
                          className="h-8 text-xs"
                          data-testid={`select-prev-test-type-${patient.id}-${row.id}`}
                        >
                          <SelectValue placeholder="Test type" />
                        </SelectTrigger>
                        <SelectContent>
                          {TEST_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt} className="text-xs">
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-3">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                        Date
                      </label>
                      <Input
                        type="date"
                        value={row.date}
                        onChange={(e) => updateRow(row.id, { date: e.target.value })}
                        className="h-8 text-xs"
                        data-testid={`input-prev-test-date-${patient.id}-${row.id}`}
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                        Source
                      </label>
                      <div
                        className="flex items-center gap-1"
                        role="radiogroup"
                        aria-label="Source"
                      >
                        {SOURCE_OPTIONS.map((src) => {
                          const selected = row.source === src;
                          return (
                            <button
                              type="button"
                              key={src}
                              onClick={() => updateRow(row.id, { source: src })}
                              role="radio"
                              aria-checked={selected}
                              className={`h-8 px-2.5 rounded-full text-[11px] font-medium border transition-colors ${
                                selected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-white text-finance-text-secondary border-finance-border-strong hover:bg-finance-bg-soft"
                              }`}
                              data-testid={`pill-prev-test-source-${patient.id}-${row.id}-${src.toLowerCase()}`}
                            >
                              {src}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                        Notes
                      </label>
                      <Input
                        placeholder="Optional"
                        value={row.notes}
                        onChange={(e) => updateRow(row.id, { notes: e.target.value })}
                        className="h-8 text-xs"
                        data-testid={`input-prev-test-notes-${patient.id}-${row.id}`}
                      />
                    </div>
                    <div className="md:col-span-1 flex items-end justify-end h-full">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(row.id)}
                        title="Remove previous test"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        data-testid={`button-remove-prev-test-${patient.id}-${row.id}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {!isRowComplete(row) && (
                      <div className="md:col-span-12 -mt-1">
                        <p className="text-[11px] text-red-500">
                          Required — Test type, Date, and Source must all be set.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {hasLegacyRow && (
              <p className="text-[11px] text-finance-text-muted">
                Existing entries above were imported as text. Click <span className="font-medium">Add Previous Test</span> to
                replace them with structured rows; clearing the text-only entry removes it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
