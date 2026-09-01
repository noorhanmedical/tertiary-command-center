// Selected Team Portal clinic context (client-side holder).
//
// The Team Portal has ONE selected facility (a canonical clinic name). Certain
// requests — messaging in particular — need to know which clinic the operator
// is currently working inside so the server can resolve tenancy. For an ADMIN
// (organization-wide, no fixed clinicId) this selected clinic IS the messaging
// tenancy; for PCS/ACS the server still uses their own canonical clinic and
// ignores this hint (defense in depth).
//
// This is a tiny module-level holder set by TeamPortalShell whenever the
// selected facility changes, and read by the request layer to attach an
// `X-Portal-Clinic` header. It is intentionally NOT React state: the request
// layer is not a component, and this avoids threading the value through every
// messaging call site.

let selectedPortalClinic: string | null = null;

/** Set the currently selected Team Portal clinic (canonical facility name),
 *  or null when none is selected. */
export function setPortalClinic(name: string | null): void {
  selectedPortalClinic = name && name.trim() ? name.trim() : null;
}

/** Read the currently selected Team Portal clinic name (or null). */
export function getPortalClinic(): string | null {
  return selectedPortalClinic;
}

/** Header name carrying the selected clinic to the server. */
export const PORTAL_CLINIC_HEADER = "X-Portal-Clinic";

/** fetch() wrapper that attaches the selected-clinic header + credentials.
 *  Use for raw messaging GETs that don't go through apiRequest. */
export function messagingFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const clinic = getPortalClinic();
  if (clinic) headers.set(PORTAL_CLINIC_HEADER, clinic);
  return fetch(input, { ...init, headers, credentials: "include" });
}
