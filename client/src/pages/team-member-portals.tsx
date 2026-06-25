// Team Member Portals landing page.
//
// The ONLY execution portals are:
//   1. Patient Care Specialist Workspace
//   2. Ancillary Care Specialist Workspace
//
// Engagement Center (assignment / disbursement of approved patients to
// PCS/ACS) and Outreach Center (marketing campaigns / call metrics) are
// surfaced from the main app nav — they are NOT execution portals and
// must not appear as tiles on this landing page.

import { Link } from "wouter";
import { ArrowRight, Headphones, Stethoscope } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";

type PortalCard = {
  title: string;
  subtitle: string;
  href: string;
  icon: React.ReactNode;
  testId: string;
};

// PHASE-1 TEAM-PORTAL ROUTING:
//   - Only PCS + ACS tiles render here.
//   - No Outreach tile.
//   - No Engagement tile.
//   - No legacy scheduler tile.
//   - No phase-7 control surfaces.
const PORTALS: PortalCard[] = [
  {
    title: "Patient Care Specialist Workspace",
    subtitle:
      "Calls, scheduling, callbacks, patient coordination, and appointment workflow.",
    href: "/patient-care-specialist-portal",
    icon: (
      <Headphones
        className="w-7 h-7 lg:w-8 lg:h-8 xl:w-9 xl:h-9"
        strokeWidth={1.75}
      />
    ),
    testId: "card-patient-care-specialist-workspace",
  },
  {
    title: "Ancillary Care Specialist Workspace",
    subtitle:
      "Clinic schedule, ancillary schedule, call list, consent, screening forms, procedure completion, uploads, and reports.",
    href: "/ancillary-care-specialist-portal",
    icon: (
      <Stethoscope
        className="w-7 h-7 lg:w-8 lg:h-8 xl:w-9 xl:h-9"
        strokeWidth={1.75}
      />
    ),
    testId: "card-ancillary-care-specialist-workspace",
  },
];

export default function TeamMemberPortalsPage() {
  return (
    <div className="flex flex-col h-full">
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-30">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2">
          <SidebarTrigger data-testid="button-sidebar-toggle-team-member-portals" />
          <div>
            <h1
              className="text-xl font-semibold tracking-tight text-slate-900"
              data-testid="text-team-member-portals-title"
            >
              Team Member Portals
            </h1>
            <p className="text-[11px] text-slate-500">
              Pick the portal that matches your role today.
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto bg-slate-50/40">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-8 lg:py-10 xl:py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6 xl:gap-8">
            {PORTALS.map((portal) => (
              <Link key={portal.href} href={portal.href}>
                <div
                  className="group rounded-2xl bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] hover:border-plexus-navy-800/40 transition-all p-6 lg:p-8 xl:p-10 cursor-pointer h-full flex flex-col"
                  data-testid={portal.testId}
                >
                  <div className="inline-flex items-center justify-center h-12 w-12 lg:h-14 lg:w-14 xl:h-16 xl:w-16 rounded-xl lg:rounded-2xl bg-plexus-navy-800/5 text-plexus-navy-800 mb-4 lg:mb-5 xl:mb-6">
                    {portal.icon}
                  </div>
                  <h2 className="text-base lg:text-lg xl:text-xl font-semibold text-slate-900">
                    {portal.title}
                  </h2>
                  <p className="mt-1 lg:mt-2 text-xs lg:text-sm text-slate-500 leading-relaxed flex-1">
                    {portal.subtitle}
                  </p>
                  <span
                    className="mt-4 lg:mt-6 inline-flex items-center gap-1.5 text-xs lg:text-sm font-medium text-plexus-navy-800 group-hover:underline"
                    data-testid={`${portal.testId}-open`}
                  >
                    Open Portal <ArrowRight className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
