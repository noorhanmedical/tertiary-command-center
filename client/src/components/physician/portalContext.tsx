import { createContext, useContext, useState, ReactNode } from "react";

export type DemoRole = "Clinician" | "Clinic Admin" | "Owner";
export type ActivePage = "dashboard" | "finance" | "orders-notes" | "engagement";

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
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<DemoRole>("Owner");
  const [activePage, setActivePage] = useState<ActivePage>("dashboard");
  const [signedToday, setSignedToday] = useState(3);

  const incrementSignedToday = (n = 1) => setSignedToday((s) => s + n);

  return (
    <PortalContext.Provider value={{ role, setRole, activePage, setActivePage, signedToday, incrementSignedToday }}>
      {children}
    </PortalContext.Provider>
  );
}

export function usePortal() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used within PortalProvider");
  return ctx;
}
