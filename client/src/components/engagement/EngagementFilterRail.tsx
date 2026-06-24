import {
  CheckCircle2,
  CalendarClock,
  AlarmClockOff,
  Clock,
  RefreshCw,
  PhoneCall,
  PhoneMissed,
  Voicemail,
  CalendarPlus,
  FileWarning,
  Ban,
  XCircle,
  Sparkles,
  LayoutList,
  type LucideIcon,
} from "lucide-react";
import { SMART_FILTERS, type SmartFilterKey } from "./engagementShared";

const ICONS: Record<SmartFilterKey, LucideIcon> = {
  all: LayoutList,
  ready_to_assign: CheckCircle2,
  due_today: CalendarClock,
  overdue: AlarmClockOff,
  due_soon: Clock,
  follow_up: RefreshCw,
  callbacks: PhoneCall,
  no_answer: PhoneMissed,
  left_voicemail: Voicemail,
  needs_scheduling: CalendarPlus,
  missing_pdf: FileWarning,
  blocked: Ban,
  declined: XCircle,
  re_eligible: Sparkles,
};

// Filters that read as "attention / problem" states get a subtle
// warm accent on their count chip when non-empty.
const WARN_KEYS = new Set<SmartFilterKey>(["overdue", "blocked", "missing_pdf"]);

export function EngagementFilterRail({
  counts,
  active,
  onChange,
}: {
  counts: Record<SmartFilterKey, number>;
  active: SmartFilterKey;
  onChange: (key: SmartFilterKey) => void;
}) {
  return (
    <nav
      className="flex flex-col gap-0.5"
      aria-label="Smart filters"
      data-testid="engagement-filter-rail"
    >
      <div className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
        Smart Filters
      </div>
      {SMART_FILTERS.map(({ key, label }) => {
        const Icon = ICONS[key];
        const count = counts[key] ?? 0;
        const isActive = active === key;
        const warn = WARN_KEYS.has(key) && count > 0;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            data-testid={`engagement-filter-${key}`}
            data-active={isActive ? "true" : "false"}
            aria-pressed={isActive}
            className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${
              isActive
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Icon
              className={`h-4 w-4 shrink-0 ${
                isActive
                  ? "text-white dark:text-slate-900"
                  : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"
              }`}
            />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span
              className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                isActive
                  ? "bg-white/20 text-white dark:bg-slate-900/15 dark:text-slate-900"
                  : warn
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              }`}
              data-testid={`engagement-filter-count-${key}`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
