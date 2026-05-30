import React from "react";
import { SquareArrowOutUpRight } from "lucide-react";
import type { PanelPlaygroundContext } from "../types/commandCenterTypes";
import { useCommandCenter } from "../context/CommandCenterContext";

function toSelectedType(context: PanelPlaygroundContext) {
  switch (context.componentType) {
    case "calendarDate":
      return "calendarDate";
    case "marketing":
      return "marketing";
    case "email":
      return "email";
    case "scratchpad":
      return "scratchpad";
    case "callList":
      return "call";
    case "document":
      return "document";
    case "billing":
      return "billing";
    case "procedure":
      return "procedure";
    case "ancillary":
      return "ancillary";
    case "patient":
      return "patient";
    case "visit":
      return "visit";
    case "outreach":
      return "outreach";
    default:
      return "none";
  }
}

export function PanelPopupCard({
  title,
  eyebrow,
  icon,
  context,
  children,
}: {
  title: string;
  eyebrow?: string;
  icon: React.ReactNode;
  context: PanelPlaygroundContext;
  children: React.ReactNode;
}) {
  const { promoteToPlayground, setSelectedContext } = useCommandCenter();

  const expand = () => {
    promoteToPlayground(context);
    setSelectedContext({
      type: toSelectedType(context),
      context,
    });
  };

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/70">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 text-slate-800">
            {icon}
          </div>
          <div>
            {eyebrow ? <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{eyebrow}</div> : null}
            <h3 className="text-base font-bold text-slate-950">{title}</h3>
          </div>
        </div>
        <button
          type="button"
          onClick={expand}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700 transition hover:bg-blue-100"
          title="Expand to Playground"
          aria-label="Expand to Playground"
        >
          <SquareArrowOutUpRight className="h-4 w-4" />
        </button>
      </div>
      {children}
    </section>
  );
}
