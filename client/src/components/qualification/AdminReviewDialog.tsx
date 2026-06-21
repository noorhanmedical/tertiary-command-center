import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Loader2,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Plus,
  RefreshCw,
  Sparkles,
  StickyNote,
  Trash2,
  X,
  Search,
  FileText,
  BookOpen,
  Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PatientScreening } from "@shared/schema";
import { computeAdminReview, type AdminApprovalStatus } from "@/lib/adminReviewStatus";
import { PatientPdfActions } from "@/components/qualification/PatientPdfActions";
import {
  openPatientPacketPrintPreview,
} from "@/lib/pdfGeneration";
import {
  validateSameFacilityDatePacket,
  type PdfPacketSourcePatient,
} from "@/lib/pdfPacketGrouping";
import { auditPacketPatients, type PacketQaReport } from "@/lib/packetQa";
import { PacketQaBlockingDialog } from "@/components/plexus-iq/PacketQaBlockingDialog";
import {
  categoryIcons,
  categoryLabels,
  categoryStyles,
  getAncillaryCategory,
} from "@/features/schedule/ancillaryMeta";
import type {
  AdminReviewAncillaryId,
  AdminReviewRuleCandidate,
  AdminReviewRuleResult,
  AdminEvidenceChip,
  AdminDiagnosisSuggestion,
} from "@shared/plexus-iq/adminReviewEvidence";
import { evidenceForUltrasoundTest } from "@shared/plexus-iq/adminReviewEvidence";

export type AdminReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: PatientScreening;
  facility?: string | null;
  scheduleDate?: string | null;
  onUpdate: (
    field: string,
    value: string | string[] | boolean | Record<string, unknown>,
  ) => void;
  onAddTest?: (test: string) => void;
  onRemoveTest?: (test: string) => void;
  // Sibling navigation. When the caller passes the full list of
  // patients for the surrounding date/group, the dialog renders
  // Prev / Next arrows + a "N of M" counter and auto-advances to
  // the next sibling on Approve / Pend / Reject. If `siblings` is
  // omitted, the dialog falls back to single-patient behaviour
  // (close on approve).
  // SOURCE MARKER: Admin Review sibling navigation
  siblings?: PatientScreening[];
  dateLabel?: string | null;
};

const ANCILLARIES: AdminReviewAncillaryId[] = ["brainwave", "vitalwave", "ultrasound"];

// Literal per-ancillary regenerate testIds so QA `requireText` can find them.
const REGENERATE_TEST_IDS: Record<AdminReviewAncillaryId, string> = {
  brainwave: "admin-review-regenerate-brainwave",
  vitalwave: "admin-review-regenerate-vitalwave",
  ultrasound: "admin-review-regenerate-ultrasound",
};

const STATUS_META: Record<
  AdminApprovalStatus,
  { label: string; pillClass: string }
> = {
  pending: {
    label: "Pending",
    pillClass: "bg-slate-100 text-slate-700 border border-slate-200",
  },
  approved: {
    label: "Approved",
    pillClass: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  },
  needs_info: {
    // Visible label kept short to avoid the legacy needs-info phrasing
    // that lived on ancillary bars. The approval state itself remains
    // `needs_info` for backend compat.
    label: "Pending Info",
    pillClass: "bg-amber-50 text-amber-800 border border-amber-200",
  },
  rejected: {
    label: "Rejected",
    pillClass: "bg-rose-50 text-rose-800 border border-rose-200",
  },
};

// Audit/change-log entry shown in the bottom "Updates Made In Patient"
// box. This is a thin trace surface, not a second clinical truth
// layer — every entry mirrors an action the admin took during this
// review session.
export type AdminReviewUpdateType =
  | "diagnosis_added"
  | "medication_added"
  | "symptom_added"
  | "icd_added"
  | "suggestion_accepted"
  | "qualifying_factor_removed"
  | "ancillary_removed"
  | "ultrasound_child_removed"
  | "regenerate"
  | "pdf_previewed"
  | "admin_note_updated"
  | "approval_approved"
  | "approval_pended"
  | "approval_needs_info"
  | "approval_rejected"
  | "scheduler_routing_changed";

export type AdminReviewUpdateEntry = {
  id: string;
  type: AdminReviewUpdateType;
  label: string;
  at: string;
  by?: string | null;
  metadata?: Record<string, unknown>;
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-800 border-emerald-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-rose-50 text-rose-800 border-rose-200",
};

// ────────────────────────────────────────────────────────────────────
// SupportingButton model — single shape for every clickable item in
// the right-panel popover button rows.
// ────────────────────────────────────────────────────────────────────
type SupportingButtonKind =
  | "icd_disease"
  | "medication"
  | "symptom"
  | "history"
  | "prior_test";

type SupportingButtonSource =
  | "Dx"
  | "Rx"
  | "Hx"
  | "Prior Test"
  | "AI ICD Search"
  | "Rule Engine";

type SupportingButton = {
  id: string;
  kind: SupportingButtonKind;
  label: string;
  source: SupportingButtonSource;
  sourceText?: string | null;
  icdCode?: string | null;
  icdLabel?: string | null;
  requiresIcd?: boolean;
  medicationName?: string | null;
  symptomName?: string | null;
  confidence?: "high" | "medium" | "low";
};

function buttonKey(b: SupportingButton): string {
  if (b.kind === "icd_disease") {
    return `icd:${b.icdCode ?? "needs"}:${b.label.toLowerCase()}`;
  }
  if (b.kind === "medication") return `med:${(b.medicationName ?? b.label).toLowerCase()}`;
  if (b.kind === "symptom" || b.kind === "history") return `hx:${b.label.toLowerCase()}`;
  if (b.kind === "prior_test") return `prior:${b.label.toLowerCase()}`;
  return `${b.kind}:${b.label.toLowerCase()}`;
}

function makeId(parts: string[]): string {
  return parts
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ────────────────────────────────────────────────────────────────────
// Source parsers — read raw Hx/Dx/Rx and produce buttons.
// ────────────────────────────────────────────────────────────────────

const ICD_LINE_RE = /([A-TV-Z][0-9][0-9A-Z]{0,2}(?:\.[0-9A-Z]{1,4})?)\s*[-:·]?\s*(.*)/i;

export function parseDiagnosisButtonsFromDx(diagnoses: string | null | undefined): SupportingButton[] {
  if (!diagnoses) return [];
  const out: SupportingButton[] = [];
  const seen = new Set<string>();
  const lines = diagnoses
    .split(/[\n;]+/)
    .flatMap((seg) => seg.split(/,(?![^()]*\))/g))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const raw of lines) {
    const m = ICD_LINE_RE.exec(raw);
    if (m && /^[A-TV-Z]/i.test(m[1])) {
      const code = m[1].toUpperCase();
      const label = (m[2] ?? "").trim() || code;
      const chip: SupportingButton = {
        id: makeId(["dx", code, label]),
        kind: "icd_disease",
        label,
        source: "Dx",
        sourceText: raw,
        icdCode: code,
        icdLabel: label,
        requiresIcd: false,
        confidence: "high",
      };
      const k = buttonKey(chip);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(chip);
      }
    } else if (raw.length > 1) {
      // Disease name only — no ICD attached.
      const label = raw.replace(/\.+$/, "").trim();
      const chip: SupportingButton = {
        id: makeId(["dx-no-icd", label]),
        kind: "icd_disease",
        label,
        source: "Dx",
        sourceText: raw,
        icdCode: null,
        icdLabel: null,
        requiresIcd: true,
        confidence: "medium",
      };
      const k = buttonKey(chip);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(chip);
      }
    }
  }
  return out;
}

const MED_DOSE_RE =
  /\s+(?:\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?|tabs?|cap(?:s)?|iu)|(?:bid|tid|qid|qd|qhs|prn|daily|nightly|q\d+h|po|sc|im|iv))\b.*$/i;

export function parseMedicationButtonsFromRx(medications: string | null | undefined): SupportingButton[] {
  if (!medications) return [];
  const out: SupportingButton[] = [];
  const seen = new Set<string>();
  const lines = medications
    .split(/[\n;]+/)
    .flatMap((seg) => seg.split(/,(?![^()]*\))/g))
    .flatMap((seg) => seg.split("/"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const raw of lines) {
    const cleaned = raw.replace(MED_DOSE_RE, "").trim().replace(/[.,]+$/, "").trim();
    if (!cleaned) continue;
    const name = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    const chip: SupportingButton = {
      id: makeId(["rx", name]),
      kind: "medication",
      label: name,
      source: "Rx",
      sourceText: raw,
      medicationName: name,
      confidence: "high",
    };
    const k = buttonKey(chip);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(chip);
    }
  }
  return out;
}

const SYMPTOM_KEYWORDS: Array<[string, string[]]> = [
  ["Dizziness", ["dizziness", "vertigo"]],
  ["Syncope", ["syncope"]],
  ["Edema", ["edema", "swelling"]],
  ["Dyspnea", ["dyspnea", "shortness of breath", "sob"]],
  ["Leg pain", ["leg pain"]],
  ["Claudication", ["claudication"]],
  ["Peripheral vascular disease concern", ["pad", "pvd", "peripheral vascular"]],
  ["Neuropathy", ["neuropathy"]],
  ["Bruit", ["bruit"]],
  ["Palpitations", ["palpitations"]],
  ["Chest pain", ["chest pain"]],
  ["Hypertension history", ["hypertension"]],
  ["Diabetes history", ["diabetes"]],
  ["Hyperlipidemia history", ["hyperlipidemia"]],
];

export function parseSymptomButtonsFromHx(history: string | null | undefined): SupportingButton[] {
  if (!history) return [];
  const lower = history.toLowerCase();
  const out: SupportingButton[] = [];
  const seen = new Set<string>();
  for (const [label, terms] of SYMPTOM_KEYWORDS) {
    if (terms.some((t) => lower.includes(t))) {
      const chip: SupportingButton = {
        id: makeId(["hx", label]),
        kind: "symptom",
        label,
        source: "Hx",
        sourceText: history,
        symptomName: label,
        confidence: "medium",
      };
      const k = buttonKey(chip);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(chip);
      }
    }
  }
  return out;
}

// Merge rule-engine evidence into the parsed buttons, deduped.
function mergeRuleEngineEvidence(
  base: SupportingButton[],
  evidence: AdminEvidenceChip[],
): SupportingButton[] {
  const seen = new Set(base.map(buttonKey));
  const out = [...base];
  for (const e of evidence) {
    let chip: SupportingButton | null = null;
    if (e.kind === "diagnosis" || e.kind === "icd") {
      chip = {
        id: makeId(["rule", "icd", e.icdCode ?? "needs", e.label]),
        kind: "icd_disease",
        label: e.label,
        source: "Rule Engine",
        sourceText: e.detail ?? null,
        icdCode: e.icdCode ?? null,
        icdLabel: e.icdLabel ?? null,
        requiresIcd: !!e.requiresIcd,
        confidence: e.confidence ?? "medium",
      };
    } else if (e.kind === "medication") {
      chip = {
        id: makeId(["rule", "rx", e.label]),
        kind: "medication",
        label: e.label,
        source: "Rule Engine",
        sourceText: e.detail ?? null,
        medicationName: e.label,
        confidence: e.confidence ?? "medium",
      };
    } else if (e.kind === "symptom" || e.kind === "risk_factor") {
      chip = {
        id: makeId(["rule", "hx", e.label]),
        kind: "symptom",
        label: e.label,
        source: "Rule Engine",
        sourceText: e.detail ?? null,
        symptomName: e.label,
        confidence: e.confidence ?? "medium",
      };
    } else if (e.kind === "prior_test") {
      chip = {
        id: makeId(["rule", "prior", e.label]),
        kind: "prior_test",
        label: e.label,
        source: "Prior Test",
        sourceText: e.detail ?? null,
        confidence: e.confidence ?? "medium",
      };
    }
    if (chip && !seen.has(buttonKey(chip))) {
      seen.add(buttonKey(chip));
      out.push(chip);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Canonical reasoning binding (reads patient.reasoning[testName]).
// ────────────────────────────────────────────────────────────────────
export type CanonicalReasoningCard = {
  testName: string;
  clinicianReasoning: string;
  patientExplanation: string;
  qualifyingFactors: string[];
  icd10Codes: string[];
  pearls: string[];
  confidence: "high" | "medium" | "low" | null;
  approvalRequired: boolean;
};

function reasoningAsObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

export function buildCanonicalReasoningByAncillary(
  patient: PatientScreening,
): Record<AdminReviewAncillaryId, CanonicalReasoningCard[]> {
  const reasoning = reasoningAsObject(patient.reasoning);
  const tests = Array.isArray(patient.qualifyingTests) ? patient.qualifyingTests : [];
  const grouped: Record<AdminReviewAncillaryId, CanonicalReasoningCard[]> = {
    brainwave: [],
    vitalwave: [],
    ultrasound: [],
  };
  for (const test of tests) {
    const category = getAncillaryCategory(test);
    if (category !== "brainwave" && category !== "vitalwave" && category !== "ultrasound") continue;
    const value = reasoning[test];
    const empty: CanonicalReasoningCard = {
      testName: test,
      clinicianReasoning: "",
      patientExplanation: "",
      qualifyingFactors: [],
      icd10Codes: [],
      pearls: [],
      confidence: null,
      approvalRequired: false,
    };
    if (value == null) {
      grouped[category].push(empty);
      continue;
    }
    if (typeof value === "string") {
      grouped[category].push({ ...empty, clinicianReasoning: value });
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      grouped[category].push({
        testName: test,
        clinicianReasoning:
          typeof value.clinician_understanding === "string" ? value.clinician_understanding : "",
        patientExplanation:
          typeof value.patient_talking_points === "string" ? value.patient_talking_points : "",
        qualifyingFactors: Array.isArray(value.qualifying_factors) ? value.qualifying_factors : [],
        icd10Codes: Array.isArray(value.icd10_codes) ? value.icd10_codes : [],
        pearls: Array.isArray(value.pearls) ? value.pearls : [],
        confidence:
          value.confidence === "high" || value.confidence === "medium" || value.confidence === "low"
            ? value.confidence
            : null,
        approvalRequired: !!value.approvalRequired,
      });
    }
  }
  return grouped;
}

// Local fallback evidence kept so /admin-review/evidence outage doesn't blank the popup.
export function buildLocalEvidenceFallback(patient: PatientScreening): AdminEvidenceChip[] {
  // Reused by the right-panel popovers through parsers; returned empty since parsers
  // now cover Dx/Rx/Hx directly. Kept as an exported function for QA continuity.
  void patient;
  return [];
}

// ────────────────────────────────────────────────────────────────────
// Assignment state — supports brainwave, vitalwave, and a two-level
// ultrasound (parent shared across child tests + per-test specific).
// ────────────────────────────────────────────────────────────────────
type UltrasoundAssignments = {
  parent: SupportingButton[];
  byTestName: Record<string, SupportingButton[]>;
};

type AdminReviewAssignmentState = {
  brainwave: SupportingButton[];
  vitalwave: SupportingButton[];
  ultrasound: UltrasoundAssignments;
};

type AssignmentTarget =
  | { type: "ancillary"; ancillaryId: "brainwave" | "vitalwave" }
  | { type: "ultrasound-parent" }
  | { type: "ultrasound-test"; testName: string }
  | { type: "all" };

function emptyAssignmentState(): AdminReviewAssignmentState {
  return {
    brainwave: [],
    vitalwave: [],
    ultrasound: { parent: [], byTestName: {} },
  };
}

function seedAssignmentsFromReasoning(
  reasoning: Record<string, any>,
): AdminReviewAssignmentState {
  const state = emptyAssignmentState();
  for (const id of ["brainwave", "vitalwave"] as const) {
    const entry = reasoning[`adminReview:${id}`];
    if (entry && typeof entry === "object" && Array.isArray(entry.assignedEvidence)) {
      state[id] = entry.assignedEvidence as SupportingButton[];
    }
  }
  const ultra = reasoning["adminReview:ultrasound"];
  if (ultra && typeof ultra === "object" && Array.isArray(ultra.assignedEvidence)) {
    state.ultrasound.parent = ultra.assignedEvidence as SupportingButton[];
  }
  // Per-test ultrasound child seeds under reasoning["adminReview:test:<name>"]
  for (const [key, value] of Object.entries(reasoning)) {
    if (!key.startsWith("adminReview:test:")) continue;
    const testName = key.slice("adminReview:test:".length);
    if (value && typeof value === "object" && Array.isArray((value as any).assignedEvidence)) {
      state.ultrasound.byTestName[testName] = (value as any).assignedEvidence as SupportingButton[];
    }
  }
  return state;
}

function chipKeyForAssignment(b: SupportingButton): string {
  return buttonKey(b);
}

// Admin Review persistence — corrective patch (b4b1569 follow-up).
//
// Build the next `reasoning` blob with `adminReview:<ancillary>` and
// `adminReview:test:<testName>` keys updated to reflect the operator's
// current `assignments` state.
//
// IMPORTANT: writer (this) and reader (`seedAssignmentsFromReasoning`)
// must stay symmetrical. If this key shape changes,
// close/reopen assignment persistence will break.
//
// Merge rules (preserve everything else):
//   - Other `adminReview:<a>` keys not touched here are passed through.
//   - Each touched key spreads its existing block then overwrites
//     `assignedEvidence` only, so any other admin metadata
//     (ancillaryId, ancillaryNote, regeneratedAt, regeneratedMode)
//     survives.
//   - Existing `reasoning[testName]` canonical entries are untouched.
//   - `adminReview:updates` audit log is untouched.
//
// `staleAncillaries` (optional): a set of ancillary ids whose
// `assignedEvidence` was just changed. The merge sets `stale: true`
// + `staleReason` + `staleAt` on those blocks so the UI and packet QA
// can block until regenerate runs. Other blocks' stale flags are left
// alone.
//
// `clearedAncillaries` (optional): a set whose stale flags should be
// cleared (used by the regenerate success handler).
type AssignedEvidenceMergeOptions = {
  staleAncillaries?: Set<string>;
  staleReason?: string;
  clearedAncillaries?: Set<string>;
};

function buildAssignedEvidenceReasoning(
  prevReasoning: Record<string, unknown>,
  assignments: AdminReviewAssignmentState,
  options: AssignedEvidenceMergeOptions = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...prevReasoning };
  const staleSet = options.staleAncillaries ?? new Set<string>();
  const clearedSet = options.clearedAncillaries ?? new Set<string>();
  const staleReason = options.staleReason ?? "Evidence assignment changed";
  const nowIso = new Date().toISOString();

  for (const id of ["brainwave", "vitalwave", "ultrasound"] as const) {
    const key = `adminReview:${id}`;
    const existing =
      next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
        ? (next[key] as Record<string, unknown>)
        : {};
    const newAssigned =
      id === "ultrasound" ? assignments.ultrasound.parent : assignments[id];
    const merged: Record<string, unknown> = {
      ...existing,
      ancillaryId: id,
      assignedEvidence: newAssigned,
    };
    if (staleSet.has(id)) {
      merged.stale = true;
      merged.staleReason = staleReason;
      merged.staleAt = nowIso;
    }
    if (clearedSet.has(id)) {
      merged.stale = false;
      merged.staleReason = null;
      merged.staleAt = null;
    }
    next[key] = merged;
  }
  // Ultrasound child tests live under their own key.
  for (const [testName, assigned] of Object.entries(
    assignments.ultrasound.byTestName,
  )) {
    const key = `adminReview:test:${testName}`;
    const existing =
      next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
        ? (next[key] as Record<string, unknown>)
        : {};
    const childKey = `test:${testName}`;
    const merged: Record<string, unknown> = {
      ...existing,
      testName,
      assignedEvidence: assigned,
    };
    if (staleSet.has(childKey)) {
      merged.stale = true;
      merged.staleReason = staleReason;
      merged.staleAt = nowIso;
    }
    if (clearedSet.has(childKey)) {
      merged.stale = false;
      merged.staleReason = null;
      merged.staleAt = null;
    }
    next[key] = merged;
  }
  return next;
}

/**
 * Return the set of "target ids" that the writer is responsible for.
 * Parents: `brainwave` / `vitalwave` / `ultrasound`.
 * Ultrasound children: `test:<testName>`.
 *
 * Used by the corrective patch to mark exactly the touched targets as
 * stale on attach/detach.
 */
function targetIdsForAssignmentTarget(
  target: AssignmentTarget,
): string[] {
  if (target.type === "all") return ["brainwave", "vitalwave", "ultrasound"];
  if (target.type === "ancillary") return [target.ancillaryId];
  if (target.type === "ultrasound-parent") return ["ultrasound"];
  if (target.type === "ultrasound-test") return [`test:${target.testName}`];
  return [];
}

/**
 * Read the stale target ids from a reasoning blob. Returns the same
 * id shape (`brainwave|vitalwave|ultrasound|test:<n>`) the writer uses.
 */
function readStaleTargetIds(reasoning: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const id of ["brainwave", "vitalwave", "ultrasound"] as const) {
    const block = reasoning[`adminReview:${id}`];
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).stale === true
    ) {
      out.push(id);
    }
  }
  for (const key of Object.keys(reasoning)) {
    if (!key.startsWith("adminReview:test:")) continue;
    const block = reasoning[key];
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).stale === true
    ) {
      out.push(`test:${key.slice("adminReview:test:".length)}`);
    }
  }
  return out;
}

function ancillaryLabelForTargetId(id: string): string {
  if (id === "brainwave") return "BrainWave";
  if (id === "vitalwave") return "VitalWave";
  if (id === "ultrasound") return "Ultrasound";
  if (id.startsWith("test:")) return `Ultrasound · ${id.slice("test:".length)}`;
  return id;
}

// ────────────────────────────────────────────────────────────────────
// ICD search result type
// ────────────────────────────────────────────────────────────────────
type IcdSearchResult = {
  code: string;
  label: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
};

type EvidencePayload = AdminReviewRuleResult & { ok?: boolean; patientId?: number };

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────
export function AdminReviewDialog({
  open,
  onOpenChange,
  patient: initialPatient,
  facility,
  scheduleDate,
  onUpdate,
  siblings,
  dateLabel,
}: AdminReviewDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Sibling navigation — the caller can pass the full date / group
  // list; this dialog walks it via Prev / Next arrows and
  // auto-advances after Approve / Pend / Reject. When `siblings`
  // is empty/undefined the dialog falls back to single-patient
  // behaviour (close on approve).
  // SOURCE MARKER: Admin Review sibling navigation
  // SOURCE MARKER: Admin Review auto-advances on approve when siblings exist
  const siblingList: PatientScreening[] =
    siblings && siblings.length > 0 ? siblings : [initialPatient];
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const i = siblingList.findIndex((p) => p.id === initialPatient.id);
    return i >= 0 ? i : 0;
  });
  // Re-anchor when the caller swaps the trigger patient (e.g. user
  // opens the dialog from a different row). Keying off a stable
  // signature of the sibling id list (first + last + length) catches
  // sibling-set mutations that share the same length — e.g. a row
  // dropped from the start and another added at the end — which the
  // older `siblingList.length` dependency missed and which left
  // activeIndex pointing at the wrong patient.
  // SOURCE MARKER: Admin Review sibling state reanchors safely
  // SOURCE MARKER: Platform performance pass avoids unnecessary Admin Review resets
  const siblingSignature =
    siblingList.length === 0
      ? "empty"
      : `${siblingList.length}:${siblingList[0]?.id ?? ""}:${siblingList[siblingList.length - 1]?.id ?? ""}`;
  useEffect(() => {
    const i = siblingList.findIndex((p) => p.id === initialPatient.id);
    setActiveIndex(i >= 0 ? i : 0);
    // siblingList identity changes every parent render — see signature
    // above for the meaningful-change key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPatient.id, siblingSignature]);
  const patient: PatientScreening =
    siblingList[activeIndex] ?? initialPatient;
  const hasPrev = siblings != null && siblings.length > 0 && activeIndex > 0;
  const hasNext =
    siblings != null && siblings.length > 0 && activeIndex < siblingList.length - 1;
  const totalSiblings = siblings?.length ?? 1;
  const remainingAfter = Math.max(0, siblingList.length - activeIndex - 1);

  function goToSibling(delta: number) {
    const next = activeIndex + delta;
    if (next < 0 || next >= siblingList.length) return;
    setActiveIndex(next);
  }

  const evidenceQuery = useQuery<EvidencePayload>({
    queryKey: ["admin-review-evidence", patient.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/patient-screenings/${patient.id}/admin-review/evidence`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load evidence (${res.status})`);
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  const reasoningObject = useMemo(
    () => reasoningAsObject(patient.reasoning),
    [patient.reasoning],
  );

  const [assignments, setAssignments] = useState<AdminReviewAssignmentState>(
    () => seedAssignmentsFromReasoning(reasoningObject),
  );
  const [adminNote, setAdminNote] = useState<string>("");
  const [ancillaryNotes, setAncillaryNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Per-ultrasound-child dropdown collapse state — defaults closed.
  const [ultrasoundChildExpanded, setUltrasoundChildExpanded] = useState<
    Record<string, boolean>
  >({});
  // Explicitly removed qualifying factors per ancillary / per ultrasound test.
  // The regenerate routes pass these to the AI service which subtracts them
  // from the merged factor set.
  type RemovedQualificationState = {
    brainwave: string[];
    vitalwave: string[];
    ultrasound: { parent: string[]; byTestName: Record<string, string[]> };
  };
  const [removedFactors, setRemovedFactors] = useState<RemovedQualificationState>({
    brainwave: [],
    vitalwave: [],
    ultrasound: { parent: [], byTestName: {} },
  });

  // AI ICD search state (added results live in this list until the user assigns them).
  const [icdSearchQuery, setIcdSearchQuery] = useState("");
  const [aiIcdButtons, setAiIcdButtons] = useState<SupportingButton[]>([]);

  const icdSearchMutation = useMutation<
    { ok: boolean; results: IcdSearchResult[]; error?: string; detail?: string },
    Error,
    { query: string }
  >({
    mutationFn: async ({ query }) => {
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-review/icd-search`,
        {
          query,
          patientContext: {
            diagnoses: patient.diagnoses ?? "",
            history: patient.history ?? "",
            medications: patient.medications ?? "",
          },
        },
      );
      return res.json();
    },
    onError: (err) => {
      toast({
        title: "ICD search failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const [regenInFlight, setRegenInFlight] = useState<Record<string, boolean>>({});
  // Admin Review regenerate error is surfaced — per-ancillary /
  // per-test error strings render inline on the bar so the user sees
  // the actual cause (missing OpenAI key, route 5xx, invalid response).
  // SOURCE MARKER: Admin Review regenerate error is surfaced
  const [regenErrors, setRegenErrors] = useState<Record<string, string | null>>({});

  // Extract a user-facing message from the raw apiRequest error. The
  // throwIfResNotOk helper produces messages shaped like
  //   "500: {\"error\":\"OpenAI universal ICD search failed: ...\"}"
  // so try to JSON-parse the body and surface .error; fall back to
  // the raw message.
  function extractRegenErrorMessage(err: unknown): string {
    if (!(err instanceof Error)) return "Unknown regenerate error";
    const m = err.message.match(/^\d{3}:\s*([\s\S]+)$/);
    const body = m ? m[1].trim() : err.message;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch {
      // not JSON, fall through.
    }
    return body || "Unknown regenerate error";
  }

  // Suggestion acceptance — a med-derived diagnosis becomes a real
  // SupportingButton only after the admin clicks accept.
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<SupportingButton[]>([]);

  // Drives the Engagement reference query (enabled only when "engagement").
  // Set when the Engagement reference collapsible is opened.
  const [leftTab, setLeftTab] = useState<
    "source" | "history" | "icd" | "engagement"
  >("source");

  // Engagement assignment for THIS patient — drives the scheduler
  // routing chip on the right panel and the highlight in the
  // Engagement tab call list.
  type EngagementAssignment = {
    patientScreeningId: number;
    executionCaseId: number | null;
    commitStatus: string | null;
    engagementStatus: string | null;
    engagementBucket: string | null;
    assignedRole: string | null;
    assignedTeamMemberId: number | null;
    scheduler: { id: number; name: string; facility: string } | null;
  };
  const engagementAssignmentQuery = useQuery<EngagementAssignment | null>({
    queryKey: ["/api/patients", patient.id, "engagement-assignment"],
    queryFn: async () => {
      const res = await fetch(
        `/api/patients/${patient.id}/engagement-assignment`,
        { credentials: "include" },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`engagement-assignment ${res.status}`);
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  // Scheduler-grouped call list — backed by /api/engagement/assignment-board,
  // grouped CLIENT-SIDE by assignedName since the backend returns a flat
  // list (no scheduler-grouped endpoint exists today). Patients filtered
  // to the current patient's facility so the call list shows the
  // scheduler context the admin is actually reviewing.
  //
  // SOURCE MARKER: Engagement Center source of truth
  // SOURCE MARKER: Scheduler call lists grouped by scheduler
  type EngagementBoardRow = {
    patientScreeningId: number | null;
    executionCaseId: number;
    patientName: string;
    patientDob: string | null;
    phoneNumber: string | null;
    facility: string | null;
    scheduleDate: string | null;
    patientType: string | null;
    engagementBucket: string | null;
    engagementStatus: string | null;
    commitStatus: string | null;
    assignedTeamMemberId: number | null;
    assignedRole: string | null;
    assignedName: string | null;
    assignedFacility: string | null;
    nextActionAt: string | null;
    lastActivityAt: string | null;
    lastActivitySummary: string | null;
    missingInfo: string[];
    selectedServiceList: string[];
  };
  const engagementBoardQuery = useQuery<{ rows: EngagementBoardRow[] }>({
    queryKey: [
      "/api/engagement/assignment-board",
      patient.facility ?? "_all_",
    ],
    queryFn: async () => {
      const url = patient.facility
        ? `/api/engagement/assignment-board?facility=${encodeURIComponent(patient.facility)}`
        : `/api/engagement/assignment-board`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`assignment-board ${res.status}`);
      return res.json();
    },
    enabled: open && leftTab === "engagement",
    staleTime: 30_000,
  });

  type SchedulerGroup = {
    schedulerKey: string;
    schedulerName: string;
    rows: EngagementBoardRow[];
  };

  const schedulerGroups: SchedulerGroup[] = useMemo(() => {
    const rows = engagementBoardQuery.data?.rows ?? [];
    const map = new Map<string, SchedulerGroup>();
    for (const r of rows) {
      const key = r.assignedTeamMemberId != null
        ? `id:${r.assignedTeamMemberId}`
        : "__unassigned__";
      const name = r.assignedName?.trim() || "Unassigned / Engagement Queue";
      const existing = map.get(key);
      if (existing) existing.rows.push(r);
      else map.set(key, { schedulerKey: key, schedulerName: name, rows: [r] });
    }
    const ordered = Array.from(map.values());
    ordered.sort((a, b) => {
      if (a.schedulerKey === "__unassigned__") return 1;
      if (b.schedulerKey === "__unassigned__") return -1;
      return a.schedulerName.localeCompare(b.schedulerName);
    });
    return ordered;
  }, [engagementBoardQuery.data]);

  // Per-scheduler selected patient IDs (patient_screenings.id) for the
  // scheduler-scoped Plexus / Clinician PDF buttons.
  // SOURCE MARKER: Scheduler PDF packets are scoped to assigned scheduler
  const [selectedByScheduler, setSelectedByScheduler] = useState<
    Record<string, Set<number>>
  >({});
  // Packet QA Gate — opened on per-scheduler PDF preview when audit
  // finds blockers. proceed() carries the printable subset forward.
  const [packetQa, setPacketQa] = useState<{
    report: PacketQaReport;
    proceed: () => void;
  } | null>(null);

  function toggleSelectedForScheduler(schedulerKey: string, patientId: number) {
    setSelectedByScheduler((prev) => {
      const next = new Set(prev[schedulerKey] ?? []);
      if (next.has(patientId)) next.delete(patientId);
      else next.add(patientId);
      return { ...prev, [schedulerKey]: next };
    });
  }

  function setAllSelectedForScheduler(group: SchedulerGroup) {
    setSelectedByScheduler((prev) => {
      const existing = prev[group.schedulerKey] ?? new Set<number>();
      const allIds = group.rows
        .map((r) => r.patientScreeningId)
        .filter((id): id is number => id != null);
      // If everyone is already selected, clear. Otherwise select all.
      const allSelected = allIds.length > 0 && allIds.every((id) => existing.has(id));
      const next = new Set<number>(allSelected ? [] : allIds);
      return { ...prev, [group.schedulerKey]: next };
    });
  }

  // Scheduler-scoped PDF packet generation. Pulls full patient
  // records for the selected ids, validates the facility/date
  // packet, then opens the canonical print-preview popup. The
  // operator hits "Print / Save as PDF" inside the popup to produce
  // the file — html2pdf / html2canvas are not used here so the
  // dialog stays responsive even on large selections.
  // SOURCE MARKER: Scheduler PDF packets are scoped to assigned scheduler
  // SOURCE MARKER: Admin Review packets use print preview
  // SOURCE MARKER: Admin Review packet print preview avoids html2canvas
  // SOURCE MARKER: Admin Review packet print preview opens printable popup
  async function generateSchedulerScopedPdf(
    group: SchedulerGroup,
    patientIds: number[],
    mode: "plexus" | "clinician",
  ) {
    if (patientIds.length === 0) {
      // SOURCE MARKER: Admin Review print preview errors are surfaced
      toast({
        title: "Select patients first.",
        description: `Pick at least one patient under ${group.schedulerName} to generate a packet.`,
        variant: "destructive",
      });
      return;
    }
    try {
      const fetched = await Promise.all(
        patientIds.map(async (id) => {
          const res = await fetch(`/api/patients/${id}`, { credentials: "include" });
          if (!res.ok) return null;
          return (await res.json()) as PatientScreening;
        }),
      );
      const fullPatients = fetched.filter((p): p is PatientScreening => p != null);
      if (fullPatients.length === 0) {
        toast({
          title: "PDF packet blocked",
          description: "Could not load any of the selected patients.",
          variant: "destructive",
        });
        return;
      }
      const validation = validateSameFacilityDatePacket(
        fullPatients as PdfPacketSourcePatient[],
        patient.facility ?? null,
        scheduleDate ?? null,
      );
      if (!validation.ok) {
        toast({
          title: "PDF packet blocked",
          description: validation.reason,
          variant: "destructive",
        });
        return;
      }
      const batchName = `${validation.patients[0]?.facility ?? group.schedulerName} · ${
        validation.isOutreachPacket ? "Outreach" : validation.scheduleDate
      }`;
      // Packet QA Gate — audit before opening preview.
      const openWithSubset = (subset: PatientScreening[]) => {
        const result = openPatientPacketPrintPreview({
          mode,
          batchName,
          patients: subset,
          scheduleDate: validation.scheduleDate,
          createdAt: null,
        });
        if (!result.ok && result.reason === "popup-blocked") {
          // SOURCE MARKER: Admin Review print preview popup blocked is surfaced
          toast({
            title: "Popup blocked. Allow popups to print this packet.",
            description:
              "Your browser blocked the print preview window. Re-enable popups for this site and try again.",
            variant: "destructive",
          });
          return;
        }
        recordAdminReviewUpdate(
          "pdf_previewed",
          `Generated ${mode === "plexus" ? "Plexus" : "Clinician"} PDF for ${group.schedulerName} (${subset.length})`,
          { scheduler: group.schedulerName, kind: mode },
        );
      };

      const qaReport = auditPacketPatients(validation.patients, mode);
      if (qaReport.blockedCount > 0) {
        const printable = validation.patients.filter(
          (p) => !qaReport.blockedPatients.some((b) => b.patientId === p.id),
        );
        setPacketQa({
          report: qaReport,
          proceed: () => {
            setPacketQa(null);
            openWithSubset(printable);
          },
        });
        return;
      }

      openWithSubset(validation.patients);
    } catch (err) {
      toast({
        title: "Could not open print preview",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  // Audit log. Seeded from patient.reasoning["adminReview:updates"]
  // so prior persisted entries survive a dialog reopen. New entries
  // append at the top and persist via onUpdate when the type allows.
  const [updatesLog, setUpdatesLog] = useState<AdminReviewUpdateEntry[]>(() => {
    const stored = (reasoningObject as Record<string, unknown>)["adminReview:updates"];
    if (Array.isArray(stored)) return stored as AdminReviewUpdateEntry[];
    return [];
  });

  // Admin Review persistence — corrective patch refs.
  //
  // `assignmentsRef` mirrors `assignments` so handlers read the latest
  // staged state synchronously without waiting for React to flush.
  //
  // `lastWrittenReasoningRef` is the authoritative local truth for
  // "what reasoning blob have we sent to the parent so far". We rebase
  // every attach/detach merge against this ref — NOT against
  // `patient.reasoning` — so a still-in-flight PATCH response cannot
  // overwrite a chained click's value.
  //
  // Both refs are RE-SEEDED inside the seed useEffect below whenever
  // the dialog opens or the patient swaps.
  const assignmentsRef = useRef<AdminReviewAssignmentState>(assignments);
  const lastWrittenReasoningRef = useRef<Record<string, unknown>>(
    reasoningAsObject(patient.reasoning),
  );

  useEffect(() => {
    if (!open) return;
    const freshAssignments = seedAssignmentsFromReasoning(
      reasoningAsObject(patient.reasoning),
    );
    setAssignments(freshAssignments);
    // Corrective patch: also seed the synchronous ref so the very
    // first attach/detach after open uses the seeded snapshot as base.
    assignmentsRef.current = freshAssignments;
    setAdminNote("");
    setAncillaryNotes({});
    setIcdSearchQuery("");
    setAiIcdButtons([]);
    setUltrasoundChildExpanded({});
    setAcceptedSuggestions([]);
    setRemovedFactors({
      brainwave: [],
      vitalwave: [],
      ultrasound: { parent: [], byTestName: {} },
    });
    const stored = reasoningAsObject(patient.reasoning)["adminReview:updates"];
    setUpdatesLog(Array.isArray(stored) ? (stored as AdminReviewUpdateEntry[]) : []);
    // Patch 1 (admin-review persistence fix):
    //   `patient.reasoning` is intentionally EXCLUDED from this
    //   dependency list. Per-ancillary regenerate updates
    //   patient.reasoning during an active editing session; including
    //   it here would re-run this seeder and wipe the operator's
    //   staged assignments for ancillaries that haven't been
    //   regenerated yet (e.g., regenerate BrainWave → VitalWave and
    //   Ultrasound staged evidence resets to the pre-regen saved
    //   state). The seeder is now an "entry-point only" reset: it
    //   runs when the dialog opens or the patient id changes, then
    //   yields to operator-driven state mutation until next
    //   open / patient swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient.id]);

  // Admin Review persistence — corrective patch.
  //
  // The previous patch (b4b1569) used a passive useEffect to persist
  // assignments on every `assignments` change. Replit smoke-test showed
  // that approach was insufficient: rapid attach clicks raced with
  // React Query cache propagation, the closure-stale `patient.reasoning`
  // used as merge base lost concurrent updates, and the
  // `sameAssignedEvidenceState` skip masked legitimate diffs in some
  // ordering paths.
  //
  // Corrective approach (this patch):
  //   1. `assignmentsRef` mirrors `assignments` so handlers can read
  //      the latest staged state synchronously without waiting for
  //      React to flush a render.
  //   2. `lastWrittenReasoningRef` is the authoritative local truth
  //      for "what reasoning blob have we sent to the parent so far".
  //      We rebase every attach/detach merge against this ref — NOT
  //      against `patient.reasoning` — so a still-in-flight PATCH
  //      response cannot overwrite a chained click's value.
  //   3. Attach and detach handlers compute the next state
  //      synchronously, update both refs, push to React state, and
  //      call `onUpdate("reasoning", ...)` in the same tick. No
  //      deferred effect.
  //   4. Regenerate-success handlers MERGE the server-returned
  //      `reasoning` with the live `lastWrittenReasoningRef.current`'s
  //      `adminReview:<other>.assignedEvidence` blocks before pushing
  //      out, so a server response that pre-dates a concurrent attach
  //      cannot wipe other targets' staged evidence.
  //
  // The refs themselves are declared higher up in the file (right
  // after `updatesLog` so they're in scope for the seed useEffect).
  // The seed useEffect re-seeds BOTH `assignmentsRef` and
  // `lastWrittenReasoningRef` on open / patient-swap.

  // Keep assignmentsRef in lockstep with React state — guards against
  // any code path that bypasses the handlers below.
  useEffect(() => {
    assignmentsRef.current = assignments;
  }, [assignments]);

  // Re-seed the lastWrittenReasoningRef whenever the dialog opens or
  // the patient swaps. The seed useEffect above resets `assignments`
  // to match; we mirror the same reset here so subsequent attach/
  // detach merges start from the real saved state.
  useEffect(() => {
    if (!open) return;
    lastWrittenReasoningRef.current = reasoningAsObject(patient.reasoning);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient.id]);

  /**
   * Persist a freshly-computed `assignments` snapshot through the
   * existing `onUpdate("reasoning", ...)` path. The merge base is
   * `lastWrittenReasoningRef.current` — NOT `patient.reasoning` from
   * props — so rapid sequential clicks chain correctly even before
   * React Query's cache catches up.
   *
   * `staleAncillaries` is the set of target ids whose `assignedEvidence`
   * the operator just changed. They're flagged stale until the next
   * regenerate runs.
   */
  function persistAssignmentsToReasoning(
    nextAssignments: AdminReviewAssignmentState,
    staleAncillaries: Set<string>,
    staleReason: string,
  ): void {
    const base = lastWrittenReasoningRef.current;
    const nextReasoning = buildAssignedEvidenceReasoning(
      base,
      nextAssignments,
      { staleAncillaries, staleReason },
    );
    lastWrittenReasoningRef.current = nextReasoning;
    onUpdate("reasoning", nextReasoning);
  }

  /**
   * After a regenerate success, the server returns `data.patient.reasoning`.
   * That response is reliable for the *regenerated* ancillary, but for
   * OTHER ancillaries it reflects whatever was last persisted before
   * the regenerate kicked off — which may NOT include attach/detach
   * changes the operator made while the regenerate was in flight.
   *
   * Re-overlay the live `lastWrittenReasoningRef`'s
   * `adminReview:<other>.assignedEvidence` blocks on top of the
   * server's response, then clear the just-regenerated ancillary's
   * stale flag. The result becomes the new authoritative local truth.
   */
  function mergeRegenerateResponseReasoning(
    serverReasoning: Record<string, unknown>,
    regeneratedTargetIds: Set<string>,
  ): Record<string, unknown> {
    const live = lastWrittenReasoningRef.current;
    const merged: Record<string, unknown> = { ...serverReasoning };
    // Carry forward every adminReview:* block that was newer locally
    // (i.e., any block whose `assignedEvidence` array differs). The
    // regenerated targets' blocks come from the server.
    for (const key of new Set([...Object.keys(live), ...Object.keys(serverReasoning)])) {
      if (!key.startsWith("adminReview:")) continue;
      if (key === "adminReview:updates") {
        // Audit log: prefer server if present, else local.
        if (serverReasoning[key] !== undefined) merged[key] = serverReasoning[key];
        else if (live[key] !== undefined) merged[key] = live[key];
        continue;
      }
      const targetId = key === "adminReview:ultrasound" ? "ultrasound"
        : key === "adminReview:brainwave" ? "brainwave"
        : key === "adminReview:vitalwave" ? "vitalwave"
        : key.startsWith("adminReview:test:") ? `test:${key.slice("adminReview:test:".length)}`
        : null;
      if (targetId == null) continue;
      if (regeneratedTargetIds.has(targetId)) {
        // Trust server for the regenerated block.
        if (serverReasoning[key] !== undefined) merged[key] = serverReasoning[key];
      } else {
        // Carry forward local block (preserves operator's staged
        // assignedEvidence + stale flag for non-regenerated targets).
        if (live[key] !== undefined) merged[key] = live[key];
      }
    }
    // Clear stale for the regenerated targets — overlay onto whichever
    // block now wins.
    const cleared = buildAssignedEvidenceReasoning(
      merged,
      assignmentsRef.current,
      {
        clearedAncillaries: regeneratedTargetIds,
      },
    );
    return cleared;
  }

  // recordAdminReviewUpdate — append to the session log and persist
  // to patient.reasoning["adminReview:updates"] so the audit trail
  // survives across reopens. Safe metadata-only persistence; never
  // mutates Hx/Dx/Rx.
  function recordAdminReviewUpdate(
    type: AdminReviewUpdateType,
    label: string,
    metadata?: Record<string, unknown>,
  ) {
    const entry: AdminReviewUpdateEntry = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      label,
      at: new Date().toISOString(),
      metadata,
    };
    setUpdatesLog((prev) => {
      const next = [entry, ...prev].slice(0, 200);
      const reasoning = reasoningAsObject(patient.reasoning);
      const nextReasoning = { ...reasoning, "adminReview:updates": next };
      onUpdate("reasoning", nextReasoning);
      return next;
    });
  }

  const apiEvidence: AdminEvidenceChip[] = evidenceQuery.data?.evidence ?? [];

  // Build assignable button lists from raw source + rule engine + AI ICD additions.
  const dxButtons = useMemo(
    () => parseDiagnosisButtonsFromDx(patient.diagnoses),
    [patient.diagnoses],
  );
  const rxButtons = useMemo(
    () => parseMedicationButtonsFromRx(patient.medications),
    [patient.medications],
  );
  const hxButtons = useMemo(
    () => parseSymptomButtonsFromHx(patient.history),
    [patient.history],
  );
  const mergedDx = useMemo(
    () => mergeRuleEngineEvidence(dxButtons, apiEvidence),
    [dxButtons, apiEvidence],
  );
  const mergedRx = useMemo(
    () => mergeRuleEngineEvidence(rxButtons, apiEvidence).filter((b) => b.kind === "medication" && (rxButtons.find((x) => buttonKey(x) === buttonKey(b)) || b.source === "Rule Engine")),
    [rxButtons, apiEvidence],
  );
  const mergedHx = useMemo(
    () =>
      mergeRuleEngineEvidence(hxButtons, apiEvidence).filter(
        (b) => b.kind === "symptom" || b.kind === "history" || b.kind === "prior_test",
      ),
    [hxButtons, apiEvidence],
  );

  // Dedicated AI ICD result buttons (user-added via search) + accepted
  // medication-derived suggestions. A suggestion only enters this list
  // after the admin explicitly clicks accept — until then it lives in
  // the right-panel Diagnosis popover as a dashed inactive chip.
  // SOURCE MARKER: Medication-derived diagnosis suggestions are inactive until accepted
  const availableButtons = useMemo(() => {
    const seen = new Set<string>();
    const out: SupportingButton[] = [];
    for (const list of [mergedDx, aiIcdButtons, acceptedSuggestions, mergedRx, mergedHx]) {
      for (const b of list) {
        const k = buttonKey(b);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(b);
        }
      }
    }
    return out;
  }, [mergedDx, mergedRx, mergedHx, aiIcdButtons, acceptedSuggestions]);

  // Rule-engine suggestions filtered to those NOT already accepted or
  // covered by an existing diagnosis chip.
  const ruleSuggestions: AdminDiagnosisSuggestion[] =
    evidenceQuery.data?.suggestions ?? [];
  const activeDiagnosisLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const b of availableButtons) {
      if (b.kind === "icd_disease") labels.add(b.label.toLowerCase());
    }
    return labels;
  }, [availableButtons]);
  const visibleSuggestions = useMemo(
    () => ruleSuggestions.filter((s) => !activeDiagnosisLabels.has(s.label.toLowerCase())),
    [ruleSuggestions, activeDiagnosisLabels],
  );

  function acceptDiagnosisSuggestion(s: AdminDiagnosisSuggestion) {
    const chip: SupportingButton = {
      id: makeId(["suggestion", s.id]),
      kind: "icd_disease",
      label: s.label,
      source: "AI ICD Search",
      sourceText: s.reason,
      icdCode: s.suggestedIcds?.[0]?.code ?? null,
      icdLabel: s.suggestedIcds?.[0]?.label ?? null,
      // requiresIcd does not block placement — an accepted suggestion
      // is a real diagnosis chip even if no code is selected.
      // SOURCE MARKER: requiresIcd does not block chip placement
      requiresIcd: !s.suggestedIcds?.[0]?.code,
      confidence: "medium",
    };
    setAcceptedSuggestions((prev) => {
      if (prev.some((b) => buttonKey(b) === buttonKey(chip))) return prev;
      return [...prev, chip];
    });
    recordAdminReviewUpdate("suggestion_accepted", `Accepted suggestion: ${s.label}`, {
      suggestionId: s.id,
      trigger: s.triggerLabel ?? null,
    });
  }

  const candidates: AdminReviewRuleCandidate[] = evidenceQuery.data?.candidates ?? [];
  const candidateById = useMemo(() => {
    const map = new Map<AdminReviewAncillaryId, AdminReviewRuleCandidate>();
    for (const c of candidates) map.set(c.ancillaryId, c);
    return map;
  }, [candidates]);

  const ageNumber: number | null =
    typeof patient.age === "number" ? patient.age : null;
  const isUnder16 = (ageNumber ?? 99) < 16;

  const review = useMemo(
    () =>
      computeAdminReview({
        name: patient.name,
        dob: patient.dob,
        phoneNumber: patient.phoneNumber,
        facility: patient.facility,
        qualifyingTests: patient.qualifyingTests ?? [],
        commitStatus: patient.commitStatus,
        adminApprovalStatus:
          (patient as { adminApprovalStatus?: string | null }).adminApprovalStatus ?? null,
      }),
    [patient],
  );

  const canonicalReasoningByAncillary = useMemo(
    () => buildCanonicalReasoningByAncillary(patient),
    [patient],
  );

  const ultrasoundTests = canonicalReasoningByAncillary.ultrasound.map((c) => c.testName);

  // Convert rule-engine AdminEvidenceChip → SupportingButton so the
  // bar can render seeded chips inline alongside user-assigned ones.
  function evidenceToSupporting(chip: AdminEvidenceChip): SupportingButton {
    if (chip.kind === "diagnosis" || chip.kind === "icd") {
      return {
        id: makeId(["rule", "icd", chip.icdCode ?? "needs", chip.label]),
        kind: "icd_disease",
        label: chip.label,
        source: "Rule Engine",
        sourceText: chip.detail ?? null,
        icdCode: chip.icdCode ?? null,
        icdLabel: chip.icdLabel ?? null,
        // SOURCE MARKER: requiresIcd does not block chip placement
        requiresIcd: !!chip.requiresIcd,
        confidence: chip.confidence ?? "medium",
      };
    }
    if (chip.kind === "medication") {
      return {
        id: makeId(["rule", "rx", chip.label]),
        kind: "medication",
        label: chip.label,
        source: "Rule Engine",
        sourceText: chip.detail ?? null,
        medicationName: chip.label,
        confidence: chip.confidence ?? "medium",
      };
    }
    if (chip.kind === "prior_test") {
      return {
        id: makeId(["rule", "prior", chip.label]),
        kind: "prior_test",
        label: chip.label,
        source: "Prior Test",
        sourceText: chip.detail ?? null,
        confidence: chip.confidence ?? "medium",
      };
    }
    return {
      id: makeId(["rule", chip.kind, chip.label]),
      kind: "symptom",
      label: chip.label,
      source: "Rule Engine",
      sourceText: chip.detail ?? null,
      symptomName: chip.label,
      confidence: chip.confidence ?? "medium",
    };
  }

  // Rule-engine evidence that the bar should display as a seeded chip.
  // BrainWave pulls neurovascular/dizziness; VitalWave pulls vascular
  // risk/edema/dyspnea. Medications are ALWAYS supporting context for
  // any bar — they never become a diagnosis.
  // SOURCE MARKER: Medications do not auto-create diagnoses
  function ruleSeededChipsForAncillary(
    id: "brainwave" | "vitalwave",
  ): SupportingButton[] {
    const out: SupportingButton[] = [];
    for (const chip of apiEvidence) {
      const label = chip.label.toLowerCase();
      if (chip.kind === "medication") {
        out.push(evidenceToSupporting(chip));
        continue;
      }
      if (id === "brainwave") {
        if (["dizziness", "syncope", "neuropathy", "bruit", "stroke", "tia"].some((t) => label.includes(t))) {
          out.push(evidenceToSupporting(chip));
        }
        continue;
      }
      // vitalwave
      if (
        ["edema", "dyspnea", "claudication", "leg pain", "peripheral vascular", "pvd"].some((t) => label.includes(t))
      ) {
        out.push(evidenceToSupporting(chip));
        continue;
      }
      if (
        chip.kind === "diagnosis" &&
        ["diabetes", "hypertension", "hyperlipidemia"].some((t) => label.includes(t))
      ) {
        out.push(evidenceToSupporting(chip));
      }
    }
    return out;
  }

  function ruleSeededChipsForUltrasoundParent(): SupportingButton[] {
    return apiEvidence.map(evidenceToSupporting);
  }

  function ruleSeededChipsForUltrasoundTest(testName: string): SupportingButton[] {
    return evidenceForUltrasoundTest(testName, apiEvidence).map(evidenceToSupporting);
  }

  // Combine user-assigned chips with rule-engine-seeded ones,
  // deduped. Seeded chips never displace a user click.
  function combineChips(
    selected: SupportingButton[],
    seeded: SupportingButton[],
  ): Array<{ chip: SupportingButton; seeded: boolean }> {
    const keys = new Set(selected.map(chipKeyForAssignment));
    const out: Array<{ chip: SupportingButton; seeded: boolean }> = selected.map((c) => ({ chip: c, seeded: false }));
    for (const s of seeded) {
      const k = chipKeyForAssignment(s);
      if (keys.has(k)) continue;
      keys.add(k);
      out.push({ chip: s, seeded: true });
    }
    return out;
  }

  // ─── Merged qualifying chips (bar source of truth) ──────────────
  //
  // Merged qualifying chips are the Admin Review bar source of truth.
  // Closed bars render merged qualifying chips so the user can read
  // the qualifying factors without expanding the bar.
  // Canonical qualifying_factors are converted to bar chips here.
  // SOURCE MARKER: Merged qualifying chips are the Admin Review bar source of truth
  // SOURCE MARKER: Canonical qualifying_factors are converted to bar chips
  // SOURCE MARKER: Closed bars render merged qualifying chips
  type ChipOrigin = "user" | "canonical" | "rule-seeded";
  type DisplayChipKind = "icd_disease" | "medication" | "symptom" | "history" | "prior_test";
  type DisplayChip = {
    key: string;
    label: string;
    icdCode: string | null;
    kind: DisplayChipKind;
    origin: ChipOrigin;
    // The originating SupportingButton when the chip came from
    // assignments (user/rule-seeded). Empty for canonical-only chips.
    button?: SupportingButton;
    // For canonical chips: the test name whose qualifying_factors
    // contained this label. Used to scope removal on a parent bar.
    canonicalTestNames?: string[];
  };

  const ICD_INLINE_RE = /^([A-TV-Z][0-9][0-9A-Z]{0,2}(?:\.[0-9A-Z]{1,4})?)\s*[·:\-]\s*(.+)$/i;

  function inferChipKindFromLabel(label: string): DisplayChipKind {
    const lower = label.toLowerCase();
    const medHints = ["metformin", "insulin", "amlodipine", "lisinopril", "losartan", "metoprolol", "atorvastatin", "rosuvastatin", "aspirin", "apixaban", "rivaroxaban", "warfarin", "statin"];
    if (medHints.some((m) => lower.includes(m))) return "medication";
    const sxHints = ["dizziness", "syncope", "edema", "swelling", "dyspnea", "shortness of breath", "claudication", "leg pain", "calf pain", "bruit", "vertigo"];
    if (sxHints.some((s) => lower.includes(s))) return "symptom";
    return "icd_disease";
  }

  function normalizedKeyFor(label: string, icdCode: string | null | undefined, kind: DisplayChipKind): string {
    const cleanLabel = label.trim().toLowerCase().replace(/\s+/g, " ");
    const code = (icdCode ?? "").trim().toLowerCase();
    return `${kind}:${code}:${cleanLabel}`;
  }

  function chipFromButton(button: SupportingButton, origin: ChipOrigin): DisplayChip {
    const kind: DisplayChipKind =
      button.kind === "icd_disease" || button.kind === "medication" ||
      button.kind === "symptom" || button.kind === "history" ||
      button.kind === "prior_test"
        ? button.kind
        : "icd_disease";
    return {
      key: normalizedKeyFor(button.label, button.icdCode ?? null, kind),
      label: button.label,
      icdCode: button.icdCode ?? null,
      kind,
      origin,
      button,
    };
  }

  function chipFromCanonicalFactor(factor: string, testName: string): DisplayChip {
    const m = ICD_INLINE_RE.exec(factor.trim());
    if (m && /^[A-TV-Z]/i.test(m[1])) {
      const code = m[1].toUpperCase();
      const label = m[2].trim();
      return {
        key: normalizedKeyFor(label, code, "icd_disease"),
        label,
        icdCode: code,
        kind: "icd_disease",
        origin: "canonical",
        canonicalTestNames: [testName],
      };
    }
    const cleaned = factor.trim();
    const kind = inferChipKindFromLabel(cleaned);
    return {
      key: normalizedKeyFor(cleaned, null, kind),
      label: cleaned,
      icdCode: null,
      kind,
      origin: "canonical",
      canonicalTestNames: [testName],
    };
  }

  // Dedupe by normalized key. Priority when the same key appears in
  // multiple origins: user > canonical > rule-seeded. Canonical entries
  // accumulate every testName they came from so an ancillary-level
  // removal can strip the factor from each test's qualifying_factors.
  function dedupeChips(chips: DisplayChip[]): DisplayChip[] {
    const priority: Record<ChipOrigin, number> = { user: 0, canonical: 1, "rule-seeded": 2 };
    const map = new Map<string, DisplayChip>();
    for (const chip of chips) {
      const existing = map.get(chip.key);
      if (!existing) {
        map.set(chip.key, { ...chip, canonicalTestNames: chip.canonicalTestNames ? [...chip.canonicalTestNames] : undefined });
        continue;
      }
      const winsBy: ChipOrigin = priority[chip.origin] < priority[existing.origin] ? chip.origin : existing.origin;
      const winner = winsBy === chip.origin ? chip : existing;
      // Always merge canonical test names so an ancillary-level remove
      // can strip every occurrence.
      const merged: DisplayChip = {
        ...winner,
        canonicalTestNames: Array.from(
          new Set([
            ...(existing.canonicalTestNames ?? []),
            ...(chip.canonicalTestNames ?? []),
          ]),
        ),
      };
      if (merged.canonicalTestNames && merged.canonicalTestNames.length === 0) {
        merged.canonicalTestNames = undefined;
      }
      map.set(chip.key, merged);
    }
    return Array.from(map.values());
  }

  function isChipRemoved(chip: DisplayChip, removedLabels: string[]): boolean {
    const lower = removedLabels.map((s) => s.toLowerCase().trim());
    const a = chip.label.toLowerCase().trim();
    const b = chip.icdCode ? `${chip.icdCode} · ${chip.label}`.toLowerCase().trim() : null;
    return lower.includes(a) || (b !== null && lower.includes(b));
  }

  function getMergedQualifyingChipsForAncillary(
    id: "brainwave" | "vitalwave",
  ): DisplayChip[] {
    const userChips = selectedFor(id).map((b) => chipFromButton(b, "user"));
    const canonicalChips: DisplayChip[] = [];
    for (const card of canonicalReasoningByAncillary[id]) {
      for (const f of card.qualifyingFactors) {
        canonicalChips.push(chipFromCanonicalFactor(f, card.testName));
      }
    }
    const ruleSeededChips = ruleSeededChipsForAncillary(id).map((b) =>
      chipFromButton(b, "rule-seeded"),
    );
    return dedupeChips([...userChips, ...canonicalChips, ...ruleSeededChips]).filter(
      (c) => !isChipRemoved(c, removedFactors[id]),
    );
  }

  function getMergedQualifyingChipsForUltrasoundParent(): DisplayChip[] {
    const userChips = ultrasoundParentSelected().map((b) =>
      chipFromButton(b, "user"),
    );
    const canonicalChips: DisplayChip[] = [];
    for (const card of canonicalReasoningByAncillary.ultrasound) {
      for (const f of card.qualifyingFactors) {
        canonicalChips.push(chipFromCanonicalFactor(f, card.testName));
      }
    }
    const ruleSeededChips = ruleSeededChipsForUltrasoundParent().map((b) =>
      chipFromButton(b, "rule-seeded"),
    );
    return dedupeChips([
      ...userChips,
      ...canonicalChips,
      ...ruleSeededChips,
    ]).filter((c) => !isChipRemoved(c, removedFactors.ultrasound.parent));
  }

  function getMergedQualifyingChipsForTest(testName: string): DisplayChip[] {
    const userChips = ultrasoundChildSelected(testName).map((b) =>
      chipFromButton(b, "user"),
    );
    const card = canonicalReasoningByAncillary.ultrasound.find(
      (c) => c.testName === testName,
    );
    const canonicalChips: DisplayChip[] = card
      ? card.qualifyingFactors.map((f) => chipFromCanonicalFactor(f, testName))
      : [];
    const ruleSeededChips = ruleSeededChipsForUltrasoundTest(testName).map((b) =>
      chipFromButton(b, "rule-seeded"),
    );
    const removed = [
      ...(removedFactors.ultrasound.byTestName[testName] ?? []),
      ...removedFactors.ultrasound.parent,
    ];
    return dedupeChips([
      ...userChips,
      ...canonicalChips,
      ...ruleSeededChips,
    ]).filter((c) => !isChipRemoved(c, removed));
  }

  // Whether a given button is already assigned to a specific target.
  // Drives the "Already on X" disabled states in AssignMenu and prevents
  // duplicate entries on the same ancillary bar.
  function isAssignedToTarget(
    btn: SupportingButton,
    target: AssignmentTarget,
    state: AdminReviewAssignmentState,
  ): boolean {
    const key = chipKeyForAssignment(btn);
    if (target.type === "ancillary") {
      return state[target.ancillaryId].some(
        (b) => chipKeyForAssignment(b) === key,
      );
    }
    if (target.type === "ultrasound-parent") {
      return state.ultrasound.parent.some(
        (b) => chipKeyForAssignment(b) === key,
      );
    }
    if (target.type === "ultrasound-test") {
      return (state.ultrasound.byTestName[target.testName] ?? []).some(
        (b) => chipKeyForAssignment(b) === key,
      );
    }
    if (target.type === "all") {
      return (
        state.brainwave.some((b) => chipKeyForAssignment(b) === key) &&
        state.vitalwave.some((b) => chipKeyForAssignment(b) === key) &&
        state.ultrasound.parent.some((b) => chipKeyForAssignment(b) === key)
      );
    }
    return false;
  }

  // Assignment helper. A missing ICD code does NOT block assignment —
  // every diagnosis from patient.diagnoses is a valid SupportingButton.
  // ICD Search is an optional add-on, not a prerequisite.
  function assignToTarget(target: AssignmentTarget, btn: SupportingButton) {
    // Corrective patch: compute the next snapshot ONCE using the
    // synchronously-tracked ref (not React state) so rapid sequential
    // clicks chain correctly even before React commits.
    const prev = assignmentsRef.current;
    const next: AdminReviewAssignmentState = {
      brainwave: [...prev.brainwave],
      vitalwave: [...prev.vitalwave],
      ultrasound: {
        parent: [...prev.ultrasound.parent],
        byTestName: { ...prev.ultrasound.byTestName },
      },
    };
    const k = chipKeyForAssignment(btn);
    const pushTo = (arr: SupportingButton[]) => {
      // Dedupe ONLY inside the target being changed.
      if (!arr.some((c) => chipKeyForAssignment(c) === k)) arr.push(btn);
    };
    if (target.type === "all") {
      pushTo(next.brainwave);
      pushTo(next.vitalwave);
      pushTo(next.ultrasound.parent);
    } else if (target.type === "ancillary") {
      pushTo(next[target.ancillaryId]);
    } else if (target.type === "ultrasound-parent") {
      pushTo(next.ultrasound.parent);
    } else if (target.type === "ultrasound-test") {
      const list = next.ultrasound.byTestName[target.testName] ?? [];
      const arr = [...list];
      pushTo(arr);
      next.ultrasound.byTestName[target.testName] = arr;
    }
    // Sync ref + React state, then persist.
    assignmentsRef.current = next;
    setAssignments(next);
    const stale = new Set(targetIdsForAssignmentTarget(target));
    persistAssignmentsToReasoning(next, stale, "Evidence attached");

    const type: AdminReviewUpdateType =
      btn.kind === "icd_disease"
        ? "diagnosis_added"
        : btn.kind === "medication"
          ? "medication_added"
          : "symptom_added";
    const label =
      btn.kind === "icd_disease"
        ? `Added diagnosis: ${btn.label}`
        : btn.kind === "medication"
          ? `Added medication: ${btn.label}`
          : `Added symptom: ${btn.label}`;
    recordAdminReviewUpdate(type, label, { target });
  }

  function unassign(from: AssignmentTarget, btn: SupportingButton) {
    // Corrective patch: same synchronous compute-and-persist pattern
    // as `assignToTarget`. Detach scopes to the exact target the
    // operator clicked; other targets keep the same evidence.
    const prev: AdminReviewAssignmentState = assignmentsRef.current;
    const k = chipKeyForAssignment(btn);
    const filterOut = (arr: SupportingButton[]): SupportingButton[] =>
      arr.filter((c: SupportingButton) => chipKeyForAssignment(c) !== k);
    const next: AdminReviewAssignmentState = {
      brainwave: [...prev.brainwave],
      vitalwave: [...prev.vitalwave],
      ultrasound: {
        parent: [...prev.ultrasound.parent],
        byTestName: { ...prev.ultrasound.byTestName },
      },
    };
    if (from.type === "all") {
      next.brainwave = filterOut(prev.brainwave);
      next.vitalwave = filterOut(prev.vitalwave);
      next.ultrasound = {
        parent: filterOut(prev.ultrasound.parent),
        byTestName: { ...prev.ultrasound.byTestName },
      };
    } else if (from.type === "ancillary") {
      if (from.ancillaryId === "brainwave") {
        next.brainwave = filterOut(prev.brainwave);
      } else if (from.ancillaryId === "vitalwave") {
        next.vitalwave = filterOut(prev.vitalwave);
      }
    } else if (from.type === "ultrasound-parent") {
      next.ultrasound = {
        parent: filterOut(prev.ultrasound.parent),
        byTestName: { ...prev.ultrasound.byTestName },
      };
    } else if (from.type === "ultrasound-test") {
      const list = prev.ultrasound.byTestName[from.testName] ?? [];
      next.ultrasound = {
        parent: [...prev.ultrasound.parent],
        byTestName: {
          ...prev.ultrasound.byTestName,
          [from.testName]: filterOut(list),
        },
      };
    }
    assignmentsRef.current = next;
    setAssignments(next);
    const stale = new Set(targetIdsForAssignmentTarget(from));
    persistAssignmentsToReasoning(next, stale, "Evidence detached");
  }

  // Record a removed qualifying factor + unassign the button from the
  // matching bar. The label string is what the AI prompt subtracts from
  // the merged qualifying_factors floor.
  function labelForRemoval(btn: SupportingButton): string {
    return btn.icdCode && btn.label ? `${btn.icdCode} · ${btn.label}` : btn.label;
  }

  // Remove a single canonical qualifying factor from patient.reasoning[testName].
  // Persists immediately via onUpdate so the user sees it gone on next render,
  // and records the label in removedFactors so a later regenerate won't re-add it.
  function removeCanonicalQualifyingFactor(testName: string, factor: string) {
    const reasoning = reasoningAsObject(patient.reasoning);
    const entry = reasoning[testName];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const factors = Array.isArray((entry as any).qualifying_factors)
      ? ((entry as any).qualifying_factors as string[])
      : [];
    const filtered = factors.filter((f) => f !== factor);
    const nextReasoning = {
      ...reasoning,
      [testName]: { ...(entry as Record<string, unknown>), qualifying_factors: filtered },
    };
    onUpdate("reasoning", nextReasoning);

    // Record so a subsequent regenerate doesn't re-add this factor.
    const category = getAncillaryCategory(testName);
    setRemovedFactors((prev) => {
      const next = {
        brainwave: [...prev.brainwave],
        vitalwave: [...prev.vitalwave],
        ultrasound: {
          parent: [...prev.ultrasound.parent],
          byTestName: { ...prev.ultrasound.byTestName },
        },
      };
      if (category === "brainwave" && !next.brainwave.includes(factor)) {
        next.brainwave.push(factor);
      } else if (category === "vitalwave" && !next.vitalwave.includes(factor)) {
        next.vitalwave.push(factor);
      } else if (category === "ultrasound") {
        const list = [...(next.ultrasound.byTestName[testName] ?? [])];
        if (!list.includes(factor)) list.push(factor);
        next.ultrasound.byTestName[testName] = list;
      }
      return next;
    });
  }

  function removeQualifyingFactor(from: AssignmentTarget, btn: SupportingButton) {
    const label = labelForRemoval(btn);
    setRemovedFactors((prev) => {
      const next = {
        brainwave: [...prev.brainwave],
        vitalwave: [...prev.vitalwave],
        ultrasound: {
          parent: [...prev.ultrasound.parent],
          byTestName: { ...prev.ultrasound.byTestName },
        },
      };
      const pushIfNew = (arr: string[]) => {
        if (!arr.includes(label)) arr.push(label);
      };
      if (from.type === "ancillary") {
        if (from.ancillaryId === "brainwave") pushIfNew(next.brainwave);
        if (from.ancillaryId === "vitalwave") pushIfNew(next.vitalwave);
      } else if (from.type === "ultrasound-parent") {
        pushIfNew(next.ultrasound.parent);
      } else if (from.type === "ultrasound-test") {
        const list = [...(next.ultrasound.byTestName[from.testName] ?? [])];
        if (!list.includes(label)) list.push(label);
        next.ultrasound.byTestName[from.testName] = list;
      }
      return next;
    });
    unassign(from, btn);
    recordAdminReviewUpdate("qualifying_factor_removed", `Removed qualifying factor: ${label}`, { from });
  }

  // Unified merged-chip remove. Dispatches by chip origin so a single
  // X button works for user-assigned chips, canonical reasoning
  // factors, and rule-engine-seeded chips. Source markers:
  //   - "Remove canonical qualifying factor"
  //   - "Removed factors are excluded from regenerate"
  //   - "Deleting a chip persists to patient.reasoning"
  // SOURCE MARKER: Remove canonical qualifying factor
  // SOURCE MARKER: Removed factors are excluded from regenerate
  // SOURCE MARKER: Deleting a chip persists to patient.reasoning
  function handleRemoveMergedChip(target: AssignmentTarget, chip: DisplayChip) {
    const codeLabel = chip.icdCode ? `${chip.icdCode} · ${chip.label}` : chip.label;

    // 1. Always record the label so a future regenerate excludes it.
    setRemovedFactors((prev) => {
      const next = {
        brainwave: [...prev.brainwave],
        vitalwave: [...prev.vitalwave],
        ultrasound: {
          parent: [...prev.ultrasound.parent],
          byTestName: { ...prev.ultrasound.byTestName },
        },
      };
      const push = (arr: string[]) => {
        if (!arr.includes(chip.label)) arr.push(chip.label);
        if (!arr.includes(codeLabel)) arr.push(codeLabel);
      };
      if (target.type === "ancillary") {
        if (target.ancillaryId === "brainwave") push(next.brainwave);
        if (target.ancillaryId === "vitalwave") push(next.vitalwave);
      } else if (target.type === "ultrasound-parent") {
        push(next.ultrasound.parent);
      } else if (target.type === "ultrasound-test") {
        const list = [...(next.ultrasound.byTestName[target.testName] ?? [])];
        const pushLocal = (arr: string[]) => {
          if (!arr.includes(chip.label)) arr.push(chip.label);
          if (!arr.includes(codeLabel)) arr.push(codeLabel);
        };
        pushLocal(list);
        next.ultrasound.byTestName[target.testName] = list;
      }
      return next;
    });

    // 2. User-assigned chips unassign the underlying SupportingButton.
    if (chip.origin === "user" && chip.button) {
      unassign(target, chip.button);
    }

    // 3. Canonical chips must also strip from patient.reasoning so the
    // deletion persists across reopen/regenerate.
    if (chip.origin === "canonical") {
      const testNames = chip.canonicalTestNames ?? [];
      if (target.type === "ultrasound-test" && testNames.length === 0) {
        testNames.push(target.testName);
      }
      for (const testName of testNames) {
        removeCanonicalQualifyingFactor(testName, chip.label);
        if (chip.icdCode) {
          removeCanonicalQualifyingFactor(testName, codeLabel);
        }
      }
    }

    // 4. Audit log.
    recordAdminReviewUpdate(
      "qualifying_factor_removed",
      `Removed qualifying factor: ${chip.label}`,
      { target, origin: chip.origin, icdCode: chip.icdCode ?? null },
    );
  }

  // Backend: remove an entire ancillary from this patient.
  const removeAncillaryMutation = useMutation<
    { ok: boolean; patient: PatientScreening; ancillaryId: AdminReviewAncillaryId; removedTests: string[] },
    Error,
    { ancillary: AdminReviewAncillaryId }
  >({
    mutationFn: async ({ ancillary }) => {
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-review/remove-ancillary`,
        { ancillaryId: ancillary },
      );
      return res.json();
    },
    onSuccess: (data, vars) => {
      toast({
        title: `Removed ${categoryLabels[vars.ancillary]}`,
        description: `Removed ${data.removedTests?.length ?? 0} test(s) for this patient.`,
      });
      if (data.patient) {
        onUpdate("reasoning", (data.patient.reasoning ?? {}) as Record<string, unknown>);
        if (Array.isArray(data.patient.qualifyingTests)) {
          onUpdate("qualifyingTests", data.patient.qualifyingTests as string[]);
        }
      }
      setAssignments((prev) => {
        const next = {
          brainwave: vars.ancillary === "brainwave" ? [] : prev.brainwave,
          vitalwave: vars.ancillary === "vitalwave" ? [] : prev.vitalwave,
          ultrasound:
            vars.ancillary === "ultrasound"
              ? { parent: [], byTestName: {} }
              : prev.ultrasound,
        };
        return next;
      });
      recordAdminReviewUpdate(
        "ancillary_removed",
        `Removed ancillary: ${categoryLabels[vars.ancillary]}`,
        { removed: data.removedTests ?? [] },
      );
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
    },
    onError: (err, vars) => {
      toast({
        title: `Could not remove ${categoryLabels[vars.ancillary]}`,
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Backend: remove a single qualifying test (ultrasound child).
  const removeTestMutation = useMutation<
    { ok: boolean; patient: PatientScreening; removedTestName: string },
    Error,
    { testName: string }
  >({
    mutationFn: async ({ testName }) => {
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-review/remove-test`,
        { testName },
      );
      return res.json();
    },
    onSuccess: (data, vars) => {
      toast({
        title: `Removed ${vars.testName}`,
        description: "Test removed from this patient.",
      });
      if (data.patient) {
        onUpdate("reasoning", (data.patient.reasoning ?? {}) as Record<string, unknown>);
        if (Array.isArray(data.patient.qualifyingTests)) {
          onUpdate("qualifyingTests", data.patient.qualifyingTests as string[]);
        }
      }
      setAssignments((prev) => ({
        ...prev,
        ultrasound: {
          parent: prev.ultrasound.parent,
          byTestName: Object.fromEntries(
            Object.entries(prev.ultrasound.byTestName).filter(([k]) => k !== vars.testName),
          ),
        },
      }));
      recordAdminReviewUpdate(
        "ultrasound_child_removed",
        `Removed ultrasound test: ${vars.testName}`,
      );
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
    },
    onError: (err, vars) => {
      toast({
        title: `Could not remove ${vars.testName}`,
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Selected buttons surfaced for each panel header (deduped).
  function selectedFor(ancillary: "brainwave" | "vitalwave"): SupportingButton[] {
    return assignments[ancillary];
  }
  function ultrasoundParentSelected(): SupportingButton[] {
    return assignments.ultrasound.parent;
  }
  function ultrasoundChildSelected(testName: string): SupportingButton[] {
    const child = assignments.ultrasound.byTestName[testName] ?? [];
    const seen = new Set<string>();
    const out: SupportingButton[] = [];
    for (const b of [...assignments.ultrasound.parent, ...child]) {
      const k = chipKeyForAssignment(b);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(b);
      }
    }
    return out;
  }

  // Active ICDs from search + parsed Dx (for regenerate payload).
  function activeIcdCodes(): Array<{ code: string; label: string }> {
    const map = new Map<string, { code: string; label: string }>();
    for (const b of availableButtons) {
      if (b.kind === "icd_disease" && b.icdCode) {
        if (!map.has(b.icdCode)) map.set(b.icdCode, { code: b.icdCode, label: b.icdLabel ?? b.label });
      }
    }
    return Array.from(map.values());
  }

  function adoptIcdSearchResult(r: IcdSearchResult) {
    const chip: SupportingButton = {
      id: makeId(["ai", "icd", r.code, r.label]),
      kind: "icd_disease",
      label: r.label,
      source: "AI ICD Search",
      sourceText: r.rationale,
      icdCode: r.code,
      icdLabel: r.label,
      requiresIcd: false,
      confidence: r.confidence,
    };
    setAiIcdButtons((prev) => {
      if (prev.some((b) => buttonKey(b) === buttonKey(chip))) return prev;
      return [...prev, chip];
    });
    recordAdminReviewUpdate("icd_added", `Added ICD: ${r.code} · ${r.label}`, {
      code: r.code,
      label: r.label,
    });
  }

  // Regenerate (per-ancillary OR per-ultrasound-test)
  const regenerateAncillaryMutation = useMutation<
    { ok: boolean; patient: PatientScreening; ancillaryId: AdminReviewAncillaryId },
    Error,
    { ancillary: AdminReviewAncillaryId }
  >({
    mutationFn: async ({ ancillary }) => {
      setRegenInFlight((prev) => ({ ...prev, [ancillary]: true }));
      const evidenceForCall =
        ancillary === "ultrasound" ? assignments.ultrasound.parent : assignments[ancillary];
      const removedForCall =
        ancillary === "ultrasound"
          ? removedFactors.ultrasound.parent
          : removedFactors[ancillary];
      // Regenerate uses visible qualifying chips — the visible chip
      // layer on the bar is the merged union of user-assigned + canonical
      // qualifying_factors + rule-engine evidence minus removedFactors.
      // The authoritative floor below sends the canonical layer so the
      // server merge cannot lose it; removedFactors are subtracted so an
      // explicit user delete is honoured.
      // SOURCE MARKER: Regenerate uses visible qualifying chips
      // SOURCE MARKER: Admin Review regenerate payload includes priorQualifyingFactorsByTest
      // SOURCE MARKER: Admin Review regenerate payload includes removedFactors
      // Authoritative floor: send the current canonical qualifying_factors
      // straight from patient.reasoning so the server merge can't lose them
      // even if the stored shape is unusual.
      const priorQualifyingFactorsByTest: Record<string, string[]> = {};
      const filtered = canonicalReasoningByAncillary[ancillary] ?? [];
      for (const c of filtered) {
        priorQualifyingFactorsByTest[c.testName] = c.qualifyingFactors;
      }
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-review/regenerate-ancillary`,
        {
          ancillaryId: ancillary,
          assignedEvidence: evidenceForCall,
          ancillaryNote: ancillaryNotes[ancillary] ?? "",
          adminNote,
          diagnoses: patient.diagnoses ?? "",
          medications: patient.medications ?? "",
          history: patient.history ?? "",
          icdCodes: activeIcdCodes(),
          removedFactors: removedForCall,
          priorQualifyingFactorsByTest,
        },
      );
      return res.json();
    },
    onSuccess: (data, vars) => {
      toast({
        title: `Regenerated ${categoryLabels[vars.ancillary]}`,
        description: "Canonical reasoning updated.",
      });
      if (data.patient) {
        // Corrective patch: re-overlay other targets' staged
        // assignedEvidence on top of the server response so a
        // concurrent attach/detach that the regenerate request did NOT
        // know about cannot be lost. Also clears the just-regenerated
        // ancillary's stale flag.
        const serverReasoning = (data.patient.reasoning ?? {}) as Record<
          string,
          unknown
        >;
        const merged = mergeRegenerateResponseReasoning(
          serverReasoning,
          new Set([vars.ancillary]),
        );
        lastWrittenReasoningRef.current = merged;
        onUpdate("reasoning", merged);
      }
      recordAdminReviewUpdate(
        "regenerate",
        `Regenerated ${categoryLabels[vars.ancillary]}`,
      );
      setRegenErrors((prev) => ({ ...prev, [vars.ancillary]: null }));
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
      queryClient.invalidateQueries({ queryKey: ["admin-review-evidence", patient.id] });
    },
    onError: (err, vars) => {
      const message = extractRegenErrorMessage(err);
      setRegenErrors((prev) => ({ ...prev, [vars.ancillary]: message }));
      toast({
        title: `Could not regenerate ${categoryLabels[vars.ancillary]}`,
        description: message,
        variant: "destructive",
      });
    },
    onSettled: (_d, _e, vars) => {
      setRegenInFlight((prev) => ({ ...prev, [vars.ancillary]: false }));
    },
  });

  const regenerateTestMutation = useMutation<
    { ok: boolean; patient: PatientScreening; testName: string },
    Error,
    { testName: string; ancillaryId: AdminReviewAncillaryId }
  >({
    mutationFn: async ({ testName, ancillaryId }) => {
      setRegenInFlight((prev) => ({ ...prev, [`test:${testName}`]: true }));
      const evidenceForCall = ultrasoundChildSelected(testName);
      const removedForCall = [
        ...(removedFactors.ultrasound.byTestName[testName] ?? []),
        ...removedFactors.ultrasound.parent,
      ];
      // Authoritative floor for this single test (see regenerate-ancillary above).
      const priorEntry = (canonicalReasoningByAncillary.ultrasound ?? []).find(
        (c) => c.testName === testName,
      );
      const priorQualifyingFactorsByTest: Record<string, string[]> = {
        [testName]: priorEntry?.qualifyingFactors ?? [],
      };
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-review/regenerate-test`,
        {
          testName,
          ancillaryId,
          assignedEvidence: evidenceForCall,
          ancillaryNote: ancillaryNotes[`test:${testName}`] ?? "",
          adminNote,
          diagnoses: patient.diagnoses ?? "",
          medications: patient.medications ?? "",
          history: patient.history ?? "",
          icdCodes: activeIcdCodes(),
          removedFactors: removedForCall,
          priorQualifyingFactorsByTest,
        },
      );
      return res.json();
    },
    onSuccess: (data, vars) => {
      toast({
        title: `Regenerated ${vars.testName}`,
        description: "Canonical reasoning updated for this test.",
      });
      if (data.patient) {
        // Corrective patch: merge server response with live staged
        // assignedEvidence; clear stale for the just-regenerated test.
        const serverReasoning = (data.patient.reasoning ?? {}) as Record<
          string,
          unknown
        >;
        const merged = mergeRegenerateResponseReasoning(
          serverReasoning,
          new Set([`test:${vars.testName}`]),
        );
        lastWrittenReasoningRef.current = merged;
        onUpdate("reasoning", merged);
      }
      recordAdminReviewUpdate("regenerate", `Regenerated ${vars.testName}`);
      setRegenErrors((prev) => ({ ...prev, [`test:${vars.testName}`]: null }));
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
    },
    onError: (err, vars) => {
      const message = extractRegenErrorMessage(err);
      setRegenErrors((prev) => ({ ...prev, [`test:${vars.testName}`]: message }));
      toast({
        title: `Could not regenerate ${vars.testName}`,
        description: message,
        variant: "destructive",
      });
    },
    onSettled: (_d, _e, vars) => {
      setRegenInFlight((prev) => ({ ...prev, [`test:${vars.testName}`]: false }));
    },
  });

  // Admin Review persistence — corrective patch: Regenerate Changed
  //
  // Sequentially regenerates every target whose `adminReview:<id>` block
  // currently carries `stale: true`. Sequential (not parallel) so each
  // call sees the previous call's server-side update; merges via
  // `mergeRegenerateResponseReasoning` preserve other targets' staged
  // evidence at every step. A per-target failure does NOT abort the
  // queue — the target keeps its stale flag and its row-level error
  // surfaces via `setRegenErrors` (existing UI).
  const [regenChangedInFlight, setRegenChangedInFlight] = useState(false);
  const regenerateChangedTargets = useCallback(async (): Promise<void> => {
    const staleIds = readStaleTargetIds(lastWrittenReasoningRef.current);
    if (staleIds.length === 0) return;
    setRegenChangedInFlight(true);
    try {
      for (const targetId of staleIds) {
        try {
          if (
            targetId === "brainwave" ||
            targetId === "vitalwave" ||
            targetId === "ultrasound"
          ) {
            await regenerateAncillaryMutation.mutateAsync({ ancillary: targetId });
          } else if (targetId.startsWith("test:")) {
            const testName = targetId.slice("test:".length);
            await regenerateTestMutation.mutateAsync({
              testName,
              ancillaryId: "ultrasound",
            });
          }
        } catch {
          // Per-target failure already surfaces via the mutation's
          // onError handler — keep going so the operator sees per-row
          // errors but successful targets clear their stale flag.
        }
      }
    } finally {
      setRegenChangedInFlight(false);
    }
  }, [regenerateAncillaryMutation, regenerateTestMutation]);

  const approvalMutation = useMutation<
    { ok: boolean; patient: PatientScreening },
    Error,
    { status: AdminApprovalStatus }
  >({
    mutationFn: async ({ status }) => {
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-approval`,
        { status, note: adminNote.trim() || undefined },
      );
      return res.json();
    },
    onSuccess: (data, vars) => {
      const routed = (data as { routedToEngagement?: boolean }).routedToEngagement;
      const schedulerName = (data as { routedSchedulerName?: string | null }).routedSchedulerName;
      const bySettings = (data as { routedByScheduledSettings?: boolean }).routedByScheduledSettings;
      toast({
        title: `Admin approval: ${vars.status.replace("_", " ")}`,
        description: routed
          ? schedulerName
            ? bySettings
              ? `Routed to scheduler: ${schedulerName} · Scheduler Settings`
              : `Routed to scheduler: ${schedulerName}`
            : "Routed to Engagement Queue (unassigned)"
          : data.patient?.name ?? "",
      });
      // SOURCE MARKER: Admin Review navigation does not refetch full workspace
      // Refresh only what actually changes on admin approval: the
      // patient's batch (so the card surfaces the new
      // adminApprovalStatus) and the per-patient engagement chip (so
      // the scheduler routing badge appears). The assignment-board
      // refresh uses the predicate form so the active query key
      // matches regardless of which filters the Engagement Center
      // currently has applied — the old exact-key form never matched
      // and was effectively a no-op.
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
      queryClient.invalidateQueries({
        queryKey: ["/api/patients", patient.id, "engagement-assignment"],
      });
      queryClient.invalidateQueries({
        predicate: (qq) =>
          Array.isArray(qq.queryKey) &&
          qq.queryKey[0] === "/api/engagement/assignment-board",
      });
      // Auto-advance to the next sibling when the caller passed a
      // siblings list and there's another patient in the group;
      // otherwise close the dialog as before.
      if (hasNext) {
        setActiveIndex((i) => Math.min(i + 1, siblingList.length - 1));
      } else {
        onOpenChange(false);
      }
    },
    onError: (err) => {
      toast({
        title: "Could not update admin approval",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  function toggleExpand(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const totalMissingIcds = availableButtons.filter(
    (b) => b.kind === "icd_disease" && b.requiresIcd,
  ).length;

  const shellChildren = (
    <>
        {/* Smoke header — black at ~70% opacity per Team Portal spec. */}
        <DialogHeader
          className="px-6 pt-5 pb-4 border-b border-slate-700 bg-slate-900 text-white"
          data-testid="admin-review-smoke-header"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold tracking-tight text-white">
                Admin Review · {patient.name || "Unnamed patient"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Admin review for {patient.name || "patient"}
              </DialogDescription>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 ${STATUS_META[review.approval].pillClass}`}
                >
                  {STATUS_META[review.approval].label}
                </span>
                {isUnder16 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-900 border border-rose-300 px-2 py-0.5 font-semibold uppercase tracking-wider"
                    data-testid="badge-admin-review-under-16"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Under 16 · Admin approval required
                  </span>
                )}
                {patient.facility && <span className="text-white/70">{patient.facility}</span>}
                {scheduleDate && <span className="text-white/70">· {scheduleDate}</span>}
                {patient.dob && (
                  <span className="text-white/70" data-testid="admin-review-banner-dob">· DOB {patient.dob}</span>
                )}
                {patient.insurance && (
                  <span className="text-white/70" data-testid="admin-review-banner-insurance">· {patient.insurance}</span>
                )}
                {patient.phoneNumber && (
                  <span className="text-white/70" data-testid="admin-review-banner-phone">· {patient.phoneNumber}</span>
                )}
                {evidenceQuery.isFetching && (
                  <span className="text-white/60 inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Refreshing
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Sibling navigation — Prev / counter / Next. Visible
                  only when the caller passed a siblings list. Auto-
                  advance on approve is handled in approvalMutation's
                  onSuccess.
                  SOURCE MARKER: Admin Review sibling navigation */}
              {siblings && siblings.length > 1 && (
                <div
                  className="inline-flex items-center gap-1 rounded-md bg-white/10 px-1 py-0.5"
                  data-testid="admin-review-sibling-nav"
                  data-active-index={activeIndex}
                  data-total={totalSiblings}
                  data-approve-pending={approvalMutation.isPending ? "true" : "false"}
                >
                  {/* SOURCE MARKER: Admin Review navigation disabled during approve */}
                  <button
                    type="button"
                    onClick={() => goToSibling(-1)}
                    disabled={!hasPrev || approvalMutation.isPending}
                    aria-label="Previous patient"
                    title="Previous patient"
                    data-testid="admin-review-sibling-prev"
                    className="inline-flex items-center justify-center h-6 w-6 rounded text-white/85 hover:text-white hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span
                    className="text-[11px] font-medium text-white/85 tabular-nums px-1"
                    data-testid="admin-review-sibling-counter"
                  >
                    {activeIndex + 1} of {totalSiblings}
                    {dateLabel ? ` · ${dateLabel}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToSibling(1)}
                    disabled={!hasNext || approvalMutation.isPending}
                    aria-label="Next patient"
                    title={
                      hasNext
                        ? `Next patient (${remainingAfter} more${dateLabel ? ` in ${dateLabel}` : ""})`
                        : "No more patients"
                    }
                    data-testid="admin-review-sibling-next"
                    className="inline-flex items-center justify-center h-6 w-6 rounded text-white/85 hover:text-white hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {/* Admin Review persistence — corrective patch:
                  Regenerate Changed button. Visible whenever any
                  `adminReview:<id>` block carries `stale: true`.
                  Reads from `lastWrittenReasoningRef.current` so the
                  count reflects the synchronous local truth (not
                  patient.reasoning which lags by a roundtrip). */}
              {(() => {
                const staleIds = readStaleTargetIds(
                  lastWrittenReasoningRef.current,
                );
                if (staleIds.length === 0) return null;
                const label = staleIds
                  .map(ancillaryLabelForTargetId)
                  .join(", ");
                return (
                  <button
                    type="button"
                    onClick={() => void regenerateChangedTargets()}
                    disabled={regenChangedInFlight}
                    aria-label="Regenerate Changed"
                    title={`Regenerate: ${label}`}
                    data-testid="admin-review-regenerate-changed"
                    data-stale-count={staleIds.length}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-amber-500/90 hover:bg-amber-500 text-white text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {regenChangedInFlight ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Regenerate Changed ({staleIds.length})
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close admin review"
                title="Close"
                data-testid="admin-review-close-button"
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-white/85 hover:text-white hover:bg-white/15 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </DialogHeader>
        {/* ─── Two-panel body: LEFT ancillaries playground · RIGHT action column ─── */}
        <div
          className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4"
          style={{ background: "#EEF1F7" }}
          data-testid="admin-review-two-panel-body"
        >
          {/* ─── LEFT panel — Ancillaries playground ─── */}
          <main
            className="flex min-h-0 flex-[1.35] flex-col overflow-hidden rounded-2xl border border-[#E6E8EF] bg-white"
            data-testid="admin-review-ancillary-panel"
          >
              <div className="px-5 pt-4 pb-2 border-b border-slate-100 flex items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 text-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider shadow-sm"
                  data-testid="admin-review-ancillary-playground-pill"
                >
                  <Sparkles className="w-3 h-3" />
                  Ancillary Playground
                </span>
                {evidenceQuery.isFetching && (
                  <span className="text-[10px] text-slate-400 inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Refreshing rule engine
                  </span>
                )}
              </div>
              <ScrollArea className="flex-1 min-h-0 px-5 py-4">
                <div
                  className="space-y-4"
                  data-testid="admin-review-ancillary-playground"
                >
              {/* BrainWave + VitalWave panels. Bar shows only qualifying-
                  factor chips + icon-only Regenerate/Delete. Status
                  labels, the services row, and the selected list were removed
                  per the dropdown-cleanup spec — the canonical
                  reasoning expansion still carries that detail. */}
              {(["brainwave", "vitalwave"] as const).map((id) => {
                const style = categoryStyles[id];
                const Icon = categoryIcons[id];
                const selected = selectedFor(id);
                const note = ancillaryNotes[id] ?? "";
                const isOpen = !!expanded[id];
                return (
                  <div
                    key={id}
                    className={`rounded-2xl border overflow-hidden ${style.bg} ${style.border}`}
                    data-testid="admin-review-ancillary-colored-panel"
                    data-ancillary={id}
                  >
                    <div className="px-4 py-3 border-b border-white/40 bg-white/30 backdrop-blur-sm">
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => toggleExpand(id)}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left"
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className={`w-4 h-4 shrink-0 ${style.accent}`} />
                          ) : (
                            <ChevronRight className={`w-4 h-4 shrink-0 ${style.accent}`} />
                          )}
                          <div className={`shrink-0 w-7 h-7 rounded-full bg-white inline-flex items-center justify-center ${style.icon}`}>
                            <Icon className="w-4 h-4" strokeWidth={2} fill="none" />
                          </div>
                          <div className="min-w-0 flex items-center gap-2 flex-wrap">
                            <div className={`font-semibold text-sm ${style.accent} shrink-0`}>
                              {categoryLabels[id]}
                            </div>
                            {isUnder16 && (
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-800 bg-rose-50 border border-rose-300 rounded-full px-1.5 shrink-0">
                                &lt;16
                              </span>
                            )}
                            {/* Closed bars render merged qualifying chips. */}
                            <div
                              className="flex flex-wrap items-center gap-1"
                              data-testid="admin-review-ancillary-factor-chip-row"
                            >
                              {getMergedQualifyingChipsForAncillary(id).map((chip) => (
                                <PremiumFactorChip
                                  key={chip.key}
                                  chip={chip}
                                  barTestId="admin-review-ancillary-factor-chip"
                                  removeBarTestId={
                                    id === "brainwave"
                                      ? "admin-review-remove-brainwave-factor"
                                      : "admin-review-remove-vitalwave-factor"
                                  }
                                  onRemove={() =>
                                    handleRemoveMergedChip({ type: "ancillary", ancillaryId: id }, chip)
                                  }
                                />
                              ))}
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={!!regenInFlight[id]}
                            onClick={(e) => {
                              e.stopPropagation();
                              regenerateAncillaryMutation.mutate({ ancillary: id });
                            }}
                            aria-label={`Regenerate ${categoryLabels[id]}`}
                            title={`Regenerate ${categoryLabels[id]}`}
                            data-testid="admin-review-regenerate-icon-button"
                            data-bar-testid={REGENERATE_TEST_IDS[id]}
                            data-regenerate="admin-review-regenerate-ancillary"
                            data-ancillary={id}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/80 hover:bg-white text-slate-700 hover:text-slate-900 transition-colors disabled:opacity-50"
                          >
                            {regenInFlight[id] ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={removeAncillaryMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                confirm(
                                  `Remove ${categoryLabels[id]} from this patient? All ${categoryLabels[id]} tests will be cleared.`,
                                )
                              ) {
                                removeAncillaryMutation.mutate({ ancillary: id });
                              }
                            }}
                            aria-label={`Remove ${categoryLabels[id]}`}
                            title={`Remove ${categoryLabels[id]}`}
                            data-testid="admin-review-delete-icon-button"
                            data-bar-testid={
                              id === "brainwave"
                                ? "admin-review-remove-brainwave"
                                : "admin-review-remove-vitalwave"
                            }
                            data-remove-ancillary="admin-review-remove-ancillary"
                            data-ancillary={id}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/80 hover:bg-rose-50 text-slate-700 hover:text-rose-700 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {regenErrors[id] && (
                      <div
                        className="mx-4 my-2 rounded-md border border-rose-300 bg-rose-50 text-rose-800 text-[11px] px-3 py-2"
                        data-testid="admin-review-regenerate-error"
                        data-ancillary={id}
                      >
                        <span className="font-semibold">Regenerate failed:</span>{" "}
                        {regenErrors[id]}
                      </div>
                    )}
                    {isOpen && (
                      <div
                        className="px-4 py-3 space-y-3 bg-white/60"
                        data-testid="admin-review-ancillary-expanded"
                      >
                        {isUnder16 && (
                          <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                            Patient is under 16. Not routine — requires admin override approval.
                          </div>
                        )}
                        {canonicalReasoningByAncillary[id].length === 0 ? (
                          <div className="text-xs text-slate-500 italic">
                            No services under {categoryLabels[id]} yet.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {canonicalReasoningByAncillary[id].map((card) => (
                              <CanonicalReasoningCardView
                                key={card.testName}
                                card={card}
                                onRemoveFactor={removeCanonicalQualifyingFactor}
                              />
                            ))}
                          </div>
                        )}
                        <div className="space-y-1">
                          <Label
                            htmlFor={`admin-review-note-${id}`}
                            className="text-[11px] uppercase tracking-wider text-slate-500"
                          >
                            Notes
                          </Label>
                          <Textarea
                            id={`admin-review-note-${id}`}
                            value={note}
                            rows={2}
                            onChange={(e) =>
                              setAncillaryNotes((prev) => ({ ...prev, [id]: e.target.value }))
                            }
                            data-testid={`admin-review-note-${id}`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Ultrasound parent + child bars — simplified to the same
                  chip-only / icon-only pattern as BrainWave/VitalWave. */}
              <div
                className={`rounded-2xl border overflow-hidden ${categoryStyles.ultrasound.bg} ${categoryStyles.ultrasound.border}`}
                data-testid="admin-review-ultrasound-parent-panel"
                data-ancillary="ultrasound"
              >
                <div className="px-4 py-3 border-b border-white/40 bg-white/30 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand("ultrasound")}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      aria-expanded={!!expanded.ultrasound}
                    >
                      {expanded.ultrasound ? (
                        <ChevronDown className={`w-4 h-4 shrink-0 ${categoryStyles.ultrasound.accent}`} />
                      ) : (
                        <ChevronRight className={`w-4 h-4 shrink-0 ${categoryStyles.ultrasound.accent}`} />
                      )}
                      <div className={`shrink-0 w-7 h-7 rounded-full bg-white inline-flex items-center justify-center ${categoryStyles.ultrasound.icon}`}>
                        {(() => {
                          const Icon = categoryIcons.ultrasound;
                          return <Icon className="w-4 h-4" strokeWidth={2} fill="none" />;
                        })()}
                      </div>
                      <div className="min-w-0 flex items-center gap-2 flex-wrap">
                        <div className={`font-semibold text-sm ${categoryStyles.ultrasound.accent} shrink-0`}>
                          {categoryLabels.ultrasound}
                        </div>
                        {isUnder16 && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-800 bg-rose-50 border border-rose-300 rounded-full px-1.5 shrink-0">
                            &lt;16
                          </span>
                        )}
                        {/* Closed bars render merged qualifying chips. */}
                        <div
                          className="flex flex-wrap items-center gap-1"
                          data-testid="admin-review-ancillary-factor-chip-row"
                        >
                          {getMergedQualifyingChipsForUltrasoundParent().map((chip) => (
                            <PremiumFactorChip
                              key={chip.key}
                              chip={chip}
                              barTestId="admin-review-ancillary-factor-chip"
                              removeBarTestId="admin-review-remove-ultrasound-parent-factor"
                              onRemove={() =>
                                handleRemoveMergedChip({ type: "ultrasound-parent" }, chip)
                              }
                            />
                          ))}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={!!regenInFlight.ultrasound}
                        onClick={(e) => {
                          e.stopPropagation();
                          regenerateAncillaryMutation.mutate({ ancillary: "ultrasound" });
                        }}
                        aria-label={`Regenerate ${categoryLabels.ultrasound}`}
                        title={`Regenerate ${categoryLabels.ultrasound}`}
                        data-testid="admin-review-regenerate-icon-button"
                        data-bar-testid={REGENERATE_TEST_IDS.ultrasound}
                        data-regenerate="admin-review-regenerate-ancillary"
                        data-ancillary="ultrasound"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/80 hover:bg-white text-slate-700 hover:text-slate-900 transition-colors disabled:opacity-50"
                      >
                        {regenInFlight.ultrasound ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={removeAncillaryMutation.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            confirm(
                              `Remove all ${categoryLabels.ultrasound} from this patient? Every child ultrasound test will be cleared.`,
                            )
                          ) {
                            removeAncillaryMutation.mutate({ ancillary: "ultrasound" });
                          }
                        }}
                        aria-label={`Remove ${categoryLabels.ultrasound}`}
                        title={`Remove ${categoryLabels.ultrasound}`}
                        data-testid="admin-review-delete-icon-button"
                        data-bar-testid="admin-review-remove-ultrasound-parent"
                        data-remove-ancillary="admin-review-remove-ancillary"
                        data-ancillary="ultrasound"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/80 hover:bg-rose-50 text-slate-700 hover:text-rose-700 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {regenErrors.ultrasound && (
                  <div
                    className="mx-4 my-2 rounded-md border border-rose-300 bg-rose-50 text-rose-800 text-[11px] px-3 py-2"
                    data-testid="admin-review-regenerate-error"
                    data-ancillary="ultrasound"
                  >
                    <span className="font-semibold">Regenerate failed:</span>{" "}
                    {regenErrors.ultrasound}
                  </div>
                )}
                {expanded.ultrasound && (
                  <div className="px-4 py-3 space-y-3 bg-white/60">
                    {canonicalReasoningByAncillary.ultrasound.length === 0 ? (
                      <div className="text-xs text-slate-500 italic">
                        No ultrasound services yet.
                      </div>
                    ) : (
                      canonicalReasoningByAncillary.ultrasound.map((card) => {
                        const selected = ultrasoundChildSelected(card.testName);
                        const inFlight = !!regenInFlight[`test:${card.testName}`];
                        const childError = regenErrors[`test:${card.testName}`];
                        // Per-child dropdown is collapsed by default; user clicks to expand.
                        const childOpen = !!ultrasoundChildExpanded[card.testName];
                        const removeInFlight = removeTestMutation.isPending && removeTestMutation.variables?.testName === card.testName;
                        return (
                          <div
                            key={card.testName}
                            className="rounded-xl border border-emerald-200 bg-white"
                            data-testid="admin-review-ultrasound-child-panel"
                            data-test-name={card.testName}
                          >
                            {childError && (
                              <div
                                className="mx-2 mt-2 rounded-md border border-rose-300 bg-rose-50 text-rose-800 text-[11px] px-2 py-1.5"
                                data-testid="admin-review-regenerate-error"
                                data-test-name={card.testName}
                              >
                                <span className="font-semibold">Regenerate failed:</span>{" "}
                                {childError}
                              </div>
                            )}
                            <div
                              className="rounded-xl border border-emerald-200 bg-white"
                              data-testid="admin-review-ultrasound-child-dropdown"
                              data-test-name={card.testName}
                            >
                              <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setUltrasoundChildExpanded((prev) => ({
                                      ...prev,
                                      [card.testName]: !prev[card.testName],
                                    }))
                                  }
                                  aria-expanded={childOpen}
                                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                                  data-testid="admin-review-ultrasound-child-toggle"
                                  data-test-name={card.testName}
                                >
                                  {childOpen ? (
                                    <ChevronDown className="w-4 h-4 shrink-0 text-emerald-700" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 shrink-0 text-emerald-700" />
                                  )}
                                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                    <div className="text-sm font-semibold text-slate-900 shrink-0">
                                      {card.testName}
                                    </div>
                                    {/* Closed bars render merged qualifying chips. */}
                                    <div
                                      className="flex flex-wrap items-center gap-1"
                                      data-testid="admin-review-ultrasound-child-factor-chip-row"
                                    >
                                      {getMergedQualifyingChipsForTest(card.testName).map((chip) => (
                                        <PremiumFactorChip
                                          key={chip.key}
                                          chip={chip}
                                          barTestId="admin-review-ultrasound-child-factor-chip"
                                          removeBarTestId="admin-review-remove-ultrasound-child-factor"
                                          onRemove={() =>
                                            handleRemoveMergedChip(
                                              { type: "ultrasound-test", testName: card.testName },
                                              chip,
                                            )
                                          }
                                        />
                                      ))}
                                    </div>
                                  </div>
                                </button>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    disabled={inFlight}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      regenerateTestMutation.mutate({
                                        testName: card.testName,
                                        ancillaryId: "ultrasound",
                                      });
                                    }}
                                    aria-label={`Regenerate ${card.testName}`}
                                    title={`Regenerate ${card.testName}`}
                                    data-testid="admin-review-ultrasound-regenerate-icon-button"
                                    data-bar-testid="admin-review-regenerate-ultrasound-test"
                                    data-test-name={card.testName}
                                    className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-emerald-200 transition-colors disabled:opacity-50"
                                  >
                                    {inFlight ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Sparkles className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={removeInFlight}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (
                                        confirm(
                                          `Remove ${card.testName} from this patient? Other ultrasound tests stay.`,
                                        )
                                      ) {
                                        removeTestMutation.mutate({ testName: card.testName });
                                      }
                                    }}
                                    aria-label={`Remove ${card.testName}`}
                                    title={`Remove ${card.testName}`}
                                    data-testid="admin-review-ultrasound-delete-icon-button"
                                    data-bar-testid="admin-review-remove-ultrasound-test"
                                    data-remove-ultrasound-child="admin-review-remove-ultrasound-child"
                                    data-test-name={card.testName}
                                    className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-rose-200 transition-colors disabled:opacity-50"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              {childOpen && (
                                <div
                                  className="px-3 pb-3 space-y-2 border-t border-emerald-100"
                                  data-testid="admin-review-ultrasound-child-body"
                                  data-test-name={card.testName}
                                >
                                  <CanonicalReasoningCardView
                                    card={card}
                                    onRemoveFactor={removeCanonicalQualifyingFactor}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
                </div>
              </ScrollArea>
          </main>

          {/* ─── RIGHT panel — slim action rail. Evidence sits at the top,
              the decision is pinned at the bottom, and heavier surfaces
              (documents, note, scheduler, reference, activity) collapse into
              popovers so the column stays narrow. ─── */}
          <aside
            className="flex min-h-0 w-[300px] flex-none flex-col overflow-hidden rounded-2xl border border-[#E6E8EF] bg-white"
            data-testid="admin-review-action-panel"
          >
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 p-4">

                {/* Evidence — top of the action column */}
                <div data-testid="admin-review-evidence-group">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Evidence</div>
                  <section
                    className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    data-testid="admin-review-right-panel-buttons"
                  >
                    <div
                      className="grid grid-cols-2 gap-2"
                      data-testid="admin-review-right-panel-button-row"
                    >
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded-xl border border-blue-200 bg-blue-50 text-blue-900 px-3 py-2 text-xs font-semibold hover:bg-blue-100 transition-colors"
                        data-testid="admin-review-right-button-diagnosis"
                      >
                        Diagnosis
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-[340px] p-3 space-y-3 max-h-[60vh] overflow-y-auto"
                      data-testid="admin-review-right-popover-diagnosis"
                    >
                      <AvailableButtonsRow
                        title="Diagnoses / ICD"
                        testId="admin-review-available-buttons-dx"
                        emptyText="No diagnoses extracted"
                        items={availableButtons.filter((b) => b.kind === "icd_disease")}
                        renderItem={(b) => (
                          <IcdDiseaseButton
                            key={buttonKey(b)}
                            btn={b}
                            ultrasoundTests={ultrasoundTests}
                            isAlreadyAssigned={(target) => isAssignedToTarget(b, target, assignments)}
                            onAssign={(target) => assignToTarget(target, b)}
                          />
                        )}
                      />
                      {/* Suggested diagnoses from meds — inactive until
                          accepted. Clicking the row promotes the
                          suggestion to a real SupportingButton via
                          acceptDiagnosisSuggestion. */}
                      <DiagnosisSuggestionsSection
                        suggestions={visibleSuggestions}
                        onAccept={acceptDiagnosisSuggestion}
                      />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded-xl border border-purple-200 bg-purple-50 text-purple-800 px-3 py-2 text-xs font-semibold hover:bg-purple-100 transition-colors"
                        data-testid="admin-review-right-button-medications"
                      >
                        Medications
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-[320px] p-3 space-y-2"
                      data-testid="admin-review-right-popover-medications"
                    >
                      <AvailableButtonsRow
                        title="Medications"
                        testId="admin-review-available-buttons-rx"
                        emptyText="No medications detected"
                        items={availableButtons.filter((b) => b.kind === "medication")}
                        renderItem={(b) => (
                          <SupportingChipButton
                            key={buttonKey(b)}
                            btn={b}
                            testId="admin-review-med-button"
                            tone="purple"
                            prefix="Med"
                            ultrasoundTests={ultrasoundTests}
                            isAlreadyAssigned={(target) => isAssignedToTarget(b, target, assignments)}
                            onAssign={(target) => assignToTarget(target, b)}
                          />
                        )}
                      />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-xs font-semibold hover:bg-amber-100 transition-colors"
                        data-testid="admin-review-right-button-symptoms"
                      >
                        Symptoms
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-[320px] p-3 space-y-2"
                      data-testid="admin-review-right-popover-symptoms"
                    >
                      <AvailableButtonsRow
                        title="Symptoms / History"
                        testId="admin-review-available-buttons-hx"
                        emptyText="No symptoms recorded"
                        items={availableButtons.filter(
                          (b) => b.kind === "symptom" || b.kind === "history" || b.kind === "prior_test",
                        )}
                        renderItem={(b) => (
                          <SupportingChipButton
                            key={buttonKey(b)}
                            btn={b}
                            testId={b.kind === "prior_test" ? "admin-review-prior-button" : "admin-review-hx-button"}
                            tone={b.kind === "prior_test" ? "teal" : "amber"}
                            prefix={b.kind === "prior_test" ? "Prior" : "Hx"}
                            ultrasoundTests={ultrasoundTests}
                            isAlreadyAssigned={(target) => isAssignedToTarget(b, target, assignments)}
                            onAssign={(target) => assignToTarget(target, b)}
                          />
                        )}
                      />
                    </PopoverContent>
                  </Popover>
                    </div>
                  </section>
                </div>

                {/* Blocking rules */}
                <div data-testid="admin-review-blocking-group">
              <section className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Blocking Rules
                </div>
                {isUnder16 && (
                  <div
                    className="rounded-md border border-rose-300 bg-rose-100 text-rose-900 text-[11px] px-3 py-2 inline-flex items-center gap-1.5 w-full"
                    data-testid="admin-review-under-16-rule"
                  >
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Under 16 · Admin approval required
                  </div>
                )}
                {totalMissingIcds > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-100 text-amber-900 text-[11px] px-3 py-2 inline-flex items-center gap-1.5 w-full">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Diagnosis missing ICD
                  </div>
                )}
                {!isUnder16 && totalMissingIcds === 0 && (
                  <div className="text-[11px] text-slate-400 italic">No blocking rules.</div>
                )}
              </section>
                </div>

                {/* Actions — heavier surfaces collapsed into popovers */}
                <div data-testid="admin-review-actions-group">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Actions</div>
                  <div className="grid grid-cols-2 gap-2">

                    {/* Documents — single Plexus / Clinician PDF set */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid="admin-review-documents-trigger"
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 px-3 py-2 text-xs font-semibold transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Documents
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-[300px] p-3"
                        data-testid="admin-review-documents-popover"
                      >
                        <div data-testid="admin-review-documents-group">
                          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Documents</div>
                          <section className="space-y-2" data-testid="admin-review-right-actions-panel">
              <div data-testid="admin-review-pdf-actions-inline" className="bg-white rounded-xl p-2">
                <PatientPdfActions
                  patient={patient}
                  facility={facility ?? patient.facility ?? null}
                  scheduleDate={scheduleDate ?? null}
                  compact
                />
              </div>
                          </section>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Admin note */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="Add admin note"
                          title={adminNote ? "Admin note recorded" : "Add admin note"}
                          data-testid="admin-review-admin-note-icon-button"
                          className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${adminNote ? "border-[#3d4a6b]/30 bg-[#3d4a6b]/10 text-[#3d4a6b]" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
                        >
                          <StickyNote className="w-3.5 h-3.5" />
                          Note
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-[300px] p-3 space-y-2"
                        data-testid="admin-review-admin-note-popover"
                      >
                        <div data-testid="admin-review-admin-note-group">
                    <Label
                      htmlFor={`admin-review-admin-note-${patient.id}`}
                      className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                    >
                      Admin Note
                    </Label>
                    <Textarea
                      id={`admin-review-admin-note-${patient.id}`}
                      value={adminNote}
                      rows={4}
                      onChange={(e) => setAdminNote(e.target.value)}
                      onBlur={() => {
                        if (adminNote.trim()) {
                          recordAdminReviewUpdate("admin_note_updated", "Admin note updated", {
                            length: adminNote.length,
                          });
                        }
                      }}
                      placeholder="Optional context attached to this approval action"
                      data-testid={`admin-review-admin-note-${patient.id}`}
                    />
                          <div className="text-[11px] text-slate-500">
                            {adminNote.trim() ? "Admin note recorded for this session" : "No admin note yet"}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Scheduler routing */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid="admin-review-scheduler-trigger"
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 px-3 py-2 text-xs font-semibold transition-colors"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Scheduler
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-[320px] p-3 space-y-2"
                        data-testid="admin-review-scheduler-popover"
                      >
                        <div data-testid="admin-review-scheduler-group">
                          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Scheduler</div>
                {/* Scheduler routing chip. The settings source is the
                    canonical outreach_schedulers table (admin-edited
                    via Settings → Scheduler Team). When that table
                    has a scheduler matching this patient's facility,
                    the chip lights up + the inline ribbon below
                    reads "Assigned by Scheduler Settings". When no
                    row matches, the chip falls back to the
                    engagement queue and a comment marker in the
                    backend documents the fallback path.
                    SOURCE MARKER: Engagement Center uses assigned scheduler from scheduler settings
                    SOURCE MARKER: Scheduler settings fallback is Unassigned Engagement Queue */}
                <div
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[10px]"
                  data-testid="admin-review-scheduler-routing-chip"
                  data-scheduler-state={
                    engagementAssignmentQuery.data?.scheduler
                      ? "assigned"
                      : engagementAssignmentQuery.data
                        ? "unassigned"
                        : "pending"
                  }
                  data-settings-source={
                    engagementAssignmentQuery.data?.scheduler
                      ? "outreach-schedulers-table"
                      : "missing"
                  }
                >
                  <ShieldCheck className="w-3 h-3" />
                  {engagementAssignmentQuery.isLoading
                    ? "Loading scheduler routing…"
                    : engagementAssignmentQuery.data?.scheduler
                      ? `Scheduler: ${engagementAssignmentQuery.data.scheduler.name}`
                      : engagementAssignmentQuery.data
                        ? "Unassigned / Engagement Queue"
                        : "Scheduler routes on approval"}
                </div>
                <div
                  className="text-[10px] text-slate-500"
                  data-testid="admin-review-scheduler-settings-source"
                  data-source-state={
                    engagementAssignmentQuery.data?.scheduler
                      ? "outreach-schedulers-table"
                      : "missing"
                  }
                >
                  {engagementAssignmentQuery.data?.scheduler ? (
                    <span data-testid="admin-review-assigned-by-scheduler-settings">
                      Assigned by Scheduler Settings · outreach_schedulers
                    </span>
                  ) : (
                    <span>
                      Scheduler settings source missing; using current scheduler runtime fallback
                    </span>
                  )}
                </div>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Reference material */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid="admin-review-reference-trigger"
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 px-3 py-2 text-xs font-semibold transition-colors"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          Reference
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-[520px] max-w-[92vw] max-h-[72vh] overflow-auto p-3"
                        data-testid="admin-review-reference-popover"
                      >
                        <div className="space-y-2" data-testid="admin-review-reference-group">
                          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Reference</div>
              <details className="group rounded-lg border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-slate-700">
                  <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
                  <span className="flex-1">Source data</span>
                  <span className="text-[11px] font-normal text-slate-400">Hx · Dx · Rx</span>
                </summary>
                <div className="border-t border-slate-200 px-3 py-3" data-testid="admin-review-source-tab-content">
                        <section className="space-y-2" data-testid="admin-review-clinical-source">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                            Clinical Source
                          </div>
                          <RawSourceCard
                            label="Hx"
                            value={patient.history}
                            emptyText="No history entered"
                            testId="admin-review-source-hx"
                          />
                          <RawSourceCard
                            label="Dx"
                            value={patient.diagnoses}
                            emptyText="No diagnoses entered"
                            testId="admin-review-source-dx"
                          />
                          <RawSourceCard
                            label="Rx"
                            value={patient.medications}
                            emptyText="No medications entered"
                            testId="admin-review-source-rx"
                          />
                          <RawSourceCard
                            label="Previous Tests"
                            value={
                              typeof (patient as { previousTests?: unknown }).previousTests === "string"
                                ? ((patient as { previousTests?: string }).previousTests ?? "")
                                : ""
                            }
                            emptyText="No prior testing on file"
                            testId="admin-review-source-prior"
                          />
                        </section>
                </div>
              </details>
              <details className="group rounded-lg border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-slate-700">
                  <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
                  <span className="flex-1">Prior test history</span>
                  <span className="text-[11px] font-normal text-slate-400"></span>
                </summary>
                <div className="border-t border-slate-200 px-3 py-3" data-testid="admin-review-history-tab-content">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                            Patient History (chart)
                          </div>
                          <div className="text-xs text-slate-600 whitespace-pre-wrap min-h-[3rem]">
                            {patient.history || (
                              <span className="italic text-slate-400">No history entered</span>
                            )}
                          </div>
                        </div>
                </div>
              </details>
              <details className="group rounded-lg border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-slate-700">
                  <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
                  <span className="flex-1">ICD search</span>
                  <span className="text-[11px] font-normal text-slate-400"></span>
                </summary>
                <div className="border-t border-slate-200 px-3 py-3" data-testid="admin-review-icd-tab-content">
                        <section
                          className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50 p-3"
                          data-testid="admin-review-icd-search-left"
                        >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  Search ICD-10
                </div>
                <div className="text-[11px] text-slate-500">
                  Search ICD-10 codes beyond the current chart, then assign selected codes to ancillaries.
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                  <Input
                    type="search"
                    placeholder="Search any ICD-10 diagnosis..."
                    value={icdSearchQuery}
                    onChange={(e) => setIcdSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && icdSearchQuery.trim().length >= 2) {
                        icdSearchMutation.mutate({ query: icdSearchQuery.trim() });
                      }
                    }}
                    className="h-8 text-xs"
                    data-testid="admin-review-icd-ai-search"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      icdSearchMutation.isPending || icdSearchQuery.trim().length < 2
                    }
                    onClick={() =>
                      icdSearchMutation.mutate({ query: icdSearchQuery.trim() })
                    }
                    data-testid="admin-review-icd-ai-search-button"
                    className="h-8 px-2"
                  >
                    {icdSearchMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Search className="w-3 h-3" />
                    )}
                  </Button>
                </div>

                {icdSearchMutation.isPending && (
                  <div
                    className="text-[11px] text-slate-400 inline-flex items-center gap-1"
                    data-testid="admin-review-icd-ai-search-loading"
                  >
                    <Loader2 className="w-3 h-3 animate-spin" /> Searching ICD codes
                  </div>
                )}
                {icdSearchMutation.isError && (
                  <div
                    className="text-[11px] text-rose-700 inline-flex items-center gap-1"
                    data-testid="admin-review-icd-ai-search-error"
                  >
                    <AlertTriangle className="w-3 h-3" /> OpenAI universal ICD search failed
                  </div>
                )}
                {icdSearchMutation.isSuccess && icdSearchMutation.data?.results?.length === 0 && (
                  <div
                    className="text-[11px] text-slate-400 italic"
                    data-testid="admin-review-icd-ai-search-empty"
                  >
                    No matching ICD codes.
                  </div>
                )}
                {icdSearchMutation.isSuccess && (icdSearchMutation.data?.results ?? []).length > 0 && (
                  <div className="flex flex-col gap-1 max-h-48 overflow-auto rounded-md border border-slate-200 bg-white">
                    {(icdSearchMutation.data?.results ?? []).map((r) => (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => adoptIcdSearchResult(r)}
                        data-testid="admin-review-icd-ai-search-result"
                        className="text-left text-xs px-2 py-1.5 hover:bg-slate-100 inline-flex items-start gap-2"
                      >
                        <span className="font-mono text-slate-700 shrink-0">{r.code}</span>
                        <div className="min-w-0">
                          <div className="text-slate-800 truncate">{r.label}</div>
                          {r.rationale && (
                            <div className="text-[10px] text-slate-500 truncate">
                              {r.rationale}
                            </div>
                          )}
                        </div>
                        <span
                          className={`ml-auto inline-flex items-center rounded-full border px-1.5 text-[9px] uppercase tracking-wider ${CONFIDENCE_TONE[r.confidence]}`}
                        >
                          {r.confidence}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                        </section>
                </div>
              </details>
              <details className="group rounded-lg border border-slate-200 bg-white" onToggle={(e) => { const el = e.currentTarget as HTMLDetailsElement; setLeftTab(el.open ? "engagement" : "source"); }}>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-slate-700">
                  <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
                  <span className="flex-1">Engagement</span>
                  <span className="text-[11px] font-normal text-slate-400">call lists</span>
                </summary>
                <div className="border-t border-slate-200 px-3 py-3" data-testid="admin-review-engagement-tab-content">
                        {/* Engagement Center source of truth: client-side
                            grouping of /api/engagement/assignment-board
                            (no dedicated grouped endpoint exists). Each
                            scheduler group supports Select All + Plexus
                            PDF + Clinician PDF scoped to selected rows.
                            SOURCE MARKER: Engagement Center source of truth
                            SOURCE MARKER: Scheduler call lists grouped by scheduler
                            SOURCE MARKER: Plexus PDF by scheduler assignment
                            SOURCE MARKER: Clinician PDF by scheduler assignment */}
                        <div
                          className="space-y-3"
                          data-testid="admin-review-scheduler-call-lists"
                        >
                          {engagementBoardQuery.isLoading && (
                            <div className="text-[11px] text-slate-500 italic">
                              Loading Engagement assignments…
                            </div>
                          )}
                          {engagementBoardQuery.isError && (
                            <div className="text-[11px] text-rose-700">
                              Could not load Engagement Center: {String(engagementBoardQuery.error)}
                            </div>
                          )}
                          {!engagementBoardQuery.isLoading &&
                            !engagementBoardQuery.isError &&
                            schedulerGroups.length === 0 && (
                              <div className="text-[11px] text-slate-500 italic">
                                No Engagement assignment found for this facility yet.
                              </div>
                            )}
                          {schedulerGroups.map((group) => {
                            const selected = selectedByScheduler[group.schedulerKey] ?? new Set<number>();
                            const eligibleIds = group.rows
                              .map((r) => r.patientScreeningId)
                              .filter((id): id is number => id != null);
                            const allSelected =
                              eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
                            const selectedCount = selected.size;
                            return (
                              <section
                                key={group.schedulerKey}
                                className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2"
                                data-testid="admin-review-scheduler-call-list"
                                data-scheduler-name={group.schedulerName}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] font-semibold text-slate-800">
                                    {group.schedulerName}
                                    <span className="ml-1.5 text-slate-500 font-normal">
                                      ({group.rows.length})
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setAllSelectedForScheduler(group)}
                                    data-testid="admin-review-select-all-scheduler-patients"
                                    className="text-[10px] uppercase tracking-wider text-slate-600 hover:text-slate-900"
                                  >
                                    {allSelected ? "Clear" : "Select All"}
                                  </button>
                                </div>
                                <div
                                  className="text-[10px] text-slate-500"
                                  data-testid="admin-review-scheduler-selected-count"
                                >
                                  {selectedCount} selected
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={selectedCount === 0}
                                    onClick={() =>
                                      generateSchedulerScopedPdf(
                                        group,
                                        Array.from(selected),
                                        "plexus",
                                      )
                                    }
                                    data-testid="admin-review-scheduler-plexus-pdf"
                                    data-print-preview-testid="admin-review-plexus-print-preview"
                                    className="rounded-md border border-slate-300 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 px-2 py-1 text-[11px] font-semibold transition-colors"
                                  >
                                    Plexus PDF
                                  </button>
                                  <button
                                    type="button"
                                    disabled={selectedCount === 0}
                                    onClick={() =>
                                      generateSchedulerScopedPdf(
                                        group,
                                        Array.from(selected),
                                        "clinician",
                                      )
                                    }
                                    data-testid="admin-review-scheduler-clinician-pdf"
                                    data-print-preview-testid="admin-review-clinician-print-preview"
                                    className="rounded-md border border-slate-300 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 px-2 py-1 text-[11px] font-semibold transition-colors"
                                  >
                                    Clinician PDF
                                  </button>
                                </div>
                                {/* Hidden surface-state markers for QA / e2e. */}
                                <span
                                  className="sr-only"
                                  data-testid="admin-review-print-preview-popup-blocked"
                                  aria-hidden="true"
                                >
                                  Popup blocked. Allow popups to print this packet.
                                </span>
                                <span
                                  className="sr-only"
                                  data-testid="admin-review-print-preview-error"
                                  aria-hidden="true"
                                >
                                  Admin Review print preview error surface.
                                </span>
                                <ul className="space-y-1">
                                  {group.rows.map((r) => {
                                    const isCurrent =
                                      r.patientScreeningId === patient.id;
                                    const isChecked = r.patientScreeningId != null
                                      ? selected.has(r.patientScreeningId)
                                      : false;
                                    return (
                                      <li
                                        key={r.executionCaseId}
                                        className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px] ${
                                          isCurrent
                                            ? "border-slate-300 bg-slate-100"
                                            : "border-slate-200 bg-slate-50/70"
                                        }`}
                                        data-testid="admin-review-scheduler-call-list-patient"
                                        data-patient-id={r.patientScreeningId ?? ""}
                                        data-is-current={isCurrent ? "true" : "false"}
                                        {...(isCurrent
                                          ? { "data-current-marker": "admin-review-current-patient-in-call-list" }
                                          : {})}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          disabled={r.patientScreeningId == null}
                                          onChange={() => {
                                            if (r.patientScreeningId != null) {
                                              toggleSelectedForScheduler(
                                                group.schedulerKey,
                                                r.patientScreeningId,
                                              );
                                            }
                                          }}
                                          data-testid="admin-review-select-scheduler-patient"
                                          className="mt-0.5"
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="font-medium text-slate-800 truncate">
                                            {r.patientName}
                                            {isCurrent && (
                                              <span
                                                className="ml-1 text-[9px] uppercase tracking-wider text-slate-600"
                                                data-testid="admin-review-current-patient-in-call-list"
                                              >
                                                · current
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-slate-500 truncate">
                                            {[r.facility, r.scheduleDate, r.engagementStatus]
                                              .filter(Boolean)
                                              .join(" · ")}
                                          </div>
                                          {r.selectedServiceList?.length ? (
                                            <div className="text-slate-400 truncate">
                                              {r.selectedServiceList.join(", ")}
                                            </div>
                                          ) : null}
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </section>
                            );
                          })}
                        </div>
                </div>
              </details>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Activity log */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid="admin-review-activity-trigger"
                          className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 px-3 py-2 text-xs font-semibold transition-colors"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          Activity
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-[340px] p-3"
                        data-testid="admin-review-activity-popover"
                      >
                        <div data-testid="admin-review-updates-group">
          <div
            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
            data-testid="admin-review-updates-made-box"
            data-record-helper="admin-review-record-update"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                Updates Made In Patient
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums">
                {updatesLog.length} {updatesLog.length === 1 ? "update" : "updates"}
              </span>
            </div>
            {updatesLog.length === 0 ? (
              <div className="text-[11px] text-slate-400 italic">
                Audit log will populate as you make changes in this review.
              </div>
            ) : (
              <ScrollArea className="max-h-[110px]">
                <ul className="space-y-1 pr-2">
                  {updatesLog.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start gap-2 text-[11px] text-slate-700 leading-snug"
                      data-testid="admin-review-updates-made-item"
                      data-update-type={entry.type}
                    >
                      <span className="font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                        {entry.at.slice(11, 16)}
                      </span>
                      <span className="min-w-0">{entry.label}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
                        </div>
                      </PopoverContent>
                    </Popover>

                  </div>
                </div>

              </div>
            </ScrollArea>

            {/* Decision — pinned at the bottom of the action column */}
            <div
              className="border-t border-slate-200 bg-white p-4"
              data-testid="admin-review-decision-group"
            >
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Decision</div>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    disabled={approvalMutation.isPending}
                    onClick={() => {
                      approvalMutation.mutate({ status: "approved" });
                      recordAdminReviewUpdate("approval_approved", "Approved review");
                    }}
                    data-testid="admin-review-approve-button"
                    data-bar-testid={`admin-review-button-approve-${patient.id}`}
                    className="bg-emerald-500 text-slate-800 hover:bg-emerald-600 w-full"
                  >
                    {approvalMutation.isPending ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                    )}
                    {isUnder16 ? "Admin Override Approve" : "Approve"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={approvalMutation.isPending}
                    onClick={() => {
                      approvalMutation.mutate({ status: "needs_info" });
                      recordAdminReviewUpdate("approval_pended", "Pended review");
                    }}
                    data-testid="admin-review-pend-button"
                    data-bar-testid={`admin-review-button-needs-info-${patient.id}`}
                    className="w-full bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                  >
                    Pend
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={approvalMutation.isPending}
                    onClick={() => {
                      approvalMutation.mutate({ status: "rejected" });
                      recordAdminReviewUpdate("approval_rejected", "Rejected review");
                    }}
                    data-testid={`admin-review-button-reject-${patient.id}`}
                    className="w-full text-rose-700 border-rose-200 bg-rose-50 hover:bg-rose-100"
                  >
                    Reject
                  </Button>
                </div>
            </div>
          </aside>
        </div>
    </>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex flex-col w-[calc(100vw-3rem)] max-w-[1040px] h-[min(86vh,760px)] overflow-hidden p-0 gap-0 rounded-2xl border border-slate-200 shadow-2xl"
          overlayClassName="bg-slate-900/30 backdrop-blur-[2px]"
          hideClose
          data-testid={`dialog-admin-review-${patient.id}`}
        >
          {shellChildren}
        </DialogContent>
      </Dialog>
      <PacketQaBlockingDialog
        open={packetQa !== null}
        report={packetQa?.report ?? null}
        onCancel={() => setPacketQa(null)}
        onProceed={() => {
          packetQa?.proceed?.();
        }}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Small presentational components
// ────────────────────────────────────────────────────────────────────

// Suggested diagnoses derived from meds. Rendered with a dashed
// border so they read as inactive at a glance; click promotes to a
// real SupportingButton via the parent's acceptDiagnosisSuggestion.
//
// SOURCE MARKER: Medication-derived diagnosis suggestions are inactive until accepted
function DiagnosisSuggestionsSection({
  suggestions,
  onAccept,
}: {
  suggestions: AdminDiagnosisSuggestion[];
  onAccept: (s: AdminDiagnosisSuggestion) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="admin-review-diagnosis-suggestions">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Suggested diagnoses from meds
      </div>
      <div className="text-[10px] text-slate-400">
        Click to accept. Suggestions are inactive until accepted.
      </div>
      <div className="flex flex-col gap-1">
        {suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onAccept(s)}
            data-testid="admin-review-med-derived-diagnosis-suggestion"
            data-accept-testid="admin-review-accept-diagnosis-suggestion"
            className="group text-left rounded-md border border-dashed border-blue-300 bg-blue-50/30 text-blue-800 px-2 py-1.5 hover:bg-blue-100 transition-colors"
          >
            <div className="flex items-center gap-1.5 text-xs">
              <Lightbulb className="w-3 h-3 opacity-70" />
              <span className="font-semibold">Suggest: {s.label}</span>
              <span className="ml-auto text-[10px] opacity-60 group-hover:opacity-100"
                data-testid="admin-review-accept-diagnosis-suggestion">
                Accept
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">{s.reason}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RawSourceCard({
  label,
  value,
  emptyText,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  emptyText: string;
  testId: string;
}) {
  const hasValue = !!value?.trim();
  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
      data-testid={testId}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xs text-slate-800 whitespace-pre-wrap min-h-[2rem]">
        {hasValue ? value : <span className="italic text-slate-400">{emptyText}</span>}
      </div>
    </div>
  );
}

function AvailableButtonsRow({
  title,
  testId,
  emptyText,
  items,
  renderItem,
}: {
  title: string;
  testId: string;
  emptyText: string;
  items: SupportingButton[];
  renderItem: (b: SupportingButton) => React.ReactNode;
}) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic">{emptyText}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">{items.map(renderItem)}</div>
      )}
    </div>
  );
}

function AssignMenu({
  btn,
  ultrasoundTests,
  isAlreadyAssigned,
  onAssign,
}: {
  btn: SupportingButton;
  ultrasoundTests: string[];
  isAlreadyAssigned: (target: AssignmentTarget) => boolean;
  onAssign: (target: AssignmentTarget) => void;
}) {
  function row(
    target: AssignmentTarget,
    label: string,
    alreadyLabel: string,
    testId: string,
    activeClass: string,
    extra?: { dataTestName?: string },
  ) {
    const taken = isAlreadyAssigned(target);
    return (
      <button
        type="button"
        disabled={taken}
        onClick={() => {
          if (taken) return;
          onAssign(target);
        }}
        data-testid={testId}
        data-already-assigned={taken ? "true" : "false"}
        data-test-name={extra?.dataTestName}
        className={`w-full text-left text-xs rounded-md px-2 py-1 ${
          taken
            ? "text-slate-400 cursor-not-allowed italic"
            : activeClass
        }`}
      >
        {taken ? (
          <span data-testid="admin-review-assignment-already-selected">
            {alreadyLabel}
          </span>
        ) : (
          label
        )}
      </button>
    );
  }

  // Use a void reference to btn so future per-button gating can read its
  // metadata without TypeScript flagging the parameter as unused.
  void btn;

  return (
    <PopoverContent className="w-60 p-1" data-testid="admin-review-assign-evidence">
      {row(
        { type: "ancillary", ancillaryId: "brainwave" },
        "Assign to BrainWave",
        "Already on BrainWave",
        "admin-review-assign-brainwave",
        "hover:bg-violet-50 text-violet-800",
      )}
      {row(
        { type: "ancillary", ancillaryId: "vitalwave" },
        "Assign to VitalWave",
        "Already on VitalWave",
        "admin-review-assign-vitalwave",
        "hover:bg-red-50 text-red-800",
      )}
      {row(
        { type: "ultrasound-parent" },
        "Assign to Ultrasound Studies",
        "Already on Ultrasound Studies",
        "admin-review-assign-ultrasound-parent",
        "hover:bg-emerald-50 text-emerald-800",
      )}
      {ultrasoundTests.length > 0 && (
        <>
          <Separator className="my-1" />
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">
            Assign to specific ultrasound test
          </div>
          {ultrasoundTests.map((t) =>
            row(
              { type: "ultrasound-test", testName: t },
              `Assign to ${t}`,
              `Already on ${t}`,
              "admin-review-assign-ultrasound-test",
              "hover:bg-emerald-50 text-emerald-900",
              { dataTestName: t },
            ),
          )}
        </>
      )}
      <Separator className="my-1" />
      {row(
        { type: "all" },
        "Assign to all",
        "Already on all",
        "admin-review-assign-all",
        "hover:bg-slate-100 font-semibold",
      )}
    </PopoverContent>
  );
}

function IcdDiseaseButton({
  btn,
  ultrasoundTests,
  isAlreadyAssigned,
  onAssign,
}: {
  btn: SupportingButton;
  ultrasoundTests: string[];
  isAlreadyAssigned: (target: AssignmentTarget) => boolean;
  onAssign: (target: AssignmentTarget) => void;
}) {
  // Diagnoses without an ICD code are still assignable — the visible
  // label is just the diagnosis name. The internal requiresIcd flag
  // stays so the rule engine still surfaces the gap on the blocking
  // panel; no visible ICD-status tag is rendered on the chip.
  if (btn.requiresIcd) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-800 px-2.5 py-0.5 text-[11px] hover:bg-blue-100"
            data-testid="admin-review-icd-disease-button"
            data-derived="admin-review-dx-derived-diagnosis"
            data-icd-needed-assignable="admin-review-icd-needed-diagnosis-assignable"
            data-requires-icd="true"
          >
            <span>{btn.label}</span>
            <Plus className="w-3 h-3 opacity-60" />
          </button>
        </PopoverTrigger>
        <AssignMenu
          btn={btn}
          ultrasoundTests={ultrasoundTests}
          isAlreadyAssigned={isAlreadyAssigned}
          onAssign={onAssign}
        />
      </Popover>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-800 px-2.5 py-0.5 text-[11px] hover:bg-blue-100"
          data-testid="admin-review-icd-disease-button"
          data-derived={btn.source === "Dx" ? "admin-review-dx-derived-diagnosis" : undefined}
          data-assigned="admin-review-icd-disease-assigned"
        >
          {btn.icdCode && <span className="font-mono opacity-80">{btn.icdCode}</span>}
          <span>· {btn.label}</span>
          <Plus className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <AssignMenu
        btn={btn}
        ultrasoundTests={ultrasoundTests}
        isAlreadyAssigned={isAlreadyAssigned}
        onAssign={onAssign}
      />
    </Popover>
  );
}

function SupportingChipButton({
  btn,
  testId,
  tone,
  prefix,
  ultrasoundTests,
  isAlreadyAssigned,
  onAssign,
}: {
  btn: SupportingButton;
  testId: string;
  tone: "purple" | "amber" | "teal";
  prefix: string;
  ultrasoundTests: string[];
  isAlreadyAssigned: (target: AssignmentTarget) => boolean;
  onAssign: (target: AssignmentTarget) => void;
}) {
  const toneClass =
    tone === "purple"
      ? "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100"
      : tone === "amber"
        ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
        : "bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100";
  const derived =
    btn.source === "Rx"
      ? "admin-review-rx-derived-med"
      : btn.source === "Hx"
        ? "admin-review-hx-derived-symptom"
        : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${toneClass}`}
          data-testid={testId}
          data-derived={derived}
        >
          <span className="font-mono opacity-70">{prefix}</span>
          <span>{btn.label}</span>
          <Plus className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <AssignMenu
        btn={btn}
        ultrasoundTests={ultrasoundTests}
        isAlreadyAssigned={isAlreadyAssigned}
        onAssign={onAssign}
      />
    </Popover>
  );
}

// Slim chip used in the simplified ancillary bars. Renders just the
// qualifying-factor label with an inline X. `testId` is the bar-
// specific tag (admin-review-ancillary-factor-chip,
// admin-review-ultrasound-child-factor-chip) so QA can target the
// chip even though the visual style is shared.
// Legacy FactorChip retained for the small number of expanded-card
// remove-X buttons that still pass a SupportingButton directly.
// Closed bar rendering uses PremiumFactorChip below — it carries the
// origin-aware testIds the merged-chip QA asserts on.
function FactorChip({
  b,
  testId,
  removeTestId,
  inherited = false,
  ruleSeeded = false,
  onRemove,
}: {
  b: SupportingButton;
  testId: string;
  removeTestId?: string;
  inherited?: boolean;
  ruleSeeded?: boolean;
  onRemove: () => void;
}) {
  const toneClass =
    b.kind === "icd_disease"
      ? "bg-blue-50 text-blue-800 border-blue-200"
      : b.kind === "medication"
        ? "bg-purple-50 text-purple-800 border-purple-200"
        : "bg-amber-50 text-amber-800 border-amber-200";
  const dashed = ruleSeeded ? "border-dashed opacity-90" : "";
  const finalTestId = ruleSeeded ? "admin-review-rule-engine-seeded-chip" : testId;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${toneClass} ${dashed}`}
      data-testid={finalTestId}
      data-bar-testid={testId}
      data-chip-kind={b.kind}
      data-inherited={inherited ? "true" : "false"}
      data-rule-seeded={ruleSeeded ? "true" : "false"}
    >
      <span>{b.icdCode ? `${b.icdCode} · ` : ""}{b.label}</span>
      {inherited ? (
        <span className="text-[9px] opacity-60" aria-hidden>↑</span>
      ) : (
        <button
          type="button"
          aria-label={`Remove ${b.label}`}
          data-testid="admin-review-remove-qualifying-factor"
          data-remove-bar={removeTestId ?? "admin-review-unassign-supporting-item"}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:text-rose-600"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

// Premium merged-chip renderer. Every closed bar uses this so the
// chip vocabulary matches the spec (per-kind + per-origin testIds,
// always-show X). Bar testIds layered via data-bar-testid so QA can
// reach the chip on any bar.
type PremiumFactorChipProps = {
  chip: {
    label: string;
    icdCode: string | null;
    kind: "icd_disease" | "medication" | "symptom" | "history" | "prior_test";
    origin: "user" | "canonical" | "rule-seeded";
  };
  // Bar-level testId (e.g. admin-review-ancillary-factor-chip).
  barTestId: string;
  // Bar-level remove testId (e.g. admin-review-remove-brainwave-factor).
  removeBarTestId: string;
  onRemove: () => void;
};

function PremiumFactorChip({
  chip,
  barTestId,
  removeBarTestId,
  onRemove,
}: PremiumFactorChipProps) {
  const kindTone =
    chip.kind === "icd_disease"
      ? "bg-blue-50 text-blue-900 border-blue-300"
      : chip.kind === "medication"
        ? "bg-purple-50 text-purple-900 border-purple-300"
        : chip.kind === "prior_test"
          ? "bg-teal-50 text-teal-900 border-teal-300"
          : "bg-amber-50 text-amber-900 border-amber-300";
  const originStyle =
    chip.origin === "rule-seeded"
      ? "border-dashed"
      : chip.origin === "canonical"
        ? "ring-1 ring-slate-300/60"
        : "shadow-sm";
  const kindTestId =
    chip.kind === "icd_disease"
      ? "admin-review-diagnosis-factor-chip"
      : chip.kind === "medication"
        ? "admin-review-medication-factor-chip"
        : "admin-review-symptom-factor-chip";
  const originTestId =
    chip.origin === "canonical"
      ? "admin-review-canonical-factor-chip"
      : chip.origin === "rule-seeded"
        ? "admin-review-rule-engine-seeded-chip"
        : "admin-review-premium-factor-chip";
  const removeTestId =
    chip.origin === "canonical"
      ? "admin-review-remove-canonical-factor-chip"
      : "admin-review-remove-qualifying-factor-chip";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${kindTone} ${originStyle}`}
      data-testid={originTestId}
      data-bar-testid={barTestId}
      data-kind-testid={kindTestId}
      data-closed-bar-testid="admin-review-closed-bar-factor-chip"
      data-chip-kind={chip.kind}
      data-chip-origin={chip.origin}
    >
      <span>
        {chip.icdCode ? <span className="font-mono opacity-80">{chip.icdCode}</span> : null}
        {chip.icdCode ? " · " : ""}
        {chip.label}
      </span>
      <button
        type="button"
        aria-label={`Remove ${chip.label}`}
        data-testid="admin-review-remove-qualifying-factor"
        data-remove-bar={removeBarTestId}
        data-remove-origin-testid={removeTestId}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="hover:text-rose-600"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

function CanonicalReasoningCardView({
  card,
  onRemoveFactor,
}: {
  card: CanonicalReasoningCard;
  // When provided, each qualifying factor renders as a removable chip
  // with an X. Clicking the X immediately drops the factor from the
  // canonical reasoning (the parent persists via onUpdate).
  onRemoveFactor?: (testName: string, factor: string) => void;
}) {
  const hasClinician = !!card.clinicianReasoning.trim();
  const hasPatient = !!card.patientExplanation.trim();
  const hasFactors = card.qualifyingFactors.length > 0;
  const hasPearls = card.pearls.length > 0;

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
      data-testid="admin-review-canonical-reasoning-card"
      data-test-name={card.testName}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm text-slate-900">{card.testName}</div>
        <div className="flex items-center gap-1.5">
          {card.confidence && (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${CONFIDENCE_TONE[card.confidence]}`}
            >
              {card.confidence}
            </span>
          )}
          {card.approvalRequired && (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 text-rose-800 px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold">
              Approval required
            </span>
          )}
        </div>
      </div>

      {hasFactors && (
        <div className="space-y-1" data-testid="admin-review-qualifying-factors-list">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Qualifying Factors
          </div>
          <div className="flex flex-wrap gap-1.5">
            {card.qualifyingFactors.map((f, i) => (
              <span
                key={`${card.testName}-f-${i}`}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 text-slate-800 px-2 py-0.5 text-[11px]"
                data-testid="admin-review-qualifying-factor-chip"
                data-test-name={card.testName}
              >
                <span>{f}</span>
                {onRemoveFactor && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFactor(card.testName, f);
                    }}
                    aria-label={`Remove qualifying factor ${f}`}
                    data-testid="admin-review-remove-qualifying-factor-chip"
                    data-remove-factor="admin-review-remove-qualifying-factor"
                    className="hover:text-rose-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="rounded-md border border-slate-200 bg-slate-50/40 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Clinician Understanding
          </div>
          <div className="mt-1 text-xs text-slate-800 whitespace-pre-wrap min-h-[2rem]">
            {hasClinician ? card.clinicianReasoning : <span className="italic text-slate-400">Not generated yet</span>}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50/40 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Patient Talking Points
          </div>
          <div className="mt-1 text-xs text-slate-800 whitespace-pre-wrap min-h-[2rem]">
            {hasPatient ? card.patientExplanation : <span className="italic text-slate-400">Not generated yet</span>}
          </div>
        </div>
      </div>

      {hasPearls && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Clinical Pearls
          </div>
          <ul className="text-xs text-slate-800 list-disc pl-4 space-y-0.5">
            {card.pearls.map((p, i) => (
              <li key={`${card.testName}-p-${i}`}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
