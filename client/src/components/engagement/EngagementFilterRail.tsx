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
  Ban,
  XCircle,
  Sparkles,
  LayoutList,
  UserCheck,
  Stethoscope,
  MapPin,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import {
  SMART_FILTERS,
  SMART_FILTER_GROUP_LABELS,
  SMART_FILTER_GROUP_ORDER,
  type SmartFilterKey,
  type SmartFilterGroup,
} from "./engagementShared";

const ICONS: Record<SmartFilterKey, LucideIcon> = {
  all: LayoutList,
  ready_to_assign: CheckCircle2,
  assigned: UserCheck,
  visit_scheduling: Stethoscope,
  outreach_scheduling: MapPin,
  repeat_test_due: Repeat,
  due_today: CalendarClock,
  overdue: AlarmClockOff,
  due_soon: Clock,
  follow_up: RefreshCw,
  callbacks: PhoneCall,
  no_answer: PhoneMissed,
  left_voicemail: Voicemail,
  needs_scheduling: CalendarPlus,
  blocked: Ban,
  declined: XCircle,
  re_eligible: Sparkles,
};

// Filters that read as "attention / problem" states get a subtle
// warm accent on their count chip when non-empty.
const WARN_KEYS = new Set<SmartFilterKey>(["overdue", "blocked"]);

export function EngagementFilterRail({
  counts,
  active,
  onChange,
}: {
  counts: Record<SmartFilterKey, number>;
  active: SmartFilterKey;
  onChange: (key: SmartFilterKey) => void;
}) {
  function renderButton(key: SmartFilterKey, label: string) {
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
  }

  const allFilter = SMART_FILTERS.find((f) => f.key === "all");

  return (
    <nav
      className="flex flex-col gap-0.5"
      aria-label="Smart filters"
      data-testid="engagement-filter-rail"
    >
      <div className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
        Smart Filters
      </div>
      {allFilter ? renderButton(allFilter.key, allFilter.label) : null}

      {SMART_FILTER_GROUP_ORDER.map((group: SmartFilterGroup) => {
        const items = SMART_FILTERS.filter((f) => f.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="mt-1.5 flex flex-col gap-0.5">
            <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300 dark:text-slate-600">
              {SMART_FILTER_GROUP_LABELS[group]}
            </div>
            {items.map((f) => renderButton(f.key, f.label))}
          </div>
        );
      })}
    </nav>
  );
}
