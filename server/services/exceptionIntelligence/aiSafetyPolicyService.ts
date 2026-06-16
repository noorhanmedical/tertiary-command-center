// aiSafetyPolicyService — Phase 3 PR 3.4.
//
// Owns the answer to: "Which model provider are we authorised to call?
// Which confidence label may we report?" It does NOT call any model — it
// only reports what is allowed. The recommendation engine in PR 3.5 must
// consult this service before writing a log entry.
//
// Reads admin_settings.ai_safety.* with the Phase 2 hardening precedence:
// testType > facility > user > global > default.

import { getAdminSettingValue } from "../../repositories/adminSettings.repo";
import {
  AI_SAFETY_DOMAIN, AI_SAFETY_KEYS, MODEL_PROVIDERS,
  type AiSafetyPolicy, type ModelProvider,
} from "@shared/contracts/aiRecommendation";

type Scope = { facilityId: string | null; userId: string | null; testType: string | null };

async function readValue<T>(key: string, scope: Scope): Promise<{ value: T | null; source: "admin_settings" | "default" }> {
  if (scope.testType != null) {
    const ts = await getAdminSettingValue<T>(AI_SAFETY_DOMAIN, key, {
      facilityId: scope.facilityId ?? null, userId: scope.userId ?? null, testType: scope.testType,
    });
    if (ts !== null) return { value: ts, source: "admin_settings" };
  }
  if (scope.facilityId != null) {
    const fs = await getAdminSettingValue<T>(AI_SAFETY_DOMAIN, key, { facilityId: scope.facilityId });
    if (fs !== null) return { value: fs, source: "admin_settings" };
  }
  if (scope.userId != null) {
    const us = await getAdminSettingValue<T>(AI_SAFETY_DOMAIN, key, { userId: scope.userId });
    if (us !== null) return { value: us, source: "admin_settings" };
  }
  const g = await getAdminSettingValue<T>(AI_SAFETY_DOMAIN, key);
  if (g !== null) return { value: g, source: "admin_settings" };
  return { value: null, source: "default" };
}

function asProviderArray(v: unknown): ModelProvider[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<ModelProvider>();
  for (const raw of v) {
    if (typeof raw === "string" && (MODEL_PROVIDERS as readonly string[]).includes(raw)) {
      out.add(raw as ModelProvider);
    }
  }
  return Array.from(out);
}

function asProvider(v: unknown, fallback: ModelProvider): ModelProvider {
  return typeof v === "string" && (MODEL_PROVIDERS as readonly string[]).includes(v)
    ? (v as ModelProvider) : fallback;
}

function asReportingMode(v: unknown): AiSafetyPolicy["confidenceReportingMode"] {
  if (v === "rules_only" || v === "model_label" || v === "explicit_label") return v;
  return "rules_only";
}

/** Resolve the effective AI safety policy. Honours absolute Phase 3 rules. */
export async function getEffectiveAiSafetyPolicy(
  scope: { facilityId?: string | null; userId?: string | null; testType?: string | null } = {},
): Promise<AiSafetyPolicy> {
  const s: Scope = {
    facilityId: scope.facilityId ?? null,
    userId: scope.userId ?? null,
    testType: scope.testType ?? null,
  };
  const sources: AiSafetyPolicy["sources"] = {};

  const allowedRead = await readValue<{ value?: unknown }>(AI_SAFETY_KEYS.allowedModelProviders, s);
  sources[AI_SAFETY_KEYS.allowedModelProviders] = allowedRead.source;
  const allowed = asProviderArray((allowedRead.value as { value?: unknown } | null)?.value ?? ["rules_engine"]);
  const allowedFinal: ModelProvider[] = allowed.length > 0 ? allowed : ["rules_engine"];

  const defaultRead = await readValue<{ value?: unknown }>(AI_SAFETY_KEYS.defaultModelProvider, s);
  sources[AI_SAFETY_KEYS.defaultModelProvider] = defaultRead.source;
  const defaultProvider = asProvider(
    (defaultRead.value as { value?: unknown } | null)?.value, "rules_engine",
  );

  // Effective provider — start with default, downgrade if not allowed or
  // (for "openai") not configured via env.
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY);
  let effective: ModelProvider = defaultProvider;
  if (!allowedFinal.includes(effective)) effective = "rules_engine";
  if (effective === "openai" && !openAiConfigured) effective = "not_configured";
  if (effective === "openai") sources[AI_SAFETY_KEYS.defaultModelProvider] = "env";
  if (effective === "not_configured") sources[AI_SAFETY_KEYS.defaultModelProvider] = "env";

  const modeRead = await readValue<{ value?: unknown }>(AI_SAFETY_KEYS.confidenceReportingMode, s);
  sources[AI_SAFETY_KEYS.confidenceReportingMode] = modeRead.source;
  const confidenceReportingMode = asReportingMode(
    (modeRead.value as { value?: unknown } | null)?.value,
  );

  return {
    allowedModelProviders: allowedFinal,
    effectiveModelProvider: effective,
    confidenceReportingMode,
    humanReviewRequired: true,
    autoActionsEnabled: false,
    sources,
  };
}
