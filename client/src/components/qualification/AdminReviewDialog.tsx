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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PatientScreening } from "@shared/schema";
import { computeAdminReview, type AdminApprovalStatus } from "@/lib/adminReviewStatus";
import { PatientPdfActions } from "@/components/qualification/PatientPdfActions";
import { getAncillaryCategory } from "@/features/schedule/ancillaryMeta";
import {
  COMMON_ICD_SUGGESTIONS,
  type AdminEvidenceChip,
  type AdminReviewAncillaryId,
  type AdminReviewRuleCandidate,
  type AdminReviewRuleResult,
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

type AncillaryRow = {
  id: AdminReviewAncillaryId;
  label: string;
};

const ANCILLARIES: AncillaryRow[] = [
  { id: "brainwave", label: "BrainWave" },
  { id: "vitalwave", label: "VitalWave" },
  { id: "ultrasound", label: "Ultrasound Studies" },
];

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

const SOURCE_TONE: Record<string, string> = {
  Hx: "bg-slate-100 text-slate-700 border-slate-200",
  Dx: "bg-indigo-50 text-indigo-700 border-indigo-200",
  Rx: "bg-violet-50 text-violet-700 border-violet-200",
  ICD: "bg-emerald-50 text-emerald-700 border-emerald-200",
  AI: "bg-sky-50 text-sky-700 border-sky-200",
  Manual: "bg-amber-50 text-amber-800 border-amber-200",
  "Prior Test": "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-800 border-emerald-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-rose-50 text-rose-800 border-rose-200",
};

type EvidencePayload = AdminReviewRuleResult & { ok?: boolean; patientId?: number };

type AncillaryAssignmentMap = Record<AdminReviewAncillaryId, AdminEvidenceChip[]>;
type AncillaryNoteMap = Record<AdminReviewAncillaryId, string>;

function emptyAncillaryMap<T>(value: () => T): Record<AdminReviewAncillaryId, T> {
  return {
    brainwave: value(),
    vitalwave: value(),
    ultrasound: value(),
  };
}

function reasoningAsObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function seedFromAdminMetadata(reasoning: Record<string, any>): {
  assignments: AncillaryAssignmentMap;
  notes: AncillaryNoteMap;
} {
  const assignments = emptyAncillaryMap<AdminEvidenceChip[]>(() => []);
  const notes = emptyAncillaryMap<string>(() => "");
  for (const id of ["brainwave", "vitalwave", "ultrasound"] as AdminReviewAncillaryId[]) {
    const entry = reasoning[`adminReview:${id}`];
    if (entry && typeof entry === "object") {
      if (Array.isArray(entry.assignedEvidence)) {
        assignments[id] = entry.assignedEvidence as AdminEvidenceChip[];
      }
      if (typeof entry.ancillaryNote === "string") notes[id] = entry.ancillaryNote;
    }
  }
  return { assignments, notes };
}

function chipKey(chip: AdminEvidenceChip): string {
  return `${chip.id}::${chip.icdCode ?? "no-icd"}`;
}

function localStableId(parts: string[]): string {
  return parts
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Local fallback evidence — keeps the popup non-empty when
// /admin-review/evidence is loading, errored, or returns nothing.
export function buildLocalEvidenceFallback(patient: PatientScreening): AdminEvidenceChip[] {
  const hx = (patient.history ?? "").toLowerCase();
  const dxText = (patient.diagnoses ?? "").toLowerCase();
  const rxText = (patient.medications ?? "").toLowerCase();
  const reasoningStr = JSON.stringify(patient.reasoning ?? {}).toLowerCase();
  const prior = (
    (patient as { previousTests?: string | null }).previousTests ?? ""
  ).toLowerCase();
  const blob = `${hx} ${dxText} ${rxText} ${reasoningStr} ${prior}`;

  const out: AdminEvidenceChip[] = [];
  const seen = new Set<string>();
  function push(chip: AdminEvidenceChip) {
    const k = chipKey(chip);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(chip);
  }

  const matches = (terms: string[]) => terms.some((t) => blob.includes(t));
  const icdInText = (code: string) => blob.includes(code.toLowerCase());

  if (matches(["diabetes", "dm2", "metformin", "insulin", "glp-1", "semaglutide", "jardiance", "farxiga"])) {
    const code = ["E11.9", "E11.40"].find(icdInText) ?? null;
    push({
      id: localStableId(["diagnosis", "diabetes", code ?? "needs-icd"]),
      kind: "diagnosis",
      label: "Diabetes mellitus",
      source: "AI",
      icdCode: code,
      icdLabel: code ? COMMON_ICD_SUGGESTIONS.diabetes.find((s) => s.code === code)?.label ?? null : null,
      requiresIcd: !code,
      suggestedIcds: code ? [] : COMMON_ICD_SUGGESTIONS.diabetes,
      confidence: "high",
      detail: "Local match on Hx/Dx/Rx",
    });
  }
  if (matches(["hypertension", "htn", "amlodipine", "lisinopril", "losartan", "hctz", "hydrochlorothiazide", "metoprolol"])) {
    const code = icdInText("I10") ? "I10" : null;
    push({
      id: localStableId(["diagnosis", "hypertension", code ?? "needs-icd"]),
      kind: "diagnosis",
      label: "Hypertension",
      source: "AI",
      icdCode: code,
      icdLabel: code ? COMMON_ICD_SUGGESTIONS.hypertension[0].label : null,
      requiresIcd: !code,
      suggestedIcds: code ? [] : COMMON_ICD_SUGGESTIONS.hypertension,
      confidence: "high",
    });
  }
  if (matches(["hyperlipidemia", "hld", "atorvastatin", "rosuvastatin", "pravastatin", "simvastatin", "statin"])) {
    const code = icdInText("E78.5") ? "E78.5" : null;
    push({
      id: localStableId(["diagnosis", "hyperlipidemia", code ?? "needs-icd"]),
      kind: "diagnosis",
      label: "Hyperlipidemia",
      source: "AI",
      icdCode: code,
      icdLabel: code ? COMMON_ICD_SUGGESTIONS.hyperlipidemia[0].label : null,
      requiresIcd: !code,
      suggestedIcds: code ? [] : COMMON_ICD_SUGGESTIONS.hyperlipidemia,
      confidence: "high",
    });
  }
  if (matches(["claudication", "pad", "pvd", "leg pain"])) {
    const code = icdInText("I73.9") ? "I73.9" : null;
    push({
      id: localStableId(["symptom", "pvd", code ?? "no-icd"]),
      kind: "symptom",
      label: "Peripheral vascular disease concern",
      source: "Hx",
      icdCode: code,
      requiresIcd: false,
      suggestedIcds: code ? [] : COMMON_ICD_SUGGESTIONS.pvd,
      confidence: "medium",
    });
  }
  if (matches(["edema", "swelling"])) {
    const code = icdInText("R60.0") ? "R60.0" : null;
    push({
      id: localStableId(["symptom", "edema", code ?? "no-icd"]),
      kind: "symptom",
      label: "Lower extremity edema",
      source: "Hx",
      icdCode: code,
      requiresIcd: false,
      suggestedIcds: code ? [] : COMMON_ICD_SUGGESTIONS.edema,
      confidence: "medium",
    });
  }
  if (matches(["dizziness", "syncope", "bruit"])) {
    const code = icdInText("R42") ? "R42" : null;
    push({
      id: localStableId(["symptom", "dizziness", code ?? "no-icd"]),
      kind: "symptom",
      label: "Dizziness / neurovascular symptom",
      source: "Hx",
      icdCode: code,
      requiresIcd: false,
      suggestedIcds: code ? [] : COMMON_ICD_SUGGESTIONS.dizziness,
      confidence: "medium",
    });
  }
  if (matches(["dyspnea", "shortness of breath", "sob"])) {
    const code = icdInText("R06.02") ? "R06.02" : null;
    push({
      id: localStableId(["symptom", "dyspnea", code ?? "no-icd"]),
      kind: "symptom",
      label: "Dyspnea",
      source: "Hx",
      icdCode: code,
      requiresIcd: false,
      suggestedIcds: code ? [] : COMMON_ICD_SUGGESTIONS.dyspnea,
      confidence: "medium",
    });
  }
  if (matches(["aspirin", "antiplatelet", "clopidogrel", "plavix"])) {
    push({
      id: localStableId(["medication", "antiplatelet"]),
      kind: "medication",
      label: "Antiplatelet therapy",
      source: "Rx",
      confidence: "medium",
    });
  }
  const meds: Array<[string, string[]]> = [
    ["Metformin", ["metformin"]],
    ["Insulin", ["insulin"]],
    ["Amlodipine", ["amlodipine"]],
    ["Lisinopril", ["lisinopril"]],
    ["Losartan", ["losartan"]],
    ["Metoprolol", ["metoprolol"]],
    ["Atorvastatin", ["atorvastatin"]],
    ["Rosuvastatin", ["rosuvastatin"]],
  ];
  for (const [label, terms] of meds) {
    if (matches(terms)) {
      push({
        id: localStableId(["medication", label]),
        kind: "medication",
        label,
        source: "Rx",
        confidence: "high",
      });
    }
  }
  if (prior.trim() || reasoningStr.includes("prior test") || reasoningStr.includes("previoustests")) {
    push({
      id: localStableId(["prior-test", "prior"]),
      kind: "prior_test",
      label: "Prior testing",
      source: "Prior Test",
      detail: (patient as { previousTests?: string | null }).previousTests ?? null,
      confidence: "medium",
    });
  }
  return out;
}

// Canonical reasoning helper: pulls patient.reasoning[testName] for every
// qualifying test, groups by ancillary category, and shapes for display.
// Same source the patient-card icon popup, QualificationReasoningDialog,
// and PDF generation read from.
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
    if (value == null) continue;

    if (typeof value === "string") {
      grouped[category].push({
        testName: test,
        clinicianReasoning: value,
        patientExplanation: "",
        qualifyingFactors: [],
        icd10Codes: [],
        pearls: [],
        confidence: null,
        approvalRequired: false,
      });
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      grouped[category].push({
        testName: test,
        clinicianReasoning:
          typeof value.clinician_understanding === "string"
            ? value.clinician_understanding
            : "",
        patientExplanation:
          typeof value.patient_talking_points === "string"
            ? value.patient_talking_points
            : "",
        qualifyingFactors: Array.isArray(value.qualifying_factors)
          ? value.qualifying_factors
          : [],
        icd10Codes: Array.isArray(value.icd10_codes) ? value.icd10_codes : [],
        pearls: Array.isArray(value.pearls) ? value.pearls : [],
        confidence:
          value.confidence === "high" ||
          value.confidence === "medium" ||
          value.confidence === "low"
            ? value.confidence
            : null,
        approvalRequired: !!value.approvalRequired,
      });
    }
  }

  return grouped;
}

type IcdEntry = { code: string; label: string };

function extractIcdsFromDiagnoses(diagnoses: string | null | undefined): IcdEntry[] {
  if (!diagnoses) return [];
  const out: IcdEntry[] = [];
  const seen = new Set<string>();
  const lineRe = /([A-TV-Z][0-9][0-9A-Z]{0,2}(?:\.[0-9A-Z]{1,4})?)\s*[-:]?\s*(.*)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(diagnoses)) !== null) {
    const code = m[1].toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: (m[2] ?? "").trim() });
  }
  return out;
}

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
  const initialSeed = useMemo(() => seedFromAdminMetadata(reasoningObject), [reasoningObject]);

  const [assignments, setAssignments] = useState<AncillaryAssignmentMap>(initialSeed.assignments);
  const [notes, setNotes] = useState<AncillaryNoteMap>(initialSeed.notes);
  const [expanded, setExpanded] = useState<Record<AdminReviewAncillaryId, boolean>>({
    brainwave: false,
    vitalwave: false,
    ultrasound: false,
  });
  const [adminNote, setAdminNote] = useState<string>("");
  const [icdSearch, setIcdSearch] = useState("");
  const [manualIcdCode, setManualIcdCode] = useState("");
  const [manualIcdLabel, setManualIcdLabel] = useState("");
  const [pendingIcds, setPendingIcds] = useState<IcdEntry[]>([]);
  const [removedIcds, setRemovedIcds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const seeded = seedFromAdminMetadata(reasoningAsObject(patient.reasoning));
    setAssignments(seeded.assignments);
    setNotes(seeded.notes);
    setAdminNote("");
    setIcdSearch("");
    setManualIcdCode("");
    setManualIcdLabel("");
    setPendingIcds([]);
    setRemovedIcds(new Set());
  }, [open, patient.id, patient.reasoning]);

  const apiEvidence: AdminEvidenceChip[] = evidenceQuery.data?.evidence ?? [];
  const localFallback = useMemo(() => buildLocalEvidenceFallback(patient), [patient]);
  const evidence: AdminEvidenceChip[] = apiEvidence.length > 0 ? apiEvidence : localFallback;
  const evidenceSource: "api" | "local" | "empty" =
    apiEvidence.length > 0
      ? "api"
      : localFallback.length > 0
        ? "local"
        : "empty";

  const candidates: AdminReviewRuleCandidate[] = evidenceQuery.data?.candidates ?? [];
  const candidateById = useMemo(() => {
    const map = new Map<AdminReviewAncillaryId, AdminReviewRuleCandidate>();
    for (const c of candidates) map.set(c.ancillaryId, c);
    return map;
  }, [candidates]);

  const ageNumber: number | null = useMemo(() => {
    if (typeof patient.age === "number") return patient.age;
    return null;
  }, [patient.age]);
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

  // ICDs already attached on patient (parsed from diagnoses), minus user removals.
  const existingIcds = useMemo(() => {
    const parsed = extractIcdsFromDiagnoses(patient.diagnoses);
    return parsed.filter((c) => !removedIcds.has(c.code));
  }, [patient.diagnoses, removedIcds]);

  const allActiveIcds = useMemo(() => {
    const map = new Map<string, IcdEntry>();
    for (const c of existingIcds) map.set(c.code, c);
    for (const c of pendingIcds) if (!map.has(c.code)) map.set(c.code, c);
    return Array.from(map.values());
  }, [existingIcds, pendingIcds]);

  const icdSearchResults = useMemo(() => {
    const q = icdSearch.trim().toLowerCase();
    const all: IcdEntry[] = Object.values(COMMON_ICD_SUGGESTIONS).flat();
    if (!q) return all.slice(0, 6);
    return all
      .filter((s) => s.code.toLowerCase().includes(q) || s.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [icdSearch]);

  function addIcdEntry(entry: IcdEntry) {
    if (!entry.code) return;
    setRemovedIcds((prev) => {
      const next = new Set(prev);
      next.delete(entry.code);
      return next;
    });
    setPendingIcds((prev) => {
      if (prev.some((c) => c.code === entry.code)) return prev;
      const exists = extractIcdsFromDiagnoses(patient.diagnoses).some((c) => c.code === entry.code);
      if (exists) return prev;
      return [...prev, entry];
    });
  }

  function removeIcdEntry(code: string) {
    setPendingIcds((prev) => prev.filter((c) => c.code !== code));
    setRemovedIcds((prev) => {
      const next = new Set(prev);
      next.add(code);
      return next;
    });
  }

  // Compose the diagnoses string that will be sent on regenerate-all so
  // the canonical patient_screenings row gets the same ICDs the dialog shows.
  function composeUpdatedDiagnoses(): string {
    const original = (patient.diagnoses ?? "").trim();
    const lines = original ? original.split(/\r?\n/) : [];
    // Strip lines whose code is in removedIcds.
    const filtered = lines.filter((line) => {
      const m = /^([A-TV-Z][0-9][0-9A-Z]{0,2}(?:\.[0-9A-Z]{1,4})?)/i.exec(line.trim());
      if (!m) return true;
      return !removedIcds.has(m[1].toUpperCase());
    });
    // Append pending new ICDs that aren't already represented.
    for (const c of pendingIcds) {
      const already = filtered.some((line) => line.includes(c.code));
      if (!already) filtered.push(c.label ? `${c.code} - ${c.label}` : c.code);
    }
    return filtered.join("\n");
  }

  function assignEvidence(ancillary: AdminReviewAncillaryId | "all", chip: AdminEvidenceChip) {
    if (chip.requiresIcd) {
      toast({
        title: "ICD required",
        description: `Add an ICD code to "${chip.label}" before assigning.`,
        variant: "destructive",
      });
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      const targets: AdminReviewAncillaryId[] =
        ancillary === "all" ? ["brainwave", "vitalwave", "ultrasound"] : [ancillary];
      for (const id of targets) {
        const existing = next[id] ?? [];
        if (!existing.some((c) => chipKey(c) === chipKey(chip))) {
          next[id] = [...existing, chip];
        }
      }
      return next;
    });
  }

  function unassignEvidence(ancillary: AdminReviewAncillaryId, chip: AdminEvidenceChip) {
    setAssignments((prev) => ({
      ...prev,
      [ancillary]: (prev[ancillary] ?? []).filter((c) => chipKey(c) !== chipKey(chip)),
    }));
  }

  function attachIcdToChip(chip: AdminEvidenceChip, code: string, label: string) {
    const updated: AdminEvidenceChip = {
      ...chip,
      icdCode: code,
      icdLabel: label,
      requiresIcd: false,
      suggestedIcds: [],
      source: chip.source === "AI" ? "Manual" : chip.source,
    };
    addIcdEntry({ code, label });
    queryClient.setQueryData<EvidencePayload>(
      ["admin-review-evidence", patient.id],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          evidence: old.evidence.map((c) => (chipKey(c) === chipKey(chip) ? updated : c)),
        };
      },
    );
  }

  const regenerateAllMutation = useMutation<
    { ok: boolean; patient: PatientScreening },
    Error,
    void
  >({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-review/regenerate-all`,
        {
          assignedEvidenceByAncillary: assignments,
          ancillaryNotes: notes,
          adminNote,
          diagnoses: composeUpdatedDiagnoses(),
          medications: patient.medications ?? "",
          history: patient.history ?? "",
          icdCodes: allActiveIcds,
        },
      );
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Regenerated",
        description: "Canonical reasoning updated for all qualifying tests.",
      });
      if (data.patient) {
        onUpdate("reasoning", (data.patient.reasoning ?? {}) as Record<string, unknown>);
        if (typeof data.patient.diagnoses === "string") {
          onUpdate("diagnoses", data.patient.diagnoses);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", patient.batchId] });
      queryClient.invalidateQueries({ queryKey: ["admin-review-evidence", patient.id] });
      setPendingIcds([]);
      setRemovedIcds(new Set());
    },
    onError: (err) => {
      toast({
        title: "Could not regenerate",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
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

  function toggleExpand(id: AdminReviewAncillaryId) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const totalMissingIcds = evidence.filter((e) => e.requiresIcd).length;

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
                    <Loader2 className="w-3 h-3 animate-spin" /> Evidence refreshing
                  </span>
                )}
                {evidenceQuery.isError && (
                  <span className="text-amber-700 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Evidence unavailable
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
            {/* ─── Column 1 — Clinical Data + ICD ─── */}
            <div className="space-y-4" data-testid="admin-review-left-column">
              <section className="space-y-2" data-testid="admin-review-clinical-data">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Clinical Data
                </div>
                <ClinicalField label="Hx" value={patient.history} />
                <ClinicalField label="Dx" value={patient.diagnoses} />
                <ClinicalField label="Rx" value={patient.medications} />
              </section>

              <section className="space-y-2" data-testid="admin-review-icd-section">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  ICD
                </div>

                <div className="space-y-1.5">
                  <Input
                    type="search"
                    placeholder="Search ICD…"
                    value={icdSearch}
                    onChange={(e) => setIcdSearch(e.target.value)}
                    className="h-8 text-xs"
                    data-testid="admin-review-icd-search"
                  />
                  {icdSearchResults.length > 0 && (
                    <div className="flex flex-col gap-0.5 max-h-40 overflow-auto rounded-md border border-slate-200 bg-white">
                      {icdSearchResults.map((s) => (
                        <button
                          key={s.code}
                          type="button"
                          onClick={() => addIcdEntry(s)}
                          className="text-left text-xs px-2 py-1 hover:bg-slate-100 inline-flex items-center gap-2"
                        >
                          <span className="font-mono text-slate-700">{s.code}</span>
                          <span className="text-slate-500 truncate">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-[80px_minmax(0,1fr)_auto] gap-1.5 items-center">
                  <Input
                    placeholder="CODE"
                    value={manualIcdCode}
                    onChange={(e) => setManualIcdCode(e.target.value.toUpperCase())}
                    className="h-8 text-xs font-mono"
                    data-testid="admin-review-icd-manual-code"
                  />
                  <Input
                    placeholder="Label"
                    value={manualIcdLabel}
                    onChange={(e) => setManualIcdLabel(e.target.value)}
                    className="h-8 text-xs"
                    data-testid="admin-review-icd-manual-label"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (!manualIcdCode.trim()) return;
                      addIcdEntry({ code: manualIcdCode.trim(), label: manualIcdLabel.trim() });
                      setManualIcdCode("");
                      setManualIcdLabel("");
                    }}
                    data-testid="admin-review-icd-add"
                    className="h-8 px-2"
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>

                {allActiveIcds.length === 0 ? (
                  <div className="text-xs text-slate-400 italic">No ICD codes attached.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {allActiveIcds.map((c) => (
                      <span
                        key={c.code}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-2 py-0.5 text-[11px]"
                      >
                        <span className="font-mono">{c.code}</span>
                        <span className="truncate max-w-[140px]">{c.label}</span>
                        <button
                          type="button"
                          onClick={() => removeIcdEntry(c.code)}
                          aria-label={`Remove ICD ${c.code}`}
                          data-testid="admin-review-icd-remove"
                          className="hover:text-rose-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {totalMissingIcds > 0 && (
                  <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {totalMissingIcds} diagnosis ICD needed
                  </div>
                )}
              </section>
            </div>

            {/* ─── Column 2 — Evidence + Ancillary Cards ─── */}
            <div className="space-y-4" data-testid="admin-review-middle-column">
              <section className="space-y-2" data-testid="admin-review-evidence">
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Evidence
                  </div>
                  {evidenceSource === "local" && (
                    <span className="text-[10px] text-slate-400">Local fallback</span>
                  )}
                </div>
                {evidence.length === 0 ? (
                  <div
                    className="text-xs text-slate-400 italic px-3 py-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 text-center"
                    data-testid="admin-review-evidence-empty"
                  >
                    No evidence
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {evidence.map((chip) => (
                      <EvidenceChip
                        key={chipKey(chip)}
                        chip={chip}
                        onAssign={(ancillary) => assignEvidence(ancillary, chip)}
                        onAttachIcd={(code, label) => attachIcdToChip(chip, code, label)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              <section className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Ancillaries
                </div>
                <div className="space-y-2">
                  {ANCILLARIES.map((row) => {
                    const candidate = candidateById.get(row.id);
                    const assigned = assignments[row.id] ?? [];
                    const note = notes[row.id] ?? "";
                    const canonicalCards = canonicalReasoningByAncillary[row.id] ?? [];
                    const isOpen = expanded[row.id];
                    const candidateMissingIcds = candidate?.missing.length ?? 0;
                    const candidateStatusLabel = candidate
                      ? candidate.status === "suggested"
                        ? "Suggested"
                        : candidate.status === "needs_info"
                          ? "Needs Info"
                          : "Admin approval required"
                      : isUnder16
                        ? "Admin approval required"
                        : canonicalCards.length > 0
                          ? "Generated"
                          : "Needs Info";
                    return (
                      <div
                        key={row.id}
                        className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
                        data-testid="admin-review-ancillary-card"
                        data-ancillary={row.id}
                      >
                        <button
                          type="button"
                          onClick={() => toggleExpand(row.id)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                          data-testid={`admin-review-ancillary-toggle-${row.id}`}
                          aria-expanded={isOpen}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {isOpen ? (
                              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                            )}
                            <span className="font-semibold text-slate-900">{row.label}</span>
                            <span className="text-[11px] text-slate-500">
                              {candidateStatusLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-600">
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5">
                              {canonicalCards.length} test{canonicalCards.length === 1 ? "" : "s"}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5">
                              {assigned.length} evidence
                            </span>
                            {candidateMissingIcds > 0 && (
                              <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5">
                                {candidateMissingIcds} ICD needed
                              </span>
                            )}
                            {isUnder16 && (
                              <span className="inline-flex items-center rounded-full bg-rose-50 text-rose-800 border border-rose-300 px-2 py-0.5 font-semibold">
                                &lt;16
                              </span>
                            )}
                          </div>
                        </button>

                        {isOpen && (
                          <div
                            className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100"
                            data-testid="admin-review-ancillary-expanded"
                          >
                            {isUnder16 && (
                              <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                                Patient is under 16. Not routine — requires admin override approval.
                              </div>
                            )}

                            {/* Canonical reasoning per qualifying test, sourced from patient.reasoning[testName]. */}
                            {canonicalCards.length === 0 ? (
                              <div className="text-xs text-slate-400 italic">
                                No qualifying tests in this ancillary yet.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {canonicalCards.map((card) => (
                                  <CanonicalReasoningCardView key={card.testName} card={card} />
                                ))}
                              </div>
                            )}

                            <div className="space-y-1">
                              <Label className="text-[11px] uppercase tracking-wider text-slate-500">
                                Assigned Evidence
                              </Label>
                              {assigned.length === 0 ? (
                                <div className="text-xs text-slate-400">No evidence assigned yet.</div>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {assigned.map((chip) => (
                                    <span
                                      key={chipKey(chip)}
                                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${SOURCE_TONE[chip.source] ?? "bg-slate-50 text-slate-700 border-slate-200"}`}
                                    >
                                      {chip.label}
                                      {chip.icdCode ? ` · ${chip.icdCode}` : ""}
                                      <button
                                        type="button"
                                        onClick={() => unassignEvidence(row.id, chip)}
                                        className="hover:text-rose-600"
                                        aria-label={`Remove ${chip.label}`}
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="space-y-1">
                              <Label
                                htmlFor={`admin-review-note-${row.id}`}
                                className="text-[11px] uppercase tracking-wider text-slate-500"
                              >
                                Notes
                              </Label>
                              <Textarea
                                id={`admin-review-note-${row.id}`}
                                value={note}
                                rows={2}
                                onChange={(e) =>
                                  setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                                }
                                data-testid={`admin-review-note-${row.id}`}
                              />
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                              <PatientPdfActions
                                patient={patient}
                                facility={facility ?? patient.facility ?? null}
                                scheduleDate={scheduleDate ?? null}
                                compact
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* ─── Column 3 — Approval / Blocking Rules / PDFs / Admin Note / Regenerate ─── */}
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
                    {totalMissingIcds} diagnosis ICD needed
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
                <Button
                  type="button"
                  disabled={regenerateAllMutation.isPending}
                  onClick={() => regenerateAllMutation.mutate()}
                  data-testid="admin-review-global-regenerate"
                  className="w-full"
                  variant="outline"
                >
                  {regenerateAllMutation.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3 mr-1" />
                  )}
                  Regenerate
                </Button>
                <div className="text-[10px] text-slate-500">
                  Updates clinician reasoning, patient explanations, ICDs, qualifying factors, and pearls for every qualifying test. PDFs use the same source.
                </div>
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

function ClinicalField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-xs text-slate-800 whitespace-pre-wrap min-h-[2rem]">
        {value?.trim() ? value : <span className="italic text-slate-400">Empty</span>}
      </div>
    </div>
  );
}

function CanonicalReasoningCardView({ card }: { card: CanonicalReasoningCard }) {
  const hasClinician = !!card.clinicianReasoning.trim();
  const hasPatient = !!card.patientExplanation.trim();
  const hasFactors = card.qualifyingFactors.length > 0;
  const hasIcds = card.icd10Codes.length > 0;
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

      {hasIcds && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            ICD-10 Codes
          </div>
          <div className="flex flex-wrap gap-1">
            {card.icd10Codes.map((c, i) => (
              <span
                key={`${card.testName}-icd-${i}`}
                className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-2 py-0.5 text-[10px] font-mono"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

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

function EvidenceChip({
  chip,
  onAssign,
  onAttachIcd,
}: {
  chip: AdminEvidenceChip;
  onAssign: (ancillary: AdminReviewAncillaryId | "all") => void;
  onAttachIcd: (code: string, label: string) => void;
}) {
  const tone = SOURCE_TONE[chip.source] ?? "bg-slate-50 text-slate-700 border-slate-200";
  if (chip.requiresIcd) {
    const suggestions =
      chip.suggestedIcds && chip.suggestedIcds.length > 0
        ? chip.suggestedIcds
        : COMMON_ICD_SUGGESTIONS["diabetes"];
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${tone} hover:bg-amber-100`}
            data-testid="admin-review-evidence-chip"
            data-icd-needed="true"
          >
            <span>{chip.label}</span>
            <span
              className="text-amber-800 font-semibold"
              data-testid="admin-review-icd-needed"
            >
              · ICD needed
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-1 py-1">
            Suggested ICDs
          </div>
          <div className="flex flex-col gap-1">
            {suggestions?.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => onAttachIcd(s.code, s.label)}
                className="text-left text-xs rounded-md px-2 py-1 hover:bg-slate-100 inline-flex items-center gap-2"
                data-testid="admin-review-icd-suggestion"
              >
                <span className="font-mono text-slate-700">{s.code}</span>
                <span className="text-slate-500 truncate">{s.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${tone} hover:opacity-90`}
          data-testid="admin-review-evidence-chip"
        >
          <span className="font-mono opacity-60">{chip.source}</span>
          <span>{chip.label}</span>
          {chip.icdCode && <span className="font-mono opacity-70">· {chip.icdCode}</span>}
          <Plus className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" data-testid="admin-review-assign-evidence">
        <button
          type="button"
          onClick={() => onAssign("brainwave")}
          className="w-full text-left text-xs rounded-md px-2 py-1 hover:bg-slate-100"
        >
          Assign to BrainWave
        </button>
        <button
          type="button"
          onClick={() => onAssign("vitalwave")}
          className="w-full text-left text-xs rounded-md px-2 py-1 hover:bg-slate-100"
        >
          Assign to VitalWave
        </button>
        <button
          type="button"
          onClick={() => onAssign("ultrasound")}
          className="w-full text-left text-xs rounded-md px-2 py-1 hover:bg-slate-100"
        >
          Assign to Ultrasound Studies
        </button>
        <Separator className="my-1" />
        <button
          type="button"
          onClick={() => onAssign("all")}
          className="w-full text-left text-xs rounded-md px-2 py-1 hover:bg-slate-100 font-semibold"
        >
          Assign to all
        </button>
      </PopoverContent>
    </Popover>
  );
}
