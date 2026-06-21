import { Home, LogOut } from "lucide-react";
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
  const isAdmin = role === "admin";
  const roleLabel = isAdmin ? "" : (ROLE_LABELS[role] ?? role);
  const [location] = useLocation();
  const onHome = location === "/home" || location === "/";

  return (
    <header
      className="shrink-0 h-16 text-white border-b border-white/10 relative overflow-hidden"
      style={{ background: "#05060f" }}
      data-testid="top-banner"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          content: '""',
          width: "100%",
          height: "100%",
          backgroundImage:
            "radial-gradient(1px 1px at 10% 30%, rgba(255,255,255,0.5) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 25% 70%, rgba(255,255,255,0.4) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 40% 20%, rgba(255,255,255,0.55) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 55% 80%, rgba(255,255,255,0.35) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 65% 45%, rgba(255,255,255,0.5) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 72% 15%, rgba(255,255,255,0.4) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 80% 60%, rgba(255,255,255,0.45) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 88% 35%, rgba(255,255,255,0.3) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 93% 75%, rgba(255,255,255,0.5) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 5% 55%, rgba(255,255,255,0.35) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 18% 85%, rgba(255,255,255,0.4) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 33% 50%, rgba(255,255,255,0.3) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 48% 10%, rgba(255,255,255,0.45) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 59% 90%, rgba(255,255,255,0.35) 0%, transparent 100%), " +
            "radial-gradient(1px 1px at 76% 25%, rgba(255,255,255,0.5) 0%, transparent 100%), " +
            "radial-gradient(1.5px 1.5px at 3% 40%, rgba(255,255,255,0.6) 0%, transparent 100%), " +
            "radial-gradient(1.5px 1.5px at 50% 65%, rgba(255,255,255,0.55) 0%, transparent 100%), " +
            "radial-gradient(1.5px 1.5px at 85% 50%, rgba(255,255,255,0.6) 0%, transparent 100%)",
        }}
      />
      <div className="relative h-full px-6 flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight text-white" data-testid="text-banner-title">
            Plexus Clinical
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
