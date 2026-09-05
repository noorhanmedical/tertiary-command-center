import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { FALLBACK_GRADIENT, imageAltText } from "@/lib/worldTime/locations";

// ─────────────────────────────────────────────────────────────────────────
// WorldTimeCard — the single source of truth for the premium World Time card.
//
// Used by BOTH the Home dashboard row and the admin approval preview, so the
// preview is visually indistinguishable from the eventual production card.
//
// Visual priority: TIME → LOCATION → TIMEZONE/DATE → IMAGE. A left-to-right
// navy gradient keeps the text side dark + readable while letting the landmark
// image show clearly on the right (cinematic, not blacked-out).
//
// If no APPROVED image is supplied — or the image fails to load — the card
// falls back to the premium Plexus navy gradient. It never shows a broken
// image, a blank card, or a raw un-overlaid photo.
// ─────────────────────────────────────────────────────────────────────────

/** Exact overlay/gradient/typography tokens — shared so every card (and the
 *  approval preview) is byte-for-byte the same treatment. */
export const WORLD_TIME_TOKENS = {
  radius: 14,
  // Horizontal navy wash: dark on the text (left) side, fading to nearly clear
  // on the right so the landmark reads clearly.
  primaryOverlay:
    "linear-gradient(90deg, rgba(6,17,47,0.94) 0%, rgba(6,17,47,0.80) 26%, rgba(6,17,47,0.48) 52%, rgba(6,17,47,0.20) 78%, rgba(6,17,47,0.06) 100%)",
  // Subtle bottom darkening for depth + footer legibility.
  secondaryOverlay:
    "linear-gradient(180deg, rgba(0,0,0,0) 52%, rgba(0,0,0,0.30) 100%)",
  // Light normalization only — the image should be clearly visible.
  imageFilter: "brightness(1) saturate(1.06) contrast(1.02)",
  imageFilterHover: "brightness(1.09) saturate(1.1) contrast(1.02)",
  fallback: FALLBACK_GRADIENT,
  timeColor: "#5B8CFF",
  cityColor: "rgba(255,255,255,0.96)",
  metaColor: "rgba(255,255,255,0.74)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderHover: "rgba(91,140,255,0.28)",
  shadow: "0 4px 14px rgba(6,17,47,0.18)",
} as const;

export type WorldTimeCardImage = {
  assetUrl: string;
  imagePosition?: string;
  landmarkName?: string;
};

export type WorldTimeCardProps = {
  /** City / location label — always rendered as text (never relies on image). */
  label: string;
  /** Large local time, e.g. "5:14 PM". */
  time: string;
  /** Derived timezone abbreviation, e.g. "CDT". */
  abbr?: string;
  /** Compact date, e.g. "Sep 4". */
  date?: string;
  /** APPROVED image to display, or null/undefined for the fallback gradient. */
  image?: WorldTimeCardImage | null;
  /** Local hour (0–23) → renders a subtle day/night icon by the city label. */
  localHour?: number;
  className?: string;
  "data-testid"?: string;
};

export function WorldTimeCard({
  label,
  time,
  abbr,
  date,
  image,
  localHour,
  className,
  "data-testid": testId,
}: WorldTimeCardProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const [hovered, setHovered] = useState(false);
  const showImage = Boolean(image?.assetUrl) && !imageBroken;

  const footer = [abbr, date].filter(Boolean).join(" · ");
  const ariaLabel = `Current time in ${label}: ${time}${abbr ? ` ${abbr}` : ""}`;
  const isDay = localHour == null ? true : localHour >= 6 && localHour < 18;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`world-time-card group relative flex h-[92px] min-w-[168px] flex-1 flex-col justify-center overflow-hidden ${className ?? ""}`}
      style={{
        borderRadius: WORLD_TIME_TOKENS.radius,
        border: WORLD_TIME_TOKENS.border,
        borderColor: hovered ? WORLD_TIME_TOKENS.borderHover : "rgba(255,255,255,0.10)",
        boxShadow: WORLD_TIME_TOKENS.shadow,
        // Fallback lives on the base element so it shows through until (and if)
        // an approved image paints — and remains if the image is absent.
        background: WORLD_TIME_TOKENS.fallback,
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 180ms ease, border-color 180ms ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Full-bleed image layer (lightly normalized), only when an approved asset loads */}
      {showImage && (
        <img
          src={image!.assetUrl}
          alt={imageAltText(image!.landmarkName, label)}
          aria-hidden="true"
          onError={() => setImageBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            objectPosition: image!.imagePosition ?? "center center",
            filter: hovered ? WORLD_TIME_TOKENS.imageFilterHover : WORLD_TIME_TOKENS.imageFilter,
            transition: "filter 200ms ease",
          }}
        />
      )}

      {/* Navy overlays — only over an image; fallback gradient stands alone */}
      {showImage && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: WORLD_TIME_TOKENS.primaryOverlay }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: WORLD_TIME_TOKENS.secondaryOverlay }}
          />
        </>
      )}

      {/* Text — left aligned, above the imagery */}
      <div className="relative z-[2] flex flex-col gap-0.5 px-4 py-[11px] text-left">
        <span
          className="flex items-center gap-1.5 text-[12px] font-semibold leading-[1.2]"
          style={{ color: WORLD_TIME_TOKENS.cityColor }}
        >
          <span className="truncate">{label}</span>
          {isDay ? (
            <Sun className="h-3 w-3 shrink-0" style={{ color: "rgba(255,201,128,0.92)" }} strokeWidth={2.25} />
          ) : (
            <Moon className="h-3 w-3 shrink-0" style={{ color: "rgba(191,209,255,0.9)" }} strokeWidth={2.25} />
          )}
        </span>
        <span
          className="text-[20px] font-bold leading-[1.05] tabular-nums"
          style={{ color: WORLD_TIME_TOKENS.timeColor }}
          data-testid={testId ? `${testId}-time` : undefined}
        >
          {time}
        </span>
        {footer && (
          <span
            className="text-[10px] font-medium uppercase leading-[1.2] tracking-wide"
            style={{ color: WORLD_TIME_TOKENS.metaColor }}
            data-testid={testId ? `${testId}-meta` : undefined}
          >
            {footer}
          </span>
        )}
      </div>
    </div>
  );
}
