import { Maximize2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function RailIcon({
  icon,
  title,
  hoverClass,
  testId,
  popoverContent,
  popoverClassName,
  onExpand,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  hoverClass: string;
  testId: string;
  popoverContent: React.ReactNode;
  popoverClassName?: string;
  onExpand?: () => void;
  badge?: number;
}) {
  return (
    <div className="relative group">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={title}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition ${hoverClass}`}
            data-testid={testId}
          >
            {icon}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className={popoverClassName}
          data-testid={`${testId}-popover`}
        >
          {popoverContent}
        </PopoverContent>
      </Popover>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          title="Open in playing field"
          className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity hover:border-indigo-300 hover:text-indigo-600 focus:opacity-100"
          data-testid={`${testId}-expand`}
        >
          <Maximize2 className="h-2.5 w-2.5" />
        </button>
      )}
      {badge != null && badge > 0 && (
        <span
          className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-sm"
          data-testid={`${testId}-badge`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </div>
  );
}
