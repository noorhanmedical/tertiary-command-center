import React from "react";
import { Phone } from "lucide-react";
import { CommandTile } from "./CommandTile";
import { commandTileProfiles } from "./commandTileProfiles";
import type {
  CommandTileContext,
  CommandTileSurface,
} from "./commandTileTypes";
import { PanelPopupCard } from "../components/PanelPopupCard";
import type { PanelPlaygroundContext } from "../types/commandCenterTypes";

export type OutreachCommandTileProps = {
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

export function OutreachCommandTile({
  surface,
  title,
  subtitle,
  href,
  testId,
  onClick,
  popup,
  popupBody,
  context,
}: OutreachCommandTileProps) {
  const profile = commandTileProfiles[surface].outreach;
  const resolvedTitle = title ?? profile.label;
  const resolvedSubtitle = subtitle ?? profile.subtitle;
  const resolvedTestId = testId ?? profile.testId;
  const resolvedHref = href ?? profile.defaultHref;

  const popupContext: PanelPlaygroundContext = {
    sourceSurface: surface,
    componentType: "outreach",
    title: resolvedTitle,
    metadata: {
      tileKind: "outreach",
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
      eyebrow="Outreach"
      icon={<Phone className="h-5 w-5" />}
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
                className="rounded-full bg-violet-50 px-3 py-1 font-semibold text-violet-700"
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
      kind="outreach"
      surface={surface}
      title={resolvedTitle}
      subtitle={resolvedSubtitle}
      icon={
        <Phone
          className="glass-tile-icon w-14 h-14 text-indigo-900"
          strokeWidth={1.5}
        />
      }
      testId={resolvedTestId}
      href={popup ? undefined : resolvedHref}
      onClick={onClick}
      popupPreview={popupPreview}
      context={{ kind: "outreach", surface, title: resolvedTitle, ...context }}
    />
  );
}
