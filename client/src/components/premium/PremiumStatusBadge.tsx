import type { ReactNode } from "react";

// Single premium status badge. One source of truth for status pills
// (Completed / Needs Completion / Admin Review / etc.). Tones map to
// the platform-token palette so the same badge looks consistent
// everywhere.

type Tone =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "review"
  | "neutral";

const toneClass: Record<Tone, string> = {
  default: "bg-[#F8F9FB] border-[#DCE2EA] text-[#475467]",
  neutral: "bg-[#F8F9FB] border-[#DCE2EA] text-[#475467]",
  success: "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]",
  warning: "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]",
  danger: "bg-[#FFF1F2] border-[#FECDD3] text-[#BE123C]",
  info: "bg-[#EFF6FF] border-[#DBEAFE] text-[#1D4ED8]",
  review: "bg-[#F5F3FF] border-[#DDD6FE] text-[#7C3AED]",
};

type PremiumStatusBadgeProps = {
  label: string;
  tone?: Tone;
  icon?: ReactNode;
  testId?: string;
  title?: string;
};

export function PremiumStatusBadge({
  label,
  tone = "default",
  icon,
  testId,
  title,
}: PremiumStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${toneClass[tone]}`}
      data-testid={testId}
      title={title}
    >
      {icon}
      {label}
    </span>
  );
}
