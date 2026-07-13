// Shared ancillary categorization. Used by:
//   - client/src/features/schedule/ancillaryMeta.tsx (re-exports)
//   - server/routes/batches.ts (calendar-summary aggregation)
//
// Single source of truth so the server-side calendar summary stays in
// lockstep with the client-side dot rendering.

export type AncillaryCategory = "brainwave" | "vitalwave" | "ultrasound" | "other";

const ULTRASOUND_KEYWORDS = [
  "ultrasound",
  "carotid",
  "arterial",
  "venous",
  "aorta",
  "aortic",
  "abdomen",
  "abdominal",
  "renal",
  "thyroid",
  "pelvic",
  "echo",
  "echocardiogram",
  "doppler",
] as const;

export function getAncillaryCategory(testName: string): AncillaryCategory {
  const t = String(testName || "").toLowerCase();
  if (t.includes("brainwave") || t.includes("eeg") || t.includes("neuro")) {
    return "brainwave";
  }
  if (t.includes("vitalwave") || t.includes("ekg") || t.includes("ecg") || t.includes("cardiac")) {
    return "vitalwave";
  }
  if (ULTRASOUND_KEYWORDS.some((k) => t.includes(k))) {
    return "ultrasound";
  }
  return "other";
}
