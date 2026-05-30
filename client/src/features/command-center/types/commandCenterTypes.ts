export type CommandSurface = "pcs" | "acs" | "plexusIq" | "dashboard" | "unknown";

export type CommandComponentType =
  | "calendarDate"
  | "patient"
  | "ancillary"
  | "callList"
  | "procedure"
  | "document"
  | "billing"
  | "marketing"
  | "email"
  | "scratchpad"
  | "searchResult"
  | "visit"
  | "outreach";

export type AncillaryType = "brainwave" | "vitalwave" | "ultrasound" | "other";

export type LeftPanelModuleId =
  | "calendar"
  | "phone"
  | "marketing"
  | "email"
  | "search"
  | "scratchpad";

export type PanelPlaygroundContext = {
  sourceSurface: CommandSurface;
  componentType: CommandComponentType;
  selectedDate?: string;
  patientUuid?: string;
  patientName?: string;
  facilityId?: string;
  clinicId?: string;
  ancillaryType?: AncillaryType;
  callId?: string;
  materialId?: string;
  documentId?: string;
  billingId?: string;
  procedureId?: string;
  invoiceId?: string;
  filters?: Record<string, unknown>;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type SelectedCommandContext = {
  type:
    | "patient"
    | "clinic"
    | "calendarDate"
    | "call"
    | "ancillary"
    | "procedure"
    | "document"
    | "billing"
    | "marketing"
    | "email"
    | "scratchpad"
    | "visit"
    | "outreach"
    | "none";
  context: PanelPlaygroundContext | null;
};

export type PlaygroundWorkspaceType = CommandComponentType | "call" | "empty";

export type CommandPermission =
  | "viewCalendar"
  | "usePhone"
  | "sendMarketing"
  | "composeEmail"
  | "searchCommand"
  | "useScratchpad"
  | "viewProcedures"
  | "editProcedures"
  | "viewDocuments"
  | "viewBilling"
  | "editBilling";

export type CommandSurfaceProfile = {
  surface: CommandSurface;
  label: string;
  visibleLeftPanelModules: LeftPanelModuleId[];
  permissions: CommandPermission[];
  defaultCalendarFilters?: Record<string, unknown>;
};

export type CommandCalendarCell = {
  date: string;
  facilityId?: string;
  totalPatientCount: number;
  brainWaveCount: number;
  vitalWaveCount: number;
  ultrasoundCount: number;
  hasBrainWave: boolean;
  hasVitalWave: boolean;
  hasUltrasound: boolean;
  procedureCompleteCount: number;
  hasProcedureComplete: boolean;
  scheduledAncillaryCount: number;
  sameDayOpportunityCount: number;
  patientUuids: string[];
  metadata?: Record<string, unknown>;
};

export type MarketingMaterial = {
  id: string;
  title: string;
  category:
    | "BrainWave"
    | "VitalWave"
    | "Ultrasound"
    | "Preventive screening"
    | "Chronic care"
    | "Clinic-specific material"
    | "General education"
    | "Consent/support materials";
  description?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  fileUrl?: string;
  fileType?: "pdf" | "image" | "doc" | "link";
  ancillaryType?: AncillaryType;
  clinicId?: string;
  facilityId?: string;
  tags?: string[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};
