import type { LucideIcon } from "lucide-react";
import { Activity, Brain, HeartPulse, Scan } from "lucide-react";
import {
  getAncillaryCategory as sharedGetAncillaryCategory,
  type AncillaryCategory as SharedAncillaryCategory,
} from "@shared/ancillaryCategory";

export type AncillaryCategory = SharedAncillaryCategory;

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
    bg: "bg-violet-50/60",
    border: "border-violet-300/60",
    accent: "text-violet-900",
    icon: "text-violet-700",
  },
  vitalwave: {
    bg: "bg-rose-50/60",
    border: "border-rose-300/60",
    accent: "text-rose-900",
    icon: "text-rose-700",
  },
  ultrasound: {
    bg: "bg-emerald-50/60",
    border: "border-emerald-300/60",
    accent: "text-emerald-900",
    icon: "text-emerald-700",
  },
  other: {
    bg: "bg-slate-50/90",
    border: "border-slate-200/70",
    accent: "text-slate-700",
    icon: "text-slate-500",
  },
};

export const getAncillaryCategory = sharedGetAncillaryCategory;

export function isImagingTest(testName: string): boolean {
  return getAncillaryCategory(testName) === "ultrasound";
}

export function getBadgeColor(category: string): string {
  switch (category) {
    case "brainwave":
      return "bg-violet-50 text-violet-800";
    case "vitalwave":
      return "bg-rose-50 text-rose-800";
    case "ultrasound":
      return "bg-emerald-50 text-emerald-800";
    default:
      return "bg-slate-50 text-slate-700";
  }
}
