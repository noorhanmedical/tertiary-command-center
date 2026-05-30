import React, { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import type {
  CommandTileContext,
  CommandTileKind,
  CommandTileSurface,
} from "./commandTileTypes";

export type CommandTileProps = {
  kind: CommandTileKind;
  surface: CommandTileSurface;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  testId?: string;
  href?: string;
  onClick?: () => void;
  popupPreview?: React.ReactNode;
  context?: Partial<CommandTileContext>;
};

export function CommandTile({
  kind,
  surface,
  title,
  subtitle,
  icon,
  testId,
  href,
  onClick,
  popupPreview,
}: CommandTileProps) {
  const [, setLocation] = useLocation();
  const [popupOpen, setPopupOpen] = useState(false);

  const handleClick = () => {
    if (popupPreview) {
      setPopupOpen((prev) => !prev);
      return;
    }
    if (onClick) {
      onClick();
      return;
    }
    if (href) {
      setLocation(href);
    }
  };

  return (
    <div className="relative" data-tile-kind={kind} data-tile-surface={surface}>
      <Card
        className="glass-tile glass-tile-interactive group cursor-pointer"
        onClick={handleClick}
        data-testid={testId}
      >
        <div className="aspect-[1.2/1] flex flex-col items-center justify-center gap-4 p-8">
          {icon}
          <div className="text-center">
            <div className="text-[18px] font-semibold text-slate-900">{title}</div>
            {subtitle ? (
              <div className="text-[13px] text-slate-500 mt-1">{subtitle}</div>
            ) : null}
          </div>
        </div>
      </Card>

      {popupPreview && popupOpen ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-[360px]">
          {popupPreview}
        </div>
      ) : null}
    </div>
  );
}
