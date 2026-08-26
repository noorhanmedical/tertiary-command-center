// Nova dock icon — a clean white icon matching the dock's visual language.
// An abstract "AI spark" shape: a four-pointed star with a central dot,
// distinct from Lucide's Sparkles (which has 3 separate stars).

export function NovaDockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Four-pointed star burst (Nova identity) */}
      <path d="M12 2 L12 6" />
      <path d="M12 18 L12 22" />
      <path d="M2 12 L6 12" />
      <path d="M18 12 L22 12" />
      {/* Diamond/star shape in center */}
      <path d="M12 6 C12 6 15 9 15 12 C15 15 12 18 12 18 C12 18 9 15 9 12 C9 9 12 6 12 6Z" />
      {/* Central dot */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      {/* Small corner accents */}
      <path d="M5.5 5.5 L7 7" />
      <path d="M17 17 L18.5 18.5" />
      <path d="M18.5 5.5 L17 7" />
      <path d="M7 17 L5.5 18.5" />
    </svg>
  );
}
