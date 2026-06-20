import type { PatientScreening } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import {
  computePlexusIqStatus,
  computePlexusIqFlags,
} from "@/lib/plexusIqStatus";

// One patient row in the Plexus IQ clean operating list.
//
// Columns ONLY:
//   Checkbox · Patient Name · DOB · Insurance · Plexus IQ Status · Flags · Review · Delete
//
// No phone, facility, or ancillary icons. Missing info / cooldown /
// stale evidence / packet blockers render as the ⚠ Flags popover —
// never as a status.

export type PlexusIQOperatingRowProps = {
  patient: PatientScreening;
  isRunning: boolean;
  selected: boolean;
  isAdmin: boolean;
  onToggleSelect: (checked: boolean) => void;
  onOpenReview: () => void;
  onDelete: () => void;
};

export function PlexusIQOperatingRow({
  patient,
  isRunning,
  selected,
  isAdmin,
  onToggleSelect,
  onOpenReview,
  onDelete,
}: PlexusIQOperatingRowProps) {
  const statusMeta = computePlexusIqStatus(patient, { isRunning });
  const flags = computePlexusIqFlags(patient);

  const displayName = (patient.name || "").trim() || "Unnamed patient";
  const ageDisplay = typeof patient.age === "number" ? `${patient.age}yo` : null;
  const isUnder16 = typeof patient.age === "number" && patient.age < 16;

  const openReview = () => {
    if (isAdmin) onOpenReview();
  };

  return (
    <div
      className="grid grid-cols-[auto_minmax(140px,1.6fr)_minmax(96px,0.9fr)_minmax(120px,1.1fr)_minmax(150px,0.9fr)_auto_auto_auto] gap-3 items-center px-3 py-2 border border-slate-200 rounded-xl bg-white hover:bg-slate-50/60 transition-colors"
      data-testid={`plexus-iq-operating-row-${patient.id}`}
      data-row-type="plexus-iq-operating-row"
    >
      {/* Checkbox */}
      <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
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
        className="text-left min-w-0"
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
      <div className="text-xs text-slate-600 truncate">
        {patient.dob ? (
          <span title="DOB">{patient.dob}</span>
        ) : (
          <span className="italic text-slate-400">—</span>
        )}
        {ageDisplay && <span className="ml-1 text-slate-500">· {ageDisplay}</span>}
      </div>

      {/* Insurance */}
      <div className="text-xs text-slate-600 truncate" title={patient.insurance ?? ""}>
        {patient.insurance || <span className="italic text-slate-400">—</span>}
      </div>

      {/* Plexus IQ Status */}
      <span
        className={`justify-self-start inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusMeta.pillClass}`}
        data-testid={`pill-operating-row-status-${patient.id}`}
      >
        {statusMeta.running && <Loader2 className="h-3 w-3 animate-spin" />}
        {statusMeta.label}
      </span>

      {/* Flags */}
      <div className="flex items-center justify-end">
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

      {/* Review */}
      <div className="flex items-center justify-end">
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

      {/* Delete */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Remove this patient?")) onDelete();
          }}
          aria-label="Remove patient"
          title="Remove patient"
          className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors"
          data-testid={`button-operating-row-delete-${patient.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export default PlexusIQOperatingRow;
