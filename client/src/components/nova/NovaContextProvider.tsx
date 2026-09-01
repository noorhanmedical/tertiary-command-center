// Nova Context Provider — supplies Nova with current workspace/patient context.
//
// Wraps the Playground surface so Nova can access the active patient,
// service, workspace type, facility, etc. without prop-drilling.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { NovaContext } from "./contracts";

const NovaCtx = createContext<NovaContext>({});

export function NovaContextProvider({
  value,
  children,
}: {
  value: NovaContext;
  children: ReactNode;
}) {
  const stable = useMemo(() => value, [
    value.userId, value.role, value.facilityId, value.patientScreeningId,
    value.executionCaseId, value.serviceKey, value.workspaceType,
    value.playgroundTabId, value.selectedDate, value.viewAsTeamMemberId,
  ]);
  return <NovaCtx.Provider value={stable}>{children}</NovaCtx.Provider>;
}

/** Access the current Nova context (active patient, workspace, etc.). */
export function useNovaContext(): NovaContext {
  return useContext(NovaCtx);
}
