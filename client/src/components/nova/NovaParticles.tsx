// Nova — ambient AI assistant, Canvas 2D particle system.
//
// Hundreds of tiny luminous dots forming ONE cohesive living nebula.
// Force-field based simulation: global flow + breathing + shape
// attraction + local noise. Canvas 2D for 60fps at 300+ particles.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NOVA_COLOR_PRESETS,
  type NovaAppearanceProfile,
  DEFAULT_NOVA_APPEARANCE,
} from "./contracts";
import {
  createEngine,
  updateEngine,
  renderToCanvas,
  retargetShape,
  computeParticleCount,
  type EngineState,
} from "./engine";

// ─── Props ────────────────────────────────────────────────────────────────

export type NovaParticlesProps = {
  appearance?: NovaAppearanceProfile;
  active?: boolean;
  onClick?: () => void;
  onDragEnd?: (x: number, y: number) => void;
  onInteractionChange?: (active: boolean) => void;
  className?: string;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EngineState | null>(null);
  const frameRef = useRef<number>(0);
  const lastTimeRef = useRef(0);
  const dragStart = useRef<{ x: number; y: number; elX: number; elY: number } | null>(null);
  const dragDelta = useRef({ dx: 0, dy: 0 });
  const prevShapeRef = useRef(appearance.shape);
  const prevInteracting = useRef(false);

  const { size, particleDensity, shape, colorPreset, customColors,
    glowIntensity, movementSpeed, movementIntensity, hoverScale, idleVisibility,
    hoverIntensity,
  } = appearance;

  const colors = customColors && customColors.length > 0
    ? customColors
    : NOVA_COLOR_PRESETS[colorPreset] ?? NOVA_COLOR_PRESETS.deep_space;

  const particleCount = computeParticleCount(size, particleDensity);

  // Initialize / reinitialize engine.
  useEffect(() => {
    engineRef.current = createEngine(particleCount, shape, 42);
    prevShapeRef.current = shape;
  }, [particleCount]); // Only recreate when count changes.

  // Retarget shape without recreating particles (smooth morph).
  useEffect(() => {
    if (engineRef.current && shape !== prevShapeRef.current) {
      retargetShape(engineRef.current, shape);
      prevShapeRef.current = shape;
    }
  }, [shape]);

  // Interaction state notification.
  const isInteracting = hovered || active || dragging;
  useEffect(() => {
    if (isInteracting !== prevInteracting.current) {
      prevInteracting.current = isInteracting;
      onInteractionChange?.(isInteracting);
    }
  }, [isInteracting, onInteractionChange]);

  // Reduced motion detection.
  const reducedMotion = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mq.matches;
    const handler = () => { reducedMotion.current = mq.matches; };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Visibility detection — pause when hidden.
  const visible = useRef(true);
  useEffect(() => {
    const handler = () => { visible.current = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Animation loop.
  useEffect(() => {
    if (reducedMotion.current) {
      // Render one static frame.
      const canvas = canvasRef.current;
      const engine = engineRef.current;
      if (canvas && engine) {
        const ctx = canvas.getContext("2d");
        if (ctx) renderToCanvas(ctx, engine, canvas.width, canvas.height, colors, false, glowIntensity);
      }
      return;
    }

    let running = true;
    const animate = (now: number) => {
      if (!running) return;
      frameRef.current = requestAnimationFrame(animate);
      if (!visible.current) return;

      const engine = engineRef.current;
      const canvas = canvasRef.current;
      if (!engine || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dt = lastTimeRef.current ? Math.min((now - lastTimeRef.current) / 1000, 0.05) : 0.016;
      lastTimeRef.current = now;

      const engaged = hovered || active;

      updateEngine(engine, {
        dt,
        hovered,
        active,
        dragging,
        dragDx: dragDelta.current.dx,
        dragDy: dragDelta.current.dy,
        movementSpeed,
        movementIntensity,
        hoverScale: hoverScale ?? 1.2,
      });

      dragDelta.current = { dx: 0, dy: 0 };
      renderToCanvas(ctx, engine, canvas.width, canvas.height, colors, engaged, glowIntensity);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, [hovered, active, dragging, movementSpeed, movementIntensity, hoverScale, colors, glowIntensity]);

  // Hit area (larger than visible for stable hover).
  const hitSize = Math.max(size * 1.3, size + 30);
  // Canvas draws at pixel size; CSS scales to visual size with bloom.
  const canvasPixels = Math.round(size * (hoverScale ?? 1.2) * 1.1);

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
    // Normalized drag delta for engine momentum.
    dragDelta.current = { dx: dx * 0.001, dy: dy * 0.001 };
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

  // Bloom scale for the canvas element (CSS transform).
  const engaged = hovered || active;
  const visualScale = engaged ? (hoverScale ?? 1.2) : 1;
  const visualOpacity = engaged ? Math.min(1, idleVisibility * (hoverIntensity ?? 1.6)) : idleVisibility;

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
      <canvas
        ref={canvasRef}
        width={canvasPixels}
        height={canvasPixels}
        style={{
          width: size,
          height: size,
          opacity: visualOpacity,
          transform: `scale(${visualScale})`,
          transformOrigin: "center",
          transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
        }}
        aria-hidden="true"
      />
    </div>
  );
}
