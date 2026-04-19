export type TestPalette = {
  key: "brainwave" | "vitalwave" | "ultrasound" | "neutral";
  label: string;
  selectedBg: string;
  selectedText: string;
  selectedRing: string;
  hoverBorder: string;
  hoverBg: string;
  bookedBg: string;
  bookedBorder: string;
  bookedText: string;
  accentText: string;
  iconText: string;
  badgeBg: string;
  badgeText: string;
  dotBg: string;
};

export const BRAINWAVE_PALETTE: TestPalette = {
  key: "brainwave",
  label: "BrainWave",
  selectedBg: "bg-violet-600",
  selectedText: "text-white",
  selectedRing: "ring-violet-500/40",
  hoverBorder: "hover:border-violet-400",
  hoverBg: "hover:bg-violet-50",
  bookedBg: "bg-violet-50",
  bookedBorder: "border-violet-200",
  bookedText: "text-violet-800",
  accentText: "text-violet-700",
  iconText: "text-violet-600",
  badgeBg: "bg-violet-100",
  badgeText: "text-violet-700",
  dotBg: "bg-violet-600",
};

export const VITALWAVE_PALETTE: TestPalette = {
  key: "vitalwave",
  label: "VitalWave",
  selectedBg: "bg-rose-800",
  selectedText: "text-white",
  selectedRing: "ring-rose-700/40",
  hoverBorder: "hover:border-rose-500",
  hoverBg: "hover:bg-rose-50",
  bookedBg: "bg-rose-50",
  bookedBorder: "border-rose-200",
  bookedText: "text-rose-900",
  accentText: "text-rose-800",
  iconText: "text-rose-700",
  badgeBg: "bg-rose-100",
  badgeText: "text-rose-800",
  dotBg: "bg-rose-800",
};

export const ULTRASOUND_PALETTE: TestPalette = {
  key: "ultrasound",
  label: "Ultrasound",
  selectedBg: "bg-emerald-800",
  selectedText: "text-white",
  selectedRing: "ring-emerald-700/40",
  hoverBorder: "hover:border-emerald-500",
  hoverBg: "hover:bg-emerald-50",
  bookedBg: "bg-emerald-50",
  bookedBorder: "border-emerald-200",
  bookedText: "text-emerald-900",
  accentText: "text-emerald-800",
  iconText: "text-emerald-700",
  badgeBg: "bg-emerald-100",
  badgeText: "text-emerald-800",
  dotBg: "bg-emerald-800",
};

export const NEUTRAL_PALETTE: TestPalette = {
  ...BRAINWAVE_PALETTE,
  key: "neutral",
  label: "Schedule",
};

export function getTestPalette(testType: string | null | undefined): TestPalette {
  if (!testType) return NEUTRAL_PALETTE;
  const t = testType.toLowerCase();
  if (t.includes("brain")) return BRAINWAVE_PALETTE;
  if (t.includes("vital")) return VITALWAVE_PALETTE;
  if (
    t.includes("ultrasound") ||
    t.includes("doppler") ||
    t.includes("duplex") ||
    t.includes("echo") ||
    t.includes("tte")
  ) {
    return ULTRASOUND_PALETTE;
  }
  return NEUTRAL_PALETTE;
}
