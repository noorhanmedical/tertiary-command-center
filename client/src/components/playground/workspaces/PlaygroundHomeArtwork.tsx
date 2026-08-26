// Playground Home — daily colored-pencil illustration.
//
// One small decorative SVG drawing per day. No words, no cards, no dashboard.
// Rotates deterministically by date. Seasonal pools. Subtle optional animation.
// Respects prefers-reduced-motion.

import { useMemo } from "react";

// ─── Artwork library ──────────────────────────────────────────────────────

type ArtworkDef = {
  id: string;
  season?: "winter" | "spring" | "summer" | "fall";
  render: () => JSX.Element;
};

const ARTWORK_LIBRARY: ArtworkDef[] = [
  {
    id: "paper-airplane",
    render: () => (
      <svg viewBox="0 0 200 160" fill="none" className="playground-art">
        <path d="M30 120 L170 60 L90 85 Z" stroke="#4A5568" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M90 85 L80 130 L110 100" stroke="#4A5568" strokeWidth="1" fill="none" strokeLinecap="round" />
        <path d="M170 60 L90 85 L80 130" stroke="#718096" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.5" />
        <circle cx="25" cy="125" r="1" fill="#A0AEC0" opacity="0.4" className="playground-art-float" />
        <circle cx="175" cy="55" r="0.8" fill="#A0AEC0" opacity="0.3" className="playground-art-float" style={{ animationDelay: "1s" }} />
      </svg>
    ),
  },
  {
    id: "winter-cabin",
    season: "winter",
    render: () => (
      <svg viewBox="0 0 200 160" fill="none" className="playground-art">
        <path d="M60 110 L100 80 L140 110" stroke="#4A5568" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="70" y="110" width="60" height="35" stroke="#4A5568" strokeWidth="1" fill="none" rx="1" />
        <rect x="90" y="120" width="14" height="25" stroke="#4A5568" strokeWidth="0.8" fill="none" rx="1" />
        <rect x="75" y="118" width="10" height="8" stroke="#718096" strokeWidth="0.7" fill="none" />
        <path d="M115 95 L115 80 L120 80 L120 100" stroke="#4A5568" strokeWidth="1" strokeLinecap="round" />
        <path d="M40 145 Q70 140 100 145 Q130 148 160 145" stroke="#A0AEC0" strokeWidth="0.8" opacity="0.5" />
        <path d="M30 145 Q50 142 70 145 Q90 148 120 144 Q150 140 170 145" stroke="#CBD5E0" strokeWidth="0.6" opacity="0.4" />
        <circle cx="50" cy="70" r="1" fill="#A0AEC0" opacity="0.5" className="playground-art-snow" />
        <circle cx="80" cy="60" r="0.8" fill="#A0AEC0" opacity="0.4" className="playground-art-snow" style={{ animationDelay: "2s" }} />
        <circle cx="130" cy="65" r="1" fill="#CBD5E0" opacity="0.4" className="playground-art-snow" style={{ animationDelay: "4s" }} />
      </svg>
    ),
  },
  {
    id: "crescent-moon",
    render: () => (
      <svg viewBox="0 0 200 160" fill="none" className="playground-art">
        <path d="M110 50 A30 30 0 1 0 110 110 A22 22 0 1 1 110 50" stroke="#4A5568" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <circle cx="70" cy="60" r="1.2" fill="#718096" opacity="0.6" className="playground-art-twinkle" />
        <circle cx="140" cy="45" r="0.8" fill="#A0AEC0" opacity="0.5" className="playground-art-twinkle" style={{ animationDelay: "1.5s" }} />
        <circle cx="55" cy="90" r="0.6" fill="#A0AEC0" opacity="0.4" className="playground-art-twinkle" style={{ animationDelay: "3s" }} />
        <circle cx="150" cy="85" r="1" fill="#718096" opacity="0.4" className="playground-art-twinkle" style={{ animationDelay: "2.5s" }} />
        <circle cx="120" cy="35" r="0.7" fill="#CBD5E0" opacity="0.3" className="playground-art-twinkle" style={{ animationDelay: "4s" }} />
      </svg>
    ),
  },
  {
    id: "notebook-pencil",
    render: () => (
      <svg viewBox="0 0 200 160" fill="none" className="playground-art">
        <rect x="60" y="50" width="80" height="100" rx="3" stroke="#4A5568" strokeWidth="1.2" fill="none" />
        <line x1="70" y1="70" x2="130" y2="70" stroke="#CBD5E0" strokeWidth="0.5" />
        <line x1="70" y1="82" x2="125" y2="82" stroke="#CBD5E0" strokeWidth="0.5" />
        <line x1="70" y1="94" x2="115" y2="94" stroke="#CBD5E0" strokeWidth="0.5" />
        <line x1="70" y1="106" x2="120" y2="106" stroke="#CBD5E0" strokeWidth="0.5" />
        <path d="M145 45 L155 140 L158 140 L148 45 Z" stroke="#718096" strokeWidth="0.8" fill="none" />
        <path d="M151.5 140 L153 148" stroke="#4A5568" strokeWidth="1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "coffee-steam",
    season: "fall",
    render: () => (
      <svg viewBox="0 0 200 160" fill="none" className="playground-art">
        <path d="M70 90 Q70 130 75 135 Q100 145 125 135 Q130 130 130 90" stroke="#4A5568" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M130 100 Q145 100 145 110 Q145 120 130 120" stroke="#718096" strokeWidth="1" fill="none" strokeLinecap="round" />
        <line x1="65" y1="90" x2="135" y2="90" stroke="#4A5568" strokeWidth="1" strokeLinecap="round" />
        <path d="M88 80 Q90 70 88 60" stroke="#A0AEC0" strokeWidth="0.8" fill="none" strokeLinecap="round" opacity="0.5" className="playground-art-steam" />
        <path d="M100 78 Q102 65 100 55" stroke="#A0AEC0" strokeWidth="0.8" fill="none" strokeLinecap="round" opacity="0.4" className="playground-art-steam" style={{ animationDelay: "1.5s" }} />
        <path d="M112 80 Q114 68 112 58" stroke="#CBD5E0" strokeWidth="0.7" fill="none" strokeLinecap="round" opacity="0.4" className="playground-art-steam" style={{ animationDelay: "3s" }} />
      </svg>
    ),
  },
  {
    id: "pine-trees-snow",
    season: "winter",
    render: () => (
      <svg viewBox="0 0 200 160" fill="none" className="playground-art">
        <path d="M80 130 L80 100 L65 100 L80 80 L70 80 L80 60 L90 80 L82 80 L95 100 L82 100 L82 130" stroke="#4A5568" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M120 130 L120 105 L108 105 L120 88 L112 88 L120 70 L128 88 L122 88 L132 105 L122 105 L122 130" stroke="#718096" strokeWidth="0.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M150 130 L150 112 L143 112 L150 98 L145 98 L150 85 L155 98 L151 98 L157 112 L151 112 L151 130" stroke="#A0AEC0" strokeWidth="0.7" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
        <path d="M50 135 Q100 132 150 135 Q170 137 190 135" stroke="#CBD5E0" strokeWidth="0.6" opacity="0.4" />
        <circle cx="95" cy="55" r="0.8" fill="#CBD5E0" opacity="0.4" className="playground-art-snow" />
        <circle cx="130" cy="62" r="0.7" fill="#A0AEC0" opacity="0.3" className="playground-art-snow" style={{ animationDelay: "3s" }} />
      </svg>
    ),
  },
  {
    id: "paper-boat",
    season: "spring",
    render: () => (
      <svg viewBox="0 0 200 160" fill="none" className="playground-art">
        <path d="M60 110 L100 80 L140 110 Z" stroke="#4A5568" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="100" y1="80" x2="100" y2="60" stroke="#4A5568" strokeWidth="0.8" strokeLinecap="round" />
        <path d="M100 60 L115 72 L100 80" stroke="#718096" strokeWidth="0.8" fill="none" strokeLinecap="round" />
        <path d="M40 115 Q70 112 100 115 Q130 118 160 115" stroke="#A0AEC0" strokeWidth="0.7" opacity="0.5" />
        <path d="M50 120 Q80 117 110 120 Q140 123 170 120" stroke="#CBD5E0" strokeWidth="0.5" opacity="0.3" />
      </svg>
    ),
  },
  {
    id: "small-kite",
    season: "summer",
    render: () => (
      <svg viewBox="0 0 200 160" fill="none" className="playground-art">
        <path d="M100 40 L120 80 L100 100 L80 80 Z" stroke="#4A5568" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="80" y1="80" x2="120" y2="80" stroke="#718096" strokeWidth="0.6" />
        <line x1="100" y1="40" x2="100" y2="100" stroke="#718096" strokeWidth="0.6" />
        <path d="M100 100 Q105 115 95 125 Q100 130 95 140" stroke="#A0AEC0" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      </svg>
    ),
  },
];

// ─── Deterministic daily selection ────────────────────────────────────────

function dateHash(dateStr: string): number {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = ((h << 5) - h + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getCurrentSeason(): "winter" | "spring" | "summer" | "fall" {
  const month = new Date().getMonth(); // 0-11
  if (month >= 11 || month <= 1) return "winter";
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  return "fall";
}

function getDailyArtwork(): ArtworkDef {
  const today = new Date().toISOString().slice(0, 10);
  const season = getCurrentSeason();

  // Prefer seasonal artwork 60% of the time.
  const seasonal = ARTWORK_LIBRARY.filter((a) => a.season === season);
  const pool = seasonal.length > 0 && dateHash(today) % 10 < 6
    ? seasonal
    : ARTWORK_LIBRARY;

  const idx = dateHash(today) % pool.length;
  return pool[idx];
}

// ─── Component ────────────────────────────────────────────────────────────

export function PlaygroundHomeArtwork() {
  const artwork = useMemo(() => getDailyArtwork(), []);
  const Illustration = artwork.render;

  return (
    <div className="flex h-full items-center justify-center" data-testid="playground-home-artwork">
      <div className="w-[220px] h-[180px] opacity-60">
        <Illustration />
      </div>
      <style>{`
        @keyframes playground-art-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes playground-art-snow {
          0% { transform: translateY(0); opacity: 0.5; }
          100% { transform: translateY(12px); opacity: 0; }
        }
        @keyframes playground-art-twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.7; }
        }
        @keyframes playground-art-steam {
          0% { transform: translateY(0); opacity: 0.5; }
          100% { transform: translateY(-8px); opacity: 0; }
        }
        .playground-art-float { animation: playground-art-float 6s ease-in-out infinite; }
        .playground-art-snow { animation: playground-art-snow 8s ease-in infinite; }
        .playground-art-twinkle { animation: playground-art-twinkle 4s ease-in-out infinite; }
        .playground-art-steam { animation: playground-art-steam 5s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .playground-art-float, .playground-art-snow, .playground-art-twinkle, .playground-art-steam { animation: none; }
        }
      `}</style>
    </div>
  );
}
