// Clinical Intelligence & Governance — Plexus IQ knowledge tile (prototype).
//
// The system-wide "AI brain" surface: 20 governance modules over the
// localStorage-backed clinical-intelligence store plus seeded library
// content. Nothing here changes live engine behavior — every rule and
// learning item is a governance artifact requiring human approval, so
// documentation stays CMS audit-ready and legally defensible.

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Brain,
  Check,
  ClipboardList,
  Database,
  FileText,
  FlaskConical,
  GitBranch,
  Globe,
  GraduationCap,
  History,
  Lightbulb,
  Link2,
  ListChecks,
  Map,
  Network,
  Pill as PillIcon,
  ScrollText,
  Shield,
  Sparkles,
  Stethoscope,
  ThumbsDown,
  Wrench,
  X,
} from "lucide-react";
import {
  CI_ANCILLARY_LABELS,
  CI_DOWNSTREAM_LANGUAGE,
  CI_LEARNING_STATUS_LABELS,
  CI_OUTPUT_LABELS,
  CI_RULE_STATUS_LABELS,
  CI_SCOPE_LABELS,
  type CiAncillaryTarget,
  type CiLearningItem,
  type CiOutputArea,
  type CiRule,
  type CiRuleScope,
  type CiRuleStatus,
} from "@/lib/clinicalIntelligence/types";
import {
  ciAddRule,
  ciConvertLearningToRule,
  ciSetLearningStatus,
  ciSetRuleStatus,
  ciUpdateLearningItem,
  ciUpdateRule,
  useClinicalIntelligence,
} from "@/lib/clinicalIntelligence/store";
import {
  canManageGovernance,
  canReviewRuleStatus,
  canTransitionRule,
  ciActorName,
  requiredReviewerLabel,
} from "@/lib/clinicalIntelligence/permissions";
import { useCurrentUser } from "@/hooks/api/auth";
import {
  ANCILLARY_MAPPING,
  CMS_UPDATES,
  DIAGNOSIS_MAPPINGS,
  EMR_DATA_SOURCES,
  FINDINGS_LIBRARY,
  GUARDRAILS,
  KNOWLEDGE_OBJECTS,
  MEDICATION_LIBRARY,
  ORDER_NOTE_TEMPLATES,
  REASONING_TEMPLATES,
  SYMPTOM_LIBRARY,
} from "@/lib/clinicalIntelligence/seeds";

// ───── Module registry ──────────────────────────────────────────────────

type ModuleId =
  | "learning_center"
  | "rule_builder"
  | "rule_library"
  | "sandbox"
  | "version_history"
  | "approval_queue"
  | "analytics"
  | "traceability"
  | "audit_center"
  | "diagnosis_mapping"
  | "symptom_library"
  | "medication_library"
  | "findings_library"
  | "ancillary_mapping"
  | "reasoning_library"
  | "order_note_library"
  | "cms_watch"
  | "emr_wiring"
  | "guardrails"
  | "knowledge_objects"
  | "evidence_inbox"
  | "result_review"
  | "ancillary_opportunities"
  | "repeat_eligibility"
  | "documentation_reconciliation"
  | "evidence_timeline";

const MODULES: { id: ModuleId; label: string; icon: typeof Brain; group: string }[] = [
  { id: "learning_center", label: "AI Learning Center", icon: GraduationCap, group: "Learning & Rules" },
  { id: "rule_builder", label: "Rule Builder", icon: Wrench, group: "Learning & Rules" },
  { id: "rule_library", label: "Rule Library", icon: BookOpen, group: "Learning & Rules" },
  { id: "sandbox", label: "Rule Testing Sandbox", icon: FlaskConical, group: "Learning & Rules" },
  { id: "version_history", label: "Version History", icon: History, group: "Learning & Rules" },
  { id: "approval_queue", label: "Approval Queue", icon: ListChecks, group: "Governance" },
  { id: "analytics", label: "Analytics", icon: Activity, group: "Governance" },
  { id: "traceability", label: "Evidence Traceability", icon: Link2, group: "Governance" },
  { id: "audit_center", label: "Audit Center", icon: ScrollText, group: "Governance" },
  { id: "guardrails", label: "Compliance Guardrails", icon: Shield, group: "Governance" },
  { id: "diagnosis_mapping", label: "Diagnosis Mapping", icon: Map, group: "Clinical Libraries" },
  { id: "symptom_library", label: "Symptom Library", icon: Stethoscope, group: "Clinical Libraries" },
  { id: "medication_library", label: "Medication Evidence", icon: PillIcon, group: "Clinical Libraries" },
  { id: "findings_library", label: "Clinical Findings", icon: ClipboardList, group: "Clinical Libraries" },
  { id: "ancillary_mapping", label: "Ancillary Mapping", icon: Network, group: "Clinical Libraries" },
  { id: "reasoning_library", label: "Reasoning Library", icon: Lightbulb, group: "Documentation" },
  { id: "order_note_library", label: "Order Note Library", icon: FileText, group: "Documentation" },
  { id: "cms_watch", label: "CMS & Regulatory Watch", icon: Globe, group: "External Intelligence" },
  { id: "emr_wiring", label: "EMR / API Data Wiring", icon: Database, group: "External Intelligence" },
  { id: "knowledge_objects", label: "Knowledge Objects", icon: Brain, group: "External Intelligence" },
  { id: "evidence_inbox", label: "Evidence Inbox", icon: GitBranch, group: "Repeat Testing Loop" },
  { id: "result_review", label: "Result Review", icon: Activity, group: "Repeat Testing Loop" },
  { id: "ancillary_opportunities", label: "Ancillary Opportunities", icon: Network, group: "Repeat Testing Loop" },
  { id: "repeat_eligibility", label: "Repeat Eligibility", icon: History, group: "Repeat Testing Loop" },
  { id: "documentation_reconciliation", label: "Documentation Reconciliation", icon: ClipboardList, group: "Repeat Testing Loop" },
  { id: "evidence_timeline", label: "Evidence Timeline", icon: ScrollText, group: "Repeat Testing Loop" },
];

const MODULE_GROUPS = [
  "Learning & Rules",
  "Governance",
  "Clinical Libraries",
  "Documentation",
  "External Intelligence",
  "Repeat Testing Loop",
];

// ───── Small shared bits ────────────────────────────────────────────────

const RULE_STATUS_TONE: Record<CiRuleStatus, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  pending_physician_review: "bg-amber-50 text-amber-800 border-amber-200",
  pending_compliance_review: "bg-orange-50 text-orange-800 border-orange-200",
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  inactive: "bg-slate-100 text-slate-500 border-slate-200",
  retired: "bg-rose-50 text-rose-700 border-rose-200",
};

const LEARNING_STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  pending_review: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  disabled: "bg-slate-100 text-slate-400 border-slate-200",
  converted: "bg-violet-50 text-violet-800 border-violet-200",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-slate-500">
      {text}
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ───── Learning Center ──────────────────────────────────────────────────

function LearningCenter() {
  const { learningItems } = useClinicalIntelligence();
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const actor = ciActorName(currentUser ?? null);
  const canManage = canManageGovernance(currentUser ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  return (
    <SectionCard
      title="AI Learning Center"
      subtitle="Learning items submitted from Admin Review. Nothing becomes a rule without explicit review and approval."
    >
      {learningItems.length === 0 ? (
        <EmptyNote text="No learning items yet. Use the AI Logic (✨) button inside Admin Review to teach the AI from a patient." />
      ) : (
        <div className="space-y-3">
          {learningItems.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-slate-200 bg-slate-50/50 p-3"
              data-testid={`card-learning-${item.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={LEARNING_STATUS_TONE[item.status] ?? LEARNING_STATUS_TONE.draft}>
                  {CI_LEARNING_STATUS_LABELS[item.status]}
                </Pill>
                <Pill tone="bg-white text-slate-600 border-slate-200">{CI_SCOPE_LABELS[item.scope]}</Pill>
                <Pill tone="bg-white text-slate-600 border-slate-200">
                  {CI_ANCILLARY_LABELS[item.affectedAncillary]}
                </Pill>
                {item.triggerSource && (
                  <Pill tone="bg-white text-slate-600 border-slate-200">Trigger: {item.triggerSource}</Pill>
                )}
                <span className="ml-auto text-[10px] text-slate-400">{fmtDate(item.createdAt)}</span>
              </div>
              {item.ruleName && (
                <div className="mt-1.5 text-xs font-semibold text-slate-800">{item.ruleName}</div>
              )}
              {editingId === item.id ? (
                <div className="mt-1.5 space-y-1.5">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="min-h-[60px] text-xs"
                    data-testid={`input-edit-learning-${item.id}`}
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-6 text-[11px]"
                      onClick={() => {
                        ciUpdateLearningItem(item.id, actor, { instruction: editText });
                        setEditingId(null);
                        toast({ title: "Learning item updated" });
                      }}
                      data-testid={`button-save-learning-${item.id}`}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-xs leading-relaxed text-slate-700">{item.instruction}</p>
              )}
              <div className="mt-1 text-[10px] text-slate-500">
                From {item.sourcePatientName || "unknown patient"}
                {item.sourceFacility ? ` · ${item.sourceFacility}` : ""}
                {item.sourceDate ? ` · ${item.sourceDate}` : ""}
                {" · Outputs: "}
                {item.affectedOutputs.map((o) => CI_OUTPUT_LABELS[o]).join(", ") || "—"}
              </div>
              {item.status !== "converted" && !canManage && (
                <div className="mt-2 text-[10px] text-slate-400" data-testid={`note-readonly-learning-${item.id}`}>
                  Read-only — reviewing learning items requires an admin or clinician role.
                </div>
              )}
              {item.status !== "converted" && canManage && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditText(item.instruction);
                    }}
                    data-testid={`button-edit-learning-${item.id}`}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    onClick={async () => {
                      const rule = await ciConvertLearningToRule(item.id, actor);
                      toast({
                        title: rule ? "Converted to draft rule" : "Conversion failed",
                        description: rule ? `"${rule.name}" added to the Rule Library.` : undefined,
                      });
                    }}
                    data-testid={`button-convert-learning-${item.id}`}
                  >
                    <GitBranch className="mr-1 w-3 h-3" /> Convert to rule
                  </Button>
                  {item.status !== "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] text-emerald-700"
                      onClick={() => {
                        ciSetLearningStatus(item.id, actor, "approved");
                        toast({ title: "Learning item approved" });
                      }}
                      data-testid={`button-approve-learning-${item.id}`}
                    >
                      <Check className="mr-1 w-3 h-3" /> Approve
                    </Button>
                  )}
                  {item.status !== "rejected" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] text-rose-700"
                      onClick={() => {
                        ciSetLearningStatus(item.id, actor, "rejected");
                        toast({ title: "Learning item rejected" });
                      }}
                      data-testid={`button-reject-learning-${item.id}`}
                    >
                      <ThumbsDown className="mr-1 w-3 h-3" /> Reject
                    </Button>
                  )}
                  {item.status !== "disabled" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] text-slate-500"
                      onClick={() => {
                        ciSetLearningStatus(item.id, actor, "disabled");
                        toast({ title: "Learning item disabled" });
                      }}
                      data-testid={`button-disable-learning-${item.id}`}
                    >
                      Disable
                    </Button>
                  )}
                </div>
              )}
              {item.convertedRuleId && (
                <div className="mt-1 text-[10px] text-violet-600">Converted → rule {item.convertedRuleId}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ───── Rule Builder ─────────────────────────────────────────────────────

function RuleBuilder() {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const actor = ciActorName(currentUser ?? null);
  const canManage = canManageGovernance(currentUser ?? null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dxTrig, setDxTrig] = useState("");
  const [symTrig, setSymTrig] = useState("");
  const [medTrig, setMedTrig] = useState("");
  const [findTrig, setFindTrig] = useState("");
  const [ancillary, setAncillary] = useState<CiAncillaryTarget>("brainwave");
  const [outputs, setOutputs] = useState<CiOutputArea[]>(["ancillary_assignment", "medical_necessity"]);
  const [scope, setScope] = useState<CiRuleScope>("clinic_draft");
  const [evidenceReq, setEvidenceReq] = useState("At least one source-linked HX/DX/RX item");
  const [approvalReq, setApprovalReq] = useState("Admin Review before finalization");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [status, setStatus] = useState<CiRuleStatus>("draft");

  const toggleOutput = (o: CiOutputArea) =>
    setOutputs((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));

  const save = () => {
    if (!name.trim() || !description.trim()) {
      toast({ title: "Name and description required", variant: "destructive" });
      return;
    }
    ciAddRule({
      name: name.trim(),
      description: description.trim(),
      diagnosisTrigger: dxTrig.trim() || undefined,
      symptomTrigger: symTrig.trim() || undefined,
      medicationTrigger: medTrig.trim() || undefined,
      findingTrigger: findTrig.trim() || undefined,
      triggerCondition:
        [dxTrig && `dx: ${dxTrig}`, symTrig && `symptom: ${symTrig}`, medTrig && `medication: ${medTrig}`, findTrig && `finding: ${findTrig}`]
          .filter(Boolean)
          .join(" AND ") || undefined,
      targetAncillary: ancillary,
      targetOutputs: outputs,
      evidenceRequirement: evidenceReq.trim() || undefined,
      scope,
      approvalRequirement: approvalReq.trim() || undefined,
      effectiveDate: effectiveDate || null,
      status,
      conflictFlags: [],
      createdBy: actor,
    });
    toast({ title: "Rule saved", description: `"${name.trim()}" added to the Rule Library.` });
    setName("");
    setDescription("");
    setDxTrig("");
    setSymTrig("");
    setMedTrig("");
    setFindTrig("");
  };

  return (
    <SectionCard
      title="Rule Builder"
      subtitle="IF (trigger) THEN (documentation behavior). New rules start as drafts — activation requires human approval."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs">Rule name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" data-testid="input-rule-name" />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs">Description (IF … THEN …)</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[70px] text-sm"
            placeholder='IF diagnosis includes diabetic neuropathy AND medication includes gabapentin THEN suggest VitalWave with source-linked evidence…'
            data-testid="input-rule-description"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Diagnosis trigger</Label>
          <Input value={dxTrig} onChange={(e) => setDxTrig(e.target.value)} className="h-8 text-sm" data-testid="input-rule-dx-trigger" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Symptom trigger</Label>
          <Input value={symTrig} onChange={(e) => setSymTrig(e.target.value)} className="h-8 text-sm" data-testid="input-rule-symptom-trigger" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Medication trigger</Label>
          <Input value={medTrig} onChange={(e) => setMedTrig(e.target.value)} className="h-8 text-sm" data-testid="input-rule-med-trigger" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Finding trigger</Label>
          <Input value={findTrig} onChange={(e) => setFindTrig(e.target.value)} className="h-8 text-sm" data-testid="input-rule-finding-trigger" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Target ancillary</Label>
          <Select value={ancillary} onValueChange={(v) => setAncillary(v as CiAncillaryTarget)}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-rule-ancillary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CI_ANCILLARY_LABELS) as CiAncillaryTarget[]).map((a) => (
                <SelectItem key={a} value={a}>
                  {CI_ANCILLARY_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Scope</Label>
          <Select value={scope} onValueChange={(v) => setScope(v as CiRuleScope)}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-rule-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CI_SCOPE_LABELS) as CiRuleScope[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {CI_SCOPE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs">Affected output areas</Label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CI_OUTPUT_LABELS) as CiOutputArea[]).map((o) => {
              const on = outputs.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggleOutput(o)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    on ? "border-violet-300 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-slate-600"
                  }`}
                  data-testid={`toggle-rule-output-${o}`}
                >
                  {on && <Check className="mr-1 inline w-3 h-3" />}
                  {CI_OUTPUT_LABELS[o]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Evidence requirement</Label>
          <Input value={evidenceReq} onChange={(e) => setEvidenceReq(e.target.value)} className="h-8 text-sm" data-testid="input-rule-evidence-req" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Approval requirement</Label>
          <Input value={approvalReq} onChange={(e) => setApprovalReq(e.target.value)} className="h-8 text-sm" data-testid="input-rule-approval-req" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Effective date</Label>
          <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="h-8 text-sm" data-testid="input-rule-effective-date" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Initial status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as CiRuleStatus)}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-rule-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_physician_review">Pending physician review</SelectItem>
              <SelectItem value="pending_compliance_review">Pending compliance review</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        {!canManage && (
          <span className="text-[10px] text-slate-400" data-testid="note-readonly-rule-builder">
            Read-only — creating rules requires an admin or clinician role.
          </span>
        )}
        <Button size="sm" onClick={save} disabled={!canManage} data-testid="button-save-rule">
          <GitBranch className="mr-1.5 w-3.5 h-3.5" /> Save rule
        </Button>
      </div>
    </SectionCard>
  );
}

// ───── Rule Library ─────────────────────────────────────────────────────

const RULE_STATUS_TRANSITIONS: Record<CiRuleStatus, CiRuleStatus[]> = {
  draft: ["pending_physician_review", "pending_compliance_review", "retired"],
  pending_physician_review: ["pending_compliance_review", "active", "draft", "retired"],
  pending_compliance_review: ["active", "draft", "retired"],
  active: ["inactive", "retired"],
  inactive: ["active", "retired"],
  retired: [],
};

function RuleCard({ rule, expanded, onToggle }: { rule: CiRule; expanded: boolean; onToggle: () => void }) {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const user = currentUser ?? null;
  const actor = ciActorName(user);
  const allowedTransitions = RULE_STATUS_TRANSITIONS[rule.status].filter((next) =>
    canTransitionRule(user, rule.status, next),
  );
  const blockedActivation =
    RULE_STATUS_TRANSITIONS[rule.status].includes("active") &&
    !allowedTransitions.includes("active") &&
    (rule.status === "pending_physician_review" || rule.status === "pending_compliance_review");
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`card-rule-${rule.id}`}>
      <button type="button" className="w-full text-left" onClick={onToggle}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={RULE_STATUS_TONE[rule.status]}>{CI_RULE_STATUS_LABELS[rule.status]}</Pill>
          <span className="text-xs font-semibold text-slate-800">{rule.name}</span>
          <span className="text-[10px] text-slate-400">v{rule.version}</span>
          {rule.seeded && <Pill tone="bg-sky-50 text-sky-700 border-sky-200">Seeded</Pill>}
          <span className="ml-auto text-[10px] text-slate-400">
            {CI_SCOPE_LABELS[rule.scope]} · {CI_ANCILLARY_LABELS[rule.targetAncillary]}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 text-xs text-slate-700">
          <p className="leading-relaxed">{rule.description}</p>
          {rule.triggerCondition && (
            <div className="rounded bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-600">
              {rule.triggerCondition}
            </div>
          )}
          <div className="text-[10px] text-slate-500">
            Outputs: {rule.targetOutputs.map((o) => CI_OUTPUT_LABELS[o]).join(", ") || "—"}
            {rule.evidenceRequirement ? ` · Evidence: ${rule.evidenceRequirement}` : ""}
            {rule.approvalRequirement ? ` · Approval: ${rule.approvalRequirement}` : ""}
            {rule.effectiveDate ? ` · Effective: ${rule.effectiveDate}` : ""}
          </div>
          {rule.sourceEvidence && rule.sourceEvidence.length > 0 && (
            <div className="text-[10px] text-slate-500">Source evidence: {rule.sourceEvidence.join(", ")}</div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {allowedTransitions.map((next) => (
              <Button
                key={next}
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={() => {
                  ciSetRuleStatus(rule.id, actor, next);
                  toast({ title: `Rule → ${CI_RULE_STATUS_LABELS[next]}`, description: rule.name });
                }}
                data-testid={`button-rule-${rule.id}-to-${next}`}
              >
                {next === "active" ? "Approve & activate" : `Move to ${CI_RULE_STATUS_LABELS[next]}`}
              </Button>
            ))}
            {blockedActivation && (
              <span className="text-[10px] text-slate-400" data-testid={`note-rule-${rule.id}-approval-restricted`}>
                Approval requires {requiredReviewerLabel(rule.status)}.
              </span>
            )}
            {allowedTransitions.length === 0 && !blockedActivation && RULE_STATUS_TRANSITIONS[rule.status].length > 0 && (
              <span className="text-[10px] text-slate-400" data-testid={`note-rule-${rule.id}-readonly`}>
                Read-only — managing rules requires an admin or clinician role.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RuleLibrary() {
  const { rules } = useClinicalIntelligence();
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const filtered = filter === "all" ? rules : rules.filter((r) => r.status === filter);
  return (
    <SectionCard
      title="Rule Library"
      subtitle="Every governance rule with status, scope, version, and full change history. Activation always requires human approval."
    >
      <div className="mb-3 flex items-center gap-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-8 w-64 text-sm" data-testid="select-rule-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(CI_RULE_STATUS_LABELS) as CiRuleStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {CI_RULE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-500">{filtered.length} rule{filtered.length === 1 ? "" : "s"}</span>
      </div>
      {filtered.length === 0 ? (
        <EmptyNote text="No rules in this view." />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ───── Sandbox ──────────────────────────────────────────────────────────

function Sandbox() {
  const { rules } = useClinicalIntelligence();
  const { data: currentUser } = useCurrentUser();
  const actor = ciActorName(currentUser ?? null);
  const [ruleId, setRuleId] = useState<string>("");
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<{ matched: string[]; missed: string[] } | null>(null);
  const rule = rules.find((r) => r.id === ruleId) ?? null;

  const run = () => {
    if (!rule) return;
    const text = sample.toLowerCase();
    const tokens = [rule.diagnosisTrigger, rule.symptomTrigger, rule.medicationTrigger, rule.findingTrigger]
      .filter((t): t is string => !!t)
      .flatMap((t) => t.split(/[,|]/).map((x) => x.replace(/\([^)]*\)/g, "").trim().toLowerCase()))
      .filter((t) => t.length > 2);
    const matched = tokens.filter((t) => text.includes(t));
    const missed = tokens.filter((t) => !text.includes(t));
    setResult({ matched, missed });
    if (matched.length > 0) ciUpdateRule(rule.id, actor, {}, "Sandbox simulation run (matched)");
  };

  return (
    <SectionCard
      title="Rule Testing Sandbox"
      subtitle="Simulate a rule against sample patient text. Simulation only — no live patient data is changed."
    >
      <div className="space-y-3">
        <Select value={ruleId} onValueChange={setRuleId}>
          <SelectTrigger className="h-8 text-sm" data-testid="select-sandbox-rule">
            <SelectValue placeholder="Pick a rule to test" />
          </SelectTrigger>
          <SelectContent>
            {rules.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="Paste sample patient Hx / Dx / Rx text here…"
          className="min-h-[100px] text-sm"
          data-testid="input-sandbox-sample"
        />
        <Button size="sm" onClick={run} disabled={!rule || !sample.trim()} data-testid="button-sandbox-run">
          <FlaskConical className="mr-1.5 w-3.5 h-3.5" /> Run simulation
        </Button>
        {result && rule && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs" data-testid="sandbox-result">
            <div className="font-semibold text-slate-800">
              {result.matched.length > 0 ? "Rule would fire (pending required approvals)" : "Rule would NOT fire"}
            </div>
            {result.matched.length > 0 && (
              <div className="mt-1 text-emerald-700">Matched triggers: {result.matched.join(", ")}</div>
            )}
            {result.missed.length > 0 && (
              <div className="mt-1 text-slate-500">Unmatched triggers: {result.missed.join(", ")}</div>
            )}
            {result.matched.length > 0 && (
              <p className="mt-2 rounded-md border border-violet-100 bg-violet-50/60 px-2 py-1.5 text-[11px] text-violet-800">
                Simulated downstream effect ({CI_ANCILLARY_LABELS[rule.targetAncillary]}): {CI_DOWNSTREAM_LANGUAGE}
              </p>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ───── Version History ──────────────────────────────────────────────────

function VersionHistory() {
  const { rules } = useClinicalIntelligence();
  return (
    <SectionCard title="Version History" subtitle="Immutable per-rule change history: every edit bumps the version with who/when/what.">
      {rules.length === 0 ? (
        <EmptyNote text="No rules yet." />
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                {r.name}
                <span className="text-[10px] font-normal text-slate-400">v{r.version}</span>
              </div>
              <div className="mt-1.5 space-y-1">
                {[...r.history].reverse().map((h) => (
                  <div key={`${r.id}-v${h.version}`} className="flex items-center gap-2 text-[11px] text-slate-600">
                    <span className="w-8 shrink-0 font-mono text-slate-400">v{h.version}</span>
                    <Pill tone={RULE_STATUS_TONE[h.status]}>{CI_RULE_STATUS_LABELS[h.status]}</Pill>
                    <span className="truncate">{h.summary}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400">
                      {h.by} · {fmtDate(h.at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ───── Approval Queue ───────────────────────────────────────────────────

function ApprovalQueue() {
  const { rules, learningItems } = useClinicalIntelligence();
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const user = currentUser ?? null;
  const actor = ciActorName(user);
  const canManage = canManageGovernance(user);
  const pendingRules = rules.filter(
    (r) => r.status === "pending_physician_review" || r.status === "pending_compliance_review",
  );
  const pendingLearning = learningItems.filter((l) => l.status === "pending_review");
  return (
    <SectionCard
      title="Approval Queue"
      subtitle="Everything awaiting human sign-off. AI never activates logic on its own — physician/compliance approval is the only path to Active."
    >
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Rules pending review</h3>
      {pendingRules.length === 0 ? (
        <EmptyNote text="No rules pending review." />
      ) : (
        <div className="space-y-2">
          {pendingRules.map((r) => {
            const canReview = canReviewRuleStatus(user, r.status);
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <Pill tone={RULE_STATUS_TONE[r.status]}>{CI_RULE_STATUS_LABELS[r.status]}</Pill>
                <span className="text-xs font-semibold text-slate-800">{r.name}</span>
                {canReview ? (
                  <div className="ml-auto flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] text-emerald-700"
                      onClick={() => {
                        ciSetRuleStatus(r.id, actor, "active");
                        toast({ title: "Rule approved & activated", description: r.name });
                      }}
                      data-testid={`button-queue-approve-${r.id}`}
                    >
                      <Check className="mr-1 w-3 h-3" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] text-rose-700"
                      onClick={() => {
                        ciSetRuleStatus(r.id, actor, "draft");
                        toast({ title: "Rule returned to draft", description: r.name });
                      }}
                      data-testid={`button-queue-return-${r.id}`}
                    >
                      <X className="mr-1 w-3 h-3" /> Return to draft
                    </Button>
                  </div>
                ) : (
                  <span className="ml-auto text-[10px] text-slate-400" data-testid={`note-queue-readonly-${r.id}`}>
                    Read-only — approval requires {requiredReviewerLabel(r.status)}.
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Learning items pending review
      </h3>
      {pendingLearning.length === 0 ? (
        <EmptyNote text="No learning items pending review." />
      ) : (
        <div className="space-y-2">
          {pendingLearning.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{l.ruleName || l.instruction}</span>
              {canManage ? (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] text-emerald-700"
                    onClick={() => {
                      ciSetLearningStatus(l.id, actor, "approved");
                      toast({ title: "Learning item approved" });
                    }}
                    data-testid={`button-queue-approve-learning-${l.id}`}
                  >
                    <Check className="mr-1 w-3 h-3" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] text-rose-700"
                    onClick={() => {
                      ciSetLearningStatus(l.id, actor, "rejected");
                      toast({ title: "Learning item rejected" });
                    }}
                    data-testid={`button-queue-reject-learning-${l.id}`}
                  >
                    <ThumbsDown className="mr-1 w-3 h-3" /> Reject
                  </Button>
                </div>
              ) : (
                <span className="text-[10px] text-slate-400" data-testid={`note-queue-readonly-learning-${l.id}`}>
                  Read-only — requires an admin or clinician role.
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ───── Analytics ────────────────────────────────────────────────────────

function Analytics() {
  const { rules, learningItems, evidence, audit } = useClinicalIntelligence();
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const r of rules) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return {
      rules: rules.length,
      byStatus,
      learning: learningItems.length,
      learningPending: learningItems.filter((l) => l.status === "pending_review").length,
      evidenceApproved: evidence.filter((e) => e.status === "approved").length,
      evidenceRejected: evidence.filter((e) => e.status === "rejected").length,
      auditEntries: audit.length,
    };
  }, [rules, learningItems, evidence, audit]);
  const tiles: { label: string; value: number }[] = [
    { label: "Total rules", value: stats.rules },
    { label: "Active rules", value: stats.byStatus["active"] ?? 0 },
    { label: "Pending review", value: (stats.byStatus["pending_physician_review"] ?? 0) + (stats.byStatus["pending_compliance_review"] ?? 0) },
    { label: "Learning items", value: stats.learning },
    { label: "Learning pending", value: stats.learningPending },
    { label: "Evidence approved", value: stats.evidenceApproved },
    { label: "Evidence rejected", value: stats.evidenceRejected },
    { label: "Audit entries", value: stats.auditEntries },
  ];
  return (
    <SectionCard title="Analytics" subtitle="Governance health at a glance (prototype metrics from the local knowledge store).">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center">
            <div className="text-xl font-bold text-slate-800 tabular-nums" data-testid={`stat-${t.label.toLowerCase().replace(/\s+/g, "-")}`}>
              {t.value}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">{t.label}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ───── Traceability + Audit ─────────────────────────────────────────────

function Traceability() {
  const { evidence, rules } = useClinicalIntelligence();
  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name ?? id;
  return (
    <SectionCard
      title="Evidence Traceability"
      subtitle="Every evidence decision made in Admin Review: source → label → decision → downstream use. This chain keeps documentation CMS audit-ready and legally defensible."
    >
      {evidence.length === 0 ? (
        <EmptyNote text="No evidence decisions recorded yet. Approve or reject AI-identified clues inside Admin Review." />
      ) : (
        <div className="space-y-2">
          {evidence.map((e) => (
            <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs" data-testid={`card-evidence-${e.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Pill
                  tone={
                    e.status === "approved"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                  }
                >
                  {e.status === "approved" ? "Approved" : "Rejected"}
                </Pill>
                <span className="font-semibold text-slate-800">{e.label}</span>
                <Pill tone="bg-slate-50 text-slate-600 border-slate-200">{e.sourceType}</Pill>
                {e.assignedAncillary && (
                  <Pill tone="bg-violet-50 text-violet-700 border-violet-200">
                    → {e.assignedAncillary}
                  </Pill>
                )}
                {e.usedInRuleIds.length > 0 && (
                  <Pill tone="bg-sky-50 text-sky-700 border-sky-200">
                    Used in {e.usedInRuleIds.length} rule{e.usedInRuleIds.length === 1 ? "" : "s"}
                  </Pill>
                )}
                <span className="ml-auto text-[10px] text-slate-400">
                  {e.decidedBy} · {fmtDate(e.at)}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                Patient: {e.patientName}
                {e.facility ? ` · ${e.facility}` : ""}
                {e.scheduleDate ? ` · ${e.scheduleDate}` : ""}
                {e.sourceText && e.sourceText !== e.label ? ` · Source text: “${e.sourceText}”` : ""}
                {` · Confidence: ${e.confidence}`}
                {` · Assigned ancillary: ${e.assignedAncillary ?? "none yet"}`}
              </div>
              {e.usedInRuleIds.length > 0 && (
                <div
                  className="mt-1 text-[10px] text-sky-700"
                  data-testid={`text-evidence-rules-${e.id}`}
                >
                  Rules: {e.usedInRuleIds.map((rid) => ruleName(rid)).join(", ")}
                </div>
              )}
              {e.status === "approved" && (
                <p className="mt-1.5 text-[10px] leading-snug text-violet-700/80">{CI_DOWNSTREAM_LANGUAGE}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function AuditCenter() {
  const { audit } = useClinicalIntelligence();
  return (
    <SectionCard
      title="Audit Center"
      subtitle="Immutable log of every knowledge-layer action: who, what, when. Nothing is ever silently changed."
    >
      {audit.length === 0 ? (
        <EmptyNote text="No audit entries yet." />
      ) : (
        <div className="space-y-1">
          {audit.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-1.5 text-[11px] text-slate-600">
              <Pill tone="bg-slate-50 text-slate-500 border-slate-200">{a.action.replace(/_/g, " ")}</Pill>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-slate-800">{a.entityName}</span>
                {a.detail ? ` — ${a.detail}` : ""}
              </span>
              <span className="shrink-0 text-[10px] text-slate-400">
                {a.by} · {fmtDate(a.at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ───── Static library modules ───────────────────────────────────────────

function DiagnosisMapping() {
  return (
    <SectionCard title="Diagnosis Mapping" subtitle="How diagnoses connect to symptoms, medications, findings, and ancillary support.">
      <div className="space-y-3">
        {DIAGNOSIS_MAPPINGS.map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800">{m.diagnosis}</span>
              {m.icdHints.map((c) => (
                <Pill key={c} tone="bg-sky-50 text-sky-700 border-sky-200">{c}</Pill>
              ))}
              <span className="ml-auto text-[10px] text-slate-500">{m.ancillaries.join(", ")}</span>
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              Symptoms: {m.symptoms.join(", ")} · Medications: {m.medications.join(", ")} · Findings: {m.findings.join(", ")}
            </div>
            <p className="mt-1 text-[11px] text-slate-600">{m.documentationUse}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function SymptomLibrary() {
  return (
    <SectionCard title="Symptom Library" subtitle="Per-symptom cards: related context, ancillary relevance, documentation use, and CMS flags.">
      <div className="grid gap-3 md:grid-cols-2">
        {SYMPTOM_LIBRARY.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">{s.symptom}</span>
              <Pill
                tone={
                  s.evidenceStrength === "high"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : s.evidenceStrength === "medium"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                }
              >
                {s.evidenceStrength} evidence
              </Pill>
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              Dx: {s.relatedDiagnoses.join(", ")} · Rx: {s.relatedMedications.join(", ")} · Findings: {s.relatedFindings.join(", ")}
            </div>
            <div className="mt-1 text-[10px] font-medium text-slate-600">Ancillaries: {s.relatedAncillaries.join(", ")}</div>
            <p className="mt-1 text-[11px] text-slate-600">{s.documentationUse}</p>
            {s.cmsFlags.length > 0 && (
              <div className="mt-1 text-[10px] text-orange-700">CMS: {s.cmsFlags.join(" · ")}</div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function MedicationLibrary() {
  return (
    <SectionCard title="Medication Evidence Library" subtitle="Medications as clinical clues — what each one implies and which ancillaries it supports.">
      <div className="grid gap-3 md:grid-cols-2">
        {MEDICATION_LIBRARY.map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-center gap-2">
              <Pill tone="bg-indigo-50 text-indigo-700 border-indigo-200">RX</Pill>
              <span className="font-semibold text-slate-800">{m.medication}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-600">{m.clinicalClue}</p>
            <div className="mt-1 text-[10px] text-slate-500">
              Dx: {m.relatedDiagnoses.join(", ")} · Ancillaries: {m.relatedAncillaries.join(", ")} · Strength: {m.evidenceStrength}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function FindingsLibrary() {
  return (
    <SectionCard title="Clinical Findings Library" subtitle="Exam and screening findings that strengthen necessity documentation.">
      <div className="grid gap-3 md:grid-cols-2">
        {FINDINGS_LIBRARY.map((f) => (
          <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">{f.finding}</span>
              <span className="text-[10px] text-slate-400">({f.sourceHint})</span>
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              Dx: {f.relatedDiagnoses.join(", ")} · Ancillaries: {f.relatedAncillaries.join(", ")} · Strength: {f.evidenceStrength}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function AncillaryMapping() {
  return (
    <SectionCard title="Ancillary Mapping" subtitle="What supports each ancillary and which documentation outputs it feeds.">
      <div className="space-y-3">
        {ANCILLARY_MAPPING.map((a) => (
          <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="font-semibold text-slate-800">{a.ancillary}</div>
            <div className="mt-1 text-[10px] text-slate-500">Supported by: {a.supportedBy.join(", ")}</div>
            <div className="mt-1 text-[10px] text-slate-500">Outputs: {a.documentationOutputs.join(", ")}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ReasoningLibrary() {
  return (
    <SectionCard title="Reasoning Library" subtitle="Approved language blocks used to compose clinician reasoning and patient explanations.">
      <div className="space-y-3">
        {REASONING_TEMPLATES.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-center gap-2">
              <Pill tone="bg-violet-50 text-violet-700 border-violet-200">{t.section.replace(/_/g, " ")}</Pill>
              <span className="font-semibold text-slate-800">{t.title}</span>
            </div>
            <p className="mt-1.5 rounded bg-slate-50 px-2 py-1.5 text-[11px] leading-relaxed text-slate-600">{t.body}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function OrderNoteLibrary() {
  return (
    <SectionCard title="Order Note Library" subtitle="Order-note and medical-necessity templates with source-linked evidence placeholders.">
      <div className="space-y-3">
        {ORDER_NOTE_TEMPLATES.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-center gap-2">
              <Pill tone="bg-teal-50 text-teal-700 border-teal-200">{t.section.replace(/_/g, " ")}</Pill>
              <span className="font-semibold text-slate-800">{t.title}</span>
            </div>
            <p className="mt-1.5 rounded bg-slate-50 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-600">{t.body}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function CmsWatch() {
  const STATUS_TONE: Record<string, string> = {
    new: "bg-sky-50 text-sky-700 border-sky-200",
    under_review: "bg-amber-50 text-amber-800 border-amber-200",
    acknowledged: "bg-slate-100 text-slate-600 border-slate-200",
    action_proposed: "bg-violet-50 text-violet-800 border-violet-200",
  };
  return (
    <SectionCard
      title="CMS & Regulatory Watch"
      subtitle="Regulatory intelligence feed. Updates can only PROPOSE rule changes — the AI never silently changes a rule."
    >
      <div className="space-y-3">
        {CMS_UPDATES.map((u) => (
          <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs" data-testid={`card-cms-${u.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="bg-slate-50 text-slate-600 border-slate-200">{u.source}</Pill>
              <span className="font-semibold text-slate-800">{u.title}</span>
              <Pill tone={STATUS_TONE[u.status]}>{u.status.replace(/_/g, " ")}</Pill>
              <span className="ml-auto text-[10px] text-slate-400">{u.publishedDate}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{u.summary}</p>
            <div className="mt-1 text-[10px] text-slate-500">
              {u.affectedAncillaries.length > 0 && <>Affects: {u.affectedAncillaries.join(", ")} · </>}
              {u.affectedRules.length > 0 && <>Rules: {u.affectedRules.join(", ")} · </>}
              Suggested action: {u.suggestedAction}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function EmrWiring() {
  const TONE: Record<string, string> = {
    planned: "bg-slate-100 text-slate-600 border-slate-200",
    design: "bg-sky-50 text-sky-700 border-sky-200",
    not_connected: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <SectionCard
      title="EMR / API Data Wiring"
      subtitle="Future-state data sources. Each will feed evidence suggestions that still require admin confirmation."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {EMR_DATA_SOURCES.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">{s.name}</span>
              <Pill tone={TONE[s.status]}>{s.status.replace(/_/g, " ")}</Pill>
            </div>
            <p className="mt-1 text-[11px] text-slate-600">{s.description}</p>
            <div className="mt-1 text-[10px] text-slate-500">e.g. {s.exampleTriggers.join(" · ")}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function Guardrails() {
  const TONE: Record<string, string> = {
    hard: "bg-rose-50 text-rose-700 border-rose-200",
    workflow: "bg-amber-50 text-amber-800 border-amber-200",
    advisory: "bg-sky-50 text-sky-700 border-sky-200",
  };
  return (
    <SectionCard
      title="Compliance Guardrails"
      subtitle="The non-negotiables that keep this system CMS audit-ready and legally defensible."
    >
      <div className="space-y-3">
        {GUARDRAILS.map((g) => (
          <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs" data-testid={`card-guardrail-${g.id}`}>
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-semibold text-slate-800">{g.title}</span>
              <Pill tone={TONE[g.enforcement]}>{g.enforcement}</Pill>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{g.description}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function KnowledgeObjects() {
  const KIND_TONE: Record<string, string> = {
    diagnosis: "bg-sky-50 text-sky-700 border-sky-200",
    symptom: "bg-amber-50 text-amber-800 border-amber-200",
    medication: "bg-indigo-50 text-indigo-700 border-indigo-200",
    finding: "bg-teal-50 text-teal-700 border-teal-200",
    ancillary: "bg-violet-50 text-violet-800 border-violet-200",
    template: "bg-slate-100 text-slate-600 border-slate-200",
    rule_concept: "bg-emerald-50 text-emerald-800 border-emerald-200",
  };
  return (
    <SectionCard
      title="Knowledge Objects"
      subtitle="The knowledge graph: every clinical concept and its connections across the intelligence layer."
    >
      <div className="grid gap-2 md:grid-cols-2">
        {KNOWLEDGE_OBJECTS.map((k) => (
          <div key={k.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-center gap-2">
              <Pill tone={KIND_TONE[k.kind]}>{k.kind.replace(/_/g, " ")}</Pill>
              <span className="font-semibold text-slate-800">{k.name}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {k.connections.map((c) => (
                <span key={c} className="rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 border border-slate-100">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ───── Repeat Testing Loop (prototype shells) ───────────────────────────
//
// Honest, not-yet-wired scaffolds for the Clinical Intelligence → Plexus IQ
// Repeat Testing → Admin Review → Scheduling Reconciliation → Engagement
// loop. These sections intentionally render NO fabricated data. Each names
// the existing tables/services it will read from once wired. The full
// implementation blueprint lives at:
//   docs/architecture/clinical-intelligence-repeat-testing-loop.md

function RepeatLoopShell({
  id,
  title,
  purpose,
  reads,
  writes,
  producesFor,
}: {
  id: ModuleId;
  title: string;
  purpose: string;
  reads: string[];
  writes: string[];
  producesFor: string;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid={`ci-repeat-shell-${id}`}>
      <div className="flex items-start gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{purpose}</p>
        </div>
        <Badge
          variant="outline"
          className="ml-auto shrink-0 border-amber-200 bg-amber-50 text-[10px] text-amber-700"
        >
          Not connected yet
        </Badge>
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center">
        <GitBranch className="mx-auto h-6 w-6 text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-700">Prototype shell — no live data</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          This surface is scaffolded but not wired. It will populate only from real records — never
          fabricated findings, ICDs, or statuses. See the implementation blueprint for the exact
          wiring plan.
        </p>
        <code className="mt-3 inline-block rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
          docs/architecture/clinical-intelligence-repeat-testing-loop.md
        </code>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white/70 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Reads from</div>
          <ul className="mt-1.5 space-y-1">
            {reads.map((r) => (
              <li key={r} className="text-[11px] text-slate-600">
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">{r}</code>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white/70 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Writes to</div>
          <ul className="mt-1.5 space-y-1">
            {writes.map((w) => (
              <li key={w} className="text-[11px] text-slate-600">
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">{w}</code>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white/70 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Feeds</div>
          <p className="mt-1.5 text-[11px] text-slate-600">{producesFor}</p>
        </div>
      </div>
    </div>
  );
}

const REPEAT_LOOP_SHELLS: Record<
  Extract<
    ModuleId,
    | "evidence_inbox"
    | "result_review"
    | "ancillary_opportunities"
    | "repeat_eligibility"
    | "documentation_reconciliation"
    | "evidence_timeline"
  >,
  Omit<Parameters<typeof RepeatLoopShell>[0], "id">
> = {
  evidence_inbox: {
    title: "Evidence Inbox",
    purpose:
      "Newly uploaded ancillary reports and imported documents awaiting Clinical Intelligence review.",
    reads: ["documents", "case_document_readiness"],
    writes: ["ci_evidence_records", "patient_journey_events"],
    producesFor: "Result Review and Documentation Reconciliation.",
  },
  result_review: {
    title: "Result Review",
    purpose:
      "AI-reviewed reports with extracted findings, key abnormalities, and suggested ICDs — every item human-verified before use.",
    reads: ["documents", "ci_evidence_records"],
    writes: ["ci_evidence_records"],
    producesFor: "Ancillary Opportunities and Repeat Eligibility.",
  },
  ancillary_opportunities: {
    title: "Ancillary Opportunities",
    purpose:
      "Suggested BrainWave / VitalWave / Ultrasound services justified by report findings, routed to Plexus IQ / Admin Review.",
    reads: ["ci_evidence_records", "patient_screenings"],
    writes: ["ci_learning_items"],
    producesFor: "Plexus IQ Initial Qualification Review.",
  },
  repeat_eligibility: {
    title: "Repeat Eligibility",
    purpose:
      "Repeat opportunities created after prior testing — payer interval (PPO 6mo / Medicare 12mo), due date, admin-review-open date, and cooldown state.",
    reads: ["cooldown_records", "ancillary_appointments", "documents"],
    writes: ["repeat_opportunities (proposed)"],
    producesFor: "Plexus IQ Repeat Testing Review.",
  },
  documentation_reconciliation: {
    title: "Documentation Reconciliation",
    purpose:
      "At report upload, checks report saved + order note present + procedure note present. Reuses the existing Ancillary Readiness read model — honest Present / Missing / Needs Review states.",
    reads: ["case_document_readiness", "documents"],
    writes: ["patient_journey_events"],
    producesFor: "Billing readiness gate and the patient chart.",
  },
  evidence_timeline: {
    title: "Evidence Timeline",
    purpose:
      "Longitudinal view of prior reports, findings, ICD suggestions, repeat opportunities, admin decisions, and outreach events.",
    reads: ["patient_journey_events", "ci_evidence_records", "documents"],
    writes: [],
    producesFor: "Patient Directory / Plexus EHR chart display.",
  },
};

// ───── Page ─────────────────────────────────────────────────────────────

export default function ClinicalIntelligencePage() {
  const [activeModule, setActiveModule] = useState<ModuleId>("learning_center");

  const content = () => {
    switch (activeModule) {
      case "learning_center":
        return <LearningCenter />;
      case "rule_builder":
        return <RuleBuilder />;
      case "rule_library":
        return <RuleLibrary />;
      case "sandbox":
        return <Sandbox />;
      case "version_history":
        return <VersionHistory />;
      case "approval_queue":
        return <ApprovalQueue />;
      case "analytics":
        return <Analytics />;
      case "traceability":
        return <Traceability />;
      case "audit_center":
        return <AuditCenter />;
      case "diagnosis_mapping":
        return <DiagnosisMapping />;
      case "symptom_library":
        return <SymptomLibrary />;
      case "medication_library":
        return <MedicationLibrary />;
      case "findings_library":
        return <FindingsLibrary />;
      case "ancillary_mapping":
        return <AncillaryMapping />;
      case "reasoning_library":
        return <ReasoningLibrary />;
      case "order_note_library":
        return <OrderNoteLibrary />;
      case "cms_watch":
        return <CmsWatch />;
      case "emr_wiring":
        return <EmrWiring />;
      case "guardrails":
        return <Guardrails />;
      case "knowledge_objects":
        return <KnowledgeObjects />;
      case "evidence_inbox":
      case "result_review":
      case "ancillary_opportunities":
      case "repeat_eligibility":
      case "documentation_reconciliation":
      case "evidence_timeline":
        return <RepeatLoopShell id={activeModule} {...REPEAT_LOOP_SHELLS[activeModule]} />;
    }
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-slate-50/60">
      <header className="border-b border-slate-200 bg-gradient-to-r from-violet-50 via-white to-indigo-50 px-5 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/plexus-iq"
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            data-testid="link-back-plexus-iq"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Plexus IQ
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <Sparkles className="w-4 h-4 text-violet-600" />
          <div>
            <h1 className="text-sm font-bold text-slate-900" data-testid="text-ci-page-title">
              Clinical Intelligence &amp; Governance
            </h1>
            <p className="text-[11px] text-slate-500">
              The system AI brain — every rule human-approved, every decision traceable, documentation CMS
              audit-ready and legally defensible.
            </p>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] text-violet-700 border-violet-200 bg-violet-50">
            Prototype · local only
          </Badge>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-white/70 p-3">
          {MODULE_GROUPS.map((group) => (
            <div key={group} className="mb-3">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group}</div>
              {MODULES.filter((m) => m.group === group).map((m) => {
                const Icon = m.icon;
                const active = activeModule === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setActiveModule(m.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                      active ? "bg-violet-100 font-semibold text-violet-900" : "text-slate-600 hover:bg-slate-100"
                    }`}
                    data-testid={`nav-ci-${m.id}`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto p-4">{content()}</main>
      </div>
    </div>
  );
}
