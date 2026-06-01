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

const ANCILLARIES: AdminReviewAncillaryId[] = ["brainwave", "vitalwave", "ultrasound"];

// Literal per-ancillary regenerate testIds. Keeping them as literals (not
// template-built) so QA `requireText` finds them in source.
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
  for (const id of ANCILLARIES) {
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
    push({
      id: localStableId(["symptom", "pvd"]),
      kind: "symptom",
      label: "Peripheral vascular disease concern",
      source: "Hx",
      requiresIcd: false,
      confidence: "medium",
    });
  }
  if (matches(["edema", "swelling"])) {
    push({
      id: localStableId(["symptom", "edema"]),
      kind: "symptom",
      label: "Lower extremity edema",
      source: "Hx",
      requiresIcd: false,
      confidence: "medium",
    });
  }
  if (matches(["dizziness", "syncope", "bruit"])) {
    push({
      id: localStableId(["symptom", "dizziness"]),
      kind: "symptom",
      label: "Dizziness",
      source: "Hx",
      requiresIcd: false,
      confidence: "medium",
    });
  }
  if (matches(["dyspnea", "shortness of breath", "sob"])) {
    push({
      id: localStableId(["symptom", "dyspnea"]),
      kind: "symptom",
      label: "Dyspnea",
      source: "Hx",
      requiresIcd: false,
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
    ["Aspirin", ["aspirin"]],
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
    if (value == null) {
      grouped[category].push({
        testName: test,
        clinicianReasoning: "",
        patientExplanation: "",
        qualifyingFactors: [],
        icd10Codes: [],
        pearls: [],
        confidence: null,
        approvalRequired: false,
      });
      continue;
    }
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

type IcdSearchResult = {
  code: string;
  label: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
};

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

  // ICD search (AI-backed)
  const [icdSearchQuery, setIcdSearchQuery] = useState("");
  const [manualIcdCode, setManualIcdCode] = useState("");
  const [manualIcdLabel, setManualIcdLabel] = useState("");
  const [pendingIcds, setPendingIcds] = useState<IcdEntry[]>([]);
  const [removedIcds, setRemovedIcds] = useState<Set<string>>(new Set());

  const icdSearchMutation = useMutation<
    { ok: boolean; results: IcdSearchResult[] },
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

  const [regenInFlight, setRegenInFlight] = useState<Record<AdminReviewAncillaryId, boolean>>({
    brainwave: false,
    vitalwave: false,
    ultrasound: false,
  });

  useEffect(() => {
    if (!open) return;
    const seeded = seedFromAdminMetadata(reasoningAsObject(patient.reasoning));
    setAssignments(seeded.assignments);
    setNotes(seeded.notes);
    setAdminNote("");
    setIcdSearchQuery("");
    setManualIcdCode("");
    setManualIcdLabel("");
    setPendingIcds([]);
    setRemovedIcds(new Set());
  }, [open, patient.id, patient.reasoning]);

  const apiEvidence: AdminEvidenceChip[] = evidenceQuery.data?.evidence ?? [];
  const localFallback = useMemo(() => buildLocalEvidenceFallback(patient), [patient]);
  const evidence: AdminEvidenceChip[] = apiEvidence.length > 0 ? apiEvidence : localFallback;
  const evidenceSource: "api" | "local" | "empty" =
    apiEvidence.length > 0 ? "api" : localFallback.length > 0 ? "local" : "empty";

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

  // Group supporting items in the library by kind.
  const evidenceByKind = useMemo(() => {
    const map = {
      diagnoses: [] as AdminEvidenceChip[],
      medications: [] as AdminEvidenceChip[],
      symptoms: [] as AdminEvidenceChip[],
      priorTests: [] as AdminEvidenceChip[],
    };
    for (const e of evidence) {
      if (e.kind === "diagnosis" || e.kind === "icd") map.diagnoses.push(e);
      else if (e.kind === "medication") map.medications.push(e);
      else if (e.kind === "prior_test") map.priorTests.push(e);
      else if (e.kind === "symptom" || e.kind === "risk_factor") map.symptoms.push(e);
      else map.symptoms.push(e);
    }
    return map;
  }, [evidence]);

  // For each ancillary, which evidence chips are assigned.
  function assignedNames(ancillary: AdminReviewAncillaryId): string[] {
    return (assignments[ancillary] ?? []).map((c) =>
      c.icdCode ? `${c.icdCode} · ${c.label}` : c.label,
    );
  }

  // Resolve display names for the services in this ancillary, sourced from the
  // canonical reasoning grouping (one entry per qualifying test name).
  function serviceNames(ancillary: AdminReviewAncillaryId): string[] {
    return canonicalReasoningByAncillary[ancillary].map((c) => c.testName);
  }

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

  // ICD search result → blue ICD-disease button via local pending list.
  function adoptIcdSearchResult(r: IcdSearchResult) {
    addIcdEntry({ code: r.code, label: r.label });
  }

  function composeUpdatedDiagnoses(): string {
    const original = (patient.diagnoses ?? "").trim();
    const lines = original ? original.split(/\r?\n/) : [];
    const filtered = lines.filter((line) => {
      const m = /^([A-TV-Z][0-9][0-9A-Z]{0,2}(?:\.[0-9A-Z]{1,4})?)/i.exec(line.trim());
      if (!m) return true;
      return !removedIcds.has(m[1].toUpperCase());
    });
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
        description: `Add an ICD code for "${chip.label}" before assigning.`,
        variant: "destructive",
      });
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      const targets: AdminReviewAncillaryId[] =
        ancillary === "all" ? ANCILLARIES : [ancillary];
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

  // Build an IcdEntry from a chip so attaching an ICD via popover also feeds the left-column ICD list.
  function attachIcdToChip(chip: AdminEvidenceChip, code: string, label: string) {
    addIcdEntry({ code, label });
    const updated: AdminEvidenceChip = {
      ...chip,
      icdCode: code,
      icdLabel: label,
      requiresIcd: false,
      suggestedIcds: [],
      source: chip.source === "AI" ? "Manual" : chip.source,
    };
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

  const regenerateAncillaryMutation = useMutation<
    { ok: boolean; patient: PatientScreening; ancillaryId: AdminReviewAncillaryId },
    Error,
    { ancillary: AdminReviewAncillaryId }
  >({
    mutationFn: async ({ ancillary }) => {
      setRegenInFlight((prev) => ({ ...prev, [ancillary]: true }));
      const res = await apiRequest(
        "POST",
        `/api/patient-screenings/${patient.id}/admin-review/regenerate-ancillary`,
        {
          ancillaryId: ancillary,
          assignedEvidence: assignments[ancillary] ?? [],
          ancillaryNote: notes[ancillary] ?? "",
          adminNote,
          diagnoses: composeUpdatedDiagnoses(),
          medications: patient.medications ?? "",
          history: patient.history ?? "",
          icdCodes: allActiveIcds,
        },
      );
      return res.json();
    },
    onSuccess: (data, vars) => {
      toast({
        title: `Regenerated ${categoryLabels[vars.ancillary]}`,
        description: "Canonical reasoning updated for this ancillary.",
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
    onError: (err, vars) => {
      toast({
        title: `Could not regenerate ${categoryLabels[vars.ancillary]}`,
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
    onSettled: (_data, _err, vars) => {
      setRegenInFlight((prev) => ({ ...prev, [vars.ancillary]: false }));
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
                    <Loader2 className="w-3 h-3 animate-spin" /> Refreshing
                  </span>
                )}
                {evidenceQuery.isError && (
                  <span className="text-amber-700 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Library unavailable
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
            {/* ─── Column 1 — Supporting Item Library + Add ICD ─── */}
            <div className="space-y-4" data-testid="admin-review-left-column">
              <section className="space-y-3" data-testid="admin-review-evidence-library">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Supporting Item Library
                </div>

                <LibrarySection
                  title="Diagnoses / ICD"
                  testId="admin-review-evidence-library-dx"
                  emptyText="No diagnoses extracted"
                >
                  {evidenceByKind.diagnoses.map((chip) => (
                    <IcdDiseaseButton
                      key={chipKey(chip)}
                      chip={chip}
                      onAssign={(ancillary) => assignEvidence(ancillary, chip)}
                      onAttachIcd={(code, label) => attachIcdToChip(chip, code, label)}
                    />
                  ))}
                </LibrarySection>

                <LibrarySection
                  title="Medications"
                  testId="admin-review-evidence-library-meds"
                  emptyText="No medications detected"
                >
                  {evidenceByKind.medications.map((chip) => (
                    <SupportingButton
                      key={chipKey(chip)}
                      chip={chip}
                      tone="purple"
                      testId="admin-review-med-button"
                      onAssign={(ancillary) => assignEvidence(ancillary, chip)}
                    />
                  ))}
                </LibrarySection>

                <LibrarySection
                  title="Symptoms / History"
                  testId="admin-review-evidence-library-hx"
                  emptyText="No symptoms recorded"
                >
                  {evidenceByKind.symptoms.map((chip) => (
                    <SupportingButton
                      key={chipKey(chip)}
                      chip={chip}
                      tone="amber"
                      testId="admin-review-hx-button"
                      onAssign={(ancillary) => assignEvidence(ancillary, chip)}
                    />
                  ))}
                </LibrarySection>

                <LibrarySection
                  title="Prior Testing"
                  testId="admin-review-evidence-library-prior"
                  emptyText="No prior testing on file"
                >
                  {evidenceByKind.priorTests.map((chip) => (
                    <SupportingButton
                      key={chipKey(chip)}
                      chip={chip}
                      tone="teal"
                      testId="admin-review-prior-button"
                      onAssign={(ancillary) => assignEvidence(ancillary, chip)}
                    />
                  ))}
                </LibrarySection>

                {evidenceSource === "local" && (
                  <div className="text-[10px] text-slate-400">
                    Library showing local fallback items.
                  </div>
                )}
              </section>

              <Separator />

              <section className="space-y-2" data-testid="admin-review-add-icd-section">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Add ICD
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                  <Input
                    type="search"
                    placeholder="Search ICD by diagnosis..."
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

                {allActiveIcds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {allActiveIcds.map((c) => (
                      <span
                        key={c.code}
                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 text-blue-800 px-2 py-0.5 text-[11px]"
                        data-testid="admin-review-icd-disease-assigned"
                      >
                        <span className="font-mono">{c.code}</span>
                        {c.label && <span className="truncate max-w-[120px]">· {c.label}</span>}
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
              </section>
            </div>

            {/* ─── Column 2 — BrainWave / VitalWave / Ultrasound colored panels ─── */}
            <div className="space-y-3" data-testid="admin-review-middle-column">
              {ANCILLARIES.map((id) => {
                const style = categoryStyles[id];
                const Icon = categoryIcons[id];
                const candidate = candidateById.get(id);
                const services = serviceNames(id);
                const supporting = assignedNames(id);
                const note = notes[id] ?? "";
                const cards = canonicalReasoningByAncillary[id] ?? [];
                const isOpen = expanded[id];
                const candidateStatusLabel = candidate
                  ? candidate.status === "suggested"
                    ? "Suggested"
                    : candidate.status === "needs_info"
                      ? "Needs Info"
                      : "Admin approval required"
                  : isUnder16
                    ? "Admin approval required"
                    : cards.length > 0
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
                              <span className="text-[11px] text-slate-700/80">
                                {candidateStatusLabel}
                              </span>
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
                              <div
                                className="flex items-baseline gap-1 mt-0.5"
                                data-testid="admin-review-ancillary-header-supporting-items"
                              >
                                <span className="font-semibold text-slate-600">Supporting:</span>
                                <span
                                  className="truncate"
                                  data-testid="admin-review-ancillary-supporting-list"
                                >
                                  {supporting.length > 0 ? supporting.join(", ") : "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={regenInFlight[id]}
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

                        {/* Assigned supporting chips inline (also visible in header text) */}
                        {(assignments[id] ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {(assignments[id] ?? []).map((chip) => (
                              <span
                                key={chipKey(chip)}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                                data-testid="admin-review-ancillary-header-chip"
                              >
                                {chip.icdCode ? `${chip.icdCode} · ` : ""}{chip.label}
                                <button
                                  type="button"
                                  onClick={() => unassignEvidence(id, chip)}
                                  aria-label={`Remove ${chip.label}`}
                                  data-testid="admin-review-unassign-supporting-item"
                                  className="hover:text-rose-600"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        {cards.length === 0 ? (
                          <div className="text-xs text-slate-500 italic">
                            No services under {categoryLabels[id]} yet.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {cards.map((card) => (
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
                              setNotes((prev) => ({ ...prev, [id]: e.target.value }))
                            }
                            data-testid={`admin-review-note-${id}`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ─── Column 3 — PDFs / Blocking Rules / Admin Note / Approval ─── */}
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

function LibrarySection({
  title,
  testId,
  emptyText,
  children,
}: {
  title: string;
  testId: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const hasContent = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      {hasContent ? (
        <div className="flex flex-wrap gap-1.5">{children}</div>
      ) : (
        <div className="text-[11px] text-slate-400 italic">{emptyText}</div>
      )}
    </div>
  );
}

function IcdDiseaseButton({
  chip,
  onAssign,
  onAttachIcd,
}: {
  chip: AdminEvidenceChip;
  onAssign: (ancillary: AdminReviewAncillaryId | "all") => void;
  onAttachIcd: (code: string, label: string) => void;
}) {
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
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-800 px-2.5 py-0.5 text-[11px] hover:bg-blue-100"
            data-testid="admin-review-icd-disease-button"
          >
            <span className="font-semibold" data-testid="admin-review-icd-disease-needed">
              ICD needed
            </span>
            <span>· {chip.label}</span>
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
          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-800 px-2.5 py-0.5 text-[11px] hover:bg-blue-100"
          data-testid="admin-review-icd-disease-button"
        >
          {chip.icdCode && <span className="font-mono opacity-80">{chip.icdCode}</span>}
          <span>· {chip.label}</span>
          <Plus className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <AssignPopoverContent onAssign={onAssign} />
    </Popover>
  );
}

function SupportingButton({
  chip,
  tone,
  testId,
  onAssign,
}: {
  chip: AdminEvidenceChip;
  tone: "purple" | "amber" | "teal";
  testId: string;
  onAssign: (ancillary: AdminReviewAncillaryId | "all") => void;
}) {
  const toneClass =
    tone === "purple"
      ? "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100"
      : tone === "amber"
        ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
        : "bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100";
  const prefix =
    chip.kind === "medication"
      ? "Med"
      : chip.kind === "prior_test"
        ? "Prior"
        : "Hx";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${toneClass}`}
          data-testid={testId}
        >
          <span className="font-mono opacity-70">{prefix}</span>
          <span>{chip.label}</span>
          <Plus className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <AssignPopoverContent onAssign={onAssign} />
    </Popover>
  );
}

function AssignPopoverContent({
  onAssign,
}: {
  onAssign: (ancillary: AdminReviewAncillaryId | "all") => void;
}) {
  return (
    <PopoverContent className="w-52 p-1" data-testid="admin-review-assign-evidence">
      <button
        type="button"
        onClick={() => onAssign("brainwave")}
        data-testid="admin-review-assign-brainwave"
        className="w-full text-left text-xs rounded-md px-2 py-1 hover:bg-violet-50 text-violet-800"
      >
        Assign to BrainWave
      </button>
      <button
        type="button"
        onClick={() => onAssign("vitalwave")}
        data-testid="admin-review-assign-vitalwave"
        className="w-full text-left text-xs rounded-md px-2 py-1 hover:bg-red-50 text-red-800"
      >
        Assign to VitalWave
      </button>
      <button
        type="button"
        onClick={() => onAssign("ultrasound")}
        data-testid="admin-review-assign-ultrasound"
        className="w-full text-left text-xs rounded-md px-2 py-1 hover:bg-emerald-50 text-emerald-800"
      >
        Assign to Ultrasound Studies
      </button>
      <Separator className="my-1" />
      <button
        type="button"
        onClick={() => onAssign("all")}
        data-testid="admin-review-assign-all"
        className="w-full text-left text-xs rounded-md px-2 py-1 hover:bg-slate-100 font-semibold"
      >
        Assign to all
      </button>
    </PopoverContent>
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
