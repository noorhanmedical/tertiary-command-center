// AI Logic layer for Admin Review (Task: Plexus IQ knowledge-tile prototype).
//
// Three pieces, all layered ON TOP of the existing Admin Review workflow
// without changing assignment/regenerate/approval behavior:
//
//   1. <AdminReviewAiLogicDrawer/> — "AI Logic for This Patient" popup
//      opened from a subtle Sparkles icon in the dialog header. Prefills
//      from the live patient context and writes learning items / draft
//      rules into the localStorage-backed Clinical Intelligence store.
//   2. <AiEvidenceBubblesRow/> — compact review bubbles for AI-identified
//      symptoms / findings / medication clues with an action popover
//      (approve/reject evidence, attach to ancillary, create rule, save
//      as AI logic). Attach actions delegate to the dialog's existing
//      assignToTarget so the right-panel assignment state stays the
//      single source of truth.
//   3. <AiLogicSavePrompt/> — subtle optional "save as future AI logic?"
//      prompt shown after the admin approves/changes a clinical item.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  Check,
  ChevronRight,
  FlaskConical,
  GitBranch,
  Lightbulb,
  Send,
  Sparkles,
  ThumbsDown,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  CI_ANCILLARY_LABELS,
  CI_DOWNSTREAM_LANGUAGE,
  CI_OUTPUT_LABELS,
  CI_SCOPE_LABELS,
  type CiAncillaryTarget,
  type CiConfidence,
  type CiOutputArea,
  type CiRuleScope,
  type CiSourceType,
} from "@/lib/clinicalIntelligence/types";
import {
  ciAddLearningItem,
  ciAddRule,
  ciConvertLearningToRule,
  ciMarkEvidenceUsedInRule,
  ciRecordEvidence,
  useClinicalIntelligence,
} from "@/lib/clinicalIntelligence/store";

// ───── Shared shapes ────────────────────────────────────────────────────

// Structural subset of the dialog's internal AssignmentTarget so attach
// callbacks type-check against the existing assignToTarget.
export type AiAttachTarget =
  | { type: "ancillary"; ancillaryId: "brainwave" | "vitalwave" }
  | { type: "ultrasound-parent" }
  | { type: "ultrasound-test"; testName: string };

export type AiEvidenceItem = {
  id: string;
  label: string;
  source: string; // "Dx" | "Rx" | "Hx" | "Prior Test" | ...
  kind: string;
  sourceText?: string | null;
  icdCode?: string | null;
  requiresIcd?: boolean;
  confidence?: CiConfidence;
};

export type AiLogicPatientContext = {
  patientId: number | null;
  patientName: string;
  facility?: string | null;
  scheduleDate?: string | null;
  hx?: string | null;
  dx?: string | null;
  rx?: string | null;
  qualifyingTests: string[];
  assignmentsSummary: string[];
  evidenceLabels: string[];
  adminNotes?: string | null;
  approvalState?: string | null;
  updatesCount: number;
};

function normalizeSourceType(source: string): CiSourceType {
  const upper = source.toUpperCase();
  if (upper === "DX") return "DX";
  if (upper === "RX") return "RX";
  if (upper === "HX") return "HX";
  if (source === "Prior Test") return "Prior Test";
  if (source === "AI ICD Search") return "AI ICD Search";
  if (source === "Rule Engine") return "Rule Engine";
  return "HX";
}

export const SOURCE_BADGE_TONE: Record<string, string> = {
  DX: "bg-sky-100 text-sky-800 border-sky-200",
  RX: "bg-indigo-100 text-indigo-800 border-indigo-200",
  HX: "bg-amber-100 text-amber-800 border-amber-200",
};

export const CONF_DOT: Record<CiConfidence, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-rose-500",
};

// Persisted evidence decision (if any) for a chip/bubble, keyed the same
// way ciRecordEvidence dedupes: patient + label + normalized source type.
export function useCiChipDecision(
  context: AiLogicPatientContext | null | undefined,
  label: string,
  source: string,
): "approved" | "rejected" | undefined {
  const ci = useClinicalIntelligence();
  return useMemo(() => {
    if (!context) return undefined;
    const sourceType = normalizeSourceType(source);
    const rec = ci.evidence.find(
      (e) =>
        e.patientId === context.patientId &&
        e.sourceType === sourceType &&
        e.label.toLowerCase() === label.toLowerCase(),
    );
    return rec?.status;
  }, [ci.evidence, context, label, source]);
}

// Extra evidence actions appended to the existing HX/DX/RX chip assign
// popovers (spec: approve evidence / create rule / save as AI logic on the
// chips themselves, without duplicating them or changing assignment
// behavior). Downstream documentation use is automatic on approval — the
// admin never picks clinician vs patient reasoning manually.
export function ChipEvidenceMenuExtras({
  context,
  label,
  source,
  sourceText,
  confidence,
  assignedAncillary,
  testIdSuffix,
}: {
  context: AiLogicPatientContext;
  label: string;
  source: string;
  sourceText?: string | null;
  confidence?: CiConfidence;
  assignedAncillary?: string | null;
  testIdSuffix: string;
}) {
  const { toast } = useToast();
  const decision = useCiChipDecision(context, label, source);

  const baseRecord = () => ({
    patientId: context.patientId,
    patientName: context.patientName,
    facility: context.facility ?? null,
    scheduleDate: context.scheduleDate ?? null,
    sourceType: normalizeSourceType(source),
    sourceText: sourceText ?? label,
    label,
    confidence: confidence ?? ("medium" as CiConfidence),
    assignedAncillary: assignedAncillary ?? null,
    decidedBy: "Admin",
  });

  const approve = () => {
    ciRecordEvidence({ ...baseRecord(), status: "approved" });
    toast({ title: "Evidence approved", description: CI_DOWNSTREAM_LANGUAGE });
  };

  const createRule = async () => {
    const rule = await ciAddRule({
      name: `Evidence rule: ${label}`,
      description: `IF ${source} includes "${label}" THEN surface it as supporting evidence for admin review and use approved source-linked evidence in downstream documentation.`,
      triggerSource: source,
      triggerCondition: `${source}: ${label}`,
      targetAncillary: "general_documentation",
      targetOutputs: ["evidence_traceability", "audit_support"],
      scope: "clinic_draft",
      approvalRequirement: "Admin Review before finalization",
      status: "draft",
      conflictFlags: [],
      sourceEvidence: [label],
      createdBy: "Admin",
    });
    const ev = await ciRecordEvidence({ ...baseRecord(), status: "approved" });
    await ciMarkEvidenceUsedInRule(ev.id, rule.id);
    toast({ title: "Draft rule created", description: "Review it in the Rule Library." });
  };

  const saveAsLogic = () => {
    ciAddLearningItem({
      instruction: `Treat "${label}" (${source}) as supporting clinical evidence.`,
      triggerSource: source,
      scope: "patient_only",
      affectedAncillary: "general_documentation",
      affectedOutputs: ["evidence_traceability", "audit_support"],
      status: "draft",
      sourcePatientId: context.patientId,
      sourcePatientName: context.patientName,
      sourceFacility: context.facility ?? null,
      sourceDate: context.scheduleDate ?? null,
      sourceContext: { evidenceLabels: [label] },
      createdBy: "Admin",
    });
    toast({ title: "Saved as AI logic", description: "Draft added to the AI Learning Center." });
  };

  return (
    <div className="mt-1 border-t border-slate-100 pt-1">
      <button
        type="button"
        onClick={approve}
        disabled={decision === "approved"}
        className="w-full flex items-center gap-2 rounded px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        data-testid={`chip-evidence-approve-${testIdSuffix}`}
      >
        <Check className="w-3 h-3" />
        {decision === "approved" ? "Evidence approved" : "Approve evidence"}
      </button>
      <button
        type="button"
        onClick={createRule}
        className="w-full flex items-center gap-2 rounded px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
        data-testid={`chip-evidence-create-rule-${testIdSuffix}`}
      >
        <GitBranch className="w-3 h-3" /> Create rule from this item
      </button>
      <button
        type="button"
        onClick={saveAsLogic}
        className="w-full flex items-center gap-2 rounded px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-50"
        data-testid={`chip-evidence-save-logic-${testIdSuffix}`}
      >
        <Sparkles className="w-3 h-3" /> Save as AI logic
      </button>
      <p className="mt-1 px-2 text-[9px] leading-snug text-violet-700/70">
        {CI_DOWNSTREAM_LANGUAGE}
      </p>
    </div>
  );
}

// ───── 1) AI Logic drawer ───────────────────────────────────────────────

const TRIGGER_SOURCES = [
  "HX",
  "DX",
  "RX",
  "Prior Test",
  "Rule Engine",
  "AI ICD Search",
  "Admin observation",
  "Future EMR Note",
  "Future Lab",
  "Future Imaging",
] as const;

const OUTPUT_AREAS: CiOutputArea[] = [
  "diagnosis_mapping",
  "ancillary_assignment",
  "medical_necessity",
  "order_note",
  "audit_support",
  "evidence_traceability",
];

export function AdminReviewAiLogicDrawer({
  open,
  onOpenChange,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: AiLogicPatientContext;
}) {
  const { toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [triggerSource, setTriggerSource] = useState<string>("HX");
  const [scope, setScope] = useState<CiRuleScope>("patient_only");
  const [ancillary, setAncillary] = useState<CiAncillaryTarget>("general_documentation");
  const [outputs, setOutputs] = useState<CiOutputArea[]>(["medical_necessity"]);
  const [evidenceReq, setEvidenceReq] = useState("At least one source-linked HX/DX/RX item");
  const [approvalReq, setApprovalReq] = useState("Admin Review before finalization");
  const [status, setStatus] = useState<"draft" | "pending_review">("draft");

  useEffect(() => {
    if (open) {
      setInstruction("");
      setRuleName("");
    }
  }, [open, context.patientId]);

  const toggleOutput = (o: CiOutputArea) =>
    setOutputs((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));

  const buildItem = (
    overrides: Partial<Parameters<typeof ciAddLearningItem>[0]> = {},
  ): Parameters<typeof ciAddLearningItem>[0] => ({
    instruction: instruction.trim(),
    ruleName: ruleName.trim() || undefined,
    triggerSource,
    scope,
    affectedAncillary: ancillary,
    affectedOutputs: outputs,
    evidenceRequirement: evidenceReq.trim() || undefined,
    approvalRequirement: approvalReq.trim() || undefined,
    status,
    sourcePatientId: context.patientId,
    sourcePatientName: context.patientName,
    sourceFacility: context.facility ?? null,
    sourceDate: context.scheduleDate ?? null,
    sourceContext: {
      hx: context.hx ?? null,
      dx: context.dx ?? null,
      rx: context.rx ?? null,
      qualifyingTests: context.qualifyingTests,
      evidenceLabels: context.evidenceLabels,
      adminNotes: context.adminNotes ?? null,
      approvalState: context.approvalState ?? null,
    },
    createdBy: "Admin",
    ...overrides,
  });

  const requireInstruction = (): boolean => {
    if (instruction.trim()) return true;
    toast({
      title: "Add an instruction first",
      description: "Describe what the AI should learn from this patient.",
      variant: "destructive",
    });
    return false;
  };

  const saveAsAiLogic = () => {
    if (!requireInstruction()) return;
    ciAddLearningItem(buildItem());
    toast({
      title: "Saved as AI logic",
      description: "The learning item is in the AI Learning Center awaiting review.",
    });
    onOpenChange(false);
  };

  const applyPatientOnly = () => {
    if (!requireInstruction()) return;
    ciAddLearningItem(buildItem({ scope: "patient_only", status: "approved" }));
    toast({
      title: "Applied to this patient only",
      description: "Logic recorded for this patient. No broader rule was created.",
    });
    onOpenChange(false);
  };

  const sendToKnowledgeTile = () => {
    if (!requireInstruction()) return;
    ciAddLearningItem(buildItem({ status: "pending_review" }));
    toast({
      title: "Sent to Knowledge Tile",
      description: "Find it under Clinical Intelligence & Governance → AI Learning Center.",
    });
    onOpenChange(false);
  };

  const createRule = async () => {
    if (!requireInstruction()) return;
    const item = await ciAddLearningItem(buildItem());
    const rule = await ciConvertLearningToRule(item.id, "Admin");
    toast({
      title: rule ? "Draft rule created" : "Saved as AI logic",
      description: rule
        ? `"${rule.name}" is a draft in the Rule Library pending review.`
        : "Learning item saved.",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0"
        data-testid="dialog-ai-logic"
      >
        <DialogHeader className="px-5 py-3 border-b bg-gradient-to-r from-violet-50 to-indigo-50">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-violet-600" />
            AI Logic for This Patient
          </DialogTitle>
          <DialogDescription className="text-xs">
            Teach the AI from {context.patientName}
            {context.facility ? ` · ${context.facility}` : ""}
            {context.scheduleDate ? ` · ${context.scheduleDate}` : ""}. Nothing changes
            engine behavior until it is reviewed and approved.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4 space-y-4">
            {/* Patient context snapshot */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5 text-[11px] text-slate-600">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Current patient context
              </div>
              {context.dx && (
                <div className="line-clamp-2">
                  <span className="font-semibold text-sky-700">DX:</span> {context.dx}
                </div>
              )}
              {context.rx && (
                <div className="line-clamp-2">
                  <span className="font-semibold text-indigo-700">RX:</span> {context.rx}
                </div>
              )}
              {context.hx && (
                <div className="line-clamp-2">
                  <span className="font-semibold text-amber-700">HX:</span> {context.hx}
                </div>
              )}
              {context.qualifyingTests.length > 0 && (
                <div className="line-clamp-2">
                  <span className="font-semibold text-slate-700">Qualifying:</span>{" "}
                  {context.qualifyingTests.join(", ")}
                </div>
              )}
              {context.assignmentsSummary.length > 0 && (
                <div className="line-clamp-2">
                  <span className="font-semibold text-slate-700">Assignments:</span>{" "}
                  {context.assignmentsSummary.join(" · ")}
                </div>
              )}
              {context.evidenceLabels.length > 0 && (
                <div className="line-clamp-2">
                  <span className="font-semibold text-slate-700">Evidence:</span>{" "}
                  {context.evidenceLabels.join(", ")}
                </div>
              )}
              {context.adminNotes && (
                <div className="line-clamp-2">
                  <span className="font-semibold text-slate-700">Admin notes:</span>{" "}
                  {context.adminNotes}
                </div>
              )}
              <div>
                <span className="font-semibold text-slate-700">Approval state:</span>{" "}
                {context.approvalState || "Pending"} ·{" "}
                <span className="font-semibold text-slate-700">Updates this session:</span>{" "}
                {context.updatesCount}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">AI instruction / learning note</Label>
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder='e.g. "When gabapentin appears with documented leg pain, treat it as neuropathy support for VitalWave."'
                className="min-h-[80px] text-sm"
                data-testid="input-ai-logic-instruction"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Rule name</Label>
                <Input
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Optional rule name"
                  className="h-8 text-sm"
                  data-testid="input-ai-logic-rule-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Trigger source</Label>
                <Select value={triggerSource} onValueChange={setTriggerSource}>
                  <SelectTrigger className="h-8 text-sm" data-testid="select-ai-logic-trigger-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {TRIGGER_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Rule scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as CiRuleScope)}>
                  <SelectTrigger className="h-8 text-sm" data-testid="select-ai-logic-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {(Object.keys(CI_SCOPE_LABELS) as CiRuleScope[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {CI_SCOPE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Affected ancillary</Label>
                <Select value={ancillary} onValueChange={(v) => setAncillary(v as CiAncillaryTarget)}>
                  <SelectTrigger className="h-8 text-sm" data-testid="select-ai-logic-ancillary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {(Object.keys(CI_ANCILLARY_LABELS) as CiAncillaryTarget[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        {CI_ANCILLARY_LABELS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Affected output areas</Label>
              <div className="flex flex-wrap gap-1.5">
                {OUTPUT_AREAS.map((o) => {
                  const on = outputs.includes(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => toggleOutput(o)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                        on
                          ? "border-violet-300 bg-violet-100 text-violet-800"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                      data-testid={`toggle-ai-logic-output-${o}`}
                    >
                      {on && <Check className="mr-1 inline w-3 h-3" />}
                      {CI_OUTPUT_LABELS[o]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Evidence requirement</Label>
                <Input
                  value={evidenceReq}
                  onChange={(e) => setEvidenceReq(e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-ai-logic-evidence-req"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Approval requirement</Label>
                <Input
                  value={approvalReq}
                  onChange={(e) => setApprovalReq(e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-ai-logic-approval-req"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "draft" | "pending_review")}>
                <SelectTrigger className="h-8 text-sm w-56" data-testid="select-ai-logic-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100]">
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending_review">Pending review</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p className="rounded-md border border-violet-100 bg-violet-50/60 px-3 py-2 text-[11px] leading-relaxed text-violet-800">
              {CI_DOWNSTREAM_LANGUAGE} Approved logic keeps documentation CMS
              audit-ready and legally defensible.
            </p>
          </div>
        </ScrollArea>
        <div className="border-t px-5 py-3 flex flex-wrap items-center justify-end gap-2 bg-slate-50/70">
          <Button
            variant="outline"
            size="sm"
            onClick={applyPatientOnly}
            data-testid="button-ai-logic-patient-only"
          >
            Apply to this patient only
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={createRule}
            data-testid="button-ai-logic-create-rule"
          >
            <GitBranch className="w-3.5 h-3.5 mr-1.5" />
            Create rule from this item
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={sendToKnowledgeTile}
            data-testid="button-ai-logic-send-knowledge"
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            Send to Knowledge Tile
          </Button>
          <Button size="sm" onClick={saveAsAiLogic} data-testid="button-ai-logic-save">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            Save as AI logic
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───── 2) Review bubbles ────────────────────────────────────────────────

export function AiEvidenceBubblesRow({
  items,
  context,
  ultrasoundTests,
  onAttach,
  isAttached,
  onEvidenceDecision,
}: {
  items: AiEvidenceItem[];
  context: AiLogicPatientContext;
  ultrasoundTests: string[];
  onAttach: (item: AiEvidenceItem, target: AiAttachTarget) => void;
  isAttached: (item: AiEvidenceItem, target: AiAttachTarget) => boolean;
  onEvidenceDecision?: (item: AiEvidenceItem, decision: "approved" | "rejected") => void;
}) {
  const { toast } = useToast();
  const ci = useClinicalIntelligence();
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  // Evidence decisions already recorded for this patient (persisted).
  // Keyed by label + sourceType to match the ciRecordEvidence dedupe key,
  // so same-label bubbles from different sources don't share a badge.
  const decisions = useMemo(() => {
    const map = new Map<string, "approved" | "rejected">();
    for (const e of ci.evidence) {
      if (e.patientId === context.patientId) {
        map.set(`${e.sourceType}::${e.label.toLowerCase()}`, e.status);
      }
    }
    return map;
  }, [ci.evidence, context.patientId]);

  if (items.length === 0) return null;

  const labelOf = (item: AiEvidenceItem) => editing[item.id] ?? item.label;

  const record = (item: AiEvidenceItem, status: "approved" | "rejected") => {
    ciRecordEvidence({
      patientId: context.patientId,
      patientName: context.patientName,
      facility: context.facility ?? null,
      scheduleDate: context.scheduleDate ?? null,
      sourceType: normalizeSourceType(item.source),
      sourceText: item.sourceText ?? item.label,
      label: labelOf(item),
      confidence: item.confidence ?? "medium",
      assignedAncillary: null,
      status,
      decidedBy: "Admin",
    });
    toast({
      title: status === "approved" ? "Evidence approved" : "Evidence rejected",
      description:
        status === "approved" ? CI_DOWNSTREAM_LANGUAGE : `"${labelOf(item)}" will not be used.`,
    });
    setOpenId(null);
    onEvidenceDecision?.(item, status);
  };

  const saveAsLogic = (item: AiEvidenceItem) => {
    ciAddLearningItem({
      instruction: `Treat "${labelOf(item)}" (${item.source}) as supporting clinical evidence.`,
      triggerSource: item.source,
      scope: "patient_only",
      affectedAncillary: "general_documentation",
      affectedOutputs: ["evidence_traceability", "audit_support"],
      status: "draft",
      sourcePatientId: context.patientId,
      sourcePatientName: context.patientName,
      sourceFacility: context.facility ?? null,
      sourceDate: context.scheduleDate ?? null,
      sourceContext: { evidenceLabels: [labelOf(item)] },
      createdBy: "Admin",
    });
    toast({ title: "Saved as AI logic", description: "Draft added to the AI Learning Center." });
    setOpenId(null);
  };

  const createRule = async (item: AiEvidenceItem) => {
    const rule = await ciAddRule({
      name: `Evidence rule: ${labelOf(item)}`,
      description: `IF ${item.source} includes "${labelOf(item)}" THEN surface it as supporting evidence for admin review and use approved source-linked evidence in downstream documentation.`,
      triggerSource: item.source,
      triggerCondition: `${item.source}: ${labelOf(item)}`,
      targetAncillary: "general_documentation",
      targetOutputs: ["evidence_traceability", "audit_support"],
      scope: "clinic_draft",
      approvalRequirement: "Admin Review before finalization",
      status: "draft",
      conflictFlags: [],
      sourceEvidence: [labelOf(item)],
      createdBy: "Admin",
    });
    // Rule creation is itself an evidence approval — record it and link the
    // evidence to the rule so Evidence Traceability shows the full chain.
    const ev = await ciRecordEvidence({
      patientId: context.patientId,
      patientName: context.patientName,
      facility: context.facility ?? null,
      scheduleDate: context.scheduleDate ?? null,
      sourceType: normalizeSourceType(item.source),
      sourceText: item.sourceText ?? item.label,
      label: labelOf(item),
      confidence: item.confidence ?? "medium",
      assignedAncillary: null,
      status: "approved",
      decidedBy: "Admin",
    });
    await ciMarkEvidenceUsedInRule(ev.id, rule.id);
    toast({ title: "Draft rule created", description: "Review it in the Rule Library." });
    setOpenId(null);
  };

  const attach = (item: AiEvidenceItem, target: AiAttachTarget, targetLabel: string) => {
    onAttach(item, target);
    // Attaching is an approval + ancillary assignment in one step — persist
    // the evidence record with the assigned ancillary for traceability.
    ciRecordEvidence({
      patientId: context.patientId,
      patientName: context.patientName,
      facility: context.facility ?? null,
      scheduleDate: context.scheduleDate ?? null,
      sourceType: normalizeSourceType(item.source),
      sourceText: item.sourceText ?? item.label,
      label: labelOf(item),
      confidence: item.confidence ?? "medium",
      assignedAncillary: targetLabel,
      status: "approved",
      decidedBy: "Admin",
    });
    toast({ title: `Attached to ${targetLabel}`, description: labelOf(item) });
    setOpenId(null);
  };

  return (
    <div
      className="mx-3 mb-2 rounded-2xl border border-violet-200/60 bg-violet-50/40 px-3 py-2"
      data-testid="admin-review-ai-bubbles"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Lightbulb className="w-3 h-3 text-violet-600" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
          AI-identified clinical clues
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const decision = decisions.get(
            `${normalizeSourceType(item.source)}::${labelOf(item).toLowerCase()}`,
          );
          const tone =
            decision === "approved"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : decision === "rejected"
                ? "border-slate-200 bg-slate-100 text-slate-400 line-through"
                : "border-violet-200 bg-white text-slate-700 hover:border-violet-300";
          return (
            <Popover
              key={item.id}
              open={openId === item.id}
              onOpenChange={(o) => setOpenId(o ? item.id : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${tone}`}
                  data-testid={`bubble-ai-evidence-${item.id}`}
                >
                  <span
                    className={`inline-flex items-center rounded-full border px-1 text-[9px] font-semibold ${
                      SOURCE_BADGE_TONE[item.source.toUpperCase()] ??
                      "bg-slate-100 text-slate-600 border-slate-200"
                    }`}
                  >
                    {item.source.toUpperCase()}
                  </span>
                  {labelOf(item)}
                  {item.kind === "icd_disease" && (
                    <span
                      className={`text-[9px] font-medium ${
                        item.icdCode ? "text-emerald-600" : "text-rose-500"
                      }`}
                    >
                      {item.icdCode ? item.icdCode : "ICD missing"}
                    </span>
                  )}
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${CONF_DOT[item.confidence ?? "medium"]}`}
                    title={`Confidence: ${item.confidence ?? "medium"}`}
                  />
                  {decision === "approved" && <Check className="w-3 h-3 text-emerald-600" />}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2 z-[100]" align="start">
                <div className="text-[11px] font-semibold text-slate-800 mb-0.5">
                  {labelOf(item)}
                </div>
                <div className="text-[10px] text-slate-500 mb-2">
                  Source: {item.source} · Confidence: {item.confidence ?? "medium"}
                  {item.sourceText && item.sourceText !== item.label ? (
                    <span className="block truncate">“{item.sourceText}”</span>
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => record(item, "approved")}
                    className="w-full flex items-center gap-2 rounded px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50"
                    data-testid={`action-bubble-approve-${item.id}`}
                  >
                    <Check className="w-3 h-3" /> Approve evidence
                  </button>
                  <button
                    type="button"
                    onClick={() => record(item, "rejected")}
                    className="w-full flex items-center gap-2 rounded px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                    data-testid={`action-bubble-reject-${item.id}`}
                  >
                    <ThumbsDown className="w-3 h-3" /> Reject evidence
                  </button>
                  <div className="flex items-center gap-1 px-2 py-1">
                    <Input
                      value={labelOf(item)}
                      onChange={(e) =>
                        setEditing((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="h-6 text-[11px]"
                      data-testid={`input-bubble-edit-${item.id}`}
                    />
                  </div>
                  <div className="border-t border-slate-100 my-1" />
                  {(
                    [
                      ["BrainWave", { type: "ancillary", ancillaryId: "brainwave" }] as const,
                      ["VitalWave", { type: "ancillary", ancillaryId: "vitalwave" }] as const,
                      ["Ultrasound (parent)", { type: "ultrasound-parent" }] as const,
                    ]
                  ).map(([lbl, target]) => {
                    const already = isAttached(item, target as AiAttachTarget);
                    return (
                      <button
                        key={lbl}
                        type="button"
                        disabled={already}
                        onClick={() => attach(item, target as AiAttachTarget, lbl)}
                        className="w-full flex items-center gap-2 rounded px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        data-testid={`action-bubble-attach-${item.id}-${lbl.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                      >
                        <ChevronRight className="w-3 h-3" />
                        {already ? `Already on ${lbl}` : `Attach to ${lbl}`}
                      </button>
                    );
                  })}
                  {ultrasoundTests.length > 0 && (
                    <div className="pl-4">
                      {ultrasoundTests.map((t) => {
                        const target: AiAttachTarget = {
                          type: "ultrasound-test",
                          testName: t,
                        };
                        const already = isAttached(item, target);
                        return (
                          <button
                            key={t}
                            type="button"
                            disabled={already}
                            onClick={() => attach(item, target, t)}
                            className="w-full flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-40 text-left"
                          >
                            <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{already ? `On ${t}` : t}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="border-t border-slate-100 my-1" />
                  {/* Downstream documentation is automatic on approval — no
                      manual action. Show the status so the admin knows. */}
                  <div
                    className="flex items-start gap-2 px-2 py-1 text-[10px] leading-snug text-violet-700/80"
                    data-testid={`status-bubble-downstream-${item.id}`}
                  >
                    <BookOpen className="mt-0.5 w-3 h-3 shrink-0" />
                    <span>
                      {decision === "approved"
                        ? CI_DOWNSTREAM_LANGUAGE
                        : "Once approved, this evidence flows automatically into downstream documentation — clinician reasoning, patient explanation, order note support, and audit traceability."}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => createRule(item)}
                    className="w-full flex items-center gap-2 rounded px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                    data-testid={`action-bubble-create-rule-${item.id}`}
                  >
                    <GitBranch className="w-3 h-3" /> Create rule from this item
                  </button>
                  <button
                    type="button"
                    onClick={() => saveAsLogic(item)}
                    className="w-full flex items-center gap-2 rounded px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-50"
                    data-testid={`action-bubble-save-logic-${item.id}`}
                  >
                    <Sparkles className="w-3 h-3" /> Save as AI logic
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-violet-700/70">
        {CI_DOWNSTREAM_LANGUAGE}
      </p>
    </div>
  );
}

// ───── 3) Subtle "save as future AI logic?" prompt ──────────────────────

export function AiLogicSavePrompt({
  itemLabel,
  context,
  onDismiss,
}: {
  itemLabel: string;
  context: AiLogicPatientContext;
  onDismiss: () => void;
}) {
  const { toast } = useToast();

  const save = async (
    kind: "patient_only" | "draft_rule" | "knowledge_tile" | "test_first",
  ) => {
    const base = {
      instruction: `Learned from "${itemLabel}" on ${context.patientName}: treat this clinical item as supporting evidence in similar patients.`,
      triggerSource: "Admin observation",
      affectedAncillary: "general_documentation" as CiAncillaryTarget,
      affectedOutputs: ["evidence_traceability", "audit_support"] as CiOutputArea[],
      sourcePatientId: context.patientId,
      sourcePatientName: context.patientName,
      sourceFacility: context.facility ?? null,
      sourceDate: context.scheduleDate ?? null,
      sourceContext: { evidenceLabels: [itemLabel] },
      createdBy: "Admin",
    };
    if (kind === "patient_only") {
      ciAddLearningItem({ ...base, scope: "patient_only", status: "approved" });
      toast({ title: "Saved for this patient only" });
    } else if (kind === "draft_rule") {
      const item = await ciAddLearningItem({ ...base, scope: "clinic_draft", status: "draft" });
      await ciConvertLearningToRule(item.id, "Admin");
      toast({ title: "Draft rule saved", description: "Review it in the Rule Library." });
    } else if (kind === "knowledge_tile") {
      ciAddLearningItem({ ...base, scope: "clinic_draft", status: "pending_review" });
      toast({
        title: "Sent to Knowledge Tile",
        description: "Clinical Intelligence & Governance → AI Learning Center.",
      });
    } else {
      ciAddLearningItem({ ...base, scope: "clinic_draft", status: "draft" });
      toast({
        title: "Saved for testing",
        description: "Try it in the Rule Testing Sandbox before approval.",
      });
    }
    onDismiss();
  };

  return (
    <div
      className="absolute bottom-4 right-4 z-50 w-72 rounded-xl border border-violet-200 bg-white/95 p-3 shadow-[0_12px_40px_rgba(76,29,149,0.18)] backdrop-blur"
      data-testid="prompt-save-ai-logic"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-800">
          <Sparkles className="w-3.5 h-3.5" />
          Save this as future AI logic?
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-slate-400 hover:text-slate-600"
          data-testid="button-ai-prompt-dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500 truncate">“{itemLabel}”</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => save("patient_only")}
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
          data-testid="button-ai-prompt-patient-only"
        >
          Patient only
        </button>
        <button
          type="button"
          onClick={() => save("draft_rule")}
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
          data-testid="button-ai-prompt-draft-rule"
        >
          Save as draft rule
        </button>
        <button
          type="button"
          onClick={() => save("knowledge_tile")}
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
          data-testid="button-ai-prompt-knowledge-tile"
        >
          Send to Knowledge Tile
        </button>
        <button
          type="button"
          onClick={() => save("test_first")}
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
          data-testid="button-ai-prompt-test-first"
        >
          <FlaskConical className="mr-0.5 inline w-2.5 h-2.5" />
          Test rule first
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-600"
          data-testid="button-ai-prompt-not-now"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
