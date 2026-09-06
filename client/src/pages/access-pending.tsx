// Access Pending — minimal, safe, neutral authenticated landing.
//
// TEMPORARY / UNSUPPORTED SURFACE. Shown to authenticated users whose intended
// default workspace has no supported UI yet (currently: Investor). It exposes
// NO operational data, NO patient/PHI, and NO navigation into the operational
// app. It renders as a full-screen surface so the persistent Admin shell's
// sidebar/dock/tab bar are not presented behind it.
//
// This is NOT an Investor Portal. When a dedicated surface ships, update
// defaultWorkspaceRoutes.ts to point the relevant identifier at it.

import { LogOut } from "lucide-react";

export default function AccessPendingPage({ onLogout }: { onLogout?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-plexus-navy-950 px-6 text-center"
      style={{ background: "#05060f" }}
      data-testid="access-pending"
    >
      <img
        src="/plexus-logo.png"
        alt="Plexus"
        className="mb-8 h-10 w-auto object-contain opacity-90"
      />
      <h1 className="text-2xl font-light tracking-tight text-white">
        Your workspace is being set up
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
        Your account is authenticated, but a workspace has not been configured
        for your access level yet. Please contact your Plexus administrator to
        finish provisioning your access.
      </p>
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
          data-testid="button-access-pending-logout"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      )}
    </div>
  );
}
