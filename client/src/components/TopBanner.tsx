import { Home, LogOut, Shield } from "lucide-react";
import { Link, useLocation } from "wouter";
import type { AuthUser } from "@/App";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  clinician: "Clinician",
  scheduler: "Scheduler",
  biller: "Biller",
};

export function TopBanner({ user, onLogout }: { user?: AuthUser; onLogout?: () => void }) {
  const role = user?.role ?? "";
  const roleLabel = ROLE_LABELS[role] ?? role;
  const isAdmin = role === "admin";
  const [location] = useLocation();
  // Suppress the Home link when we're already on home (or the root redirect)
  // so the header doesn't show a dead-end self-link.
  const onHome = location === "/home" || location === "/";

  return (
    <header
      className="shrink-0 h-20 bg-plexus-navy-950 text-white border-b border-black/40 relative overflow-hidden"
      data-testid="top-banner"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 12% 30%, rgba(255,255,255,0.6), transparent 60%)," +
            "radial-gradient(1px 1px at 28% 70%, rgba(255,255,255,0.4), transparent 60%)," +
            "radial-gradient(1px 1px at 47% 22%, rgba(255,255,255,0.5), transparent 60%)," +
            "radial-gradient(1px 1px at 63% 55%, rgba(255,255,255,0.35), transparent 60%)," +
            "radial-gradient(1px 1px at 78% 18%, rgba(255,255,255,0.5), transparent 60%)," +
            "radial-gradient(1px 1px at 88% 65%, rgba(255,255,255,0.4), transparent 60%)," +
            "radial-gradient(1px 1px at 36% 45%, rgba(255,255,255,0.3), transparent 60%)",
        }}
      />
      <div className="relative h-full px-5 flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight" data-testid="text-banner-title">
            Plexus Clinical
          </span>
          <span className="text-[10px] text-indigo-200/80 tracking-wider uppercase" data-testid="text-banner-subtitle">
            Post Acute Care Portal
          </span>
        </div>

        <div className="flex items-center gap-3">
          {user && !onHome && (
            <Link
              href="/home"
              className="inline-flex items-center gap-1.5 rounded-md bg-plexus-blue-600/30 hover:bg-plexus-blue-600/55 border border-white/15 hover:border-white/25 px-2.5 py-1 text-[11px] font-medium text-white transition-colors"
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
              {isAdmin && (
                <span
                  className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-medium"
                  data-testid="badge-admin"
                >
                  <Shield className="w-3 h-3" />
                  Admin
                </span>
              )}
              <span
                className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-indigo-100"
                data-testid="badge-banner-user"
                title={`Signed in as ${user.username}${roleLabel ? ` (${roleLabel})` : ""}`}
              >
                <span className="font-medium text-white">{user.username}</span>
                {roleLabel && !isAdmin && <span className="text-indigo-200/80">· {roleLabel}</span>}
              </span>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-md text-indigo-200 hover:text-white hover:bg-white/10 transition-colors"
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
