// Outreach / Engagement Center — the canonical command-center surface
// for engagement assignments. Distinct from Patient Care Specialist
// Workspace (a single team-member's queue) and Scheduler Portal
// (the legacy outreach call surface). /engagement-center is the
// manager-level view over every patient currently routed through
// engagement: who is assigned to whom, what is on follow-up, and what
// needs reassignment.
//
// Backed by /api/engagement/assignment-board (read) and
// /api/engagement/assignment-board/assign (write). Both ride on the
// existing patient_execution_cases + patient_screenings spine — no
// new tables, no parallel call-list store.
//
// Legacy routes:
//   /outreach-center → /scheduler-portal (unchanged, preserves
//                       deep links into the outreach call surface)
//   /scheduler-portal → OutreachPage (unchanged, scheduler call queue)
//   /engagement-center → this page (assignment manager view)

import { SidebarTrigger } from "@/components/ui/sidebar";
import { EngagementAssignmentBoard } from "@/components/engagement/EngagementAssignmentBoard";
import { EngagementDuplicateBanner } from "@/components/engagement/EngagementDuplicateBanner";

export default function EngagementCenterPage() {
  return (
    <div className="relative left-1/2 flex h-full w-screen -translate-x-1/2 flex-col bg-[#EEF1F6] text-[#101115]">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#101115] text-white">
        <div className="flex h-20 w-full items-center justify-between gap-4 px-6 lg:px-10">
          <div className="flex items-center gap-4">
            <SidebarTrigger data-testid="button-sidebar-toggle-engagement-center" />
            <div>
              <h1
                className="text-base font-medium tracking-[-0.02em] text-white"
                data-testid="text-engagement-center-title"
              >
                Engagement Center
              </h1>
              <div className="mt-1 text-[10px] font-light uppercase tracking-[0.22em] text-slate-400">
                Plexus Assignment Board
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="border border-white bg-white px-4 py-2 text-[11px] font-light uppercase tracking-[0.12em] text-[#101115]">
              Manager
            </span>
            <span className="border border-slate-700 bg-slate-900 px-4 py-2 text-[11px] font-light uppercase tracking-[0.12em] text-slate-300">
              Live
            </span>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto bg-[#EEF1F6]">
        <div className="w-full px-6 py-8 lg:px-10">
          <section className="relative mb-5 overflow-hidden rounded-md border border-slate-800 bg-[linear-gradient(135deg,#0D0E12_0%,#171B26_52%,#2A3D5A_100%)] px-8 py-10 text-white shadow-[0_34px_90px_rgba(4,8,16,0.20)]">
            <div
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
                backgroundSize: "56px 56px",
              }}
              aria-hidden="true"
            />
            <div className="relative z-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div>
                <div className="text-[11px] font-light uppercase tracking-[0.22em] text-slate-300">Plexus Clinical</div>
                <div className="mt-4 text-[52px] font-light leading-[0.95] tracking-[-0.055em] sm:text-[62px]">
                  Engagement
                </div>
                <p className="mt-5 max-w-3xl text-[15px] font-light leading-6 text-slate-300">
                  Assign approved patients to the right team member. PCS handles calls. Scheduler handles appointments. ACS handles tests.
                </p>
                <div className="mt-8 flex flex-wrap gap-2">
                  <button type="button" className="rounded-sm border border-white bg-white px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-[#101115]">
                    Assign selected
                  </button>
                  <button type="button" className="rounded-sm border border-white/20 bg-white/10 px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-white">
                    Unassigned
                  </button>
                  <button type="button" className="rounded-sm border border-white/20 bg-white/10 px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-white">
                    Interested
                  </button>
                </div>
              </div>
              <div className="rounded-sm border border-white/15 bg-white/10 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="text-lg font-medium tracking-[-0.02em] text-white">Board status</div>
                  <div className="text-[11px] font-light uppercase tracking-[0.12em] text-slate-200">Live</div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-white/15 pt-5">
                  <div><div className="text-[10px] font-light uppercase tracking-[0.18em] text-slate-300">Total</div><div className="mt-2 text-3xl font-light">—</div></div>
                  <div><div className="text-[10px] font-light uppercase tracking-[0.18em] text-slate-300">Unassigned</div><div className="mt-2 text-3xl font-light">—</div></div>
                  <div><div className="text-[10px] font-light uppercase tracking-[0.18em] text-slate-300">Assigned</div><div className="mt-2 text-3xl font-light">—</div></div>
                  <div><div className="text-[10px] font-light uppercase tracking-[0.18em] text-slate-300">Needs Info</div><div className="mt-2 text-3xl font-light">—</div></div>
                </div>
              </div>
            </div>
          </section>

          <EngagementDuplicateBanner />
          <EngagementAssignmentBoard />
        </div>
      </main>
    </div>
  );
}
