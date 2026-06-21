import type { PatientScreening } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  computePlexusIqStatus,
  computePlexusIqFlags,
} from "@/lib/plexusIqStatus";
import {
  categoryIcons,
  categoryStyles,
  getAncillaryCategory,
  type AncillaryCategory,
} from "@/features/schedule/ancillaryMeta";

const ANCILLARY_ORDER: AncillaryCategory[] = ["brainwave", "vitalwave", "ultrasound"];

// Shared grid column template for the operating list. The header row
// (PlexusIQOperatingList) and every data row must use this exact template so
// columns stay aligned at all viewport widths.
export const OPERATING_GRID_COLS =
  "grid-cols-[auto_minmax(140px,1.25fr)_minmax(150px,1fr)_minmax(130px,1fr)_minmax(140px,1fr)_auto_auto_auto]";

// One patient row in the Plexus IQ clean operating list.
//
// Columns ONLY:
//   Checkbox · Patient Name · DOB · Insurance · Plexus IQ Status · Flags ·
//   Ancillary Icons · Review
//
// No phone or facility. Missing info / cooldown / stale evidence / packet
// blockers render as the ⚠ Flags popover — never as a status.

export type PlexusIQOperatingRowProps = {
  patient: PatientScreening;
  isRunning: boolean;
  /** True while this patient's most recent edit failed to persist. */
  saveFailed?: boolean;
  selected: boolean;
  isAdmin: boolean;
  onToggleSelect: (checked: boolean) => void;
  onOpenReview: () => void;
};

export function PlexusIQOperatingRow({
  patient,
  isRunning,
  saveFailed,
  selected,
  isAdmin,
  onToggleSelect,
  onOpenReview,
}: PlexusIQOperatingRowProps) {
  const statusMeta = computePlexusIqStatus(patient, { isRunning });
  const flags = computePlexusIqFlags(patient, { saveFailed });

  const tests = patient.qualifyingTests || [];
  const ancillaryCounts = ANCILLARY_ORDER.reduce<Record<AncillaryCategory, number>>(
    (acc, cat) => {
      acc[cat] = tests.filter((t) => getAncillaryCategory(t) === cat).length;
      return acc;
    },
    { brainwave: 0, vitalwave: 0, ultrasound: 0, other: 0 },
  );

  const displayName = (patient.name || "").trim() || "Unnamed patient";
  const ageDisplay = typeof patient.age === "number" ? `${patient.age}yo` : null;
  const isUnder16 = typeof patient.age === "number" && patient.age < 16;

  const genderRaw = (patient.gender || "").trim();
  const genderDisplay = genderRaw
    ? genderRaw.length === 1
      ? genderRaw.toUpperCase()
      : genderRaw.charAt(0).toUpperCase()
    : "—";

  const openReview = () => {
    if (isAdmin) onOpenReview();
  };

  return (
    <div
      className={`grid ${OPERATING_GRID_COLS} gap-3 items-center px-3 py-2 border border-slate-200 rounded-xl bg-white hover:bg-slate-50/60 transition-colors`}
      data-testid={`plexus-iq-operating-row-${patient.id}`}
      data-row-type="plexus-iq-operating-row"
    >
      {/* Checkbox */}
      <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onToggleSelect(v === true)}
          aria-label={`Select ${displayName}`}
          data-testid={`checkbox-operating-row-${patient.id}`}
        />
      </div>

      {/* Name */}
      <button
        type="button"
        onClick={openReview}
        className="text-center min-w-0"
        data-testid={`text-operating-row-name-${patient.id}`}
      >
        <div className="text-sm font-semibold text-slate-900 truncate">
          {displayName}
        </div>
        {isUnder16 && (
          <span className="inline-flex items-center gap-1 mt-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-300 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider">
            &lt;16
          </span>
        )}
      </button>

      {/* DOB / age */}
      <div className="text-xs text-slate-600 truncate text-center">
        {patient.dob ? (
          <span title="DOB">{patient.dob}</span>
        ) : (
          <span className="italic text-slate-400">—</span>
        )}
        {ageDisplay && <span className="ml-1 text-slate-500">· {ageDisplay}</span>}
        <span className="ml-1 text-slate-500" title="Gender">· {genderDisplay}</span>
      </div>

      {/* Insurance */}
      <div className="text-xs text-slate-600 truncate text-center" title={patient.insurance ?? ""}>
        {patient.insurance || <span className="italic text-slate-400">—</span>}
      </div>

      {/* Plexus IQ Status */}
      <span
        className={`justify-self-center inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusMeta.pillClass}`}
        data-testid={`pill-operating-row-status-${patient.id}`}
      >
        {statusMeta.running && <Loader2 className="h-3 w-3 animate-spin" />}
        {statusMeta.label}
      </span>

      {/* Flags */}
      <div className="flex items-center justify-center">
        {flags.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                title="Needs attention"
                data-testid={`button-operating-row-flags-${patient.id}`}
              >
                <AlertTriangle className="h-3 w-3" />
                {flags.length}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-72 p-3"
              onClick={(e) => e.stopPropagation()}
              data-testid={`popover-operating-row-flags-${patient.id}`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Needs Attention
              </div>
              <ul className="space-y-2">
                {flags.map((f) => (
                  <li key={f.kind} className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-800">{f.label}</div>
                      <div className="text-[11px] text-slate-500 break-words">{f.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </div>

      {/* Qualifying ancillary icons */}
      <div className="flex items-center gap-2 justify-center">
        {ANCILLARY_ORDER.map((cat) => {
          const count = ancillaryCounts[cat];
          if (count === 0) return null;
          const Icon = categoryIcons[cat];
          const style = categoryStyles[cat];
          return (
            <span
              key={cat}
              className="relative inline-flex items-center"
              title={`${cat} (${count})`}
              data-testid={`icon-operating-row-${cat}-${patient.id}`}
            >
              <Icon className={`h-4 w-4 ${style.icon}`} strokeWidth={2} fill="none" />
              {count > 1 && (
                <span className="absolute -top-1 -right-2 inline-flex items-center justify-center min-w-[12px] h-3 px-1 rounded-full bg-slate-900 text-white text-[8px] font-semibold leading-none">
                  {count}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {/* Review */}
      <div className="flex items-center justify-center">
        {isAdmin && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenReview();
            }}
            aria-label="Admin Review"
            title="Admin Review"
            className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            data-testid={`button-operating-row-review-${patient.id}`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

    </div>
  );
}

export default PlexusIQOperatingRow;
