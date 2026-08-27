// Facility-aware clinician selector for the Plexus IQ batch flow.
//
// Shows active clinicians configured for the selected facility (from the
// Organization Settings source), plus an always-present "Other / Free Text"
// option. Emits a normalized clinician context:
//   { clinicianId, clinicianName, clinicianSource } | null
//
// Behavior (per spec):
//  • single active clinician for the facility → preselect it;
//  • multiple → require explicit selection;
//  • none → default to free text immediately;
//  • free text → text input, trimmed, required before it counts as selected.
//
// This component NEVER creates a permanent clinician from free text.

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFacilityCliniciansByName } from "@/hooks/api/organization";

export type ClinicianContext = {
  clinicianId: number | null;
  clinicianName: string;
  clinicianSource: "facility_clinician" | "free_text";
};

const FREE_TEXT = "__free_text__";

export function ClinicianSelector({
  facilityName,
  value,
  onChange,
  idPrefix = "plexus-iq-clinician",
}: {
  facilityName: string | null | undefined;
  value: ClinicianContext | null;
  onChange: (ctx: ClinicianContext | null) => void;
  idPrefix?: string;
}) {
  const { data, isLoading } = useFacilityCliniciansByName(facilityName);
  const clinicians = useMemo(() => data?.clinicians ?? [], [data]);

  // Selection is either a clinician id (as string) or FREE_TEXT.
  const [selectKey, setSelectKey] = useState<string>("");
  const [freeText, setFreeText] = useState<string>("");

  // Re-seed the default selection when the facility (and thus the clinician
  // list) changes. Single → preselect; none → free text; multiple → unset.
  useEffect(() => {
    if (isLoading) return;
    if (clinicians.length === 1) {
      const only = clinicians[0];
      setSelectKey(String(only.id));
      onChange({ clinicianId: only.id, clinicianName: only.displayName, clinicianSource: "facility_clinician" });
    } else if (clinicians.length === 0) {
      setSelectKey(FREE_TEXT);
      // Free text starts empty → not yet a valid selection.
      onChange(freeText.trim() ? { clinicianId: null, clinicianName: freeText.trim(), clinicianSource: "free_text" } : null);
    } else {
      setSelectKey("");
      onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityName, isLoading, clinicians.length]);

  function handleSelect(key: string) {
    setSelectKey(key);
    if (key === FREE_TEXT) {
      onChange(freeText.trim() ? { clinicianId: null, clinicianName: freeText.trim(), clinicianSource: "free_text" } : null);
      return;
    }
    const id = parseInt(key, 10);
    const c = clinicians.find((x) => x.id === id);
    if (c) onChange({ clinicianId: c.id, clinicianName: c.displayName, clinicianSource: "facility_clinician" });
    else onChange(null);
  }

  function handleFreeText(text: string) {
    setFreeText(text);
    onChange(text.trim() ? { clinicianId: null, clinicianName: text.trim(), clinicianSource: "free_text" } : null);
  }

  const showFreeText = selectKey === FREE_TEXT;
  void value; // controlled upstream; local UI state mirrors the emitted ctx

  return (
    <div>
      <Label htmlFor={`${idPrefix}-select`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Clinician
      </Label>
      <Select value={selectKey} onValueChange={handleSelect} disabled={!facilityName}>
        <SelectTrigger id={`${idPrefix}-select`} className="mt-1 h-9" data-testid="select-plexus-iq-clinician">
          <SelectValue placeholder={facilityName ? "Select a clinician…" : "Pick a facility first"} />
        </SelectTrigger>
        <SelectContent>
          {clinicians.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.displayName}{c.credentials ? `, ${c.credentials}` : ""}
            </SelectItem>
          ))}
          <SelectItem value={FREE_TEXT}>Other / Free Text</SelectItem>
        </SelectContent>
      </Select>
      {showFreeText && (
        <Input
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          placeholder="Clinician name (e.g. Dr Jane Smith)"
          className="mt-2 h-9 text-sm"
          data-testid="input-plexus-iq-clinician-freetext"
        />
      )}
    </div>
  );
}
