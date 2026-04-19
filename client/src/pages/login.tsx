import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", { username, password });
      queryClient.clear();
      onLogin();
    } catch (err: any) {
      const msg = err.message || "Login failed";
      setError(msg.includes("401") ? "Invalid username or password" : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1b35] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-7 h-7 text-white">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 001.357 2.059l.344.142c.796.329 1.399 1.01 1.604 1.845a2.25 2.25 0 01-2.174 2.735h-4.26a2.25 2.25 0 01-2.174-2.735 3.75 3.75 0 011.604-1.845l.344-.142A2.25 2.25 0 0114.25 8.818V3.104m0 0c.25.023.499.05.75.082" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Plexus</h1>
          <p className="text-white/50 text-sm mt-1">Ancillary Screening Platform</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-white/60 mb-1.5 uppercase tracking-wide">
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Enter username"
                data-testid="input-login-username"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-white/60 mb-1.5 uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Enter password"
                data-testid="input-login-password"
              />
            </div>

            {error && (
              <div className="text-red-400 text-xs text-center bg-red-500/10 rounded-lg py-2 px-3" data-testid="text-login-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-2.5 text-sm transition-colors mt-2"
              data-testid="button-login-submit"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-white/25 text-xs mt-6">
          Contact your administrator if you need access.
        </p>
      </div>
    </div>
  );
}
