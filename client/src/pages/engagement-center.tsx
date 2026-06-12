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
    <div className="flex h-full flex-col bg-[#EEF1F6]">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#101115] text-white">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <SidebarTrigger data-testid="button-sidebar-toggle-engagement-center" />
          <div>
            <div className="text-[10px] font-normal uppercase tracking-[0.18em] text-slate-400">
              PLEXUS CLINICAL · ENGAGEMENT
            </div>
            <h1
              className="text-xl font-medium tracking-[-0.02em] text-white"
              data-testid="text-engagement-center-title"
            >
              Engagement Center
            </h1>
            <p className="text-[11px] font-light text-slate-400">
              Assignment board, follow-up queue, and team coordination.
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto bg-[#EEF1F6]">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-3">
            <EngagementDuplicateBanner />
            <EngagementAssignmentBoard />
          </div>
        </div>
      </main>
    </div>
  );
}
