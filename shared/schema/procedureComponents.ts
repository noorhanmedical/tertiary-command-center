// Slice F — typed procedure component evidence.
//
// Stored in procedure_events.metadata.components (JSONB) and validated at write
// time. A Procedure Note may claim a component occurred ONLY when its
// `performed` flag is true here. Pure + isomorphic (Zod only).

import { z } from "./_common";

const componentSchema = z.object({
  performed: z.boolean(),
  completedAt: z.string().datetime().optional(),
});
const eegComponentSchema = componentSchema.extend({
  channelCount: z.number().int().positive().optional(),
});

// ── BrainWave ──
export const brainWaveComponentsSchema = z.object({
  neuropsychologicalTesting: componentSchema,
  eeg: eegComponentSchema,
  ecg: componentSchema,
  vep: componentSchema,
  aep: componentSchema,
});
export type BrainWaveComponents = z.infer<typeof brainWaveComponentsSchema>;
export const BRAINWAVE_COMPONENT_KEYS = ["neuropsychologicalTesting", "eeg", "ecg", "vep", "aep"] as const;

// ── VitalWave ──
export const vitalWaveComponentsSchema = z.object({
  autonomicTesting: componentSchema,
  tiltTable: componentSchema,
  bloodPressureHeartRateMonitoring: componentSchema,
  segmentalPressures: componentSchema,
  waveformAnalysis: componentSchema,
  rhythmEcg: componentSchema,
});
export type VitalWaveComponents = z.infer<typeof vitalWaveComponentsSchema>;
export const VITALWAVE_COMPONENT_KEYS = ["autonomicTesting", "tiltTable", "bloodPressureHeartRateMonitoring", "segmentalPressures", "waveformAnalysis", "rhythmEcg"] as const;

export type ProcedureComponents =
  | { service: "brainwave"; components: BrainWaveComponents }
  | { service: "vitalwave"; components: VitalWaveComponents };

export function serviceKeyForComponents(serviceType: string): "brainwave" | "vitalwave" | null {
  const s = (serviceType || "").toLowerCase();
  if (s.includes("brain")) return "brainwave";
  if (s.includes("vital")) return "vitalwave";
  return null;
}

/** Validate a component-evidence payload for a service. */
export function parseProcedureComponents(serviceType: string, raw: unknown): ProcedureComponents | null {
  const key = serviceKeyForComponents(serviceType);
  if (key === "brainwave") {
    const r = brainWaveComponentsSchema.safeParse(raw);
    return r.success ? { service: "brainwave", components: r.data } : null;
  }
  if (key === "vitalwave") {
    const r = vitalWaveComponentsSchema.safeParse(raw);
    return r.success ? { service: "vitalwave", components: r.data } : null;
  }
  return null;
}

/** Which component keys are marked performed. */
export function performedComponentKeys(pc: ProcedureComponents): string[] {
  const entries = Object.entries(pc.components as Record<string, { performed: boolean }>);
  return entries.filter(([, v]) => v && v.performed === true).map(([k]) => k);
}

/** True only when EVERY expected component for the service is performed. */
export function allExpectedComponentsPerformed(pc: ProcedureComponents): boolean {
  const keys = pc.service === "brainwave" ? BRAINWAVE_COMPONENT_KEYS : VITALWAVE_COMPONENT_KEYS;
  const c = pc.components as Record<string, { performed: boolean }>;
  return keys.every((k) => c[k]?.performed === true);
}
