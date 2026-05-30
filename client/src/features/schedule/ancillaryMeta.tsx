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
    bg: "bg-violet-50/90",
    border: "border-violet-200/70",
    accent: "text-violet-700",
    icon: "text-violet-500",
  },
  vitalwave: {
    bg: "bg-red-50/90",
    border: "border-red-200/70",
    accent: "text-red-700",
    icon: "text-red-500",
  },
  ultrasound: {
    bg: "bg-emerald-50/90",
    border: "border-emerald-200/70",
    accent: "text-emerald-700",
    icon: "text-emerald-500",
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
      return "bg-violet-100 text-violet-700";
    case "vitalwave":
      return "bg-red-100 text-red-700";
    case "ultrasound":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}
