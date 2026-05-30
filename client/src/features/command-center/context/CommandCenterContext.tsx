import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type {
  CommandSurface,
  CommandSurfaceProfile,
  PanelPlaygroundContext,
  SelectedCommandContext,
} from "../types/commandCenterTypes";

const defaultModules = ["calendar", "phone", "marketing", "email", "search", "scratchpad"] as const;

export const commandSurfaceProfiles: Record<CommandSurface, CommandSurfaceProfile> = {
  pcs: {
    surface: "pcs",
    label: "PCS Portal",
    visibleLeftPanelModules: [...defaultModules],
    permissions: [
      "viewCalendar",
      "usePhone",
      "sendMarketing",
      "composeEmail",
      "searchCommand",
      "useScratchpad",
      "viewDocuments",
    ],
  },
  acs: {
    surface: "acs",
    label: "ACS Portal",
    visibleLeftPanelModules: [...defaultModules],
    permissions: [
      "viewCalendar",
      "usePhone",
      "sendMarketing",
      "composeEmail",
      "searchCommand",
      "useScratchpad",
      "viewProcedures",
      "editProcedures",
      "viewDocuments",
    ],
  },
  plexusIq: {
    surface: "plexusIq",
    label: "Plexus IQ",
    visibleLeftPanelModules: [...defaultModules],
    permissions: [
      "viewCalendar",
      "usePhone",
      "sendMarketing",
      "composeEmail",
      "searchCommand",
      "useScratchpad",
      "viewProcedures",
      "editProcedures",
      "viewDocuments",
      "viewBilling",
      "editBilling",
    ],
  },
  dashboard: {
    surface: "dashboard",
    label: "Dashboard",
    visibleLeftPanelModules: [...defaultModules],
    permissions: [
      "viewCalendar",
      "usePhone",
      "sendMarketing",
      "composeEmail",
      "searchCommand",
      "useScratchpad",
      "viewProcedures",
      "viewDocuments",
      "viewBilling",
    ],
  },
  unknown: {
    surface: "unknown",
    label: "Command Center",
    visibleLeftPanelModules: [...defaultModules],
    permissions: ["viewCalendar", "searchCommand", "useScratchpad"],
  },
};

type CommandCenterState = {
  profile: CommandSurfaceProfile;
  selectedContext: SelectedCommandContext;
  playgroundContext: PanelPlaygroundContext | null;
  selectedPatient?: {
    patientUuid: string;
    patientName: string;
    phone?: string;
    email?: string;
    facilityId?: string;
  };
  setSelectedPatient: (patient?: CommandCenterState["selectedPatient"]) => void;
  setSelectedContext: (next: SelectedCommandContext) => void;
  promoteToPlayground: (context: PanelPlaygroundContext) => void;
  clearPlayground: () => void;
};

const CommandCenterContext = createContext<CommandCenterState | null>(null);

export function CommandCenterProvider({
  surface = "unknown",
  children,
}: {
  surface?: CommandSurface;
  children: React.ReactNode;
}) {
  const profile = commandSurfaceProfiles[surface] ?? commandSurfaceProfiles.unknown;
  const [selectedContext, setSelectedContextState] = useState<SelectedCommandContext>({
    type: "none",
    context: null,
  });
  const [playgroundContext, setPlaygroundContext] = useState<PanelPlaygroundContext | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<CommandCenterState["selectedPatient"]>();

  const setSelectedContext = useCallback((next: SelectedCommandContext) => {
    setSelectedContextState(next);
  }, []);

  const promoteToPlayground = useCallback((context: PanelPlaygroundContext) => {
    setPlaygroundContext(context);
  }, []);

  const clearPlayground = useCallback(() => {
    setPlaygroundContext(null);
  }, []);

  const value = useMemo(
    () => ({
      profile,
      selectedContext,
      playgroundContext,
      selectedPatient,
      setSelectedPatient,
      setSelectedContext,
      promoteToPlayground,
      clearPlayground,
    }),
    [profile, selectedContext, playgroundContext, selectedPatient, setSelectedContext, promoteToPlayground, clearPlayground],
  );

  return <CommandCenterContext.Provider value={value}>{children}</CommandCenterContext.Provider>;
}

export function useCommandCenter() {
  const ctx = useContext(CommandCenterContext);
  if (!ctx) {
    throw new Error("useCommandCenter must be used inside CommandCenterProvider");
  }
  return ctx;
}
