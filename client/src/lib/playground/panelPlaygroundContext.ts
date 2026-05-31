// Canonical context types + builders for the
// panel → popup → Playground pattern.
//
// Every panel popup that supports promotion to the Playground
// hands the parent the same shape: `PanelPlaygroundContext`. The
// parent (PortalShell or another centerMode owner) then renders
// the matching Playground body without re-fetching the source
// row.
//
// See `docs/architecture/panel-popup-playground-pattern.md` for
// the contract and the surface map.

export const PANEL_PLAYGROUND_SOURCES = [
  "pcs",
  "acs",
  "plexusIq",
  "dashboard",
  "unknown",
] as const;
export type PanelPlaygroundSource = (typeof PANEL_PLAYGROUND_SOURCES)[number];

export const PANEL_PLAYGROUND_COMPONENT_TYPES = [
  "calendarDate",
  "patient",
  "ancillary",
  "callList",
  "procedure",
  "document",
  "billing",
] as const;
export type PanelPlaygroundComponentType =
  (typeof PANEL_PLAYGROUND_COMPONENT_TYPES)[number];

export type PanelPlaygroundContext = {
  sourceSurface: PanelPlaygroundSource;
  componentType: PanelPlaygroundComponentType;
  title: string;
  selectedDate?: string;
  patientUuid?: string;
  patientName?: string;
  patientDob?: string;
  facilityId?: string;
  ancillaryType?: string;
  filters?: string[];
  metadata?: Record<string, unknown>;
};

export function isPanelPlaygroundContext(
  value: unknown,
): value is PanelPlaygroundContext {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sourceSurface === "string" &&
    typeof v.componentType === "string" &&
    typeof v.title === "string" &&
    (PANEL_PLAYGROUND_SOURCES as readonly string[]).includes(
      v.sourceSurface as string,
    ) &&
    (PANEL_PLAYGROUND_COMPONENT_TYPES as readonly string[]).includes(
      v.componentType as string,
    )
  );
}

// ─── Builders ────────────────────────────────────────────────────

export function buildCalendarDatePlaygroundContext(input: {
  sourceSurface: PanelPlaygroundSource;
  selectedDate: string;
  facilityId?: string | null;
  filters?: string[];
  count?: number | null;
  categories?: string[];
  procedureCompleted?: boolean;
}): PanelPlaygroundContext {
  const count = input.count ?? null;
  const titleBits = [input.selectedDate];
  if (input.facilityId) titleBits.push(input.facilityId);
  return {
    sourceSurface: input.sourceSurface,
    componentType: "calendarDate",
    title: titleBits.join(" · "),
    selectedDate: input.selectedDate,
    facilityId: input.facilityId ?? undefined,
    filters: input.filters,
    metadata: {
      count,
      categories: input.categories ?? [],
      procedureCompleted: !!input.procedureCompleted,
    },
  };
}

export function buildPatientPlaygroundContext(input: {
  sourceSurface: PanelPlaygroundSource;
  patientUuid?: string | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  selectedDate?: string;
}): PanelPlaygroundContext {
  const titleBits = [input.patientName ?? "Unknown patient"];
  if (input.facilityId) titleBits.push(input.facilityId);
  return {
    sourceSurface: input.sourceSurface,
    componentType: "patient",
    title: titleBits.join(" · "),
    patientUuid: input.patientUuid ?? undefined,
    patientName: input.patientName ?? undefined,
    patientDob: input.patientDob ?? undefined,
    facilityId: input.facilityId ?? undefined,
    selectedDate: input.selectedDate,
  };
}

export function buildAncillaryPlaygroundContext(input: {
  sourceSurface: PanelPlaygroundSource;
  ancillaryType: string;
  patientUuid?: string | null;
  patientName?: string | null;
  facilityId?: string | null;
  selectedDate?: string;
  ancillaryTestInstanceId?: number | null;
}): PanelPlaygroundContext {
  const titleBits = [input.ancillaryType];
  if (input.patientName) titleBits.push(input.patientName);
  return {
    sourceSurface: input.sourceSurface,
    componentType: "ancillary",
    title: titleBits.join(" · "),
    ancillaryType: input.ancillaryType,
    patientUuid: input.patientUuid ?? undefined,
    patientName: input.patientName ?? undefined,
    facilityId: input.facilityId ?? undefined,
    selectedDate: input.selectedDate,
    metadata: {
      ancillaryTestInstanceId: input.ancillaryTestInstanceId ?? null,
    },
  };
}

export function buildCallListPlaygroundContext(input: {
  sourceSurface: PanelPlaygroundSource;
  patientUuid?: string | null;
  patientName?: string | null;
  facilityId?: string | null;
  callType?: string;
  nextActionAt?: string | null;
}): PanelPlaygroundContext {
  const titleBits = [
    input.callType ? input.callType : "Call",
    input.patientName ?? "Unknown patient",
  ];
  return {
    sourceSurface: input.sourceSurface,
    componentType: "callList",
    title: titleBits.join(" · "),
    patientUuid: input.patientUuid ?? undefined,
    patientName: input.patientName ?? undefined,
    facilityId: input.facilityId ?? undefined,
    metadata: {
      callType: input.callType ?? null,
      nextActionAt: input.nextActionAt ?? null,
    },
  };
}
