export type CommandTileKind = "visit" | "outreach";

export type CommandTileSurface = "pcs" | "acs" | "plexusIq" | "dashboard";

export type CommandTileContext = {
  kind: CommandTileKind;
  surface: CommandTileSurface;
  title: string;
  subtitle?: string;
  count?: number;
  status?: string;
  patientUuids?: string[];
  facilityId?: string;
  selectedDate?: string;
  filters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type CommandTileEmphasis =
  | "patient-outreach"
  | "ancillary"
  | "intelligence"
  | "rollup";

export type CommandTileProfile = {
  surface: CommandTileSurface;
  kind: CommandTileKind;
  label: string;
  subtitle: string;
  defaultHref: string;
  testId: string;
  actions: string[];
  emphasis: CommandTileEmphasis;
};
