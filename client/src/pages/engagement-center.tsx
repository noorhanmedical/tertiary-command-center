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

import { EngagementAssignmentBoard } from "@/components/engagement/EngagementAssignmentBoard";
import { EngagementDuplicateBanner } from "@/components/engagement/EngagementDuplicateBanner";

export default function EngagementCenterPage() {
  return (
    <div className="flex flex-col h-full">
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-30">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
              PLEXUS ANCILLARY · ENGAGEMENT CENTER
            </div>
            <h1
              className="text-xl font-semibold tracking-tight text-slate-900"
              data-testid="text-engagement-center-title"
            >
              Engagement Center
            </h1>
            <p className="text-[11px] text-slate-500">
              Assignment board, follow-up queue, and team-member coordination.
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto bg-slate-50/40">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-3">
          <EngagementDuplicateBanner />
          <EngagementAssignmentBoard />
        </div>
      </main>
    </div>
  );
}
