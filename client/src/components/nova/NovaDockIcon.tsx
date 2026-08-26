// Nova dock icon — a distinctive glowing orb with radiating energy lines.
// Visually unique from any Lucide icon. Matches the deep indigo/violet Nova identity.

export function NovaDockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="none"
      className={className}
      aria-hidden="true"
    >
      {/* Outer glow ring */}
      <circle cx="12" cy="12" r="9" fill="none" stroke="url(#nova-grad-ring)" strokeWidth="1" opacity="0.5" />
      {/* Radiating energy lines */}
      <line x1="12" y1="2" x2="12" y2="5" stroke="url(#nova-grad-ray)" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <line x1="12" y1="19" x2="12" y2="22" stroke="url(#nova-grad-ray)" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <line x1="2" y1="12" x2="5" y2="12" stroke="url(#nova-grad-ray)" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <line x1="19" y1="12" x2="22" y2="12" stroke="url(#nova-grad-ray)" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      {/* Diagonal rays */}
      <line x1="4.93" y1="4.93" x2="6.81" y2="6.81" stroke="url(#nova-grad-ray)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <line x1="17.19" y1="17.19" x2="19.07" y2="19.07" stroke="url(#nova-grad-ray)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <line x1="4.93" y1="19.07" x2="6.81" y2="17.19" stroke="url(#nova-grad-ray)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <line x1="17.19" y1="6.81" x2="19.07" y2="4.93" stroke="url(#nova-grad-ray)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      {/* Core orb with gradient */}
      <circle cx="12" cy="12" r="5.5" fill="url(#nova-grad-core)" />
      {/* Inner bright center */}
      <circle cx="12" cy="12" r="2.5" fill="url(#nova-grad-center)" />
      {/* Highlight dot */}
      <circle cx="10.5" cy="10" r="1" fill="white" opacity="0.6" />
      {/* Gradient definitions */}
      <defs>
        <radialGradient id="nova-grad-core">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="50%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#312E81" />
        </radialGradient>
        <radialGradient id="nova-grad-center">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#6366F1" />
        </radialGradient>
        <linearGradient id="nova-grad-ring" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#4338CA" />
        </linearGradient>
        <linearGradient id="nova-grad-ray" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A5B4FC" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
    </svg>
  );
}
