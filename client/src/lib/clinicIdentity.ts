// Deterministic clinic identity helpers — the SINGLE shared source for a
// stable clinic color + short label in the Team Portal (Call List + Ancillary
// Schedule). There is no canonical clinic color field in the schema, so the
// color is derived deterministically from a stable clinic identifier (the
// facility string) via a fixed palette. Reuse this everywhere instead of the
// ad-hoc hardcoded facilityColor() helpers.

// Muted, professional dot palette (tailwind bg + a matching text tone). Kept
// distinct from the ancillary-service category colors so a clinic dot never
// reads as a service badge.
const CLINIC_DOT_PALETTE = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
] as const;

/** Stable hash → fixed palette index. Same input always yields the same dot. */
export function colorForClinic(stableClinicIdentifier: string | null | undefined): string {
  const id = (stableClinicIdentifier ?? "").trim();
  if (!id) return "bg-slate-400";
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CLINIC_DOT_PALETTE[hash % CLINIC_DOT_PALETTE.length];
}

/** A compact, readable clinic label. Prefers an explicit short name; otherwise
 *  returns the full facility string (the name must always remain visible —
 *  never rely on color alone). */
export function clinicLabel(
  facility: string | null | undefined,
  shortName?: string | null,
): string {
  const short = (shortName ?? "").trim();
  if (short) return short;
  return (facility ?? "").trim() || "Unknown clinic";
}
