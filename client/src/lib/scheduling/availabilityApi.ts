// Client access to the ONE capacity-aware availability engine. Both the full
// UnifiedScheduler and the Quick Schedule popover call this so they render
// identical availability. The client renders these server decisions; it never
// recomputes overlaps.

export type ResourceType = "brainwave" | "vitalwave" | "ultrasound";

export type ServiceRequest = { resourceType: ResourceType; studyCount?: number };

export type SoftConstraint = "full" | "off_day" | "outage";

export type SlotAvailability = {
  time: string;
  startMinutes: number;
  available: number;
  total: number;
  fits: boolean;
  capacityFits: boolean;
  constraint?: SoftConstraint;
  reason?: string;
};

export type Conflict = {
  resourceType: ResourceType;
  constraint: SoftConstraint;
  message: string;
  nextAvailableMinutes: number | null;
  nextEligibleDay?: string | null;
};

export type VisitPlanStep = {
  resourceType: ResourceType;
  studyCount?: number;
  isoDate: string;
  startMinutes: number;
  endMinutes: number;
  time: string;
  serviceLabel: string;
  offDay: boolean;
};

export type VisitPlan = {
  kind: "one_visit" | "split_visit";
  steps: VisitPlanStep[];
  dates: string[];
  isoDate: string;
  startMinutes: number;
  requiresOverride: boolean;
  reason: string;
  recommended: boolean;
};

export type OperatingDayInfo = {
  resourceType: ResourceType;
  label: string;
  days: number[];
  isOperatingToday: boolean;
  nextEligibleDay: string | null;
};

export type SuggestionStep = {
  resourceType: ResourceType;
  startMinutes: number;
  endMinutes: number;
  time: string;
  serviceLabel: string;
};

export type Suggestion = {
  steps: SuggestionStep[];
  startMinutes: number;
  time: string;
  reason: string;
  recommended: boolean;
};

export type AgendaItem = {
  appointmentId: number | null;
  time: string;
  endTime: string;
  patient: string;
  service: string;
  resourceType: ResourceType;
  override?: {
    constraint: SoftConstraint;
    reason: string;
    by?: string | null;
    at?: string | null;
  } | null;
};

export type EquipmentItem = { resourceType: ResourceType; total: number; label: string };

export type AvailabilityResult = {
  clinicId: number | null;
  facility: string | null;
  date: string;
  capacity: Record<
    ResourceType,
    {
      resourceType: ResourceType;
      machineCount: number;
      durationMinutes: number;
      minutesPerStudy: number | null;
      turnoverMinutes: number;
      operatingDays: number[];
    }
  >;
  durations: Partial<Record<ResourceType, number>>;
  slots: SlotAvailability[];
  conflict: Conflict | null;
  suggestions: Suggestion[];
  agenda: AgendaItem[];
  equipment: EquipmentItem[];
  operatingDays: OperatingDayInfo[];
  visit: { oneVisit: VisitPlan | null; splitVisit: VisitPlan | null };
};

export async function fetchAvailability(body: {
  facility: string | null;
  date: string;
  services: ServiceRequest[];
  patientKey?: string | null;
  preferredTime?: string | null;
}): Promise<AvailabilityResult> {
  const res = await fetch("/api/scheduling/availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Availability failed (${res.status})`);
  return res.json();
}

/** Minutes-from-midnight → "9:00 AM". */
export function prettyMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

/** "09:00" → "9:00 AM". */
export function pretty12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return prettyMinutes((h || 0) * 60 + (m || 0));
}
