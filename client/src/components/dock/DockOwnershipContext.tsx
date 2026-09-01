// Dock ownership context — prevents duplicate dock rendering.
//
// When a component (like TeamPortalShell) renders its own GlobalDock
// instance, it sets `ownsDock = true` via this provider. The App-level
// GlobalDock checks this context and skips rendering when another
// component already owns the dock.

import { createContext, useContext, type ReactNode } from "react";

const DockOwnershipContext = createContext(false);

/** Wrap around a subtree that renders its own GlobalDock instance. */
export function DockOwnershipProvider({ children }: { children: ReactNode }) {
  return (
    <DockOwnershipContext.Provider value={true}>
      {children}
    </DockOwnershipContext.Provider>
  );
}

/** Returns true if a parent component already owns the dock. */
export function useDockOwned(): boolean {
  return useContext(DockOwnershipContext);
}
