import React from "react";
import { CommandCenterProvider } from "../context/CommandCenterContext";
import type { CommandSurface } from "../types/commandCenterTypes";
import { CommandLeftRail } from "./CommandLeftRail";
import { CommandPlayground } from "../playground/CommandPlayground";
import { CommandRightContextPanel } from "./CommandRightContextPanel";

export function CommandCenterShell({ surface = "unknown" }: { surface?: CommandSurface }) {
  return (
    <CommandCenterProvider surface={surface}>
      <div className="min-h-screen bg-slate-50 text-slate-950">
        <div className="grid min-h-screen grid-cols-[88px_minmax(0,1fr)_340px] gap-4 p-4">
          <CommandLeftRail />
          <CommandPlayground />
          <CommandRightContextPanel />
        </div>
      </div>
    </CommandCenterProvider>
  );
}
