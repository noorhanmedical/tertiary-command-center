// Nova — ambient AI assistant particle presence.
//
// A living nebula of particles that inhabits the Playground canvas.
// Driven by NovaAppearanceProfile for colors/size/shape/motion.
// Draggable within the Playground surface. Procedural non-repeating motion.
// Respects prefers-reduced-motion.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NOVA_COLOR_PRESETS,
  type NovaAppearanceProfile,
  type NovaShape,
  type NovaColorPreset,
  DEFAULT_NOVA_APPEARANCE,
} from "./contracts";

// ─── Procedural noise (simple 2D Perlin-lite) ─────────────────────────────

function hashNoise(x: number, y: number, seed: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7 + seed * 43758.5453) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hashNoise(ix, iy, seed);
  const b = hashNoise(ix + 1, iy, seed);
  const c = hashNoise(ix, iy + 1, seed);
  const d = hashNoise(ix + 1, iy + 1, seed);
  return a + sx * (b - a) + sy * (c + sx * (d - c) - a - sx * (b - a));
}

// ─── Shape distributions ──────────────────────────────────────────────────

type ParticlePos = { cx: number; cy: number };

function shapeDistribution(shape: NovaShape, index: number, total: number, rand: () => number): ParticlePos {
  const angle = (index / total) * Math.PI * 2 + rand() * 0.3;
  const t = index / total;

  switch (shape) {
    case "sphere": {
      const r = 0.3 + rand() * 0.4;
      return { cx: Math.cos(angle) * r, cy: Math.sin(angle) * r };
    }
    case "ring": {
      const r = 0.55 + (rand() - 0.5) * 0.15;
      return { cx: Math.cos(angle) * r, cy: Math.sin(angle) * r };
    }
    case "star": {
      const arm = index % 5;
      const armAngle = (arm / 5) * Math.PI * 2 + (rand() - 0.5) * 0.4;
      const r = 0.2 + t * 0.5;
      return { cx: Math.cos(armAngle) * r, cy: Math.sin(armAngle) * r };
    }
    case "crescent": {
      const a2 = angle * 0.7 + Math.PI * 0.15;
      const r = 0.4 + rand() * 0.25;
      const offset = Math.cos(a2) > 0.1 ? 0 : 0.3;
      return { cx: Math.cos(a2) * r - offset, cy: Math.sin(a2) * r };
    }
    case "spiral": {
      const spiralAngle = t * Math.PI * 4 + rand() * 0.5;
      const r = 0.15 + t * 0.5;
      return { cx: Math.cos(spiralAngle) * r, cy: Math.sin(spiralAngle) * r };
    }
    case "nebula":
    default: {
      const r = Math.sqrt(rand()) * 0.7;
      return { cx: Math.cos(angle) * r, cy: Math.sin(angle) * r };
    }
  }
}

// ─── Particle generation ──────────────────────────────────────────────────

type Particle = {
  id: number;
  baseCx: number;
  baseCy: number;
  r: number;
  colorIdx: number;
  opacity: number;
  seed: number;
};

function generateParticles(count: number, shape: NovaShape, masterSeed: number): Particle[] {
  let s = masterSeed;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const pos = shapeDistribution(shape, i, count, rand);
    particles.push({
      id: i,
      baseCx: pos.cx,
      baseCy: pos.cy,
      r: 1.5 + rand() * 2.5,
      colorIdx: Math.floor(rand() * 7),
      opacity: 0.4 + rand() * 0.5,
      seed: rand() * 1000,
    });
  }
  return particles;
}

// ─── Props ────────────────────────────────────────────────────────────────

export type NovaParticlesProps = {
  /** Appearance profile (colors, size, shape, motion params). */
  appearance?: NovaAppearanceProfile;
  /** Whether Nova is in active/clicked state. */
  active?: boolean;
  /** Click handler. */
  onClick?: () => void;
  /** Drag handler — called with new position relative to container. */
  onDragEnd?: (x: number, y: number) => void;
  /** Called when Nova interaction state changes (hover/active/drag). */
  onInteractionChange?: (active: boolean) => void;
  /** Additional className. */
  className?: string;
  /** Style (for absolute positioning). */
  style?: React.CSSProperties;
};

// ─── Component ────────────────────────────────────────────────────────────

export function NovaParticles({
  appearance = DEFAULT_NOVA_APPEARANCE,
  active = false,
  onClick,
  onDragEnd,
  onInteractionChange,
  className = "",
  style,
}: NovaParticlesProps) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; elX: number; elY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const timeRef = useRef(0);
  const [tick, setTick] = useState(0);

  const { size, particleDensity, shape, colorPreset, customColors, opacity,
    glowIntensity, movementSpeed, movementIntensity, hoverIntensity, hoverScale, idleVisibility,
  } = appearance;

  const colors = customColors && customColors.length > 0
    ? customColors
    : NOVA_COLOR_PRESETS[colorPreset] ?? NOVA_COLOR_PRESETS.deep_space;

  const particles = useMemo(
    () => generateParticles(particleDensity, shape, 42),
    [particleDensity, shape],
  );

  // Procedural animation loop (non-repeating).
  const reducedMotion = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mq.matches;
    const handler = () => { reducedMotion.current = mq.matches; };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (reducedMotion.current) return;
    let running = true;
    const animate = () => {
      if (!running) return;
      timeRef.current += 0.016 * movementSpeed;
      setTick((t) => t + 1);
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, [movementSpeed]);

  // Drag handling.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!onDragEnd) return;
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    dragStart.current = { x: e.clientX, y: e.clientY, elX: rect.left, elY: rect.top };
    setDragging(true);
  }, [onDragEnd]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current || !containerRef.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const el = containerRef.current;
    el.style.left = `${dragStart.current.elX + dx}px`;
    el.style.top = `${dragStart.current.elY + dy}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }, [dragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    const el = containerRef.current;
    if (el) el.releasePointerCapture(e.pointerId);
    setDragging(false);
    if (onDragEnd && el) {
      const rect = el.getBoundingClientRect();
      onDragEnd(rect.left, rect.top);
    }
    dragStart.current = null;
  }, [dragging, onDragEnd]);

  const isEngaged = hovered || active;
  const baseOpacity = isEngaged ? Math.min(1, idleVisibility * hoverIntensity) : idleVisibility;
  const glowPx = isEngaged ? glowIntensity * 2.5 : glowIntensity;
  // BLOOM: particles expand outward on hover/active (not tighten).
  const bloom = isEngaged ? (hoverScale ?? 1.2) : 1;
  const time = timeRef.current;

  // Notify parent of interaction state changes for rail suppression.
  const isInteracting = hovered || active || dragging;
  const prevInteracting = useRef(false);
  useEffect(() => {
    if (isInteracting !== prevInteracting.current) {
      prevInteracting.current = isInteracting;
      onInteractionChange?.(isInteracting);
    }
  }, [isInteracting, onInteractionChange]);

  // Hit area is larger than visible size to prevent hover flicker.
  const hitSize = Math.max(size * 1.3, size + 30);

  return (
    <div
      ref={containerRef}
      className={`select-none touch-none ${dragging ? "cursor-grabbing" : "cursor-pointer"} ${className}`}
      style={{ width: hitSize, height: hitSize, display: "flex", alignItems: "center", justifyContent: "center", ...style }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!active) setHovered(false); }}
      onClick={dragging ? undefined : onClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
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
        style={{
          opacity: baseOpacity,
          filter: `drop-shadow(0 0 ${glowPx}px ${colors[0]}88)`,
          transition: "opacity 0.4s, filter 0.4s, transform 0.4s ease-out",
          transform: `scale(${bloom})`,
          transformOrigin: "center",
        }}
        aria-hidden="true"
      >
        {particles.map((p) => {
          // Procedural offset from noise.
          const noiseX = smoothNoise(p.seed + time * 0.3, 0, p.id) - 0.5;
          const noiseY = smoothNoise(0, p.seed + time * 0.3, p.id + 100) - 0.5;
          // Bloom: particles drift OUTWARD from center on hover.
          const bloomDrift = isEngaged ? 1.15 : 1;
          const drift = movementIntensity * 0.12;
          const cx = (p.baseCx * bloomDrift + noiseX * drift);
          const cy = (p.baseCy * bloomDrift + noiseY * drift);
          const particleR = p.r / (size / 2);

          return (
            <circle
              key={p.id}
              cx={cx}
              cy={cy}
              r={particleR * (isEngaged ? 1.1 : 1)}
              fill={colors[p.colorIdx % colors.length]}
              opacity={p.opacity * (isEngaged ? 1.3 : 1)}
              style={{ transition: "cx 0.4s, cy 0.4s, r 0.3s, opacity 0.3s" }}
            />
          );
        })}
        {/* Central bright core when engaged */}
        {isEngaged && (
          <circle cx={0} cy={0} r={0.08} fill={colors[colors.length - 1]} opacity={0.9} />
        )}
      </svg>
    </div>
  );
}
