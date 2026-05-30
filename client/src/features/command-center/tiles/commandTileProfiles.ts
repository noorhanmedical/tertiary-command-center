import type {
  CommandTileKind,
  CommandTileProfile,
  CommandTileSurface,
} from "./commandTileTypes";

export const commandTileProfiles: Record<
  CommandTileSurface,
  Record<CommandTileKind, CommandTileProfile>
> = {
  pcs: {
    visit: {
      surface: "pcs",
      kind: "visit",
      label: "Visit Patients",
      subtitle:
        "Use the existing visit workflow for committed clinic-day patients.",
      defaultHref: "/visit-patients",
      testId: "tile-pcs-visit",
      actions: [
        "openVisitCallList",
        "sendVisitReminder",
        "openVisitSchedule",
        "openPatientChart",
      ],
      emphasis: "patient-outreach",
    },
    outreach: {
      surface: "pcs",
      kind: "outreach",
      label: "Outreach Patients",
      subtitle:
        "Launch standalone outreach workflow without requiring a committed visit schedule.",
      defaultHref: "/outreach-patients",
      testId: "tile-pcs-outreach",
      actions: [
        "openOutreachQueue",
        "sendOutreachBrochure",
        "logOutreachCall",
        "convertCallback",
      ],
      emphasis: "patient-outreach",
    },
  },
  acs: {
    visit: {
      surface: "acs",
      kind: "visit",
      label: "Visit Patients",
      subtitle:
        "Manage ancillary readiness for committed visit-day patients.",
      defaultHref: "/visit-patients",
      testId: "tile-acs-visit",
      actions: [
        "openAncillaryReadiness",
        "assignTechnician",
        "openProcedureChecklist",
        "openVisitSchedule",
      ],
      emphasis: "ancillary",
    },
    outreach: {
      surface: "acs",
      kind: "outreach",
      label: "Outreach Patients",
      subtitle:
        "Ancillary follow-up for outreach-qualified patients pending scheduling.",
      defaultHref: "/outreach-patients",
      testId: "tile-acs-outreach",
      actions: [
        "openAncillaryQueue",
        "assignAncillaryFollowup",
        "viewAncillaryPipeline",
      ],
      emphasis: "ancillary",
    },
  },
  plexusIq: {
    visit: {
      surface: "plexusIq",
      kind: "visit",
      label: "Visit Patients",
      subtitle:
        "Use the existing visit workflow for committed clinic-day patients.",
      defaultHref: "/visit-patients",
      testId: "tile-qualification-visit",
      actions: [
        "openVisitIntelligenceSummary",
        "openVisitConversionFunnel",
        "openVisitAiInsights",
      ],
      emphasis: "intelligence",
    },
    outreach: {
      surface: "plexusIq",
      kind: "outreach",
      label: "Outreach Patients",
      subtitle:
        "Launch standalone outreach workflow without requiring a committed visit schedule.",
      defaultHref: "/outreach-patients",
      testId: "tile-qualification-outreach",
      actions: [
        "openOutreachIntelligenceSummary",
        "openOutreachConversionFunnel",
        "openOutreachAiInsights",
      ],
      emphasis: "intelligence",
    },
  },
  dashboard: {
    visit: {
      surface: "dashboard",
      kind: "visit",
      label: "Visit Patients",
      subtitle:
        "Rollup of visit volume, conversion, and ancillary attach across clinics.",
      defaultHref: "/visit-patients",
      testId: "tile-dashboard-visit",
      actions: [
        "openVisitRollup",
        "openVisitFacilityBreakdown",
        "openVisitWeekOverWeek",
      ],
      emphasis: "rollup",
    },
    outreach: {
      surface: "dashboard",
      kind: "outreach",
      label: "Outreach Patients",
      subtitle:
        "Rollup of outreach conversion, scheduler load, and callback aging.",
      defaultHref: "/outreach-patients",
      testId: "tile-dashboard-outreach",
      actions: [
        "openOutreachRollup",
        "openOutreachSchedulerLoad",
        "openOutreachAgingReport",
      ],
      emphasis: "rollup",
    },
  },
};
