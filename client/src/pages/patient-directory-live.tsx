// Patient Directory live page route — renders PatientDirectoryLivePage
// (route-connected wrapper) so the live Patient Directory is reachable
// at /patient-directory/live. The legacy /patient-directory route
// continues to serve PatientDatabasePage so this is purely additive.

import { SidebarTrigger } from "@/components/ui/sidebar";
import { PatientDirectoryLivePage } from "@/components/patient-directory/PatientDirectoryLivePage";

export default function PatientDirectoryLiveRoute() {
  return (
    <div className="flex flex-col h-full">
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-30">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2">
          <SidebarTrigger data-testid="button-sidebar-toggle-patient-directory-live" />
          <div>
            <div className="text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
              PLEXUS · PATIENT DIRECTORY · LIVE
            </div>
            <h1
              className="text-xl font-semibold tracking-tight text-slate-900"
              data-testid="text-patient-directory-live-title"
            >
              Patient Directory (live)
            </h1>
            <p className="text-[11px] text-slate-500">
              Search, profile, audit trail, contact restrictions, prior tests, import preview.
            </p>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-auto bg-slate-50/40">
        <PatientDirectoryLivePage />
      </main>
    </div>
  );
}
