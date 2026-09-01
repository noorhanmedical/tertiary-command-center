import { createContext, useContext, useState, ReactNode } from "react";

export type DemoRole = "Clinician" | "Clinic Admin" | "Owner";
export type ActivePage = "dashboard" | "finance" | "orders-notes" | "engagement";

/** Deep-link focus target when the portal is opened from an EHR chart
 *  "Review & Sign" link (/clinician-portal?focus=sign&noteId=…). Carries the
 *  EXACT signable note identity (canonical procedure_notes.id) so the portal
 *  lands on Orders & Notes on the specific note rather than the dashboard. */
export type SignFocus = {
  noteId: number | null;
  screeningId: number | null;
  serviceType: string | null;
  noteType: string | null;
};

/** Parse a sign deep-link off the current URL exactly once (at portal mount). */
function parseSignFocus(): SignFocus | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  if (p.get("focus") !== "sign") return null;
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);
  const sf: SignFocus = {
    noteId: num(p.get("noteId")),
    screeningId: num(p.get("screeningId")),
    serviceType: p.get("serviceType"),
    noteType: p.get("noteType"),
  };
  return sf.noteId != null || sf.serviceType ? sf : null;
}

export function hasFinanceAccess(role: DemoRole): boolean {
  return role === "Clinic Admin" || role === "Owner";
}

interface PortalContextValue {
  role: DemoRole;
  setRole: (r: DemoRole) => void;
  activePage: ActivePage;
  setActivePage: (p: ActivePage) => void;
  signedToday: number;
  incrementSignedToday: (n?: number) => void;
  signFocus: SignFocus | null;
  clearSignFocus: () => void;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<DemoRole>("Owner");
  // A sign deep-link lands directly on Orders & Notes (never the dashboard).
  const [signFocus, setSignFocus] = useState<SignFocus | null>(parseSignFocus);
  const [activePage, setActivePage] = useState<ActivePage>(signFocus ? "orders-notes" : "dashboard");
  const [signedToday, setSignedToday] = useState(3);

  const incrementSignedToday = (n = 1) => setSignedToday((s) => s + n);
  const clearSignFocus = () => setSignFocus(null);

  return (
    <PortalContext.Provider value={{ role, setRole, activePage, setActivePage, signedToday, incrementSignedToday, signFocus, clearSignFocus }}>
      {children}
    </PortalContext.Provider>
  );
}

export function usePortal() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used within PortalProvider");
  return ctx;
}
