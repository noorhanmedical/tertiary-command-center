// Nova — ambient AI assistant particle presence.
//
// A tiny nebula of soft pink/lilac luminous dots that hangs subtly in
// the Playground canvas. Three visual states:
//   idle   — low opacity, diffuse, slow drift
//   hover  — particles brighten, shape tightens, gentle pulse
//   active — clicked, expands into the Nova quick panel
//
// Implementation: pure CSS/SVG particles with transform animations.
// Respects prefers-reduced-motion (static but still responds to hover
// with brightness). ~30 particles, no WebGL dependency.

import { useCallback, useMemo, useRef, useState } from "react";

// ─── Color palette ────────────────────────────────────────────────────────

const NOVA_COLORS = [
  "#F6A6C8", // blush pink
  "#EC78B6", // rose
  "#D96BC6", // magenta
  "#B878E6", // lavender
  "#E8B4F2", // light violet
  "#F2C4E0", // soft pink
  "#C890DC", // mid lilac
];

// ─── Particle generation ──────────────────────────────────────────────────

type Particle = {
  id: number;
  cx: number; // center-relative x (-1 to 1)
  cy: number; // center-relative y (-1 to 1)
  r: number;  // radius in px
  color: string;
  opacity: number;
  delay: number; // animation delay in seconds
  drift: number; // drift amplitude
};

function generateParticles(count: number, seed: number): Particle[] {
  // Deterministic pseudo-random so particles don't jump on re-render.
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    // Cluster most particles toward center (gaussian-ish via Box-Muller lite).
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * 0.8; // sqrt distribution = more central
    particles.push({
      id: i,
      cx: Math.cos(angle) * radius,
      cy: Math.sin(angle) * radius,
      r: 1.2 + rand() * 2.2,
      color: NOVA_COLORS[Math.floor(rand() * NOVA_COLORS.length)],
      opacity: 0.4 + rand() * 0.5,
      delay: rand() * 6,
      drift: 0.5 + rand() * 1.5,
    });
  }
  return particles;
}

// ─── Props ────────────────────────────────────────────────────────────────

export type NovaParticlesProps = {
  /** Visual size of the nebula footprint in px. Default: 44. */
  size?: number;
  /** Number of particles. Default: 32. */
  count?: number;
  /** Whether Nova is in active/clicked state (brighter + defined). */
  active?: boolean;
  /** Click handler (opens quick panel). */
  onClick?: () => void;
  /** Additional className. */
  className?: string;
};

// ─── Component ────────────────────────────────────────────────────────────

export function NovaParticles({
  size = 44,
  count = 32,
  active = false,
  onClick,
  className = "",
}: NovaParticlesProps) {
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const particles = useMemo(() => generateParticles(count, 42), [count]);

  const handleEnter = useCallback(() => setHovered(true), []);
  const handleLeave = useCallback(() => setHovered(false), []);

  // State-driven visual parameters.
  const isEngaged = hovered || active;
  const baseOpacity = isEngaged ? 1 : 0.45;
  const glowIntensity = active ? 12 : hovered ? 8 : 3;
  const tighten = isEngaged ? 0.7 : 1; // Particles pull inward on engage.
  const pulseClass = isEngaged ? "nova-pulse" : "";

  return (
    <div
      ref={containerRef}
      className={`relative cursor-pointer select-none ${className}`}
      style={{ width: size, height: size }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={onClick}
      role="button"
      aria-label="Nova AI Assistant"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick?.(); }}
      data-testid="nova-particles"
    >
      <svg
        viewBox="-1.2 -1.2 2.4 2.4"
        width={size}
        height={size}
        className={`transition-opacity duration-500 ${pulseClass}`}
        style={{ opacity: baseOpacity, filter: `drop-shadow(0 0 ${glowIntensity}px rgba(217,107,198,0.6))` }}
        aria-hidden="true"
      >
        {particles.map((p) => (
          <circle
            key={p.id}
            cx={p.cx * tighten}
            cy={p.cy * tighten}
            r={p.r / (size / 2)}
            fill={p.color}
            opacity={p.opacity}
            className="nova-particle"
            style={{
              animationDelay: `${p.delay}s`,
              // @ts-expect-error CSS custom property for drift amplitude
              "--drift": `${p.drift}px`,
            }}
          />
        ))}
        {/* Central bright core — visible when engaged */}
        {isEngaged && (
          <circle cx={0} cy={0} r={0.08} fill="#F6A6C8" opacity={0.9}>
            <animate attributeName="r" values="0.06;0.1;0.06" dur="2s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>

      {/* Inline keyframe styles (no external CSS dependency) */}
      <style>{`
        @keyframes nova-drift {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(calc(var(--drift, 1px) * 0.3), calc(var(--drift, 1px) * -0.2)); }
          50% { transform: translate(calc(var(--drift, 1px) * -0.2), calc(var(--drift, 1px) * 0.3)); }
          75% { transform: translate(calc(var(--drift, 1px) * 0.1), calc(var(--drift, 1px) * 0.1)); }
        }
        @keyframes nova-pulse-anim {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        .nova-particle {
          animation: nova-drift 8s ease-in-out infinite;
        }
        .nova-pulse {
          animation: nova-pulse-anim 3s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .nova-particle { animation: none; }
          .nova-pulse { animation: none; }
        }
      `}</style>
    </div>
  );
}
