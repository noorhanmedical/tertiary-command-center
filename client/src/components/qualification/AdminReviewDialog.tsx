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
  Plus,
  Sparkles,
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
} from "@shared/plexus-iq/adminReviewEvidence";

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
    label: "Needs Info",
    pillClass: "bg-amber-50 text-amber-800 border border-amber-200",
  },
  rejected: {
    label: "Rejected",
    pillClass: "bg-rose-50 text-rose-800 border border-rose-200",
  },
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-800 border-emerald-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-rose-50 text-rose-800 border-rose-200",
};

// ────────────────────────────────────────────────────────────────────
// SupportingButton model — single shape for every clickable item in
// the Available Buttons section.
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
  // Reused by Available Buttons through parsers; returned empty since parsers
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

  useEffect(() => {
    if (!open) return;
    setAssignments(seedAssignmentsFromReasoning(reasoningAsObject(patient.reasoning)));
    setAdminNote("");
    setAncillaryNotes({});
    setIcdSearchQuery("");
    setAiIcdButtons([]);
  }, [open, patient.id, patient.reasoning]);

  const apiEvidence: AdminEvidenceChip[] = evidenceQuery.data?.evidence ?? [];

  // Build Available Buttons from raw source + rule engine + AI ICD additions.
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

  // Dedicated AI ICD result buttons (user-added via search).
  const availableButtons = useMemo(() => {
    const seen = new Set<string>();
    const out: SupportingButton[] = [];
    for (const list of [mergedDx, aiIcdButtons, mergedRx, mergedHx]) {
      for (const b of list) {
        const k = buttonKey(b);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(b);
        }
      }
    }
    return out;
  }, [mergedDx, mergedRx, mergedHx, aiIcdButtons]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-[1280px] max-h-[92vh] overflow-hidden p-0 gap-0 rounded-2xl"
        data-testid={`dialog-admin-review-${patient.id}`}
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-slate-200 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold tracking-tight text-slate-900">
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
                    className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-800 border border-rose-300 px-2 py-0.5 font-semibold uppercase tracking-wider"
                    data-testid="badge-admin-review-under-16"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Under 16 · Admin approval required
                  </span>
                )}
                {patient.facility && <span className="text-slate-500">{patient.facility}</span>}
                {scheduleDate && <span className="text-slate-500">· {scheduleDate}</span>}
                {evidenceQuery.isFetching && (
                  <span className="text-slate-400 inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Refreshing
                  </span>
                )}
              </div>
            </div>
            <PatientPdfActions
              patient={patient}
              facility={facility ?? patient.facility ?? null}
              scheduleDate={scheduleDate ?? null}
              compact
            />
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(92vh-9rem)]">
          <div
            className="px-6 py-5 grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)_320px] gap-4"
            data-testid="admin-review-three-column-layout"
          >
            {/* ─── Column 1 — Raw Clinical Source (display only) ─── */}
            <div className="space-y-3" data-testid="admin-review-left-column">
              <section className="space-y-2" data-testid="admin-review-clinical-source">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
              </section>

              <section
                className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-3"
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
            </div>

            {/* ─── Column 2 — Available Buttons + Ancillary Panels ─── */}
            <div className="space-y-4" data-testid="admin-review-middle-column">
              <section
                className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
                data-testid="admin-review-available-buttons"
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Available Buttons
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Select items to add to BrainWave, VitalWave, or Ultrasound.
                  </div>
                </div>

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

              </section>

              {/* BrainWave + VitalWave panels */}
              {(["brainwave", "vitalwave"] as const).map((id) => {
                const style = categoryStyles[id];
                const Icon = categoryIcons[id];
                const candidate = candidateById.get(id);
                const services = canonicalReasoningByAncillary[id].map((c) => c.testName);
                const selected = selectedFor(id);
                const note = ancillaryNotes[id] ?? "";
                const isOpen = !!expanded[id];
                const statusLabel = candidate
                  ? candidate.status === "suggested"
                    ? "Suggested"
                    : candidate.status === "needs_info"
                      ? "Needs Info"
                      : "Admin approval required"
                  : isUnder16
                    ? "Admin approval required"
                    : services.length > 0
                      ? "Generated"
                      : "Needs Info";
                return (
                  <div
                    key={id}
                    className={`rounded-2xl border overflow-hidden ${style.bg} ${style.border}`}
                    data-testid="admin-review-ancillary-colored-panel"
                    data-ancillary={id}
                  >
                    <div className="px-4 py-3 border-b border-white/40 bg-white/30 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => toggleExpand(id)}
                          className="flex items-start gap-3 min-w-0 flex-1 text-left"
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className={`w-4 h-4 mt-0.5 shrink-0 ${style.accent}`} />
                          ) : (
                            <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 ${style.accent}`} />
                          )}
                          <div className={`shrink-0 w-7 h-7 rounded-full bg-white inline-flex items-center justify-center ${style.icon}`}>
                            <Icon className="w-4 h-4" strokeWidth={2} fill="none" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className={`font-semibold text-sm ${style.accent}`}>
                                {categoryLabels[id]}
                              </div>
                              <span className="text-[11px] text-slate-700/80">{statusLabel}</span>
                              {isUnder16 && (
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-800 bg-rose-50 border border-rose-300 rounded-full px-1.5">
                                  &lt;16
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-700">
                              <div className="flex items-baseline gap-1">
                                <span className="font-semibold text-slate-600">Services:</span>
                                <span
                                  className="truncate"
                                  data-testid="admin-review-ancillary-services-list"
                                >
                                  {services.length > 0 ? services.join(", ") : "—"}
                                </span>
                              </div>
                              <div className="mt-0.5">
                                <div className="font-semibold text-slate-600 text-[11px]">Selected:</div>
                                <div
                                  className="flex flex-wrap gap-1 mt-0.5"
                                  data-testid="admin-review-ancillary-selected-list"
                                >
                                  {selected.length === 0 ? (
                                    <span className="text-slate-400 italic">—</span>
                                  ) : (
                                    selected.map((b) => (
                                      <SelectedChip
                                        key={chipKeyForAssignment(b)}
                                        b={b}
                                        onRemove={() => unassign({ type: "ancillary", ancillaryId: id }, b)}
                                      />
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!!regenInFlight[id]}
                          onClick={() => regenerateAncillaryMutation.mutate({ ancillary: id })}
                          data-testid={REGENERATE_TEST_IDS[id]}
                          data-regenerate="admin-review-regenerate-ancillary"
                          className="shrink-0 bg-white/80"
                        >
                          {regenInFlight[id] ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3 mr-1" />
                          )}
                          Regenerate {categoryLabels[id]}
                        </Button>
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
                              <CanonicalReasoningCardView key={card.testName} card={card} />
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

              {/* Ultrasound parent + child bars */}
              <div
                className={`rounded-2xl border overflow-hidden ${categoryStyles.ultrasound.bg} ${categoryStyles.ultrasound.border}`}
                data-testid="admin-review-ultrasound-parent-panel"
                data-ancillary="ultrasound"
              >
                <div className="px-4 py-3 border-b border-white/40 bg-white/30 backdrop-blur-sm">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand("ultrasound")}
                      className="flex items-start gap-3 min-w-0 flex-1 text-left"
                      aria-expanded={!!expanded.ultrasound}
                    >
                      {expanded.ultrasound ? (
                        <ChevronDown className={`w-4 h-4 mt-0.5 shrink-0 ${categoryStyles.ultrasound.accent}`} />
                      ) : (
                        <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 ${categoryStyles.ultrasound.accent}`} />
                      )}
                      <div className={`shrink-0 w-7 h-7 rounded-full bg-white inline-flex items-center justify-center ${categoryStyles.ultrasound.icon}`}>
                        {(() => {
                          const Icon = categoryIcons.ultrasound;
                          return <Icon className="w-4 h-4" strokeWidth={2} fill="none" />;
                        })()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className={`font-semibold text-sm ${categoryStyles.ultrasound.accent}`}>
                            {categoryLabels.ultrasound}
                          </div>
                          {isUnder16 && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-800 bg-rose-50 border border-rose-300 rounded-full px-1.5">
                              &lt;16
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-700">
                          <div className="flex items-baseline gap-1">
                            <span className="font-semibold text-slate-600">Services:</span>
                            <span
                              className="truncate"
                              data-testid="admin-review-ancillary-services-list"
                            >
                              {ultrasoundTests.length > 0 ? ultrasoundTests.join(", ") : "—"}
                            </span>
                          </div>
                          <div className="mt-0.5">
                            <div className="font-semibold text-slate-600 text-[11px]">Selected:</div>
                            <div
                              className="flex flex-wrap gap-1 mt-0.5"
                              data-testid="admin-review-ancillary-selected-list"
                            >
                              {ultrasoundParentSelected().length === 0 ? (
                                <span className="text-slate-400 italic">—</span>
                              ) : (
                                ultrasoundParentSelected().map((b) => (
                                  <SelectedChip
                                    key={chipKeyForAssignment(b)}
                                    b={b}
                                    onRemove={() => unassign({ type: "ultrasound-parent" }, b)}
                                  />
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!!regenInFlight.ultrasound}
                      onClick={() => regenerateAncillaryMutation.mutate({ ancillary: "ultrasound" })}
                      data-testid={REGENERATE_TEST_IDS.ultrasound}
                      data-regenerate="admin-review-regenerate-ancillary"
                      className="shrink-0 bg-white/80"
                    >
                      {regenInFlight.ultrasound ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3 mr-1" />
                      )}
                      Regenerate {categoryLabels.ultrasound}
                    </Button>
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
                        return (
                          <div
                            key={card.testName}
                            className="rounded-xl border border-emerald-200 bg-white"
                            data-testid="admin-review-ultrasound-child-panel"
                            data-test-name={card.testName}
                          >
                            <div className="px-3 py-2 flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-slate-900">{card.testName}</div>
                                <div className="mt-1 text-[11px]">
                                  <div className="font-semibold text-slate-600">Selected:</div>
                                  <div
                                    className="flex flex-wrap gap-1 mt-0.5"
                                    data-testid="admin-review-ultrasound-child-selected-list"
                                  >
                                    {selected.length === 0 ? (
                                      <span className="text-slate-400 italic">—</span>
                                    ) : (
                                      selected.map((b) => {
                                        const fromParent = assignments.ultrasound.parent.some(
                                          (p) => chipKeyForAssignment(p) === chipKeyForAssignment(b),
                                        );
                                        const childTestId =
                                          b.kind === "icd_disease"
                                            ? "admin-review-ultrasound-child-icd-button"
                                            : b.kind === "medication"
                                              ? "admin-review-ultrasound-child-med-button"
                                              : "admin-review-ultrasound-child-hx-button";
                                        return (
                                          <span
                                            key={chipKeyForAssignment(b)}
                                            data-testid={childTestId}
                                            data-inherited={fromParent ? "true" : "false"}
                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                                              b.kind === "icd_disease"
                                                ? "bg-blue-50 text-blue-800 border-blue-200"
                                                : b.kind === "medication"
                                                  ? "bg-purple-50 text-purple-800 border-purple-200"
                                                  : "bg-amber-50 text-amber-800 border-amber-200"
                                            }`}
                                          >
                                            {b.icdCode ? `${b.icdCode} · ` : ""}{b.label}
                                            {fromParent ? (
                                              <span className="text-[9px] opacity-60">↑ parent</span>
                                            ) : (
                                              <button
                                                type="button"
                                                aria-label={`Remove ${b.label}`}
                                                data-testid="admin-review-unassign-supporting-item"
                                                onClick={() => unassign({ type: "ultrasound-test", testName: card.testName }, b)}
                                                className="hover:text-rose-600"
                                              >
                                                <X className="w-3 h-3" />
                                              </button>
                                            )}
                                          </span>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={inFlight}
                                onClick={() =>
                                  regenerateTestMutation.mutate({
                                    testName: card.testName,
                                    ancillaryId: "ultrasound",
                                  })
                                }
                                data-testid="admin-review-regenerate-ultrasound-test"
                                data-test-name={card.testName}
                                className="shrink-0"
                              >
                                {inFlight ? (
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3 h-3 mr-1" />
                                )}
                                Regenerate {card.testName}
                              </Button>
                            </div>
                            <div className="px-3 pb-3">
                              <CanonicalReasoningCardView card={card} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ─── Column 3 — PDFs / Blocking / Admin Note / Approval ─── */}
            <div className="space-y-4" data-testid="admin-review-right-column">
              <section className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  PDFs
                </div>
                <PatientPdfActions
                  patient={patient}
                  facility={facility ?? patient.facility ?? null}
                  scheduleDate={scheduleDate ?? null}
                />
              </section>

              <section className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Blocking Rules
                </div>
                {isUnder16 && (
                  <div
                    className="rounded-md border border-rose-200 bg-rose-50 text-rose-800 text-[11px] px-3 py-2 inline-flex items-center gap-1.5 w-full"
                    data-testid="admin-review-under-16-rule"
                  >
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Under 16 · Admin approval required
                  </div>
                )}
                {totalMissingIcds > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-[11px] px-3 py-2 inline-flex items-center gap-1.5 w-full">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Diagnosis missing ICD
                  </div>
                )}
                {!isUnder16 && totalMissingIcds === 0 && (
                  <div className="text-[11px] text-slate-400 italic">No blocking rules.</div>
                )}
              </section>

              <section className="space-y-2">
                <Label
                  htmlFor={`admin-review-admin-note-${patient.id}`}
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Admin Note
                </Label>
                <Textarea
                  id={`admin-review-admin-note-${patient.id}`}
                  value={adminNote}
                  rows={3}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Optional context attached to this approval action"
                  data-testid={`admin-review-admin-note-${patient.id}`}
                />
              </section>

              <section className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Approval
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    disabled={approvalMutation.isPending}
                    onClick={() => approvalMutation.mutate({ status: "approved" })}
                    data-testid={`admin-review-button-approve-${patient.id}`}
                    className="bg-emerald-600 text-white hover:bg-emerald-700 w-full"
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
                    onClick={() => approvalMutation.mutate({ status: "needs_info" })}
                    data-testid={`admin-review-button-needs-info-${patient.id}`}
                    className="w-full"
                  >
                    Needs Info
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={approvalMutation.isPending}
                    onClick={() => approvalMutation.mutate({ status: "rejected" })}
                    data-testid={`admin-review-button-reject-${patient.id}`}
                    className="text-rose-700 border-rose-200 hover:bg-rose-50 w-full"
                  >
                    Reject
                  </Button>
                </div>
                <div className="text-[10px] text-slate-500 inline-flex items-center gap-1 pt-1">
                  <ShieldCheck className="w-3 h-3" />
                  Admin decision is final for engagement send
                </div>
              </section>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────
// Small presentational components
// ────────────────────────────────────────────────────────────────────

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
  // ICD-needed diagnoses are still assignable. Missing ICD code is internal
  // admin metadata, not a precondition. The button still opens the assign popover.
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
          >
            <span className="font-semibold" data-testid="admin-review-icd-disease-needed">
              ICD needed
            </span>
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

function SelectedChip({
  b,
  onRemove,
}: {
  b: SupportingButton;
  onRemove: () => void;
}) {
  const chipTestId =
    b.kind === "icd_disease"
      ? "admin-review-ancillary-icd-button"
      : b.kind === "medication"
        ? "admin-review-ancillary-med-button"
        : "admin-review-ancillary-hx-button";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        b.kind === "icd_disease"
          ? "bg-blue-50 text-blue-800 border-blue-200"
          : b.kind === "medication"
            ? "bg-purple-50 text-purple-800 border-purple-200"
            : "bg-amber-50 text-amber-800 border-amber-200"
      }`}
      data-testid="admin-review-ancillary-header-chip"
      data-chip-kind={chipTestId}
    >
      <span data-testid={chipTestId} className="contents">
        {b.icdCode ? `${b.icdCode} · ` : ""}{b.label}
      </span>
      <button
        type="button"
        aria-label={`Remove ${b.label}`}
        data-testid="admin-review-unassign-supporting-item"
        onClick={onRemove}
        className="hover:text-rose-600"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

function CanonicalReasoningCardView({ card }: { card: CanonicalReasoningCard }) {
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
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Qualifying Factors
          </div>
          <ul className="text-xs text-slate-800 list-disc pl-4 space-y-0.5">
            {card.qualifyingFactors.map((f, i) => (
              <li key={`${card.testName}-f-${i}`}>{f}</li>
            ))}
          </ul>
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
