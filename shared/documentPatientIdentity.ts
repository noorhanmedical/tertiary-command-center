/** Read-only demographics. Internal screening keys are never display identifiers. */
export type DocumentPatientIdentity = {
  mrn: string | null;
  dob: string | null;
  plexusId: string | null;
  status: "verified" | "unlinked" | "stale";
};

export function identitySummary(identity?: DocumentPatientIdentity | null): string {
  if (!identity || identity.status === "stale") return "Patient identity unavailable";
  return `DOB: ${identity.dob || "Unavailable"} · MRN: ${identity.mrn || "Unavailable"} · Plexus ID: ${identity.plexusId || "Unavailable"}`;
}

export function projectDocumentPatientIdentity(input: {
  clinicId: number | null;
  screeningMrn?: string | null;
  screeningDob?: string | null;
  globalPatientId: number | null;
  membership: { clinicId: number; globalPlexusPatientId: number; membershipStatus: string; clinicMrn: string | null } | null;
  patient: { id: number; dob: string | null; plexusId: string; identityStatus: string } | null;
}): DocumentPatientIdentity {
  const unavailable: DocumentPatientIdentity = { mrn: null, dob: null, plexusId: null, status: "unlinked" };
  if (!input.membership && !input.globalPatientId) return {
    ...unavailable, mrn: input.screeningMrn?.trim() || null, dob: input.screeningDob?.trim() || null,
  };
  const { membership: m, patient: p } = input;
  if (!m || !p || input.clinicId == null || m.clinicId !== input.clinicId
    || m.globalPlexusPatientId !== input.globalPatientId || p.id !== input.globalPatientId
    || m.membershipStatus !== "active" || p.identityStatus !== "active") {
    return { ...unavailable, status: "stale" };
  }
  const clean = (v: string | null) => v?.trim() || null;
  return { mrn: clean(m.clinicMrn), dob: clean(p.dob), plexusId: clean(p.plexusId), status: "verified" };
}
