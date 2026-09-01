// Playground winter background — a calm snow-mountain scene + light snowfall.
//
// Rendered as the backdrop of the Playground center surface. The scene is an
// inline SVG (no image asset), and the snow is a lightweight <canvas> particle
// layer (requestAnimationFrame, DPR-aware, ResizeObserver-sized). Both layers
// are pointer-events-none and sit behind the workspace content (-z-10), so all
// interactions and the translucent workspace surfaces read normally on top.
//
// Honors prefers-reduced-motion: when set, the snow is drawn once (static) and
// no animation loop runs.

import { useEffect, useRef } from "react";

type Flake = { x: number; y: number; r: number; vy: number; vx: number; sway: number; phase: number };

export function WinterBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

    let raf = 0;
    let w = 0;
    let h = 0;
    let flakes: Flake[] = [];

    const makeFlake = (spread: boolean): Flake => {
      const r = 0.8 + Math.random() * 1.9;
      return {
        x: Math.random() * w,
        y: spread ? Math.random() * h : -8,
        r,
        vy: 8 + r * 9 + Math.random() * 10, // px/sec — gentle fall
        vx: (Math.random() - 0.5) * 5,
        sway: 5 + Math.random() * 13,
        phase: Math.random() * Math.PI * 2,
      };
    };

    const drawFlakes = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      for (const f of flakes) {
        ctx.globalAlpha = Math.min(0.9, 0.35 + f.r / 2.8);
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Light density: ~1 flake per 20k px², clamped for tiny/huge surfaces.
      const target = Math.min(130, Math.max(28, Math.round((w * h) / 20000)));
      flakes = Array.from({ length: target }, () => makeFlake(true));
      if (reduce) drawFlakes();
    };

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      for (const f of flakes) {
        f.phase += dt;
        f.y += f.vy * dt;
        f.x += (f.vx + Math.sin(f.phase) * f.sway) * dt;
        if (f.y > h + 6) { const nf = makeFlake(false); nf.x = Math.random() * w; Object.assign(f, nf); }
        if (f.x < -6) f.x = w + 6; else if (f.x > w + 6) f.x = -6;
        ctx.globalAlpha = Math.min(0.9, 0.35 + f.r / 2.8);
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    resize();
    if (!reduce) { last = performance.now(); raf = requestAnimationFrame(frame); }

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
      data-testid="playground-winter-bg"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1024 440"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="winterSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cfe6fb" />
            <stop offset="60%" stopColor="#dcecfc" />
            <stop offset="100%" stopColor="#eaf4ff" />
          </linearGradient>
          <linearGradient id="winterSnow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f2f7ff" />
          </linearGradient>
        </defs>

        {/* Sky */}
        <rect x="0" y="0" width="1024" height="440" fill="url(#winterSky)" />

        {/* Far mountain range (lightest) */}
        <path
          fill="#c3d8ef"
          d="M0,250 L70,214 L150,238 L235,196 L318,228 L405,182 L500,150 L600,196 L690,170 L784,214 L864,178 L946,220 L1024,190 L1024,275 L0,275 Z"
        />
        {/* Near mountain range (deeper blue) with the tall centre peak */}
        <path
          fill="#a7c4e6"
          d="M0,262 L120,224 L210,250 L300,214 L360,240 L470,150 L560,222 L648,190 L742,246 L822,208 L904,250 L1004,216 L1024,244 L1024,300 L0,300 Z"
        />

        {/* Snow field */}
        <path fill="url(#winterSnow)" d="M0,252 L1024,236 L1024,440 L0,440 Z" />
        {/* Rolling dune shadows (subtle) */}
        <path fill="#e7f0fb" opacity="0.9" d="M0,330 C170,300 300,360 470,340 C640,320 800,378 1024,344 L1024,440 L0,440 Z" />
        <path fill="#dce8f8" opacity="0.75" d="M0,388 C230,360 430,410 650,392 C820,378 930,404 1024,394 L1024,440 L0,440 Z" />

        {/* Left pine cluster */}
        <g fill="#3c5fa6">
          <polygon points="60,300 34,300 47,250" />
          <polygon points="60,300 34,300 47,266" fill="#34528f" />
          <polygon points="104,306 74,306 89,246" />
          <polygon points="104,306 74,306 89,266" fill="#34528f" />
          <polygon points="138,300 116,300 127,262" />
          <rect x="45.5" y="300" width="3" height="8" />
          <rect x="87.5" y="306" width="3" height="8" />
          <rect x="125.5" y="300" width="3" height="7" />
        </g>

        {/* Right pine cluster */}
        <g fill="#3c5fa6">
          <polygon points="946,252 916,252 931,192" />
          <polygon points="946,252 916,252 931,212" fill="#34528f" />
          <polygon points="992,258 966,258 979,200" />
          <polygon points="992,258 966,258 979,220" fill="#34528f" />
          <rect x="929.5" y="252" width="3" height="9" />
          <rect x="977.5" y="258" width="3" height="9" />
        </g>
      </svg>

      {/* Light snowfall */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
