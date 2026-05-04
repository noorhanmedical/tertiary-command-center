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
      className="shrink-0 h-16 bg-finance-dark text-white border-b border-finance-dark-3 relative"
      data-testid="top-banner"
    >
      <div className="relative h-full px-6 flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight text-white" data-testid="text-banner-title">
            Plexus Clinical
          </span>
          <span className="text-[10px] text-slate-400 tracking-wider uppercase" data-testid="text-banner-subtitle">
            Post Acute Care Portal
          </span>
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
              {isAdmin && (
                <span
                  className="hidden sm:inline-flex items-center gap-1 px-3 py-1 rounded-full bg-finance-periwinkle/25 border border-finance-periwinkle/40 text-[11px] font-medium text-white"
                  data-testid="badge-admin"
                >
                  <Shield className="w-3 h-3" />
                  Admin
                </span>
              )}
              <span
                className="hidden md:inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-slate-300"
                data-testid="badge-banner-user"
                title={`Signed in as ${user.username}${roleLabel ? ` (${roleLabel})` : ""}`}
              >
                <span className="font-medium text-white">{user.username}</span>
                {roleLabel && !isAdmin && <span className="text-slate-400">· {roleLabel}</span>}
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
