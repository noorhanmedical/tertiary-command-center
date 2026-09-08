import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  // `identifier` accepts a work email (preferred) or a legacy username during
  // the auth migration. The backend normalizes + resolves either.
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Presentation-only login context. Switching to "admin" changes wording only.
  // It grants NO privileges — the backend authorizes purely from the user's
  // configured access context, never from this flag.
  const [adminMode, setAdminMode] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // `identifier` is sent as `username` for backend field compatibility
      // (the login endpoint resolves email OR username). `adminMode` is a
      // non-authoritative UI hint only.
      await apiRequest("POST", "/api/auth/login", {
        username: identifier.trim(),
        password,
        adminMode,
      });
      queryClient.clear();
      onLogin();
    } catch (err: any) {
      const msg = err.message || "Login failed";
      // Keep credential errors generic — never disclose whether an account
      // (or an administrator account) exists.
      setError(
        msg.includes("401") || msg.toLowerCase().includes("invalid")
          ? "Invalid work email or password"
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  const accessLabel = adminMode ? "Administrator Access" : "Team Access";

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 bg-cover bg-center bg-no-repeat relative bg-slate-950"
      style={{ backgroundImage: "url('/login-bg.png')" }}
    >
      {/* Readability scrim — keeps the photo CRISP (no blur) while darkening
          for text contrast: a soft vertical wash + a centered vignette. */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/45 via-slate-950/20 to-slate-950/60" />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(65% 50% at 50% 42%, rgba(2,6,23,0) 0%, rgba(2,6,23,0.42) 100%)" }}
      />

      <div className="relative w-full max-w-md flex flex-col items-center">
        {/* Brand */}
        <div className="text-center mb-8">
          <h1
            className="text-5xl md:text-6xl font-light text-white tracking-tight"
            style={{ textShadow: "0 2px 14px rgba(0,0,0,0.6)" }}
          >
            Plexus OS
          </h1>
          <p
            className="text-white/85 text-sm md:text-base mt-2 tracking-[0.35em] uppercase transition-colors"
            style={{ textShadow: "0 1px 10px rgba(0,0,0,0.55)" }}
            data-testid="text-access-mode"
          >
            {accessLabel}
          </p>
        </div>

        {/* Frosted glass card */}
        <div className="w-full bg-slate-900/55 border border-white/15 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide">
                Work Email
              </label>
              <input
                type="text"
                inputMode="email"
                autoComplete="username"
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full bg-white/10 border border-white/25 rounded-xl px-4 py-3 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition"
                placeholder="you@organization.com"
                data-testid="input-login-username"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/10 border border-white/25 rounded-xl px-4 py-3 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition"
                placeholder="Enter password"
                data-testid="input-login-password"
              />
            </div>

            {error && (
              <div className="text-red-200 text-xs text-center bg-red-900/40 border border-red-400/30 rounded-lg py-2 px-3" data-testid="text-login-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !identifier.trim() || !password}
              className="w-full bg-white hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold rounded-xl py-3 text-sm transition-colors shadow-lg"
              data-testid="button-login-submit"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        {/* Subtle access-context toggle. Presentation only — authorization is
            always decided by the backend access context, never by this switch. */}
        <button
          type="button"
          onClick={() => setAdminMode((v) => !v)}
          className="mt-5 text-xs text-white/70 hover:text-white tracking-wide underline-offset-4 hover:underline transition-colors"
          style={{ textShadow: "0 1px 8px rgba(0,0,0,0.5)" }}
          data-testid="button-toggle-admin-access"
          aria-pressed={adminMode}
        >
          {adminMode ? "← Back to Team Access" : "Administrator Access"}
        </button>

        <p className="text-center text-white/70 text-xs mt-6" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.5)" }}>
          Contact your administrator if you need access.
        </p>
      </div>
    </div>
  );
}
