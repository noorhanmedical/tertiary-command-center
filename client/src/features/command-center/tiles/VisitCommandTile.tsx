import React from "react";
import { CalendarDays } from "lucide-react";
import { CommandTile } from "./CommandTile";
import { commandTileProfiles } from "./commandTileProfiles";
import type {
  CommandTileContext,
  CommandTileSurface,
} from "./commandTileTypes";
import { PanelPopupCard } from "../components/PanelPopupCard";
import type { PanelPlaygroundContext } from "../types/commandCenterTypes";

export type VisitCommandTileProps = {
  surface: CommandTileSurface;
  title?: string;
  subtitle?: string;
  href?: string;
  testId?: string;
  onClick?: () => void;
  /**
   * Enable popup preview mode. When true, clicking the tile opens a popup
   * via PanelPopupCard, which exposes the canonical expand-to-Playground
   * affordance. Requires the tile to be rendered inside a CommandCenterProvider.
   */
  popup?: boolean;
  popupBody?: React.ReactNode;
  context?: Partial<CommandTileContext>;
};

export function VisitCommandTile({
  surface,
  title,
  subtitle,
  href,
  testId,
  onClick,
  popup,
  popupBody,
  context,
}: VisitCommandTileProps) {
  const profile = commandTileProfiles[surface].visit;
  const resolvedTitle = title ?? profile.label;
  const resolvedSubtitle = subtitle ?? profile.subtitle;
  const resolvedTestId = testId ?? profile.testId;
  const resolvedHref = href ?? profile.defaultHref;

  const popupContext: PanelPlaygroundContext = {
    sourceSurface: surface,
    componentType: "visit",
    title: resolvedTitle,
    metadata: {
      tileKind: "visit",
      tileSurface: surface,
      actions: profile.actions,
      emphasis: profile.emphasis,
      ...(context?.metadata ?? {}),
    },
    facilityId: context?.facilityId,
    selectedDate: context?.selectedDate,
    filters: context?.filters,
  };

  const popupPreview = popup ? (
    <PanelPopupCard
      title={resolvedTitle}
      eyebrow="Visit"
      icon={<CalendarDays className="h-5 w-5" />}
      context={popupContext}
    >
      {popupBody ?? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            {resolvedSubtitle}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {profile.actions.map((action) => (
              <span
                key={action}
                className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-700"
              >
                {action}
              </span>
            ))}
          </div>
        </div>
      )}
    </PanelPopupCard>
  ) : undefined;

  return (
    <CommandTile
      kind="visit"
      surface={surface}
      title={resolvedTitle}
      subtitle={resolvedSubtitle}
      icon={
        <CalendarDays
          className="glass-tile-icon w-14 h-14 text-indigo-900"
          strokeWidth={1.5}
        />
      }
      testId={resolvedTestId}
      href={popup ? undefined : resolvedHref}
      onClick={onClick}
      popupPreview={popupPreview}
      context={{ kind: "visit", surface, title: resolvedTitle, ...context }}
    />
  );
}
