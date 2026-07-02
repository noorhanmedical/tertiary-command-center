// Clinical Intelligence & Governance — localStorage-backed prototype store.
//
// Pattern mirrors plexusIqBatchSession.ts: a single storage key + a
// CustomEvent so every mounted consumer (Admin Review drawer, the
// governance page) stays in sync within the tab, plus the `storage`
// event for cross-tab sync. Prototype only — no server persistence.

import { useCallback, useEffect, useState } from "react";
import {
  ciId,
  CI_ANCILLARY_LABELS,
  CI_SCOPE_LABELS,
  type CiAuditEntry,
  type CiEvidenceRecord,
  type CiLearningItem,
  type CiLearningStatus,
  type CiRule,
  type CiRuleStatus,
  type CiStoreState,
} from "./types";
import { seededRules } from "./seeds";

const STORAGE_KEY = "plexusIq.clinicalIntelligence.v1";
const CHANGED_EVENT = "plexusIq:clinicalIntelligenceChanged";

const EMPTY: CiStoreState = { learningItems: [], rules: [], evidence: [], audit: [] };

function safeParse(raw: string | null): CiStoreState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      learningItems: Array.isArray(parsed.learningItems) ? parsed.learningItems : [],
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    };
  } catch {
    return null;
  }
}

export function readCiState(): CiStoreState {
  try {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
    // First load — seed the rule library with example governance rules so
    // the prototype is workable out of the box. Seeds are editable like
    // any other rule and marked `seeded: true`.
    const initial: CiStoreState = { ...EMPTY, rules: seededRules() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  } catch {
    return { ...EMPTY };
  }
}

function writeCiState(next: CiStoreState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable; prototype state is session-only then */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch {
    /* noop */
  }
}

function mutate(fn: (state: CiStoreState) => CiStoreState): CiStoreState {
  const next = fn(readCiState());
  writeCiState(next);
  return next;
}

function auditEntry(
  by: string,
  action: string,
  entityType: CiAuditEntry["entityType"],
  entityId: string,
  entityName: string,
  detail?: string,
): CiAuditEntry {
  return {
    id: ciId("aud"),
    at: new Date().toISOString(),
    by,
    action,
    entityType,
    entityId,
    entityName,
    detail,
  };
}

// ───── Mutations ────────────────────────────────────────────────────────

export function ciAddLearningItem(
  item: Omit<CiLearningItem, "id" | "createdAt">,
): CiLearningItem {
  const full: CiLearningItem = {
    ...item,
    id: ciId("learn"),
    createdAt: new Date().toISOString(),
  };
  mutate((s) => ({
    ...s,
    learningItems: [full, ...s.learningItems],
    audit: [
      auditEntry(
        item.createdBy,
        "learning_item_created",
        "learning_item",
        full.id,
        full.ruleName || full.instruction.slice(0, 60),
        `Scope: ${CI_SCOPE_LABELS[full.scope]} · Ancillary: ${CI_ANCILLARY_LABELS[full.affectedAncillary]}`,
      ),
      ...s.audit,
    ],
  }));
  return full;
}

export function ciUpdateLearningItem(
  id: string,
  by: string,
  patch: Partial<CiLearningItem>,
): void {
  mutate((s) => {
    const item = s.learningItems.find((l) => l.id === id);
    if (!item) return s;
    return {
      ...s,
      learningItems: s.learningItems.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      audit: [
        auditEntry(by, "learning_item_updated", "learning_item", id, item.ruleName || item.instruction.slice(0, 60)),
        ...s.audit,
      ],
    };
  });
}

export function ciSetLearningStatus(id: string, by: string, status: CiLearningStatus): void {
  mutate((s) => {
    const item = s.learningItems.find((l) => l.id === id);
    if (!item) return s;
    return {
      ...s,
      learningItems: s.learningItems.map((l) => (l.id === id ? { ...l, status } : l)),
      audit: [
        auditEntry(
          by,
          `learning_item_${status}`,
          "learning_item",
          id,
          item.ruleName || item.instruction.slice(0, 60),
          `Status → ${status}`,
        ),
        ...s.audit,
      ],
    };
  });
}

export function ciAddRule(
  rule: Omit<CiRule, "id" | "createdAt" | "updatedAt" | "version" | "usageCount" | "history">,
): CiRule {
  const now = new Date().toISOString();
  const full: CiRule = {
    ...rule,
    id: ciId("rule"),
    version: 1,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    history: [
      { version: 1, at: now, by: rule.createdBy, summary: "Rule created", status: rule.status },
    ],
  };
  mutate((s) => ({
    ...s,
    rules: [full, ...s.rules],
    audit: [auditEntry(rule.createdBy, "rule_created", "rule", full.id, full.name), ...s.audit],
  }));
  return full;
}

export function ciUpdateRule(
  id: string,
  by: string,
  patch: Partial<CiRule>,
  changeSummary = "Rule updated",
): void {
  const now = new Date().toISOString();
  mutate((s) => {
    const rule = s.rules.find((r) => r.id === id);
    if (!rule) return s;
    const nextVersion = rule.version + 1;
    const nextStatus = (patch.status ?? rule.status) as CiRuleStatus;
    return {
      ...s,
      rules: s.rules.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patch,
              version: nextVersion,
              updatedAt: now,
              history: [
                ...r.history,
                { version: nextVersion, at: now, by, summary: changeSummary, status: nextStatus },
              ],
            }
          : r,
      ),
      audit: [auditEntry(by, "rule_updated", "rule", id, rule.name, changeSummary), ...s.audit],
    };
  });
}

export function ciSetRuleStatus(id: string, by: string, status: CiRuleStatus): void {
  ciUpdateRule(id, by, { status }, `Status → ${status}`);
}

export function ciConvertLearningToRule(
  learningId: string,
  by: string,
  overrides: Partial<CiRule> = {},
): CiRule | null {
  const state = readCiState();
  const item = state.learningItems.find((l) => l.id === learningId);
  if (!item) return null;
  const rule = ciAddRule({
    name: item.ruleName || `Rule from learning: ${item.instruction.slice(0, 40)}`,
    description: item.instruction,
    triggerSource: item.triggerSource,
    targetAncillary: item.affectedAncillary,
    targetOutputs: item.affectedOutputs,
    evidenceRequirement: item.evidenceRequirement,
    scope: item.scope,
    approvalRequirement: item.approvalRequirement,
    status: "draft",
    conflictFlags: [],
    sourceLearningItemId: item.id,
    sourceEvidence: item.sourceContext?.evidenceLabels ?? [],
    createdBy: by,
    ...overrides,
  });
  mutate((s) => ({
    ...s,
    learningItems: s.learningItems.map((l) =>
      l.id === learningId ? { ...l, status: "converted", convertedRuleId: rule.id } : l,
    ),
  }));
  return rule;
}

export function ciRecordEvidence(
  record: Omit<CiEvidenceRecord, "id" | "at" | "usedInRuleIds">,
): CiEvidenceRecord {
  const full: CiEvidenceRecord = {
    ...record,
    id: ciId("ev"),
    at: new Date().toISOString(),
    usedInRuleIds: [],
  };
  mutate((s) => {
    // Dedupe: same patient + label + sourceType keeps the latest decision,
    // but merges forward the prior assigned ancillary and rule usage so an
    // approve after an attach (or vice versa) never loses traceability.
    const prior = s.evidence.find(
      (e) =>
        e.patientId === full.patientId &&
        e.label.toLowerCase() === full.label.toLowerCase() &&
        e.sourceType === full.sourceType,
    );
    if (prior) {
      full.usedInRuleIds = prior.usedInRuleIds;
      if (!full.assignedAncillary) full.assignedAncillary = prior.assignedAncillary;
    }
    const rest = s.evidence.filter(
      (e) =>
        !(
          e.patientId === full.patientId &&
          e.label.toLowerCase() === full.label.toLowerCase() &&
          e.sourceType === full.sourceType
        ),
    );
    return {
      ...s,
      evidence: [full, ...rest],
      audit: [
        auditEntry(
          record.decidedBy,
          record.status === "approved" ? "evidence_approved" : "evidence_rejected",
          "evidence",
          full.id,
          full.label,
          `${full.sourceType} · ${full.patientName}`,
        ),
        ...s.audit,
      ],
    };
  });
  return full;
}

export function ciMarkEvidenceUsedInRule(evidenceId: string, ruleId: string): void {
  mutate((s) => ({
    ...s,
    evidence: s.evidence.map((e) =>
      e.id === evidenceId && !e.usedInRuleIds.includes(ruleId)
        ? { ...e, usedInRuleIds: [...e.usedInRuleIds, ruleId] }
        : e,
    ),
  }));
}

// ───── React hook ───────────────────────────────────────────────────────

export function useClinicalIntelligence(): CiStoreState {
  const [state, setState] = useState<CiStoreState>(() => readCiState());
  useEffect(() => {
    const sync = () => setState(readCiState());
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return state;
}

export function useCiRefresh(): () => void {
  return useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
    } catch {
      /* noop */
    }
  }, []);
}
