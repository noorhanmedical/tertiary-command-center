import { useState } from "react";
import { FALLBACK_GRADIENT, imageAltText } from "@/lib/worldTime/locations";

// ─────────────────────────────────────────────────────────────────────────
// WorldTimeCard — the single source of truth for the premium World Time card.
//
// Used by BOTH the Home dashboard row and the admin approval preview, so the
// preview is visually indistinguishable from the eventual production card.
//
// Visual priority (by design): TIME → LOCATION → TIMEZONE/DATE → IMAGE.
// The background image only supplies atmosphere; a heavy navy overlay keeps
// Plexus branding dominant and the left (text) side highly readable.
//
// If no APPROVED image is supplied — or the image fails to load — the card
// falls back to the premium Plexus navy gradient. It never shows a broken
// image, a blank card, or a raw un-overlaid photo.
// ─────────────────────────────────────────────────────────────────────────

/** Exact overlay/gradient/typography tokens — shared so every card (and the
 *  approval preview) is byte-for-byte the same treatment. */
export const WORLD_TIME_TOKENS = {
  radius: 14,
  // Horizontal navy wash: darkest on the text (left) side, lighter far side.
  primaryOverlay:
    "linear-gradient(90deg, rgba(6,17,47,0.94) 0%, rgba(6,17,47,0.86) 35%, rgba(6,17,47,0.70) 68%, rgba(6,17,47,0.52) 100%)",
  // Subtle vertical darkening for depth.
  secondaryOverlay:
    "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.18) 100%)",
  imageFilter: "brightness(0.68) saturate(0.80) contrast(0.95)",
  fallback: FALLBACK_GRADIENT,
  timeColor: "#5B8CFF",
  cityColor: "rgba(255,255,255,0.95)",
  metaColor: "rgba(255,255,255,0.72)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderHover: "rgba(91,140,255,0.22)",
  shadow: "0 4px 14px rgba(6,17,47,0.14)",
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
  className?: string;
  "data-testid"?: string;
};

export function WorldTimeCard({
  label,
  time,
  abbr,
  date,
  image,
  className,
  "data-testid": testId,
}: WorldTimeCardProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const showImage = Boolean(image?.assetUrl) && !imageBroken;

  const footer = [abbr, date].filter(Boolean).join(" · ");
  const ariaLabel = `Current time in ${label}: ${time}${abbr ? ` ${abbr}` : ""}`;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`world-time-card group relative flex h-[92px] min-w-[168px] flex-1 flex-col justify-center overflow-hidden ${className ?? ""}`}
      style={{
        borderRadius: WORLD_TIME_TOKENS.radius,
        border: WORLD_TIME_TOKENS.border,
        boxShadow: WORLD_TIME_TOKENS.shadow,
        // Fallback lives on the base element so it shows through until (and if)
        // an approved image paints — and remains if the image is absent.
        background: WORLD_TIME_TOKENS.fallback,
        transition: "transform 180ms ease, border-color 180ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.borderColor = WORLD_TIME_TOKENS.borderHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
      }}
    >
      {/* Full-bleed image layer (normalized), only when an approved asset loads */}
      {showImage && (
        <img
          src={image!.assetUrl}
          alt={imageAltText(image!.landmarkName, label)}
          aria-hidden="true"
          onError={() => setImageBroken(true)}
          className="absolute inset-0 h-full w-full object-cover transition-[filter] duration-200 ease-out group-hover:brightness-[0.78]"
          style={{
            objectPosition: image!.imagePosition ?? "center center",
            filter: WORLD_TIME_TOKENS.imageFilter,
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
          className="truncate text-[12px] font-semibold leading-[1.2]"
          style={{ color: WORLD_TIME_TOKENS.cityColor }}
        >
          {label}
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
