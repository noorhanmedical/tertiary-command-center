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

const premiumLightTypeCss = `
  .premium-engagement-shell {
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  .premium-engagement-shell h1,
  .premium-engagement-shell h2,
  .premium-engagement-shell h3,
  .premium-engagement-shell .font-bold,
  .premium-engagement-shell .font-semibold,
  .premium-engagement-shell .font-extrabold,
  .premium-engagement-shell .font-black {
    font-weight: 450 !important;
    letter-spacing: -0.012em;
  }

  .premium-engagement-shell .uppercase,
  .premium-engagement-shell label,
  .premium-engagement-shell th,
  .premium-engagement-shell [data-radix-collection-item] {
    font-weight: 430 !important;
    letter-spacing: 0.11em;
  }

  .premium-engagement-shell p,
  .premium-engagement-shell td,
  .premium-engagement-shell input,
  .premium-engagement-shell button,
  .premium-engagement-shell [role="option"],
  .premium-engagement-shell .text-slate-500,
  .premium-engagement-shell .text-muted-foreground {
    font-weight: 350 !important;
  }

  .premium-engagement-shell .rounded-xl,
  .premium-engagement-shell .rounded-2xl,
  .premium-engagement-shell .rounded-3xl,
  .premium-engagement-shell .rounded-lg,
  .premium-engagement-shell .rounded-md {
    border-radius: 0 !important;
  }

  .premium-engagement-shell .bg-white,
  .premium-engagement-shell .bg-card,
  .premium-engagement-shell .glass-tile {
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.055);
  }
`;

export default function EngagementCenterPage() {
  return (
    <div className="premium-engagement-shell flex flex-col h-full bg-[#EEF1F6]">
      <style>{premiumLightTypeCss}</style>

      <header className="bg-[#101115] text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
          <SidebarTrigger data-testid="button-sidebar-toggle-engagement-center" />
          <div>
            <div className="text-[10px] tracking-[0.18em] text-slate-400 uppercase">
              PLEXUS CLINICAL · ENGAGEMENT
            </div>
            <h1
              className="text-xl tracking-[-0.02em] text-white"
              data-testid="text-engagement-center-title"
            >
              Engagement Center
            </h1>
            <p className="text-[11px] text-slate-400">
              Assignment board, follow-up queue, and team coordination.
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto bg-[#EEF1F6]">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-3">
          <EngagementDuplicateBanner />
          <EngagementAssignmentBoard />
        </div>
      </main>
    </div>
  );
}
