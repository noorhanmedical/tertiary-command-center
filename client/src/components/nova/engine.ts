// Nova Particle Engine — force-field based particle simulation.
//
// ONE cohesive nebula made from hundreds of tiny luminous dots. Particles
// share a global force field (shape attraction + center attraction + global
// flow + rotation + breathing) with individual procedural noise. Canvas 2D
// rendering for performance at 300+ particles.

import {
  NOVA_COLOR_PRESETS,
  type NovaAppearanceProfile,
  type NovaShape,
  type NovaColorPreset,
  DEFAULT_NOVA_APPEARANCE,
} from "./contracts";

// ─── Noise (2D simplex-lite) ──────────────────────────────────────────────

function hash(x: number, y: number, seed: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7 + seed * 43758.5453) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + sx * (b - a) + sy * (c + sx * (d - c) - a - sx * (b - a));
}

// ─── Shape target distributions ───────────────────────────────────────────

function shapeTarget(shape: NovaShape, i: number, total: number, rand: () => number): { x: number; y: number } {
  const angle = (i / total) * Math.PI * 2 + rand() * 0.5;
  const t = i / total;

  switch (shape) {
    case "sphere": {
      const r = 0.25 + rand() * 0.35;
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }
    case "ring": {
      const r = 0.38 + (rand() - 0.5) * 0.08;
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }
    case "star": {
      const arm = i % 5;
      const armAngle = (arm / 5) * Math.PI * 2 + (rand() - 0.5) * 0.3;
      const r = 0.12 + t * 0.35;
      return { x: Math.cos(armAngle) * r, y: Math.sin(armAngle) * r };
    }
    case "crescent": {
      const a2 = angle * 0.7 + Math.PI * 0.15;
      const r = 0.3 + rand() * 0.18;
      const offset = Math.cos(a2) > 0.1 ? 0 : 0.2;
      return { x: Math.cos(a2) * r - offset, y: Math.sin(a2) * r };
    }
    case "spiral": {
      const sa = t * Math.PI * 4 + rand() * 0.4;
      const r = 0.1 + t * 0.35;
      return { x: Math.cos(sa) * r, y: Math.sin(sa) * r };
    }
    case "nebula":
    default: {
      const r = Math.pow(rand(), 0.6) * 0.42;
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }
  }
}

// ─── Particle type ────────────────────────────────────────────────────────

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  radius: number;
  colorIdx: number;
  opacity: number;
  depth: number; // 0=background, 1=mid, 2=foreground
  noiseSeed: number;
  brightness: number;
};

// ─── Engine state ─────────────────────────────────────────────────────────

export type EngineState = {
  particles: Particle[];
  time: number;
  centerX: number;
  centerY: number;
  breathPhase: number;
  rotationAngle: number;
  dragVx: number;
  dragVy: number;
};

// ─── Engine creation ──────────────────────────────────────────────────────

export function createEngine(count: number, shape: NovaShape, seed: number): EngineState {
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const target = shapeTarget(shape, i, count, rand);
    const depth = rand() < 0.7 ? 0 : rand() < 0.85 ? 1 : 2;

    // Radius distribution: mostly tiny.
    let radius: number;
    const rRoll = rand();
    if (rRoll < 0.70) radius = 0.6 + rand() * 0.4;       // 70%: 0.6–1.0
    else if (rRoll < 0.90) radius = 1.0 + rand() * 0.4;  // 20%: 1.0–1.4
    else if (rRoll < 0.98) radius = 1.4 + rand() * 0.4;  // 8%: 1.4–1.8
    else radius = 1.8 + rand() * 0.5;                     // 2%: core

    // Opacity by depth.
    let opacity: number;
    if (depth === 0) opacity = 0.15 + rand() * 0.25;      // background
    else if (depth === 1) opacity = 0.35 + rand() * 0.35; // mid
    else opacity = 0.6 + rand() * 0.4;                    // foreground

    particles.push({
      x: target.x + (rand() - 0.5) * 0.05,
      y: target.y + (rand() - 0.5) * 0.05,
      vx: 0,
      vy: 0,
      targetX: target.x,
      targetY: target.y,
      radius,
      colorIdx: Math.floor(rand() * 7),
      opacity,
      depth,
      noiseSeed: rand() * 1000,
      brightness: 0.7 + rand() * 0.3,
    });
  }

  return {
    particles,
    time: 0,
    centerX: 0,
    centerY: 0,
    breathPhase: 0,
    rotationAngle: 0,
    dragVx: 0,
    dragVy: 0,
  };
}

// ─── Engine update (per frame) ────────────────────────────────────────────

export type EngineUpdateParams = {
  dt: number; // seconds
  hovered: boolean;
  active: boolean;
  dragging: boolean;
  dragDx: number; // current frame drag delta (normalized)
  dragDy: number;
  movementSpeed: number;
  movementIntensity: number;
  hoverScale: number;
};

export function updateEngine(state: EngineState, params: EngineUpdateParams): void {
  const { dt, hovered, active, dragging, dragDx, dragDy, movementSpeed, movementIntensity, hoverScale } = params;
  const engaged = hovered || active;

  state.time += dt * movementSpeed;

  // Global breathing (non-uniform cycle via noise).
  state.breathPhase = state.time * 0.15;
  const breathAmt = (smoothNoise(state.breathPhase, 0, 7) - 0.5) * 0.08 * movementIntensity;

  // Subtle global rotation.
  state.rotationAngle = state.time * 0.02 * movementIntensity;
  const cosR = Math.cos(state.rotationAngle * 0.3);
  const sinR = Math.sin(state.rotationAngle * 0.3);

  // Bloom factor on hover.
  const bloom = engaged ? hoverScale : 1.0;

  // Drag momentum decay.
  state.dragVx = state.dragVx * 0.92 + dragDx * 0.5;
  state.dragVy = state.dragVy * 0.92 + dragDy * 0.5;

  // Global flow field direction (slowly rotating).
  const flowAngle = state.time * 0.08;
  const flowX = Math.cos(flowAngle) * 0.002 * movementIntensity;
  const flowY = Math.sin(flowAngle) * 0.002 * movementIntensity;

  for (const p of state.particles) {
    // Target with breathing + bloom + rotation.
    const breathedX = p.targetX * (1 + breathAmt) * bloom;
    const breathedY = p.targetY * (1 + breathAmt) * bloom;
    const rotX = breathedX * cosR - breathedY * sinR;
    const rotY = breathedX * sinR + breathedY * cosR;

    // Shape attraction (spring toward target).
    const stiffness = 0.8 + p.depth * 0.4; // foreground follows faster
    const dx = rotX - p.x;
    const dy = rotY - p.y;
    const ax = dx * stiffness * dt * 3;
    const ay = dy * stiffness * dt * 3;

    // Local procedural noise (time-varying, per-particle).
    const noiseScale = 0.3 * movementIntensity;
    const nx = (smoothNoise(p.noiseSeed + state.time * 0.4, state.time * 0.1, p.noiseSeed) - 0.5) * noiseScale * dt;
    const ny = (smoothNoise(state.time * 0.1, p.noiseSeed + state.time * 0.4, p.noiseSeed + 50) - 0.5) * noiseScale * dt;

    // Drag influence (depth-based lag).
    const dragLag = 1.0 - p.depth * 0.25; // background lags more
    const dInfluenceX = state.dragVx * dragLag * 0.3;
    const dInfluenceY = state.dragVy * dragLag * 0.3;

    // Center attraction (gentle cohesion).
    const centerForce = 0.1 * dt;
    const toCenter = -p.x * centerForce;
    const toCenterY = -p.y * centerForce;

    // Velocity update.
    p.vx = (p.vx + ax + nx + flowX + dInfluenceX + toCenter) * 0.85;
    p.vy = (p.vy + ay + ny + flowY + dInfluenceY + toCenterY) * 0.85;

    // Position update.
    p.x += p.vx;
    p.y += p.vy;

    // Clamp to prevent escape.
    const maxR = 0.7 * bloom;
    const dist = Math.sqrt(p.x * p.x + p.y * p.y);
    if (dist > maxR) {
      p.x *= maxR / dist;
      p.y *= maxR / dist;
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }
}

// ─── Retarget particles to new shape ──────────────────────────────────────

export function retargetShape(state: EngineState, shape: NovaShape): void {
  let s = 42;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  const count = state.particles.length;
  for (let i = 0; i < count; i++) {
    const target = shapeTarget(shape, i, count, rand);
    state.particles[i].targetX = target.x;
    state.particles[i].targetY = target.y;
  }
}

// ─── Render to Canvas ─────────────────────────────────────────────────────

export function renderToCanvas(
  ctx: CanvasRenderingContext2D,
  state: EngineState,
  width: number,
  height: number,
  colors: string[],
  engaged: boolean,
  glowIntensity: number,
): void {
  ctx.clearRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) * 0.9;
  const opacityMul = engaged ? 1.5 : 1.0;

  // Sort by depth for correct layering (background first).
  const sorted = state.particles.slice().sort((a, b) => a.depth - b.depth);

  for (const p of sorted) {
    const px = cx + p.x * scale;
    const py = cy + p.y * scale;
    const r = p.radius * (engaged ? 1.15 : 1.0);
    const alpha = Math.min(1, p.opacity * opacityMul * p.brightness);
    const color = colors[p.colorIdx % colors.length];

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    // Subtle glow on brighter foreground particles.
    if (p.depth === 2 && glowIntensity > 2) {
      ctx.globalAlpha = alpha * 0.3;
      ctx.beginPath();
      ctx.arc(px, py, r * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
}

// ─── Compute particle count from size + density ───────────────────────────

export function computeParticleCount(size: number, density: number): number {
  // density is 20–80 (from profile). Scale with size.
  const base = density * 4; // density 40 → 160 base
  const sizeMultiplier = size / 80; // 100px → 1.25x
  return Math.round(Math.max(120, Math.min(500, base * sizeMultiplier)));
}
