import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ChevronRight,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  X,
  Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PatientScreening } from "@shared/schema";
import { computeAdminReview, type AdminApprovalStatus } from "@/lib/adminReviewStatus";
import { PatientPdfActions } from "@/components/qualification/PatientPdfActions";
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
  patient,
  facility,
  scheduleDate,
  onUpdate,
}: AdminReviewDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  // Suggestion acceptance — a med-derived diagnosis becomes a real
  // SupportingButton only after the admin clicks accept.
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<SupportingButton[]>([]);

  // Layout state — left/right panels default open, collapsible via
  // header toggle buttons. Source tab is the default left tab.
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<
    "source" | "patient-directory" | "cooldown" | "insurance" | "history"
  >("source");

  // Audit log. Seeded from patient.reasoning["adminReview:updates"]
  // so prior persisted entries survive a dialog reopen. New entries
  // append at the top and persist via onUpdate when the type allows.
  const [updatesLog, setUpdatesLog] = useState<AdminReviewUpdateEntry[]>(() => {
    const stored = (reasoningObject as Record<string, unknown>)["adminReview:updates"];
    if (Array.isArray(stored)) return stored as AdminReviewUpdateEntry[];
    return [];
  });

  useEffect(() => {
    if (!open) return;
    setAssignments(seedAssignmentsFromReasoning(reasoningAsObject(patient.reasoning)));
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
  }, [open, patient.id, patient.reasoning]);

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
    setAssignments((prev) => {
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
      return next;
    });
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
    setAssignments((prev) => {
      const k = chipKeyForAssignment(btn);
      const next: AdminReviewAssignmentState = {
        brainwave: prev.brainwave.filter((c) => chipKeyForAssignment(c) !== k),
        vitalwave: prev.vitalwave.filter((c) => chipKeyForAssignment(c) !== k),
        ultrasound: {
          parent: prev.ultrasound.parent.filter((c) => chipKeyForAssignment(c) !== k),
          byTestName: { ...prev.ultrasound.byTestName },
        },
      };
      if (from.type === "ancillary") {
        next.brainwave = from.ancillaryId === "brainwave" ? prev.brainwave.filter((c) => chipKeyForAssignment(c) !== k) : prev.brainwave;
        next.vitalwave = from.ancillaryId === "vitalwave" ? prev.vitalwave.filter((c) => chipKeyForAssignment(c) !== k) : prev.vitalwave;
        next.ultrasound = prev.ultrasound;
      } else if (from.type === "ultrasound-parent") {
        next.brainwave = prev.brainwave;
        next.vitalwave = prev.vitalwave;
        next.ultrasound = {
          parent: prev.ultrasound.parent.filter((c) => chipKeyForAssignment(c) !== k),
          byTestName: prev.ultrasound.byTestName,
        };
      } else if (from.type === "ultrasound-test") {
        const list = prev.ultrasound.byTestName[from.testName] ?? [];
        next.brainwave = prev.brainwave;
        next.vitalwave = prev.vitalwave;
        next.ultrasound = {
          parent: prev.ultrasound.parent,
          byTestName: {
            ...prev.ultrasound.byTestName,
            [from.testName]: list.filter((c) => chipKeyForAssignment(c) !== k),
          },
        };
      }
      return next;
    });
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
        onUpdate("reasoning", (data.patient.reasoning ?? {}) as Record<string, unknown>);
      }
      recordAdminReviewUpdate(
        "regenerate",
        `Regenerated ${categoryLabels[vars.ancillary]}`,
      );
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
      queryClient.invalidateQueries({ queryKey: ["admin-review-evidence", patient.id] });
    },
    onError: (err, vars) => {
      toast({
        title: `Could not regenerate ${categoryLabels[vars.ancillary]}`,
        description: err?.message ?? "Unknown error",
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
        onUpdate("reasoning", (data.patient.reasoning ?? {}) as Record<string, unknown>);
      }
      recordAdminReviewUpdate("regenerate", `Regenerated ${vars.testName}`);
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
    },
    onError: (err, vars) => {
      toast({
        title: `Could not regenerate ${vars.testName}`,
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
    onSettled: (_d, _e, vars) => {
      setRegenInFlight((prev) => ({ ...prev, [`test:${vars.testName}`]: false }));
    },
  });

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
      toast({
        title: `Admin approval: ${vars.status.replace("_", " ")}`,
        description: data.patient?.name ?? "",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
      onOpenChange(false);
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

  // Grid template flexes to whichever panels are open. Collapsed
  // panels collapse to a 40px rail with the toggle button.
  const leftCol = leftPanelOpen ? "340px" : "44px";
  const rightCol = rightPanelOpen ? "340px" : "44px";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-[1440px] max-h-[94vh] overflow-hidden p-0 gap-0 rounded-2xl"
        data-testid={`dialog-admin-review-${patient.id}`}
      >
        {/* Smoke header — black at ~70% opacity per Team Portal spec. */}
        <DialogHeader
          className="px-6 pt-5 pb-4 border-b border-black/30 bg-black/70 backdrop-blur-md text-white"
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
                {evidenceQuery.isFetching && (
                  <span className="text-white/60 inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Refreshing
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setLeftPanelOpen((v) => !v)}
                aria-label={leftPanelOpen ? "Collapse left panel" : "Expand left panel"}
                title={leftPanelOpen ? "Collapse left panel" : "Expand left panel"}
                data-testid="admin-review-left-panel-toggle"
                data-panel-state={leftPanelOpen ? "admin-review-left-panel-open" : "admin-review-left-panel-collapsed"}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-white/80 hover:text-white hover:bg-white/10"
              >
                {leftPanelOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => setRightPanelOpen((v) => !v)}
                aria-label={rightPanelOpen ? "Collapse right panel" : "Expand right panel"}
                title={rightPanelOpen ? "Collapse right panel" : "Expand right panel"}
                data-testid="admin-review-right-panel-toggle"
                data-panel-state={rightPanelOpen ? "admin-review-right-panel-open" : "admin-review-right-panel-collapsed"}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-white/80 hover:text-white hover:bg-white/10"
              >
                {rightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </DialogHeader>

        <div
          className="grid grid-cols-1 xl:grid-cols-[var(--left)_minmax(0,1fr)_var(--right)] gap-0 max-h-[calc(94vh-7.5rem)]"
          style={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ['--left' as any]: leftCol,
            ['--right' as any]: rightCol,
          }}
          data-testid="admin-review-three-column-layout"
          data-left-state={leftPanelOpen ? "admin-review-left-panel-open" : "admin-review-left-panel-collapsed"}
          data-right-state={rightPanelOpen ? "admin-review-right-panel-open" : "admin-review-right-panel-collapsed"}
        >
            {/* ─── Column 1 — approved muted blue #7283B0, tabs, scrollable ─── */}
            <aside
              className="bg-[#7283B0] text-white border-r border-black/10 flex flex-col min-h-0"
              data-testid="admin-review-left-column"
              data-panel-style="admin-review-blue-left-panel"
              data-panel-color="#7283B0"
              style={{ backgroundColor: "#7283B0" }}
            >
              {!leftPanelOpen ? (
                <div
                  className="flex-1 flex items-start justify-center pt-3"
                  data-testid="admin-review-left-panel-collapsed"
                >
                  <span className="text-[10px] uppercase tracking-[0.2em] text-white/60 rotate-90 origin-top mt-8 whitespace-nowrap">
                    Source
                  </span>
                </div>
              ) : (
                <div
                  className="flex-1 min-h-0 flex flex-col"
                  data-testid="admin-review-left-panel-open"
                >
                  <ScrollArea
                    className="flex-1 min-h-0 px-4 py-4"
                    data-testid="admin-review-left-panel-scroll"
                  >
                    <Tabs
                      value={leftTab}
                      onValueChange={(v) => setLeftTab(v as typeof leftTab)}
                      className="w-full"
                      data-testid="admin-review-left-tabs"
                    >
                      <TabsList className="bg-black/15 text-white grid grid-cols-3 w-full">
                        <TabsTrigger
                          value="source"
                          data-testid="admin-review-left-tab-source"
                          className="text-[11px] data-[state=active]:bg-white data-[state=active]:text-[#3d4a6b]"
                        >
                          Source
                        </TabsTrigger>
                        <TabsTrigger
                          value="patient-directory"
                          data-testid="admin-review-left-tab-patient-directory"
                          className="text-[11px] data-[state=active]:bg-white data-[state=active]:text-[#3d4a6b]"
                        >
                          Directory
                        </TabsTrigger>
                        <TabsTrigger
                          value="cooldown"
                          data-testid="admin-review-left-tab-cooldown"
                          className="text-[11px] data-[state=active]:bg-white data-[state=active]:text-[#3d4a6b]"
                        >
                          Cooldown
                        </TabsTrigger>
                      </TabsList>
                      <TabsList className="bg-black/15 text-white grid grid-cols-2 w-full mt-1">
                        <TabsTrigger
                          value="insurance"
                          data-testid="admin-review-left-tab-insurance"
                          className="text-[11px] data-[state=active]:bg-white data-[state=active]:text-[#3d4a6b]"
                        >
                          Insurance
                        </TabsTrigger>
                        <TabsTrigger
                          value="history"
                          data-testid="admin-review-left-tab-history"
                          className="text-[11px] data-[state=active]:bg-white data-[state=active]:text-[#3d4a6b]"
                        >
                          History
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent
                        value="source"
                        className="mt-3 space-y-3"
                        data-testid="admin-review-source-tab-content"
                      >
                        <section className="space-y-2" data-testid="admin-review-clinical-source">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
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

                        <section
                          className="space-y-1.5 rounded-2xl border border-white/15 bg-black/15 p-3"
                          data-testid="admin-review-icd-search-left"
                        >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                      </TabsContent>

                      <TabsContent
                        value="patient-directory"
                        className="mt-3"
                        data-testid="admin-review-patient-directory-tab-content"
                      >
                        <div className="rounded-2xl border border-white/15 bg-black/15 p-3 space-y-2">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                            Patient Directory
                          </div>
                          <div className="text-xs text-white/80">
                            <div>{patient.name || "Unnamed patient"}</div>
                            {patient.dob && <div className="text-white/60">DOB {patient.dob}</div>}
                            {patient.phoneNumber && (
                              <div className="text-white/60">{patient.phoneNumber}</div>
                            )}
                            {patient.facility && (
                              <div className="text-white/60">{patient.facility}</div>
                            )}
                          </div>
                          <div className="text-[10px] text-white/50 italic">
                            Full directory roster will appear here when the
                            backend route is wired.
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent
                        value="cooldown"
                        className="mt-3"
                        data-testid="admin-review-cooldown-tab-content"
                      >
                        <div
                          className="rounded-2xl border border-white/15 bg-black/15 p-3 space-y-1"
                          data-testid="admin-review-patient-cooldown-summary"
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                            Cooldown
                          </div>
                          <div className="text-xs text-white/80">
                            No active cooldown rules detected for this patient.
                          </div>
                          <div className="text-[10px] text-white/50 italic">
                            Cooldown engine wires here once the per-test
                            cooldown route ships.
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent
                        value="insurance"
                        className="mt-3"
                        data-testid="admin-review-insurance-tab-content"
                      >
                        <div className="rounded-2xl border border-white/15 bg-black/15 p-3 space-y-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                            Insurance
                          </div>
                          <div className="text-xs text-white/80">
                            {patient.insurance || (
                              <span className="italic text-white/50">No insurance on file</span>
                            )}
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent
                        value="history"
                        className="mt-3"
                        data-testid="admin-review-history-tab-content"
                      >
                        <div className="rounded-2xl border border-white/15 bg-black/15 p-3 space-y-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                            Patient History (chart)
                          </div>
                          <div className="text-xs text-white/80 whitespace-pre-wrap min-h-[3rem]">
                            {patient.history || (
                              <span className="italic text-white/50">No history entered</span>
                            )}
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </ScrollArea>
                </div>
              )}
            </aside>

            {/* ─── Column 2 — Ancillary Playground (white) ─── */}
            <main
              className="bg-white min-h-0 flex flex-col"
              data-testid="admin-review-middle-column"
              data-panel-style="admin-review-ancillary-playground-white-panel"
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
                            <div
                              className="flex flex-wrap items-center gap-1"
                              data-testid="admin-review-ancillary-factor-chip-row"
                            >
                              {combineChips(selected, ruleSeededChipsForAncillary(id)).map(({ chip: b, seeded }) => (
                                <FactorChip
                                  key={`${chipKeyForAssignment(b)}-${seeded ? "rule" : "user"}`}
                                  b={b}
                                  testId="admin-review-ancillary-factor-chip"
                                  removeTestId={
                                    id === "brainwave"
                                      ? "admin-review-remove-brainwave-factor"
                                      : "admin-review-remove-vitalwave-factor"
                                  }
                                  ruleSeeded={seeded}
                                  onRemove={() =>
                                    removeQualifyingFactor({ type: "ancillary", ancillaryId: id }, b)
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
                        <div
                          className="flex flex-wrap items-center gap-1"
                          data-testid="admin-review-ancillary-factor-chip-row"
                        >
                          {combineChips(ultrasoundParentSelected(), ruleSeededChipsForUltrasoundParent()).map(({ chip: b, seeded }) => (
                            <FactorChip
                              key={`${chipKeyForAssignment(b)}-${seeded ? "rule" : "user"}`}
                              b={b}
                              testId="admin-review-ancillary-factor-chip"
                              removeTestId="admin-review-remove-ultrasound-parent-factor"
                              ruleSeeded={seeded}
                              onRemove={() =>
                                removeQualifyingFactor({ type: "ultrasound-parent" }, b)
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
                                    <div
                                      className="flex flex-wrap items-center gap-1"
                                      data-testid="admin-review-ultrasound-child-factor-chip-row"
                                    >
                                      {combineChips(selected, ruleSeededChipsForUltrasoundTest(card.testName)).map(({ chip: b, seeded }) => {
                                        const fromParent = assignments.ultrasound.parent.some(
                                          (p) => chipKeyForAssignment(p) === chipKeyForAssignment(b),
                                        );
                                        return (
                                          <FactorChip
                                            key={`${chipKeyForAssignment(b)}-${seeded ? "rule" : "user"}`}
                                            b={b}
                                            testId="admin-review-ultrasound-child-factor-chip"
                                            removeTestId="admin-review-remove-ultrasound-child-factor"
                                            inherited={fromParent}
                                            ruleSeeded={seeded}
                                            onRemove={() =>
                                              removeQualifyingFactor(
                                                { type: "ultrasound-test", testName: card.testName },
                                                b,
                                              )
                                            }
                                          />
                                        );
                                      })}
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

            {/* ─── Column 3 — approved muted blue #7283B0 actions panel ─── */}
            <aside
              className="bg-[#7283B0] text-white border-l border-black/10 flex flex-col min-h-0"
              data-testid="admin-review-right-column"
              data-panel-style="admin-review-blue-right-panel"
              data-panel-color="#7283B0"
              style={{ backgroundColor: "#7283B0" }}
            >
              {!rightPanelOpen ? (
                <div
                  className="flex-1 flex items-start justify-center pt-3"
                  data-testid="admin-review-right-panel-collapsed"
                >
                  <span className="text-[10px] uppercase tracking-[0.2em] text-white/60 rotate-90 origin-top mt-8 whitespace-nowrap">
                    Actions
                  </span>
                </div>
              ) : (
              <ScrollArea
                className="flex-1 min-h-0 px-4 py-4"
                data-testid="admin-review-right-panel-scroll"
              >
              <div
                className="space-y-4"
                data-testid="admin-review-right-panel-open"
              >
              <section
                className="space-y-2"
                data-testid="admin-review-right-actions-panel"
              >
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    recordAdminReviewUpdate("pdf_previewed", "Previewed Patient PDF", { kind: "plexus" });
                  }}
                  data-testid="admin-review-pdf-preview-button-patient"
                  className="rounded-xl border border-white/20 bg-black/15 hover:bg-black/25 text-white px-3 py-2 text-xs font-semibold transition-colors"
                >
                  Patient PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    recordAdminReviewUpdate("pdf_previewed", "Previewed Clinician PDF", { kind: "clinician" });
                  }}
                  data-testid="admin-review-pdf-preview-button-clinician"
                  className="rounded-xl border border-white/20 bg-black/15 hover:bg-black/25 text-white px-3 py-2 text-xs font-semibold transition-colors"
                >
                  Clinician PDF
                </button>
              </div>
              <div data-testid="admin-review-pdf-actions-inline" className="bg-white rounded-xl p-2">
                <PatientPdfActions
                  patient={patient}
                  facility={facility ?? patient.facility ?? null}
                  scheduleDate={scheduleDate ?? null}
                  compact
                />
              </div>
              </section>

              <section
                className="space-y-2 rounded-2xl border border-white/15 bg-black/15 p-3"
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

                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 px-3 py-2 text-xs font-semibold hover:bg-emerald-100 transition-colors col-span-2"
                        data-testid="admin-review-right-button-suggestions"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Lightbulb className="w-3 h-3" />
                          Suggestions
                          {visibleSuggestions.length > 0 && (
                            <span className="inline-flex items-center justify-center rounded-full bg-emerald-200 text-emerald-900 text-[10px] px-1.5">
                              {visibleSuggestions.length}
                            </span>
                          )}
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-[340px] p-3 space-y-2"
                      data-testid="admin-review-right-popover-suggestions"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Diagnosis Suggestions
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Medication-derived. Click to accept — suggestions are
                        inactive until accepted.
                      </div>
                      {visibleSuggestions.length === 0 ? (
                        <div className="text-[11px] text-slate-400 italic">
                          No suggestions for this patient.
                        </div>
                      ) : (
                        <DiagnosisSuggestionsSection
                          suggestions={visibleSuggestions}
                          onAccept={acceptDiagnosisSuggestion}
                        />
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              </section>

              <section className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
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
                  <div className="text-[11px] text-white/50 italic">No blocking rules.</div>
                )}
              </section>

              {/* Admin note: circular icon button opens an inline
                  popover with the note textarea — keeps the panel
                  compact when the admin doesn't need a note. */}
              <section className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Add admin note"
                      title={adminNote ? "Admin note recorded" : "Add admin note"}
                      data-testid="admin-review-admin-note-icon-button"
                      className={`inline-flex items-center justify-center h-9 w-9 rounded-full border border-white/30 transition-colors ${
                        adminNote
                          ? "bg-white text-[#3d4a6b]"
                          : "bg-black/15 text-white hover:bg-black/25"
                      }`}
                    >
                      <StickyNote className="w-4 h-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-[300px] p-3 space-y-2"
                    data-testid="admin-review-admin-note-popover"
                  >
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
                  </PopoverContent>
                </Popover>
                <div className="text-[11px] text-white/70">
                  {adminNote.trim() ? "Admin note recorded for this session" : "No admin note yet"}
                </div>
              </section>

              <section className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
                  Decision
                </div>
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
                    className="bg-emerald-500 text-white hover:bg-emerald-600 w-full"
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
                    className="w-full bg-white/10 text-white border-white/20 hover:bg-white/20"
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
                    className="w-full text-rose-200 border-rose-300/40 bg-rose-900/40 hover:bg-rose-900/60"
                  >
                    Reject
                  </Button>
                </div>
                <div
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 text-white/70 px-2 py-0.5 text-[10px]"
                  data-testid="admin-review-scheduler-routing-chip"
                >
                  <ShieldCheck className="w-3 h-3" />
                  Scheduler routing wires here when available
                </div>
              </section>
              </div>
              </ScrollArea>
              )}
            </aside>
          </div>

          {/* ─── Bottom box — Updates Made In Patient ──────────── */}
          <div
            className="border-t border-slate-200 bg-slate-50 px-5 py-3"
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
      </DialogContent>
    </Dialog>
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
  // When true the chip is a rule-engine seed (not yet user-clicked);
  // it renders with a dashed border and the seeded testId so QA can
  // assert closed-bar chips are present.
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
      {inherited || ruleSeeded ? (
        <span className="text-[9px] opacity-60" aria-hidden>{ruleSeeded ? "rule" : "↑"}</span>
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
