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
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lightbulb,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  XCircle,
  Search,
  BookOpen,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PatientScreening } from "@shared/schema";
import { computeAdminReview, type AdminApprovalStatus } from "@/lib/adminReviewStatus";
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
import {
  evidenceForUltrasoundTest,
  ALL_ULTRASOUND_SUBTYPES,
} from "@shared/plexus-iq/adminReviewEvidence";
import {
  blockedAncillariesFromHistory,
  type AncillaryWarning,
} from "@shared/priorAncillaryHistory";
import {
  AdminReviewAiLogicDrawer,
  AiEvidenceBubblesRow,
  AiLogicSavePrompt,
  ChipEvidenceMenuExtras,
  CONF_DOT,
  SOURCE_BADGE_TONE,
  useCiChipDecision,
  normalizeSourceType,
  type AiAttachTarget,
  type AiEvidenceItem,
  type AiLogicPatientContext,
  type AiRuleRationale,
} from "./AdminReviewAiLogicDrawer";
import {
  ciRecordEvidence,
  useClinicalIntelligenceLoaded,
} from "@/lib/clinicalIntelligence/store";
import { ciActorName } from "@/lib/clinicalIntelligence/permissions";
import { useCurrentUser } from "@/hooks/api/auth";

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

// Audit/change-log entry shown in the bottom "Updates Made In Patient"
// box. This is a thin trace surface, not a second clinical truth
// layer — every entry mirrors an action the admin took during this
// review session.
// Canonical ultrasound subtype names offered by the manual "Add Ancillary"
// control. These match the qualifying-test strings used across scheduling /
// PDF surfaces (with CPT codes) so a hand-added test dedupes against an
// AI-qualified one. Generic "Ultrasound Studies" is offered separately.
const ADD_ULTRASOUND_SUBTYPES: readonly string[] = ALL_ULTRASOUND_SUBTYPES;

export type AdminReviewUpdateType =
  | "diagnosis_added"
  | "medication_added"
  | "symptom_added"
  | "icd_added"
  | "suggestion_accepted"
  | "qualifying_factor_removed"
  | "ancillary_added"
  | "ancillary_removed"
  | "ultrasound_child_added"
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

// ────────────────────────────────────────────────────────────────────
// Updates grouping — the bottom "Updates" box groups change entries by
// ancillary (BrainWave / VitalWave / Ultrasound) instead of a flat
// chronological list. Only per-ancillary clinical changes appear here;
// session-meta entries (approvals, notes, regenerate, pdf, icd search)
// are intentionally excluded.
// ────────────────────────────────────────────────────────────────────
const UPDATE_CHANGE_TYPES: ReadonlySet<AdminReviewUpdateType> = new Set([
  "diagnosis_added",
  "medication_added",
  "symptom_added",
  "qualifying_factor_removed",
  "ancillary_added",
  "ancillary_removed",
  "ultrasound_child_added",
  "ultrasound_child_removed",
]);

function ancillaryOfUpdateEntry(
  entry: AdminReviewUpdateEntry,
): AdminReviewAncillaryId | null {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const direct = meta.ancillary;
  if (direct === "brainwave" || direct === "vitalwave" || direct === "ultrasound") {
    return direct;
  }
  const t = (meta.target ?? meta.from) as
    | { type?: string; ancillaryId?: string }
    | undefined;
  if (t && typeof t === "object") {
    if (
      t.type === "ancillary" &&
      (t.ancillaryId === "brainwave" || t.ancillaryId === "vitalwave")
    ) {
      return t.ancillaryId;
    }
    if (t.type === "ultrasound-parent" || t.type === "ultrasound-test") {
      return "ultrasound";
    }
  }
  if (entry.type === "ultrasound_child_removed") return "ultrasound";
  return null;
}

// Short, clean change wording, e.g. "Removed PTSD" / "Added diabetes
// mellitus". Strips the verbose "qualifying factor:" / "diagnosis:"
// prefixes the audit log stores.
function shortUpdateText(entry: AdminReviewUpdateEntry): string {
  const label = entry.label ?? "";
  const afterColon = label.includes(":")
    ? label.slice(label.indexOf(":") + 1).trim()
    : label.trim();
  switch (entry.type) {
    case "diagnosis_added":
    case "medication_added":
    case "symptom_added":
      return `Added ${afterColon}`;
    case "qualifying_factor_removed":
    case "ultrasound_child_removed":
      return `Removed ${afterColon}`;
    case "ancillary_removed":
      return "Removed ancillary";
    default:
      return label;
  }
}

const UPDATE_GROUP_ORDER: AdminReviewAncillaryId[] = [
  "brainwave",
  "vitalwave",
  "ultrasound",
];

const UPDATE_GROUP_ACCENT: Record<AdminReviewAncillaryId, string> = {
  brainwave: "text-violet-700",
  vitalwave: "text-rose-700",
  ultrasound: "text-emerald-700",
};

const UPDATE_GROUP_DOT: Record<AdminReviewAncillaryId, string> = {
  brainwave: "bg-violet-500",
  vitalwave: "bg-rose-500",
  ultrasound: "bg-emerald-500",
};

function groupUpdatesByAncillary(
  updates: AdminReviewUpdateEntry[],
): { ancillary: AdminReviewAncillaryId; entries: AdminReviewUpdateEntry[] }[] {
  const byAncillary: Record<AdminReviewAncillaryId, AdminReviewUpdateEntry[]> = {
    brainwave: [],
    vitalwave: [],
    ultrasound: [],
  };
  for (const entry of updates) {
    if (!UPDATE_CHANGE_TYPES.has(entry.type)) continue;
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;
    const tgt = (meta.target ?? meta.from) as { type?: string } | undefined;
    if (tgt && typeof tgt === "object" && tgt.type === "all") {
      byAncillary.brainwave.push(entry);
      byAncillary.vitalwave.push(entry);
      byAncillary.ultrasound.push(entry);
      continue;
    }
    const ancillary = ancillaryOfUpdateEntry(entry);
    if (!ancillary) continue;
    byAncillary[ancillary].push(entry);
  }
  return UPDATE_GROUP_ORDER.filter((a) => byAncillary[a].length > 0).map((a) => ({
    ancillary: a,
    entries: byAncillary[a],
  }));
}

// Derive the set of regenerate target ids from the pending changes in the
// Updates panel. Mirrors the same set surfaced by `groupUpdatesByAncillary`
// but resolves ultrasound children to their specific `test:<name>` target so
// a change under a single ultrasound test regenerates only that test.
// Shape matches `readStaleTargetIds`: brainwave | vitalwave | ultrasound |
// test:<testName>.
function regenTargetIdsFromUpdates(
  updates: AdminReviewUpdateEntry[],
): string[] {
  const ids = new Set<string>();
  for (const entry of updates) {
    if (!UPDATE_CHANGE_TYPES.has(entry.type)) continue;
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;
    const tgt = (meta.target ?? meta.from) as
      | { type?: string; ancillaryId?: string; testName?: string }
      | undefined;
    if (tgt && typeof tgt === "object") {
      if (tgt.type === "all") {
        ids.add("brainwave");
        ids.add("vitalwave");
        ids.add("ultrasound");
        continue;
      }
      if (
        tgt.type === "ancillary" &&
        (tgt.ancillaryId === "brainwave" || tgt.ancillaryId === "vitalwave")
      ) {
        ids.add(tgt.ancillaryId);
        continue;
      }
      if (
        tgt.type === "ultrasound-test" &&
        typeof tgt.testName === "string" &&
        tgt.testName
      ) {
        ids.add(`test:${tgt.testName}`);
        continue;
      }
      if (tgt.type === "ultrasound-parent") {
        ids.add("ultrasound");
        continue;
      }
    }
    const anc = ancillaryOfUpdateEntry(entry);
    if (anc) ids.add(anc);
  }
  return Array.from(ids);
}

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

// Human label for an assignment target, recorded as `assignedAncillary`
// on auto-recorded evidence. Matches the labels the bubble attach flow
// already writes so the server-side dedupe merges them forward cleanly.
function assignmentTargetLabel(target: AssignmentTarget): string {
  if (target.type === "ancillary") {
    return target.ancillaryId === "brainwave" ? "BrainWave" : "VitalWave";
  }
  if (target.type === "ultrasound-parent") return "Ultrasound (parent)";
  if (target.type === "ultrasound-test") return target.testName;
  return "All ancillaries";
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
  adminAdded: boolean;
  addedReason: string | null;
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
    const adminMeta = reasoningAsObject(reasoning[`adminReview:test:${test}`]);
    const adminAdded = !!adminMeta.adminAdded;
    const addedReason =
      typeof adminMeta.reason === "string" && adminMeta.reason.trim()
        ? adminMeta.reason
        : null;
    const empty: CanonicalReasoningCard = {
      testName: test,
      clinicianReasoning: "",
      patientExplanation: "",
      qualifyingFactors: [],
      icd10Codes: [],
      pearls: [],
      confidence: null,
      approvalRequired: false,
      adminAdded,
      addedReason,
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
        adminAdded,
        addedReason,
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
  // AI Logic knowledge-layer prototype (localStorage-backed; additive —
  // never blocks or alters the existing review/approve flow).
  const [aiLogicOpen, setAiLogicOpen] = useState(false);
  const [aiPromptLabel, setAiPromptLabel] = useState<string | null>(null);
  const [ancillaryNotes, setAncillaryNotes] = useState<Record<string, string>>({});
  // Manual "Add Ancillary" control state.
  const [addOpen, setAddOpen] = useState(false);
  const [addReason, setAddReason] = useState("");
  // Set when an add attempt found no qualifying evidence — surfaces the
  // honest "no qualifying evidence" state plus the required-reason override.
  const [overrideTarget, setOverrideTarget] = useState<{
    ancillaryId: AdminReviewAncillaryId;
    testName: string;
    candidates: string[];
  } | null>(null);
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

  // Source Data popover edit mode — allows inline editing of Hx/Dx/Rx
  // with a Save → Regenerate flow.
  const [sourceEditMode, setSourceEditMode] = useState(false);
  const [sourceEditHx, setSourceEditHx] = useState("");
  const [sourceEditDx, setSourceEditDx] = useState("");
  const [sourceEditRx, setSourceEditRx] = useState("");
  const [sourceDataSaved, setSourceDataSaved] = useState(false);

  // Local mirrors of Hx/Dx/Rx that update immediately when source data
  // is saved, so evidence buttons re-parse without waiting for the parent
  // to propagate the updated patient prop back down.
  const [localHx, setLocalHx] = useState(() => patient.history ?? "");
  const [localDx, setLocalDx] = useState(() => patient.diagnoses ?? "");
  const [localRx, setLocalRx] = useState(() => patient.medications ?? "");

  // Sync local mirrors when the active patient changes (sibling navigation).
  useEffect(() => {
    setLocalHx(patient.history ?? "");
    setLocalDx(patient.diagnoses ?? "");
    setLocalRx(patient.medications ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id]);

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

  // Packet QA Gate — opened on per-scheduler PDF preview when audit
  // finds blockers. proceed() carries the printable subset forward.
  const [packetQa, setPacketQa] = useState<{
    report: PacketQaReport;
    proceed: () => void;
  } | null>(null);

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

  // Clinical Intelligence wiring: attaching evidence to an ancillary is
  // itself an approval, so assignToTarget auto-records the decision in
  // the knowledge layer (server dedupes by patient + label + sourceType).
  const { data: ciCurrentUser } = useCurrentUser();
  const ciActor = ciActorName(ciCurrentUser ?? null);
  const { state: ciState, isLoaded: ciLoaded } = useClinicalIntelligenceLoaded();

  // Record an approved evidence decision for an attached chip. Fire-and-
  // forget: the CI layer is a traceability mirror, never a gate on the
  // attach itself.
  function recordAttachEvidence(btn: SupportingButton, target: AssignmentTarget) {
    void ciRecordEvidence({
      patientId: patient.id ?? null,
      patientName: patient.name || "Unnamed patient",
      facility: patient.facility ?? facility ?? null,
      scheduleDate: scheduleDate ?? null,
      sourceType: normalizeSourceType(btn.source),
      sourceText: btn.sourceText ?? btn.label,
      label: btn.label,
      confidence: btn.confidence ?? "medium",
      assignedAncillary: assignmentTargetLabel(target),
      status: "approved",
      decidedBy: ciActor,
    }).catch(() => {
      // Non-blocking: assignment state is already persisted via
      // patient.reasoning; a failed mirror write is retried on next open
      // by the reconcile effect below.
    });
  }

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
    setSourceEditMode(false);
    setSourceDataSaved(false);
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

  // Reconcile-on-open: assignments made before this feature (or whose
  // mirror write failed) may exist in patient.reasoning without a
  // matching evidence record. Once the CI store has loaded, record an
  // approved evidence entry for each assigned chip that has none — the
  // server dedupes by patient + label + sourceType, and we skip labels
  // that already have a decision so we never overwrite a rejection or
  // bump audit timestamps on every open.
  const evidenceReconciledForPatientRef = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !ciLoaded || !ciCurrentUser) return;
    const pid = patient.id ?? null;
    if (pid == null) return;
    if (evidenceReconciledForPatientRef.current === pid) return;
    evidenceReconciledForPatientRef.current = pid;

    const existing = new Set(
      ciState.evidence
        .filter((e) => e.patientId === pid)
        .map((e) => `${e.sourceType}::${e.label.toLowerCase()}`),
    );
    const queued = new Set<string>();
    const reconcile = (btn: SupportingButton, target: AssignmentTarget) => {
      const key = `${normalizeSourceType(btn.source)}::${btn.label.toLowerCase()}`;
      if (existing.has(key) || queued.has(key)) return;
      queued.add(key);
      recordAttachEvidence(btn, target);
    };
    const a = assignmentsRef.current;
    for (const b of a.brainwave) {
      reconcile(b, { type: "ancillary", ancillaryId: "brainwave" });
    }
    for (const b of a.vitalwave) {
      reconcile(b, { type: "ancillary", ancillaryId: "vitalwave" });
    }
    for (const b of a.ultrasound.parent) {
      reconcile(b, { type: "ultrasound-parent" });
    }
    for (const [testName, list] of Object.entries(a.ultrasound.byTestName)) {
      for (const b of list ?? []) {
        reconcile(b, { type: "ultrasound-test", testName });
      }
    }
    // recordAttachEvidence and ciState are intentionally read at run
    // time only — this effect fires once per patient open, after the
    // CI store has loaded and the user is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ciLoaded, ciCurrentUser, patient.id]);

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
      // Merge into the authoritative local reasoning ref — NOT
      // patient.reasoning from props — so an audit-log write never
      // clobbers freshly-written assignedEvidence / stale flags from a
      // just-prior attach/detach/source-edit on the same tick.
      const base = lastWrittenReasoningRef.current;
      const nextReasoning = { ...base, "adminReview:updates": next };
      lastWrittenReasoningRef.current = nextReasoning;
      onUpdate("reasoning", nextReasoning);
      return next;
    });
  }

  const apiEvidence: AdminEvidenceChip[] = evidenceQuery.data?.evidence ?? [];

  // Build assignable button lists from raw source + rule engine + AI ICD additions.
  // Use localDx/localRx/localHx so saves from the Source Data popover are
  // reflected immediately without waiting for the parent to re-propagate.
  const dxButtons = useMemo(
    () => parseDiagnosisButtonsFromDx(localDx),
    [localDx],
  );
  const rxButtons = useMemo(
    () => parseMedicationButtonsFromRx(localRx),
    [localRx],
  );
  const hxButtons = useMemo(
    () => parseSymptomButtonsFromHx(localHx),
    [localHx],
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

  // Plain-language rationale for each Rule Engine evidence chip, keyed by
  // lowercase label. Targets come from the rule candidates that cite the
  // chip's evidence id; the "why" comes from the chip's own detail text.
  // Surfaced in the AI clue bubble popup so a Rule Engine suggestion is
  // never a black box — the admin can read which rule fired, what it
  // supports, and why it matched this patient.
  const ruleRationaleByLabel = useMemo(() => {
    const map = new Map<string, AiRuleRationale>();
    for (const chip of apiEvidence) {
      const targets = candidates
        .filter((c) => c.evidenceIds.includes(chip.id))
        .map((c) => c.label);
      const kindLabel =
        chip.kind === "diagnosis" || chip.kind === "icd"
          ? "Diagnosis"
          : chip.kind === "medication"
            ? "Medication"
            : chip.kind === "prior_test"
              ? "Prior testing"
              : "Symptom";
      map.set(chip.label.toLowerCase(), {
        name: `${kindLabel} rule: ${chip.label}`,
        targets,
        why:
          chip.detail?.trim() ||
          `The screening rule engine found "${chip.label}" in this patient's ${chip.source} data.`,
      });
    }
    return map;
  }, [apiEvidence, candidates]);

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
  function assignToTarget(
    target: AssignmentTarget,
    btn: SupportingButton,
    opts?: { skipEvidenceRecord?: boolean },
  ) {
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
    // Attaching IS the approval — auto-record the evidence decision with
    // its assigned ancillary so no separate "Approve evidence" click is
    // needed. The bubble attach flow records its own (possibly edited)
    // label, so it opts out to avoid a duplicate write.
    if (!opts?.skipEvidenceRecord) {
      recordAttachEvidence(btn, target);
    }
    // Subtle optional "save as future AI logic?" prompt (prototype).
    setAiPromptLabel(btn.label);
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

  // Backend: add a manually-selected ancillary to this patient. The added
  // test name lands in qualifyingTests so the whole downstream spine
  // (execution case → call reason → PDFs) flows for free; admin-added
  // provenance is stamped in adminReview:* metadata.
  const addAncillaryMutation = useMutation<
    {
      ok: boolean;
      qualified?: boolean;
      patient?: PatientScreening;
      ancillaryId: AdminReviewAncillaryId;
      testName?: string;
      addedTests?: string[];
      alreadyPresent?: boolean;
      narrativeGenerated?: boolean;
      // qualified: false branch
      requestedTestName?: string;
      state?: "no_evidence" | "needs_reason" | "already_present" | "in_cooldown";
      candidates?: string[];
      cooldown?: {
        previousDate: string | null;
        intervalDays: number | null;
        message: string;
      };
    },
    Error,
    {
      ancillaryId: AdminReviewAncillaryId;
      testName: string;
      reason?: string;
      override?: boolean;
    }
  >({
    mutationFn: async (vars) => {
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-review/add-ancillary`,
        vars,
      );
      return res.json();
    },
    onSuccess: (data, vars) => {
      // Honest empty-qualification state — nothing qualified. Surface the
      // override affordance (required reason) rather than adding a bare service.
      if (data.qualified === false) {
        if (data.state === "needs_reason") {
          toast({
            title: "Reason required",
            description: "Enter a qualification reason to override and add anyway.",
            variant: "destructive",
          });
          return;
        }
        if (data.state === "already_present") {
          // Every ultrasound sub-test is already on this patient — there is
          // nothing for the generic option to add. No override affordance.
          setOverrideTarget(null);
          setAddReason("");
          setAddOpen(false);
          toast({
            title: "All ultrasound tests already added",
            description: "Every ultrasound study is already on this patient.",
          });
          return;
        }
        if (data.state === "in_cooldown") {
          // Blocked by a within-window prior in the patient's history. No
          // override affordance — surface an honest cooldown message.
          setOverrideTarget(null);
          setAddReason("");
          setAddOpen(false);
          const testLabel = data.requestedTestName ?? vars.testName;
          const last = data.cooldown?.previousDate;
          toast({
            title: `${testLabel} is in cooldown`,
            description: last
              ? `Last performed ${last} — within the cooldown window.`
              : data.cooldown?.message ??
                "A recent prior test is on file within the cooldown window.",
            variant: "destructive",
          });
          return;
        }
        setOverrideTarget({
          ancillaryId: vars.ancillaryId,
          testName: data.requestedTestName ?? vars.testName,
          candidates: data.candidates ?? [],
        });
        setAddOpen(true);
        return;
      }

      if (data.patient) {
        onUpdate("reasoning", (data.patient.reasoning ?? {}) as Record<string, unknown>);
        if (Array.isArray(data.patient.qualifyingTests)) {
          onUpdate("qualifyingTests", data.patient.qualifyingTests as string[]);
        }
      }
      // Surface the affected bar so the operator sees the result of the add.
      setExpanded((prev) => ({ ...prev, [vars.ancillaryId]: true }));
      setOverrideTarget(null);
      setAddReason("");
      setAddOpen(false);

      const addedTests = Array.isArray(data.addedTests) ? data.addedTests : [];
      if (data.alreadyPresent && addedTests.length === 0) {
        toast({
          title: `${data.testName ?? vars.testName} already added`,
          description: "Focused the existing entry — no duplicate created.",
        });
        return;
      }
      const addedLabel =
        addedTests.length > 1
          ? `${addedTests.length} ultrasound tests`
          : addedTests[0] ?? data.testName ?? vars.testName;
      toast({
        title: `Added ${addedLabel}`,
        description: data.narrativeGenerated
          ? "Qualified against clinical data — reasoning generated."
          : "Qualified — regenerate to populate clinical reasoning.",
      });
      for (const added of addedTests) {
        const isChild =
          vars.ancillaryId === "ultrasound" && added !== "Ultrasound Studies";
        recordAdminReviewUpdate(
          isChild ? "ultrasound_child_added" : "ancillary_added",
          isChild ? `Added ultrasound test: ${added}` : `Added ${added}`,
          { ancillary: vars.ancillaryId, testName: added, reason: vars.reason ?? null },
        );
      }
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
    },
    onError: (err) => {
      toast({
        title: "Could not add ancillary",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  function handleAddAncillary(
    ancillaryId: AdminReviewAncillaryId,
    testName: string,
    override = false,
  ) {
    addAncillaryMutation.mutate({
      ancillaryId,
      testName,
      reason: addReason.trim() || undefined,
      override,
    });
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
        { removed: data.removedTests ?? [], ancillary: vars.ancillary },
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
          // Use the local mirrors (updated synchronously on source save) so a
          // Regenerate fired right after editing never sends stale Hx/Dx/Rx,
          // even before the parent re-propagates the patient prop.
          diagnoses: localDx,
          medications: localRx,
          history: localHx,
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
          // Use the local mirrors (updated synchronously on source save) so a
          // Regenerate fired right after editing never sends stale Hx/Dx/Rx,
          // even before the parent re-propagates the patient prop.
          diagnoses: localDx,
          medications: localRx,
          history: localHx,
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
    // Regenerate both the stale targets (evidence attach/detach) and the
    // targets of any pending change surfaced in the Updates panel (added/
    // removed diagnosis, medication, symptom, qualifying factor, ancillary,
    // or ultrasound child) — deduped so a change and a stale flag on the
    // same test only regenerate once.
    const staleIds = readStaleTargetIds(lastWrittenReasoningRef.current);
    const changeIds = regenTargetIdsFromUpdates(updatesLog);
    const targetIds = Array.from(new Set([...staleIds, ...changeIds]));
    if (targetIds.length === 0) return;
    setRegenChangedInFlight(true);
    try {
      for (const targetId of targetIds) {
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
  }, [regenerateAncillaryMutation, regenerateTestMutation, updatesLog]);

  // The single Regenerate action surfaced in the Updates panel. Source-data
  // edits invalidate every ancillary (we don't track which Hx/Dx/Rx line maps
  // to which test), so they trigger a full re-analysis; evidence attach/detach
  // changes regenerate only their stale targets. Both clear their own "needs
  // regeneration" state on success so Approve/PDF unblock.
  const regeneratePending = useCallback(async (): Promise<void> => {
    if (sourceDataSaved) {
      setRegenChangedInFlight(true);
      const failures: string[] = [];
      for (const ancillary of ANCILLARIES) {
        try {
          await regenerateAncillaryMutation.mutateAsync({ ancillary });
        } catch {
          failures.push(ancillary);
        }
      }
      setRegenChangedInFlight(false);
      if (failures.length === 0) {
        setSourceDataSaved(false);
        toast({ title: "Re-analysis complete", description: "All ancillaries regenerated with updated source data." });
      } else {
        // Spec: a failed regeneration must keep blocking. Leave
        // sourceDataSaved=true so Approve + PDF stay locked until every
        // ancillary regenerates cleanly.
        toast({
          title: failures.length < ANCILLARIES.length ? "Re-analysis incomplete" : "Re-analysis failed",
          description: `${failures.join(", ")} could not be regenerated. Approval stays blocked until all ancillaries regenerate — try again.`,
          variant: "destructive",
        });
        return;
      }
    }
    await regenerateChangedTargets();
  }, [sourceDataSaved, regenerateAncillaryMutation, regenerateChangedTargets, toast]);

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
            : "Sent to Engagement Queue"
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

  // Ancillaries whose assigned evidence changed since the last
  // regenerate. Computed once per render so the Updates Regenerate
  // button, the Approve gate, the Blocking Rules message, and the
  // Documents gate all read the same synchronous truth.
  const staleTargetIds = readStaleTargetIds(lastWrittenReasoningRef.current);
  // Source-data edits invalidate every ancillary; evidence attach/detach
  // marks specific stale targets. Either blocks Approve + PDF until the
  // single Updates-panel Regenerate clears it.
  const needsRegeneration = staleTargetIds.length > 0 || sourceDataSaved;

  // Targets of the pending changes currently listed in the Updates panel.
  // The Regenerate button is enabled whenever there is any such change (not
  // just when the system flagged a target "stale"), and clicking it
  // regenerates only these changed test(s) plus any stale targets.
  const pendingRegenTargetIds = regenTargetIdsFromUpdates(updatesLog);
  const canRegenerate =
    needsRegeneration || pendingRegenTargetIds.length > 0;
  // Union of stale + change-derived targets, used for the tooltip so it
  // names exactly what the button will regenerate.
  const regenTargetLabels = Array.from(
    new Set([...staleTargetIds, ...pendingRegenTargetIds]),
  ).map(ancillaryLabelForTargetId);

  // Presence of ancillaries already on the patient — drives the manual
  // Add Ancillary menu so it never re-offers something already added.
  const presentTestSet = new Set(
    (patient.qualifyingTests ?? []).map((t) => String(t)),
  );
  const presentTestList = Array.from(presentTestSet);

  // Prior-history cooldown gate. Tests that already appear in the
  // patient's free-text previousTests within the cooldown window
  // (6mo PPO / 12mo Medicare, falling back to per-test defaults) are
  // blocked from being offered as something to add. Tests in history
  // but outside the window remain addable.
  const blockedByHistory: Map<string, AncillaryWarning> =
    blockedAncillariesFromHistory(
      ["BrainWave", "VitalWave", ...ADD_ULTRASOUND_SUBTYPES],
      (patient as { previousTests?: string }).previousTests ?? "",
      (patient as { previousTestsDate?: string }).previousTestsDate ?? "",
      (patient as { insurance?: string }).insurance ?? "",
    );
  const cooldownTooltip = (testName: string): string => {
    const w = blockedByHistory.get(testName);
    if (!w) return "";
    return w.previousDate
      ? `In cooldown — last done ${w.previousDate}`
      : "In cooldown — recent prior on file";
  };

  const canAddBrainwave =
    !presentTestList.some((t) => getAncillaryCategory(t) === "brainwave") &&
    !blockedByHistory.has("BrainWave");
  const canAddVitalwave =
    !presentTestList.some((t) => getAncillaryCategory(t) === "vitalwave") &&
    !blockedByHistory.has("VitalWave");
  const brainwaveBlockedByCooldown =
    !presentTestList.some((t) => getAncillaryCategory(t) === "brainwave") &&
    blockedByHistory.has("BrainWave");
  const vitalwaveBlockedByCooldown =
    !presentTestList.some((t) => getAncillaryCategory(t) === "vitalwave") &&
    blockedByHistory.has("VitalWave");
  const availableUltrasoundSubtypes = ADD_ULTRASOUND_SUBTYPES.filter(
    (t) => !presentTestSet.has(t) && !blockedByHistory.has(t),
  );
  // Ultrasound subtypes that are absent from the patient but blocked by a
  // within-window prior — rendered disabled with a cooldown tooltip so the
  // operator can see why they can't be added.
  const cooldownBlockedUltrasoundSubtypes = ADD_ULTRASOUND_SUBTYPES.filter(
    (t) => !presentTestSet.has(t) && blockedByHistory.has(t),
  );
  // Generic ultrasound is only addable when there is at least one sub-test
  // still missing. If every sub-test (or the generic sentinel) is already on
  // the patient, there is nothing for "Add Ultrasound (generic)" to add.
  const allUltrasoundSubtypesPresent = availableUltrasoundSubtypes.length === 0;
  const canAddGenericUltrasound =
    !presentTestSet.has("Ultrasound Studies") && !allUltrasoundSubtypesPresent;
  const hasAnyAddableAncillary =
    canAddBrainwave ||
    canAddVitalwave ||
    canAddGenericUltrasound ||
    availableUltrasoundSubtypes.length > 0;
  // Items that aren't addable purely because of a cooldown — surfaced as
  // disabled rows so the operator can still open the menu to see why.
  const hasAnyCooldownBlocked =
    brainwaveBlockedByCooldown ||
    vitalwaveBlockedByCooldown ||
    cooldownBlockedUltrasoundSubtypes.length > 0;
  const canOpenAddMenu = hasAnyAddableAncillary || hasAnyCooldownBlocked;

  // ─── AI Logic knowledge-layer context (prototype) ───
  // Snapshot of the live review used to prefill the AI Logic drawer and
  // stamp learning items / evidence records with full traceability.
  const aiLogicContext: AiLogicPatientContext = useMemo(() => {
    const summary: string[] = [];
    if (assignments.brainwave.length > 0) {
      summary.push(`BrainWave: ${assignments.brainwave.map((b) => b.label).join(", ")}`);
    }
    if (assignments.vitalwave.length > 0) {
      summary.push(`VitalWave: ${assignments.vitalwave.map((b) => b.label).join(", ")}`);
    }
    if (assignments.ultrasound.parent.length > 0) {
      summary.push(`Ultrasound: ${assignments.ultrasound.parent.map((b) => b.label).join(", ")}`);
    }
    for (const [testName, chips] of Object.entries(assignments.ultrasound.byTestName)) {
      if (chips.length > 0) summary.push(`${testName}: ${chips.map((b) => b.label).join(", ")}`);
    }
    const evidenceLabels = Array.from(
      new Set([
        ...assignments.brainwave.map((b) => b.label),
        ...assignments.vitalwave.map((b) => b.label),
        ...assignments.ultrasound.parent.map((b) => b.label),
        ...Object.values(assignments.ultrasound.byTestName).flat().map((b) => b.label),
      ]),
    );
    return {
      patientId: patient.id ?? null,
      patientName: patient.name || "Unnamed patient",
      facility: patient.facility ?? facility ?? null,
      scheduleDate: scheduleDate ?? null,
      hx: localHx || null,
      dx: localDx || null,
      rx: localRx || null,
      qualifyingTests: (patient.qualifyingTests ?? []).map((t) => String(t)),
      assignmentsSummary: summary,
      evidenceLabels,
      adminNotes: adminNote || null,
      approvalState:
        (patient as { adminApprovalStatus?: string | null }).adminApprovalStatus ?? null,
      updatesCount: updatesLog.length,
    };
  }, [
    assignments,
    patient,
    facility,
    scheduleDate,
    localHx,
    localDx,
    localRx,
    adminNote,
    updatesLog.length,
  ]);

  // AI-identified clinical clue bubbles: symptoms/history + medication
  // clues + diagnoses, straight from the same parsed SupportingButtons
  // the popover rows use (no duplicate parsing logic).
  const aiBubbleItems: AiEvidenceItem[] = useMemo(
    () =>
      availableButtons
        .filter(
          (b) =>
            b.kind === "symptom" ||
            b.kind === "history" ||
            b.kind === "medication" ||
            b.kind === "icd_disease",
        )
        .slice(0, 24)
        .map((b) => ({
          id: b.id,
          label: b.label,
          source: b.source,
          kind: b.kind,
          sourceText: b.sourceText ?? null,
          icdCode: b.icdCode ?? null,
          requiresIcd: b.requiresIcd,
          confidence: b.confidence,
          rule:
            b.source === "Rule Engine"
              ? ruleRationaleByLabel.get(b.label.toLowerCase()) ?? null
              : null,
        })),
    [availableButtons, ruleRationaleByLabel],
  );

  // Bridge bubble attach actions onto the existing assignment engine.
  const findButtonForBubble = (item: AiEvidenceItem): SupportingButton | null =>
    availableButtons.find((b) => b.id === item.id) ?? null;

  const shellChildren = (
    <>
        {/* Smoke header — black at ~70% opacity per Team Portal spec. */}
        <DialogHeader
          className="px-5 py-2.5 border-b border-white/10 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white"
          data-testid="admin-review-smoke-header"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold tracking-tight text-white">
                {patient.name || "Unnamed patient"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Admin review for {patient.name || "patient"}
              </DialogDescription>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
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
              {/* Sibling navigation moved to the bottom-center footer of
                  the right panel per the Admin Review layout update. */}
              <button
                type="button"
                onClick={() => setAiLogicOpen(true)}
                aria-label="AI Logic for This Patient"
                title="AI Logic for This Patient"
                data-testid="admin-review-ai-logic-button"
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-violet-200/80 hover:text-violet-100 hover:bg-white/15 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
              </button>
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
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 md:flex-row md:gap-4 md:p-4"
          style={{
            background:
              "radial-gradient(1200px 600px at 0% 0%, #e7eefb 0%, transparent 55%), radial-gradient(1000px 700px at 100% 100%, #eaf2fb 0%, transparent 50%), linear-gradient(135deg, #eef3fb 0%, #f6f9fd 100%)",
          }}
          data-testid="admin-review-two-panel-body"
        >
          {/* ─── LEFT panel — Ancillaries playground ─── */}
          <main
            className="flex min-h-0 flex-[1.35] flex-col overflow-hidden rounded-lg border border-white/60 bg-white/75 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl"
            data-testid="admin-review-ancillary-panel"
          >
              <ScrollArea className="flex-1 min-h-0 px-5 py-4">
                <div
                  className="space-y-4"
                  data-testid="admin-review-ancillary-playground"
                >
              {/* Manual add-ancillary control. Hand-adds a service to
                  qualifyingTests + stamps admin-added provenance. */}
              <div
                className="flex items-center justify-between gap-2"
                data-testid="admin-review-add-ancillary-row"
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Ancillaries
                </div>
                <Popover
                  open={addOpen}
                  onOpenChange={(o) => {
                    setAddOpen(o);
                    if (!o) {
                      setOverrideTarget(null);
                      setAddReason("");
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="admin-review-add-ancillary-trigger"
                      disabled={addAncillaryMutation.isPending || !canOpenAddMenu}
                      title={
                        hasAnyAddableAncillary
                          ? "Add an ancillary"
                          : hasAnyCooldownBlocked
                            ? "Remaining ancillaries are in cooldown"
                            : "All ancillaries already added"
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-sky-300/60 bg-gradient-to-b from-sky-50 to-sky-100/60 text-sky-800 hover:from-sky-100 hover:to-sky-100 shadow-sm px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {addAncillaryMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      Add Ancillary
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-72 p-2"
                    align="end"
                    data-testid="admin-review-add-ancillary-menu"
                  >
                    {overrideTarget ? (
                      <div
                        className="space-y-2"
                        data-testid="admin-review-add-override"
                      >
                        <div
                          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
                          data-testid="admin-review-add-no-evidence"
                        >
                          <div className="font-semibold">No qualifying evidence found</div>
                          <div className="mt-0.5">
                            Nothing in this patient's Dx/Hx/Rx qualifies{" "}
                            <span className="font-medium">{overrideTarget.testName}</span>.
                            To add it anyway, enter a reason for the manual override.
                          </div>
                        </div>
                        <Textarea
                          value={addReason}
                          onChange={(e) => setAddReason(e.target.value)}
                          placeholder="Required: reason for manual override"
                          rows={2}
                          className="text-xs resize-none"
                          data-testid="admin-review-add-override-reason"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!addReason.trim() || addAncillaryMutation.isPending}
                            onClick={() =>
                              handleAddAncillary(
                                overrideTarget.ancillaryId,
                                overrideTarget.testName,
                                true,
                              )
                            }
                            data-testid="admin-review-add-override-confirm"
                            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Add anyway
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOverrideTarget(null);
                              setAddReason("");
                            }}
                            data-testid="admin-review-add-override-cancel"
                            className="inline-flex items-center rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        {canAddBrainwave && (
                          <button
                            type="button"
                            onClick={() => handleAddAncillary("brainwave", "BrainWave")}
                            data-testid="admin-review-add-brainwave"
                            className="w-full text-left rounded-md px-2 py-1.5 text-xs font-medium hover:bg-violet-50 text-violet-800 transition-colors"
                          >
                            Add BrainWave
                          </button>
                        )}
                        {brainwaveBlockedByCooldown && (
                          <button
                            type="button"
                            disabled
                            title={cooldownTooltip("BrainWave")}
                            data-testid="admin-review-add-brainwave-cooldown"
                            className="w-full text-left rounded-md px-2 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed flex items-center justify-between gap-2"
                          >
                            <span>Add BrainWave</span>
                            <span className="text-[10px] uppercase tracking-wider text-amber-600">
                              Cooldown
                            </span>
                          </button>
                        )}
                        {canAddVitalwave && (
                          <button
                            type="button"
                            onClick={() => handleAddAncillary("vitalwave", "VitalWave")}
                            data-testid="admin-review-add-vitalwave"
                            className="w-full text-left rounded-md px-2 py-1.5 text-xs font-medium hover:bg-rose-50 text-rose-800 transition-colors"
                          >
                            Add VitalWave
                          </button>
                        )}
                        {vitalwaveBlockedByCooldown && (
                          <button
                            type="button"
                            disabled
                            title={cooldownTooltip("VitalWave")}
                            data-testid="admin-review-add-vitalwave-cooldown"
                            className="w-full text-left rounded-md px-2 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed flex items-center justify-between gap-2"
                          >
                            <span>Add VitalWave</span>
                            <span className="text-[10px] uppercase tracking-wider text-amber-600">
                              Cooldown
                            </span>
                          </button>
                        )}
                        {canAddGenericUltrasound && (
                          <button
                            type="button"
                            onClick={() => handleAddAncillary("ultrasound", "Ultrasound Studies")}
                            data-testid="admin-review-add-ultrasound-generic"
                            className="w-full text-left rounded-md px-2 py-1.5 text-xs font-medium hover:bg-emerald-50 text-emerald-800 transition-colors"
                          >
                            Add Ultrasound (generic)
                          </button>
                        )}
                      </div>
                      {(availableUltrasoundSubtypes.length > 0 ||
                        cooldownBlockedUltrasoundSubtypes.length > 0) && (
                        <>
                          <Separator className="my-1" />
                          <div className="px-1 text-[10px] uppercase tracking-wider text-slate-500">
                            Ultrasound subtype
                          </div>
                          <ScrollArea className="max-h-44">
                            <div className="space-y-0.5 pr-1">
                              {availableUltrasoundSubtypes.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => handleAddAncillary("ultrasound", t)}
                                  data-testid="admin-review-add-ultrasound-subtype"
                                  data-test-name={t}
                                  className="w-full text-left rounded-md px-2 py-1.5 text-[11px] hover:bg-emerald-50 text-emerald-900 transition-colors"
                                >
                                  {t}
                                </button>
                              ))}
                              {cooldownBlockedUltrasoundSubtypes.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  disabled
                                  title={cooldownTooltip(t)}
                                  data-testid="admin-review-add-ultrasound-subtype-cooldown"
                                  data-test-name={t}
                                  className="w-full text-left rounded-md px-2 py-1.5 text-[11px] text-slate-400 cursor-not-allowed flex items-center justify-between gap-2"
                                >
                                  <span>{t}</span>
                                  <span className="text-[9px] uppercase tracking-wider text-amber-600 shrink-0">
                                    Cooldown
                                  </span>
                                </button>
                              ))}
                            </div>
                          </ScrollArea>
                        </>
                      )}
                      {!hasAnyAddableAncillary && !hasAnyCooldownBlocked && (
                        <div
                          className="px-2 py-3 text-center text-[11px] text-slate-400 italic"
                          data-testid="admin-review-add-ancillary-empty"
                        >
                          All ancillaries are already on this patient.
                        </div>
                      )}
                      {!hasAnyAddableAncillary && hasAnyCooldownBlocked && (
                        <div
                          className="px-2 py-3 text-center text-[11px] text-amber-600 italic"
                          data-testid="admin-review-add-ancillary-all-cooldown"
                        >
                          Remaining ancillaries are within their cooldown window.
                        </div>
                      )}
                    </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
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
                    className={`rounded-lg border overflow-hidden shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md ${style.bg} ${style.border}`}
                    data-testid="admin-review-ancillary-colored-panel"
                    data-ancillary={id}
                  >
                    <div className="px-4 py-3 border-b border-white/50 bg-gradient-to-b from-white/55 to-white/20 backdrop-blur-md">
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
                          <div className={`shrink-0 w-7 h-7 rounded-md bg-white/80 border border-black/5 inline-flex items-center justify-center ${style.icon}`}>
                            <Icon className="w-4 h-4" strokeWidth={1.8} fill="none" />
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
                className={`rounded-lg border overflow-hidden ${categoryStyles.ultrasound.bg} ${categoryStyles.ultrasound.border}`}
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
                      <div className={`shrink-0 w-7 h-7 rounded-md bg-white/80 border border-black/5 inline-flex items-center justify-center ${categoryStyles.ultrasound.icon}`}>
                        {(() => {
                          const Icon = categoryIcons.ultrasound;
                          return <Icon className="w-5 h-5" strokeWidth={2} fill="none" />;
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

          {/* ─── RIGHT panel — slim action rail. Reference + Actions sit in
              the top scroll, the Updates premium glass panel takes the bottom
              half, and a floating glass decision bar sits beneath it. Heavier
              surfaces (documents, note, scheduler) collapse into popovers so
              the column stays narrow. ─── */}
          <aside
            className="flex min-h-0 w-full flex-[2] md:w-[320px] md:flex-none flex-col overflow-hidden rounded-lg border border-white/60 bg-white/45 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl"
            data-testid="admin-review-action-panel"
          >
            {/* Scrollable middle zone — Reference + AI clues + Changes. Keeping
                this in one min-h-0 scroll region (instead of shrink-0 blocks)
                guarantees the decision footer below stays visible on short
                viewports instead of being pushed past the overflow clip. */}
            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              data-testid="admin-review-rail-scroll-zone"
            >
            <div className="shrink-0 space-y-3 p-3" data-testid="admin-review-reference-scroll">
              <div className="mb-1 flex items-center gap-2" data-testid="admin-review-workbench-header">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Review Workbench</span>
                <span className="h-px flex-1 bg-slate-200/70" />
              </div>
                    {/* Reference surfaces — split into top-of-rail buttons */}
                    <div data-testid="admin-review-reference-buttons-group">
                      <div className="grid grid-cols-2 gap-2">
                        {/* Source data */}
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              data-testid="admin-review-reference-source-trigger"
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 px-3 py-2 text-xs font-semibold shadow-sm transition-colors"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              Source data
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="w-[520px] max-w-[92vw] max-h-[72vh] overflow-auto p-3"
                            data-testid="admin-review-source-popover"
                          >
                <div className="px-0 py-0" data-testid="admin-review-source-tab-content">
                        <section className="space-y-2" data-testid="admin-review-clinical-source">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                              Clinical Source
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (!sourceEditMode) {
                                  // Seed from the freshest local mirrors (latest
                                  // saved values), and DO NOT clear sourceDataSaved
                                  // here — re-entering edit must not bypass the
                                  // regeneration gate. It clears only on a fully
                                  // successful regenerate.
                                  setSourceEditHx(localHx);
                                  setSourceEditDx(localDx);
                                  setSourceEditRx(localRx);
                                }
                                setSourceEditMode((m) => !m);
                              }}
                              data-testid="admin-review-source-edit-toggle"
                              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                                sourceEditMode
                                  ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
                                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <Pencil className="w-3 h-3" />
                              {sourceEditMode ? "Cancel" : "Edit"}
                            </button>
                          </div>

                          {sourceEditMode ? (
                            <div className="space-y-2" data-testid="admin-review-source-edit-form">
                              <div>
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">Hx</label>
                                <Textarea
                                  value={sourceEditHx}
                                  onChange={(e) => setSourceEditHx(e.target.value)}
                                  rows={3}
                                  className="text-xs"
                                  data-testid="admin-review-source-edit-hx"
                                  placeholder="Patient history..."
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">Dx</label>
                                <Textarea
                                  value={sourceEditDx}
                                  onChange={(e) => setSourceEditDx(e.target.value)}
                                  rows={3}
                                  className="text-xs"
                                  data-testid="admin-review-source-edit-dx"
                                  placeholder="Diagnoses..."
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">Rx</label>
                                <Textarea
                                  value={sourceEditRx}
                                  onChange={(e) => setSourceEditRx(e.target.value)}
                                  rows={3}
                                  className="text-xs"
                                  data-testid="admin-review-source-edit-rx"
                                  placeholder="Medications..."
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  onUpdate("history", sourceEditHx);
                                  onUpdate("diagnoses", sourceEditDx);
                                  onUpdate("medications", sourceEditRx);
                                  // Update local mirrors immediately so evidence buttons
                                  // re-parse without waiting for the parent re-render.
                                  setLocalHx(sourceEditHx);
                                  setLocalDx(sourceEditDx);
                                  setLocalRx(sourceEditRx);
                                  setSourceEditMode(false);
                                  setSourceDataSaved(true);
                                  recordAdminReviewUpdate(
                                    "admin_note_updated",
                                    "Source clinical data (Hx/Dx/Rx) updated",
                                  );
                                  toast({ title: "Source data saved", description: "Hx, Dx, and Rx have been updated." });
                                }}
                                data-testid="admin-review-source-save-button"
                                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 px-3 py-2 text-xs font-semibold transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Save Changes
                              </button>
                            </div>
                          ) : (
                            <>
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
                              {(() => {
                                const prevTests = typeof (patient as { previousTests?: unknown }).previousTests === "string"
                                  ? ((patient as { previousTests?: string }).previousTests ?? "")
                                  : "";
                                return (
                                  <RawSourceCard
                                    label="Previous Tests"
                                    value={prevTests}
                                    emptyText="No prior testing on file"
                                    testId="admin-review-source-prior"
                                  />
                                );
                              })()}
                            </>
                          )}

                          {sourceDataSaved && !sourceEditMode && (
                            <div
                              className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                              data-testid="admin-review-source-regenerate-section"
                            >
                              <div className="text-[11px] text-slate-600 font-medium inline-flex items-start gap-1.5">
                                <RefreshCw className="w-3 h-3 mt-px shrink-0 text-slate-500" />
                                Source data updated — press Regenerate in the Updates panel to re-analyze all ancillaries.
                              </div>
                            </div>
                          )}
                        </section>
                </div>
                          </PopoverContent>
                        </Popover>
                        {/* ICD search */}
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              data-testid="admin-review-reference-icd-trigger"
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 px-3 py-2 text-xs font-semibold shadow-sm transition-colors"
                            >
                              <Search className="w-3.5 h-3.5" />
                              ICD search
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="w-[420px] max-w-[92vw] max-h-[72vh] overflow-auto p-3"
                            data-testid="admin-review-icd-popover"
                          >
                <div className="px-0 py-0" data-testid="admin-review-icd-tab-content">
                        <section
                          className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3"
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
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                {/* Reference content continues — Diagnosis / Medications / Symptoms / Prior Testing
                    (single "Reference" header is provided by admin-review-reference-buttons-group above). */}
                <div data-testid="admin-review-evidence-group">
                  <section
                    className="space-y-2"
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
                        className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-colors"
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
                            evidenceContext={aiLogicContext}
                          />
                        )}
                      />
                      {/* Hx (symptoms / history) shown alongside Dx so the
                          reviewer has both in one popover. */}
                      <AvailableButtonsRow
                        title="Hx (Symptoms / History)"
                        testId="admin-review-available-buttons-dx-hx"
                        emptyText="No symptoms recorded"
                        items={availableButtons.filter(
                          (b) => b.kind === "symptom" || b.kind === "history",
                        )}
                        renderItem={(b) => (
                          <SupportingChipButton
                            key={buttonKey(b)}
                            btn={b}
                            testId="admin-review-hx-button"
                            tone="amber"
                            prefix="Hx"
                            ultrasoundTests={ultrasoundTests}
                            isAlreadyAssigned={(target) => isAssignedToTarget(b, target, assignments)}
                            onAssign={(target) => assignToTarget(target, b)}
                            evidenceContext={aiLogicContext}
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
                        className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-colors"
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
                            evidenceContext={aiLogicContext}
                          />
                        )}
                      />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-colors"
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
                        title="Symptoms"
                        testId="admin-review-available-buttons-hx"
                        emptyText="No symptoms recorded"
                        items={availableButtons.filter(
                          (b) => b.kind === "symptom" || b.kind === "history",
                        )}
                        renderItem={(b) => (
                          <SupportingChipButton
                            key={buttonKey(b)}
                            btn={b}
                            testId="admin-review-hx-button"
                            tone="amber"
                            prefix="Hx"
                            ultrasoundTests={ultrasoundTests}
                            isAlreadyAssigned={(target) => isAssignedToTarget(b, target, assignments)}
                            onAssign={(target) => assignToTarget(target, b)}
                            evidenceContext={aiLogicContext}
                          />
                        )}
                      />
                    </PopoverContent>
                  </Popover>
                  {/* Prior Testing — actual completed prior tests ONLY.
                      Never patient history (Dx/Hx). Sourced from
                      prior_test evidence chips + the patient's own
                      previousTests free text. */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-colors"
                        data-testid="admin-review-right-button-prior-testing"
                      >
                        Prior Testing
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-[340px] p-3 space-y-3 max-h-[60vh] overflow-y-auto"
                      data-testid="admin-review-right-popover-prior-testing"
                    >
                      {(() => {
                        const priorButtons = availableButtons.filter(
                          (b) => b.kind === "prior_test",
                        );
                        const priorText =
                          typeof (patient as { previousTests?: unknown }).previousTests === "string"
                            ? ((patient as { previousTests?: string }).previousTests ?? "").trim()
                            : "";
                        const noPrior = Boolean(
                          (patient as { noPreviousTests?: unknown }).noPreviousTests,
                        );
                        if (noPrior || (priorButtons.length === 0 && !priorText)) {
                          return (
                            <div
                              className="text-[11px] text-slate-400 italic"
                              data-testid="admin-review-prior-testing-empty"
                            >
                              No prior testing found.
                            </div>
                          );
                        }
                        return (
                          <div className="space-y-3">
                            {priorText && (
                              <div data-testid="admin-review-prior-testing-source">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  Recorded prior tests
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700 whitespace-pre-wrap leading-snug">
                                  {priorText}
                                </div>
                              </div>
                            )}
                            {priorButtons.length > 0 && (
                              <AvailableButtonsRow
                                title="Attach prior testing"
                                testId="admin-review-available-buttons-prior"
                                emptyText="No prior testing found."
                                items={priorButtons}
                                renderItem={(b) => (
                                  <SupportingChipButton
                                    key={buttonKey(b)}
                                    btn={b}
                                    testId="admin-review-prior-button"
                                    tone="teal"
                                    prefix="Prior"
                                    ultrasoundTests={ultrasoundTests}
                                    isAlreadyAssigned={(target) => isAssignedToTarget(b, target, assignments)}
                                    onAssign={(target) => assignToTarget(target, b)}
                                    evidenceContext={aiLogicContext}
                                  />
                                )}
                              />
                            )}
                          </div>
                        );
                      })()}
                    </PopoverContent>
                  </Popover>
                    </div>
                  </section>
                </div>

            </div>

            {/* AI-identified clinical clue bubbles (knowledge-layer prototype).
                Attach actions delegate to assignToTarget so the assignment
                state stays the single source of truth. */}
            <AiEvidenceBubblesRow
              items={aiBubbleItems}
              context={aiLogicContext}
              ultrasoundTests={ultrasoundTests}
              onAttach={(item, target) => {
                const btn = findButtonForBubble(item);
                // skipEvidenceRecord: the bubble attach flow records its
                // own evidence decision (with any label edits) inside
                // AiEvidenceBubblesRow — avoid a duplicate write here.
                if (btn) assignToTarget(target, btn, { skipEvidenceRecord: true });
              }}
              isAttached={(item, target) => {
                const btn = findButtonForBubble(item);
                return btn ? isAssignedToTarget(btn, target, assignments) : false;
              }}
              onEvidenceDecision={(item, decision) => {
                if (decision === "approved") setAiPromptLabel(item.label);
              }}
            />

            {/* Changes — flex-1 tinted workbench card; fills remaining height */}
            <div
              className="mx-3 mb-2 flex min-h-[140px] flex-1 basis-0 flex-col overflow-hidden rounded-lg border border-slate-200/70 bg-slate-50/70"
              data-testid="admin-review-updates-group"
            >
              <div
                className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200/60"
                data-record-helper="admin-review-record-update"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                    Changes
                  </span>
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {updatesLog.length} {updatesLog.length === 1 ? "change" : "changes"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void regeneratePending()}
                  disabled={regenChangedInFlight || !canRegenerate}
                  aria-label="Regenerate"
                  title={canRegenerate
                    ? (sourceDataSaved
                      ? "Regenerate all ancillaries with updated source data"
                      : `Regenerate the changed test(s): ${regenTargetLabels.join(", ")}`)
                    : "No changes pending — regeneration not needed"}
                  data-testid="admin-review-regenerate-changed"
                  data-stale-count={staleTargetIds.length}
                  data-pending-change-count={pendingRegenTargetIds.length}
                  data-needs-regeneration={needsRegeneration ? "true" : "false"}
                  data-can-regenerate={canRegenerate ? "true" : "false"}
                  className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[10px] font-semibold shadow-sm disabled:cursor-not-allowed transition-colors ${
                    canRegenerate
                      ? "bg-gradient-to-b from-emerald-400 to-emerald-500 hover:from-emerald-400 hover:to-emerald-600 text-white disabled:opacity-50"
                      : "border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 disabled:opacity-100"
                  }`}
                >
                  {regenChangedInFlight ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Regenerate
                </button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="px-4 py-3" data-testid="admin-review-updates-made-box">
                  {(() => {
                    const groups = groupUpdatesByAncillary(updatesLog);
                    if (groups.length === 0) {
                      return (
                        <div
                          className="flex flex-col items-center justify-center gap-1 py-4 text-center"
                          data-testid="admin-review-updates-empty"
                        >
                          <RefreshCw className="h-4 w-4 text-slate-300" />
                          <div className="max-w-[220px] text-[11px] italic text-slate-400">
                            {sourceDataSaved
                              ? "Source data edited — regenerate to apply across all ancillaries."
                              : "Changes you make will appear here, grouped by ancillary."}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-3 pr-1">
                        {groups.map((group) => (
                          <div
                            key={group.ancillary}
                            data-testid={`admin-review-updates-group-${group.ancillary}`}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${UPDATE_GROUP_DOT[group.ancillary]}`}
                              />
                              <span
                                className={`text-[10px] font-bold uppercase tracking-wider ${UPDATE_GROUP_ACCENT[group.ancillary]}`}
                              >
                                {categoryLabels[group.ancillary]}
                              </span>
                            </div>
                            <ul className="space-y-1 pl-3">
                              {group.entries.map((entry) => (
                                <li
                                  key={entry.id}
                                  className="flex items-start gap-2 text-[11px] text-slate-700 leading-snug"
                                  data-testid="admin-review-updates-made-item"
                                  data-update-type={entry.type}
                                >
                                  <span className="font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                                    {entry.at.slice(11, 16)}
                                  </span>
                                  <span className="min-w-0">{shortUpdateText(entry)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </ScrollArea>
            </div>
            </div>

            {/* Decision footer — sibling nav centered, decision buttons right (no tile) */}
            <div
              className="mx-2 mb-3 flex shrink-0 items-center gap-1.5 px-1"
              data-testid="admin-review-decision-group"
            >
              <div className="flex-1" />
              {siblings && siblings.length >= 1 && (
                <div
                  className="inline-flex items-center gap-1.5"
                  data-testid="admin-review-sibling-nav"
                  data-active-index={activeIndex}
                  data-total={totalSiblings}
                  data-approve-pending={approvalMutation.isPending ? "true" : "false"}
                >
                  <button
                    type="button"
                    onClick={() => goToSibling(-1)}
                    disabled={!hasPrev || approvalMutation.isPending}
                    aria-label="Previous patient"
                    title="Previous patient"
                    data-testid="admin-review-sibling-prev"
                    className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span
                    className="text-[10px] font-medium text-slate-500 whitespace-nowrap leading-none tabular-nums"
                    data-testid="admin-review-sibling-count"
                  >
                    {activeIndex + 1} of {totalSiblings}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToSibling(1)}
                    disabled={!hasNext || approvalMutation.isPending}
                    aria-label="Next patient"
                    title={hasNext ? "Next patient" : "No more patients"}
                    data-testid="admin-review-sibling-next"
                    className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="flex-1 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  disabled={approvalMutation.isPending}
                  onClick={() => {
                    approvalMutation.mutate({ status: "approved" });
                    recordAdminReviewUpdate("approval_approved", "Approved review");
                  }}
                  aria-label={isUnder16 ? "Admin Override Approve" : "Approve"}
                  title={isUnder16 ? "Admin Override Approve" : "Approve"}
                  data-testid="admin-review-approve-button"
                  data-bar-testid={`admin-review-button-approve-${patient.id}`}
                  className="inline-flex w-10 items-center justify-center h-9 rounded-md bg-emerald-700 text-white shadow-sm border border-emerald-800/40 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {approvalMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Check className="w-5 h-5" strokeWidth={3} />
                  )}
                </button>
                <button
                  type="button"
                  disabled={approvalMutation.isPending}
                  onClick={() => {
                    approvalMutation.mutate({ status: "needs_info" });
                    recordAdminReviewUpdate("approval_pended", "Pended review");
                  }}
                  aria-label="Pend"
                  title="Pend"
                  data-testid="admin-review-pend-button"
                  data-bar-testid={`admin-review-button-needs-info-${patient.id}`}
                  className="inline-flex w-10 items-center justify-center h-9 rounded-md bg-amber-600 text-white shadow-sm border border-amber-700/40 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Clock className="w-5 h-5" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  disabled={approvalMutation.isPending}
                  onClick={() => {
                    approvalMutation.mutate({ status: "rejected" });
                    recordAdminReviewUpdate("approval_rejected", "Rejected review");
                  }}
                  aria-label="Reject"
                  title="Reject"
                  data-testid={`admin-review-button-reject-${patient.id}`}
                  className="inline-flex w-10 items-center justify-center h-9 rounded-md bg-rose-700 text-white shadow-sm border border-rose-800/40 hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <XCircle className="w-5 h-5" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </aside>
        </div>
        {/* AI Logic drawer + subtle save-as-logic prompt (prototype). */}
        <AdminReviewAiLogicDrawer
          open={aiLogicOpen}
          onOpenChange={setAiLogicOpen}
          context={aiLogicContext}
        />
        {aiPromptLabel && (
          <AiLogicSavePrompt
            itemLabel={aiPromptLabel}
            context={aiLogicContext}
            onDismiss={() => setAiPromptLabel(null)}
          />
        )}
    </>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex flex-col w-[calc(100vw-0.75rem)] md:w-[calc(100vw-3rem)] max-w-[1040px] h-[min(96dvh,760px)] md:h-[min(86vh,760px)] overflow-hidden p-0 gap-0 rounded-xl border border-white/40 shadow-[0_30px_90px_rgba(15,23,42,0.35)] ring-1 ring-black/5"
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

// Human-readable label for the first ancillary this button is already
// assigned to, so chip-level evidence records carry the assigned ancillary.
function assignedAncillaryLabel(
  isAlreadyAssigned: (target: AssignmentTarget) => boolean,
  ultrasoundTests: string[],
): string | null {
  if (isAlreadyAssigned({ type: "ancillary", ancillaryId: "brainwave" })) return "BrainWave";
  if (isAlreadyAssigned({ type: "ancillary", ancillaryId: "vitalwave" })) return "VitalWave";
  if (isAlreadyAssigned({ type: "ultrasound-parent" })) return "Ultrasound Studies";
  for (const t of ultrasoundTests) {
    if (isAlreadyAssigned({ type: "ultrasound-test", testName: t })) return t;
  }
  return null;
}

function AssignMenu({
  btn,
  ultrasoundTests,
  isAlreadyAssigned,
  onAssign,
  evidenceContext,
}: {
  btn: SupportingButton;
  ultrasoundTests: string[];
  isAlreadyAssigned: (target: AssignmentTarget) => boolean;
  onAssign: (target: AssignmentTarget) => void;
  evidenceContext?: AiLogicPatientContext | null;
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
      {evidenceContext && (
        <ChipEvidenceMenuExtras
          context={evidenceContext}
          label={btn.label}
          source={btn.source}
          sourceText={btn.sourceText}
          confidence={btn.confidence}
          assignedAncillary={assignedAncillaryLabel(isAlreadyAssigned, ultrasoundTests)}
          testIdSuffix={btn.id}
        />
      )}
    </PopoverContent>
  );
}

// Shared chip decorations for the knowledge-layer prototype: source badge
// (DX/HX/RX), confidence dot, and a check when the evidence has been
// approved. Purely visual — assignment behavior is untouched.
function ChipEvidenceBadges({
  btn,
  evidenceContext,
  sourceBadge,
}: {
  btn: SupportingButton;
  evidenceContext?: AiLogicPatientContext | null;
  sourceBadge: string;
}) {
  const decision = useCiChipDecision(evidenceContext, btn.label, btn.source);
  return (
    <>
      <span
        className={`inline-flex items-center rounded-full border px-1 text-[9px] font-semibold ${
          SOURCE_BADGE_TONE[sourceBadge] ?? "bg-slate-100 text-slate-600 border-slate-200"
        }`}
        data-testid={`chip-source-badge-${btn.id}`}
      >
        {sourceBadge}
      </span>
      <span
        className={`h-1.5 w-1.5 rounded-full ${CONF_DOT[btn.confidence ?? "medium"]}`}
        title={`Confidence: ${btn.confidence ?? "medium"}`}
        data-testid={`chip-confidence-${btn.id}`}
      />
      {decision === "approved" && (
        <Check className="w-3 h-3 text-emerald-600" data-testid={`chip-approved-${btn.id}`} />
      )}
    </>
  );
}

function IcdDiseaseButton({
  btn,
  ultrasoundTests,
  isAlreadyAssigned,
  onAssign,
  evidenceContext,
}: {
  btn: SupportingButton;
  ultrasoundTests: string[];
  isAlreadyAssigned: (target: AssignmentTarget) => boolean;
  onAssign: (target: AssignmentTarget) => void;
  evidenceContext?: AiLogicPatientContext | null;
}) {
  // Diagnoses without an ICD code are still assignable — the internal
  // requiresIcd flag keeps the rule engine surfacing the gap on the
  // blocking panel. The chip now also shows a compact DX badge,
  // ICD-present/missing status, and confidence (knowledge-layer spec).
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
            <ChipEvidenceBadges btn={btn} evidenceContext={evidenceContext} sourceBadge="DX" />
            <span>{btn.label}</span>
            <span className="text-[9px] font-medium text-rose-500">ICD missing</span>
            <Plus className="w-3 h-3 opacity-60" />
          </button>
        </PopoverTrigger>
        <AssignMenu
          btn={btn}
          ultrasoundTests={ultrasoundTests}
          isAlreadyAssigned={isAlreadyAssigned}
          onAssign={onAssign}
          evidenceContext={evidenceContext}
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
          <ChipEvidenceBadges btn={btn} evidenceContext={evidenceContext} sourceBadge="DX" />
          {btn.icdCode ? (
            <span className="font-mono opacity-80">{btn.icdCode}</span>
          ) : (
            <span className="text-[9px] font-medium text-rose-500">ICD missing</span>
          )}
          <span>· {btn.label}</span>
          <Plus className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <AssignMenu
        btn={btn}
        ultrasoundTests={ultrasoundTests}
        isAlreadyAssigned={isAlreadyAssigned}
        onAssign={onAssign}
        evidenceContext={evidenceContext}
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
  evidenceContext,
}: {
  btn: SupportingButton;
  testId: string;
  tone: "purple" | "amber" | "teal";
  prefix: string;
  ultrasoundTests: string[];
  isAlreadyAssigned: (target: AssignmentTarget) => boolean;
  onAssign: (target: AssignmentTarget) => void;
  evidenceContext?: AiLogicPatientContext | null;
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
  const sourceBadge =
    btn.source === "Rx" ? "RX" : btn.source === "Hx" ? "HX" : prefix.toUpperCase();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${toneClass}`}
          data-testid={testId}
          data-derived={derived}
        >
          <ChipEvidenceBadges
            btn={btn}
            evidenceContext={evidenceContext}
            sourceBadge={sourceBadge}
          />
          <span>{btn.label}</span>
          <Plus className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <AssignMenu
        btn={btn}
        ultrasoundTests={ultrasoundTests}
        isAlreadyAssigned={isAlreadyAssigned}
        onAssign={onAssign}
        evidenceContext={evidenceContext}
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
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold ${
              card.adminAdded
                ? "border-sky-200 bg-sky-50 text-sky-800"
                : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
            data-testid="admin-review-source-badge"
            data-source={card.adminAdded ? "admin_added" : "plexus_iq"}
          >
            {card.adminAdded ? "Admin-added" : "Plexus IQ"}
          </span>
        </div>
      </div>

      {card.adminAdded && card.addedReason && (
        <div
          className="rounded-md border border-sky-100 bg-sky-50/60 px-2 py-1.5"
          data-testid="admin-review-added-reason"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">
            Qualification Reason
          </div>
          <div className="mt-0.5 text-xs text-slate-800 whitespace-pre-wrap">
            {card.addedReason}
          </div>
        </div>
      )}

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
