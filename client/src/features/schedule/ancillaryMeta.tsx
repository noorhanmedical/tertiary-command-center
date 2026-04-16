import type { LucideIcon } from "lucide-react";
import { Activity, Brain, HeartPulse, Scan } from "lucide-react";

export type AncillaryCategory = "brainwave" | "vitalwave" | "ultrasound" | "other";

export const categoryLabels: Record<AncillaryCategory, string> = {
  brainwave: "BrainWave",
  vitalwave: "VitalWave",
  ultrasound: "Ultrasound Studies",
  other: "Other",
};

export const categoryIcons: Record<AncillaryCategory, LucideIcon> = {
  brainwave: Brain,
  vitalwave: HeartPulse,
  ultrasound: Scan,
  other: Activity,
};

export const categoryStyles: Record<
  AncillaryCategory,
  { bg: string; border: string; accent: string; icon: string }
> = {
  brainwave: {
    bg: "bg-violet-50/90",
    border: "border-violet-200/70",
    accent: "text-violet-700",
    icon: "text-violet-500",
  },
  vitalwave: {
    bg: "bg-emerald-50/90",
    border: "border-emerald-200/70",
    accent: "text-emerald-700",
    icon: "text-emerald-500",
  },
  ultrasound: {
    bg: "bg-sky-50/90",
    border: "border-sky-200/70",
    accent: "text-sky-700",
    icon: "text-sky-500",
  },
  other: {
    bg: "bg-slate-50/90",
    border: "border-slate-200/70",
    accent: "text-slate-700",
    icon: "text-slate-500",
  },
};

const ULTRASOUND_KEYWORDS = [
  "ultrasound",
  "carotid",
  "arterial",
  "venous",
  "aorta",
  "abdomen",
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

export function isImagingTest(testName: string): boolean {
  return getAncillaryCategory(testName) === "ultrasound";
}

export function getBadgeColor(category: string): string {
  switch (category) {
    case "brainwave":
      return "bg-violet-100 text-violet-700";
    case "vitalwave":
      return "bg-emerald-100 text-emerald-700";
    case "ultrasound":
      return "bg-sky-100 text-sky-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}
