import type { ReactNode } from "react";

// Premium empty state — used when a list or panel has nothing to
// show. Calmer than the prior "rounded-2xl card with centered icon".

type PremiumEmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
};

export function PremiumEmptyState({
  icon,
  title,
  description,
  action,
  testId,
}: PremiumEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center p-8 gap-2 rounded bg-white border border-dashed border-[#DCE2EA]"
      data-testid={testId}
    >
      {icon && (
        <div className="h-10 w-10 inline-flex items-center justify-center rounded bg-[#F8F9FB] text-[#667085]">
          {icon}
        </div>
      )}
      <div className="text-[14px] font-medium text-[#111827]">{title}</div>
      {description && (
        <p className="text-[12px] text-[#667085] max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
