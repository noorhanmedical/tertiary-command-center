import { Phone, Calendar as CalendarIcon, Maximize2, PhoneCall, Stethoscope, Activity, Check } from "lucide-react";
import { getInitials } from "@/lib/format";

// Purpose-built compact (thin-rail) layouts for the Team Portal right
// work-queue panel. These render only when the right rail is in `small`
// (220px) mode — they are a dedicated JSX branch, NOT a CSS-narrowed copy
// of the normal cards, so the rows stay legible at ~200px usable width.

const ACCENT = "#4863A0";

// Small initials avatar shared by every compact row.
function InitialsAvatar({
  name,
  tint = "sky",
}: {
  name: string;
  tint?: "sky" | "violet" | "emerald";
}) {
  const tintClass =
    tint === "violet"
      ? "bg-violet-100 text-violet-700"
      : tint === "emerald"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-sky-100 text-sky-700";
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${tintClass}`}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  );
}

export type CompactCallRowProps = {
  name: string;
  callReason: string;
  canCall: boolean;
  testIdKey: string | number;
  onOpenPatient: () => void;
  onOpenCall: () => void;
  onOpenSchedule: () => void;
  onOpenCase: () => void;
};

// Vertically stacked icon-row for the call list. No horizontal waste:
// avatar + name (two lines, first line never truncates) on top, a reason
// badge + a three-icon quick-action strip below.
export function CompactCallRow({
  name,
  callReason,
  canCall,
  testIdKey,
  onOpenPatient,
  onOpenCall,
  onOpenSchedule,
  onOpenCase,
}: CompactCallRowProps) {
  return (
    <div
      className="glass-tile glass-tile-interactive !rounded-xl border-l-4 border-l-sky-400/80 px-2 py-2"
      data-testid={`workspace-call-compact-${testIdKey}`}
    >
      <button
        type="button"
        onClick={onOpenPatient}
        className="flex w-full items-start gap-2 text-left"
        title={`Open ${name} in Playground`}
        data-testid={`button-call-patient-${testIdKey}`}
      >
        <InitialsAvatar name={name} tint="emerald" />
        <span className="min-w-0 flex-1 text-[12px] font-semibold leading-tight text-slate-900 line-clamp-2">
          {name}
        </span>
      </button>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <span
          className="inline-flex max-w-[96px] items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700"
          title={callReason}
          data-testid={`text-call-reason-${testIdKey}`}
        >
          <PhoneCall className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{callReason}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={!canCall}
            onClick={onOpenCall}
            aria-label={`Call ${name}`}
            title="Open call tab"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-emerald-600 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid={`button-call-phone-${testIdKey}`}
          >
            <Phone className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenSchedule}
            aria-label={`Schedule ${name}`}
            title="Open schedule tab"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-colors hover:bg-blue-50"
            style={{ color: ACCENT }}
            data-testid={`button-call-schedule-${testIdKey}`}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenCase}
            aria-label={`Open case overview for ${name}`}
            title="Open case overview tab"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
            data-testid={`button-call-case-${testIdKey}`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export type CompactClinicRowProps = {
  name: string;
  time: string;
  consentDone: boolean;
  testIdKey: string | number;
  onClick: () => void;
};

// Compact clinic-schedule row: left-pinned time chip, patient initials,
// right-pinned consent dot.
export function CompactClinicRow({
  name,
  time,
  consentDone,
  testIdKey,
  onClick,
}: CompactClinicRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-tile glass-tile-interactive !rounded-xl flex w-full items-center gap-2 px-2 py-1.5 text-left"
      data-testid={`patient-row-compact-${testIdKey}`}
    >
      <span className="inline-flex shrink-0 items-center rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sky-700">
        {time}
      </span>
      <InitialsAvatar name={name} tint="sky" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-900">
        {name}
      </span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          consentDone ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
        }`}
        title={consentDone ? "Consent signed" : "Consent needed"}
        data-testid={`consent-dot-${testIdKey}`}
      >
        {consentDone ? <Check className="h-3 w-3" /> : <Stethoscope className="h-3 w-3" />}
      </span>
    </button>
  );
}

export type CompactAncillaryRowProps = {
  name: string;
  time: string;
  serviceType: string;
  testIdKey: string | number;
  onClick: () => void;
};

// Compact ancillary-schedule row: time chip + procedure icon + initials.
export function CompactAncillaryRow({
  name,
  time,
  serviceType,
  testIdKey,
  onClick,
}: CompactAncillaryRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-tile glass-tile-interactive !rounded-xl flex w-full items-center gap-2 px-2 py-1.5 text-left"
      data-testid={`workspace-ancillary-compact-${testIdKey}`}
    >
      <span className="inline-flex shrink-0 items-center rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-700">
        {time}
      </span>
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600"
        title={serviceType}
      >
        <Activity className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-900">
        {name}
      </span>
      <InitialsAvatar name={name} tint="violet" />
    </button>
  );
}
