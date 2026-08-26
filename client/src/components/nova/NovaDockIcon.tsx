// Nova dock icon — a simplified static nebula for the GlobalDock.
//
// Renders a tiny cluster of pink/lilac dots recognizable at dock size
// (20x20). Brightens/tightens slightly on hover via CSS transition.
// Used as the `icon` property for the Nova dock app definition.

export function NovaDockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`nova-dock-icon ${className}`}
      aria-hidden="true"
    >
      {/* Central cluster */}
      <circle cx="10" cy="10" r="2.2" fill="#EC78B6" opacity="0.85" />
      <circle cx="8" cy="9" r="1.5" fill="#F6A6C8" opacity="0.7" />
      <circle cx="12" cy="8.5" r="1.3" fill="#D96BC6" opacity="0.75" />
      <circle cx="11" cy="12" r="1.6" fill="#B878E6" opacity="0.65" />
      <circle cx="7.5" cy="11.5" r="1.1" fill="#E8B4F2" opacity="0.6" />
      {/* Outer scattered particles */}
      <circle cx="6" cy="7" r="0.8" fill="#F6A6C8" opacity="0.45" />
      <circle cx="14" cy="7" r="0.7" fill="#D96BC6" opacity="0.4" />
      <circle cx="13.5" cy="13" r="0.9" fill="#E8B4F2" opacity="0.5" />
      <circle cx="6.5" cy="13.5" r="0.7" fill="#B878E6" opacity="0.4" />
      <circle cx="10" cy="6" r="0.6" fill="#EC78B6" opacity="0.5" />
      <circle cx="10" cy="14.5" r="0.7" fill="#F2C4E0" opacity="0.45" />
      <circle cx="5" cy="10" r="0.5" fill="#C890DC" opacity="0.35" />
      <circle cx="15" cy="10.5" r="0.6" fill="#F6A6C8" opacity="0.35" />

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
