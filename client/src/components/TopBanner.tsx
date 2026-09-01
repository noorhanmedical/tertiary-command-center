import { Home, LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";
import type { AuthUser } from "@/App";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  clinician: "Clinician",
  scheduler: "Scheduler",
  biller: "Biller",
};

// Static twinkling stars. `s` = size in px, `o` = peak opacity, `d` = animation delay (s).
const STARS: { left: string; top: string; s: number; o: number; d: number; dur: number }[] = [
  { left: "10%", top: "30%", s: 2, o: 0.95, d: 0, dur: 3.2 },
  { left: "25%", top: "70%", s: 1, o: 0.7, d: 1.1, dur: 4.1 },
  { left: "40%", top: "20%", s: 2, o: 0.9, d: 2.3, dur: 3.6 },
  { left: "55%", top: "80%", s: 1, o: 0.65, d: 0.7, dur: 4.8 },
  { left: "65%", top: "45%", s: 2, o: 0.9, d: 1.9, dur: 3.4 },
  { left: "72%", top: "15%", s: 1, o: 0.7, d: 3.1, dur: 4.2 },
  { left: "80%", top: "60%", s: 1, o: 0.75, d: 0.4, dur: 3.9 },
  { left: "88%", top: "35%", s: 1, o: 0.65, d: 2.7, dur: 4.5 },
  { left: "93%", top: "75%", s: 2, o: 0.9, d: 1.4, dur: 3.3 },
  { left: "5%", top: "55%", s: 1, o: 0.7, d: 2.0, dur: 4.0 },
  { left: "18%", top: "85%", s: 1, o: 0.75, d: 0.9, dur: 4.6 },
  { left: "33%", top: "50%", s: 1, o: 0.65, d: 3.4, dur: 3.7 },
  { left: "48%", top: "10%", s: 2, o: 0.9, d: 1.6, dur: 3.1 },
  { left: "59%", top: "90%", s: 1, o: 0.7, d: 2.5, dur: 4.3 },
  { left: "76%", top: "25%", s: 2, o: 0.95, d: 0.6, dur: 3.5 },
  { left: "14%", top: "45%", s: 1, o: 0.65, d: 3.0, dur: 4.4 },
  { left: "22%", top: "18%", s: 1, o: 0.75, d: 1.2, dur: 3.8 },
  { left: "37%", top: "78%", s: 1, o: 0.7, d: 2.8, dur: 4.1 },
  { left: "44%", top: "38%", s: 1, o: 0.65, d: 0.3, dur: 4.7 },
  { left: "62%", top: "62%", s: 2, o: 0.9, d: 2.1, dur: 3.2 },
  { left: "69%", top: "88%", s: 1, o: 0.65, d: 1.7, dur: 4.0 },
  { left: "83%", top: "12%", s: 1, o: 0.75, d: 3.3, dur: 3.6 },
  { left: "90%", top: "52%", s: 1, o: 0.7, d: 0.8, dur: 4.5 },
  { left: "97%", top: "28%", s: 1, o: 0.65, d: 2.4, dur: 3.9 },
  { left: "8%", top: "72%", s: 1, o: 0.7, d: 1.5, dur: 4.2 },
  { left: "3%", top: "40%", s: 2, o: 0.95, d: 2.9, dur: 3.4 },
  { left: "50%", top: "65%", s: 2, o: 0.9, d: 0.5, dur: 3.7 },
  { left: "85%", top: "50%", s: 2, o: 0.95, d: 2.2, dur: 3.3 },
  // Extra dots to populate the field.
  { left: "30%", top: "33%", s: 1, o: 0.7, d: 1.0, dur: 4.3 },
  { left: "67%", top: "72%", s: 2, o: 0.9, d: 3.5, dur: 3.5 },
  { left: "12%", top: "60%", s: 1, o: 0.65, d: 0.2, dur: 4.6 },
  { left: "53%", top: "25%", s: 1, o: 0.75, d: 2.6, dur: 3.8 },
  { left: "78%", top: "82%", s: 1, o: 0.7, d: 1.3, dur: 4.1 },
  { left: "42%", top: "55%", s: 2, o: 0.9, d: 3.2, dur: 3.2 },
  { left: "95%", top: "62%", s: 1, o: 0.7, d: 0.6, dur: 4.4 },
  { left: "27%", top: "8%", s: 1, o: 0.75, d: 2.0, dur: 3.6 },
];

export function TopBanner({ user, onLogout }: { user?: AuthUser; onLogout?: () => void }) {
  const role = user?.role ?? "";
  const isAdmin = role === "admin";
  const roleLabel = isAdmin ? "" : (ROLE_LABELS[role] ?? role);
  const [location] = useLocation();
  const onHome = location === "/home" || location === "/";
  // Winter shell is scoped to the staged Home redesign only (§8).
  const winter = location === "/home-preview";

  if (winter) {
    return (
      <header
        className="shrink-0 winter-topbar text-white border-b border-white/10 relative overflow-hidden"
        data-testid="top-banner"
      >
        <div className="relative h-full px-7 flex items-center justify-between">
          <div className="flex items-center">
            <img
              src="/plexus-logo.png"
              alt="Plexus Clinical"
              className="h-9 w-auto object-contain"
              data-testid="img-banner-logo"
            />
          </div>
          <div className="flex items-center gap-2">
            {user && !onHome && (
              <Link
                href="/home"
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 hover:border-white/25 px-3 py-1 text-[12px] font-medium text-white transition-colors"
                data-testid="link-banner-home"
                aria-label="Back to Home"
                title="Back to Home"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Home</span>
              </Link>
            )}
            {user && (
              <>
                <span
                  className="hidden md:inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-slate-300"
                  data-testid="badge-banner-user"
                  title={`Signed in as ${user.username}${roleLabel ? ` (${roleLabel})` : ""}`}
                >
                  <span className="font-medium text-white">{user.username}</span>
                  {roleLabel && <span className="text-slate-400">· {roleLabel}</span>}
                </span>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    className="p-1.5 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                    title="Sign out"
                    aria-label="Sign out"
                    data-testid="button-banner-logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header
      className="shrink-0 h-20 text-white border-b border-white/10 relative overflow-hidden"
      style={{ background: "#05060f" }}
      data-testid="top-banner"
    >
      <style>{`
        @keyframes shootingStar {
          0% {
            transform: rotate(var(--angle, 20deg)) translateX(0);
            opacity: 0;
          }
          0.4% {
            opacity: var(--maxop, 0.38);
          }
          1.5% {
            opacity: var(--maxop, 0.38);
          }
          2.3% {
            transform: rotate(var(--angle, 20deg)) translateX(var(--dist, 480px));
            opacity: 0;
          }
          100% {
            transform: rotate(var(--angle, 20deg)) translateX(var(--dist, 480px));
            opacity: 0;
          }
        }
        .top-banner-shooting-star {
          position: absolute;
          height: 1px;
          width: var(--len, 60px);
          background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 55%, rgba(255,255,255,0.95) 100%);
          border-radius: 9999px;
          opacity: 0;
          pointer-events: none;
          transform-origin: left center;
          animation-name: shootingStar;
          animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
          animation-iteration-count: infinite;
          filter: drop-shadow(0 0 2px rgba(255,255,255,0.6));
        }
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50% { opacity: var(--peakop, 0.95); transform: scale(1.15); }
        }
        .top-banner-star {
          position: absolute;
          border-radius: 9999px;
          background: #ffffff;
          pointer-events: none;
          box-shadow: 0 0 3px rgba(255,255,255,0.85);
          animation-name: twinkle;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .top-banner-shooting-star { animation: none; opacity: 0; }
          .top-banner-star { animation: none; }
        }
      `}</style>
      <div className="absolute inset-0 pointer-events-none">
        {STARS.map((star, i) => (
          <span
            key={i}
            className="top-banner-star"
            style={{
              left: star.left,
              top: star.top,
              width: `${star.s}px`,
              height: `${star.s}px`,
              opacity: star.o,
              ["--peakop" as any]: String(star.o),
              animationDuration: `${star.dur}s`,
              animationDelay: `${star.d}s`,
            }}
          />
        ))}
      </div>
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* A bright streak appears roughly every 7–8s: each star runs a 30s
            cycle staggered by 8s, each with its own direction (--angle),
            travel distance (--dist) and trail length. */}
        <span
          className="top-banner-shooting-star"
          style={{ top: "18%", left: "-6%", ["--angle" as any]: "22deg", ["--dist" as any]: "560px", ["--len" as any]: "64px", ["--maxop" as any]: "0.9", animationDuration: "30s", animationDelay: "0s" }}
        />
        <span
          className="top-banner-shooting-star"
          style={{ top: "8%", left: "40%", ["--angle" as any]: "34deg", ["--dist" as any]: "440px", ["--len" as any]: "52px", ["--maxop" as any]: "0.8", animationDuration: "30s", animationDelay: "8s" }}
        />
        <span
          className="top-banner-shooting-star"
          style={{ top: "60%", left: "10%", ["--angle" as any]: "-12deg", ["--dist" as any]: "600px", ["--len" as any]: "70px", ["--maxop" as any]: "0.85", animationDuration: "30s", animationDelay: "16s" }}
        />
        <span
          className="top-banner-shooting-star"
          style={{ top: "30%", left: "-4%", ["--angle" as any]: "9deg", ["--dist" as any]: "500px", ["--len" as any]: "58px", ["--maxop" as any]: "0.75", animationDuration: "30s", animationDelay: "24s" }}
        />
      </div>
      <div className="relative h-full px-6 flex items-center justify-between">
        <div className="flex items-center">
          <img
            src="/plexus-logo.png"
            alt="Plexus Clinical"
            className="h-10 w-auto object-contain"
            data-testid="img-banner-logo"
          />
        </div>

        <div className="flex items-center gap-2">
          {user && !onHome && (
            <Link
              href="/home"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 hover:border-white/25 px-3 py-1 text-[12px] font-medium text-white transition-colors"
              data-testid="link-banner-home"
              aria-label="Back to Home"
              title="Back to Home"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Home</span>
            </Link>
          )}
          {user && (
            <>
              <span
                className="hidden md:inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-slate-300"
                data-testid="badge-banner-user"
                title={`Signed in as ${user.username}${roleLabel ? ` (${roleLabel})` : ""}`}
              >
                <span className="font-medium text-white">{user.username}</span>
                {roleLabel && <span className="text-slate-400">· {roleLabel}</span>}
              </span>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                  title="Sign out"
                  aria-label="Sign out"
                  data-testid="button-banner-logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
