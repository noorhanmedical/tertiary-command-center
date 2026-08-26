// Nova dock icon — simplified static nebula for the GlobalDock.
//
// Uses the dark purple/indigo/blue palette matching Nova's default
// Deep Space appearance. Recognizable at dock size (20x20).

export function NovaDockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`nova-dock-icon ${className}`}
      aria-hidden="true"
    >
      {/* Central cluster — deep purple/indigo */}
      <circle cx="10" cy="10" r="2.2" fill="#4338CA" opacity="0.9" />
      <circle cx="8" cy="9" r="1.5" fill="#6366F1" opacity="0.75" />
      <circle cx="12" cy="8.5" r="1.3" fill="#4B0082" opacity="0.8" />
      <circle cx="11" cy="12" r="1.6" fill="#312E81" opacity="0.7" />
      <circle cx="7.5" cy="11.5" r="1.1" fill="#818CF8" opacity="0.6" />
      {/* Outer scattered particles */}
      <circle cx="6" cy="7" r="0.8" fill="#6366F1" opacity="0.45" />
      <circle cx="14" cy="7" r="0.7" fill="#4338CA" opacity="0.4" />
      <circle cx="13.5" cy="13" r="0.9" fill="#818CF8" opacity="0.5" />
      <circle cx="6.5" cy="13.5" r="0.7" fill="#312E81" opacity="0.4" />
      <circle cx="10" cy="6" r="0.6" fill="#4B0082" opacity="0.5" />
      <circle cx="10" cy="14.5" r="0.7" fill="#A5B4FC" opacity="0.4" />
      <circle cx="5" cy="10" r="0.5" fill="#1E1B4B" opacity="0.35" />
      <circle cx="15" cy="10.5" r="0.6" fill="#6366F1" opacity="0.35" />

      <style>{`
        .nova-dock-icon circle {
          transition: opacity 0.3s, transform 0.3s;
          transform-origin: 10px 10px;
        }
        .nova-dock-icon:hover circle {
          opacity: 1 !important;
          transform: scale(0.92);
        }
      `}</style>
    </svg>
  );
}
