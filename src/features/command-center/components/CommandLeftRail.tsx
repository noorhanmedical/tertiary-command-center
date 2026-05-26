import React, { useState } from "react";
import { CalendarDays, Mail, Megaphone, NotebookPen, Phone, Search, SquareArrowOutUpRight } from "lucide-react";
import { useCommandCenter } from "../context/CommandCenterContext";
import type { LeftPanelModuleId } from "../types/commandCenterTypes";
import { CalendarDockPopup } from "../docks/CalendarDockPopup";
import { PhoneDockPopup } from "../docks/PhoneDockPopup";
import { MarketingDockPopup } from "../docks/MarketingDockPopup";
import { EmailDockPopup } from "../docks/EmailDockPopup";
import { SearchDockPopup } from "../docks/SearchDockPopup";
import { ScratchpadDockPopup } from "../docks/ScratchpadDockPopup";

const moduleConfig: Record<
  LeftPanelModuleId,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
  }
> = {
  calendar: { label: "Calendar", icon: CalendarDays, tone: "text-blue-700 bg-blue-50 border-blue-100" },
  phone: { label: "Phone", icon: Phone, tone: "text-slate-900 bg-slate-100 border-slate-200" },
  marketing: { label: "Marketing", icon: Megaphone, tone: "text-violet-700 bg-violet-50 border-violet-100" },
  email: { label: "Email", icon: Mail, tone: "text-sky-700 bg-sky-50 border-sky-100" },
  search: { label: "Search", icon: Search, tone: "text-slate-700 bg-white border-slate-200" },
  scratchpad: { label: "Scratch", icon: NotebookPen, tone: "text-amber-700 bg-amber-50 border-amber-100" },
};

function DockPopup({ active }: { active: LeftPanelModuleId }) {
  switch (active) {
    case "calendar":
      return <CalendarDockPopup />;
    case "phone":
      return <PhoneDockPopup />;
    case "marketing":
      return <MarketingDockPopup />;
    case "email":
      return <EmailDockPopup />;
    case "search":
      return <SearchDockPopup />;
    case "scratchpad":
      return <ScratchpadDockPopup />;
    default:
      return null;
  }
}

export function CommandLeftRail() {
  const { profile } = useCommandCenter();
  const [active, setActive] = useState<LeftPanelModuleId | null>(null);

  return (
    <aside className="relative rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-4 flex flex-col items-center gap-1 pt-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#061b2d] text-sm font-bold text-white">
          TC
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{profile.surface}</div>
      </div>

      <div className="flex flex-col items-center gap-3">
        {profile.visibleLeftPanelModules.map((moduleId) => {
          const item = moduleConfig[moduleId];
          const Icon = item.icon;
          const isActive = active === moduleId;

          return (
            <button
              key={moduleId}
              type="button"
              onClick={() => setActive(isActive ? null : moduleId)}
              className={[
                "group relative flex h-14 w-14 items-center justify-center rounded-2xl border transition",
                item.tone,
                isActive ? "ring-2 ring-blue-300" : "hover:scale-[1.03] hover:shadow-sm",
              ].join(" ")}
              aria-label={item.label}
              title={item.label}
            >
              <Icon className="h-6 w-6" />
              <span className="pointer-events-none absolute left-[64px] z-20 hidden whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-md group-hover:block">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="absolute bottom-4 left-0 right-0 flex justify-center">
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
          <SquareArrowOutUpRight className="h-3 w-3" />
          Expand
        </div>
      </div>

      {active ? (
        <div className="absolute left-[96px] top-4 z-30 w-[360px]">
          <DockPopup active={active} />
        </div>
      ) : null}
    </aside>
  );
}
