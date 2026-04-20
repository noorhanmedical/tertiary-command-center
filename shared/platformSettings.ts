export type TeamMember = {
  id: string;
  name: string;
  initials: string;
  role: "scheduler" | "admin" | "support";
};

export type ClinicSpreadsheetConnection = {
  clinicKey: string;
  clinicLabel: string;
  spreadsheetId: string;
  patientTabName: string;
  calendarTabName: string;
};

export const TEAM_MEMBERS: TeamMember[] = [
  { id: "spring-scheduler", name: "Spring Scheduler", initials: "SS", role: "scheduler" },
  { id: "veterans-scheduler", name: "Veterans Scheduler", initials: "VS", role: "scheduler" },
  { id: "taylor-scheduler", name: "Taylor Scheduler", initials: "TS", role: "scheduler" },
];

export const CLINIC_SPREADSHEET_CONNECTIONS: ClinicSpreadsheetConnection[] = [
  {
    clinicKey: "spring",
    clinicLabel: "NWPG - Spring",
    spreadsheetId: "PASTE_SPRING_SPREADSHEET_ID",
    patientTabName: "Patients",
    calendarTabName: "Calendar",
  },
  {
    clinicKey: "veterans",
    clinicLabel: "NWPG - Veterans",
    spreadsheetId: "PASTE_VETERANS_SPREADSHEET_ID",
    patientTabName: "Patients",
    calendarTabName: "Calendar",
  },
  {
    clinicKey: "taylor",
    clinicLabel: "Taylor Family Practice",
    spreadsheetId: "PASTE_TAYLOR_SPREADSHEET_ID",
    patientTabName: "Patients",
    calendarTabName: "Calendar",
  },
];

export const SHARED_CALENDAR_SPREADSHEET_ID = "PASTE_SHARED_CALENDAR_SPREADSHEET_ID";

// ── Portal outreach tuning ───────────────────────────────────────────────────
// PORTAL_OUTREACH_BASE_CAP: max outreach calls per worker on a normal day.
// PORTAL_OUTREACH_HEAVY_LOAD_THRESHOLD: when in-clinic appointments per worker
//   meet or exceed this number, the day is considered "heavy" — outreach cap
//   is reduced to leave bandwidth for in-clinic work.
// PORTAL_OUTREACH_HEAVY_DAY_CAP_FACTOR: multiplier (<1.0) applied to the base
//   cap on heavy days. e.g. 0.6 means each worker only gets 60% of normal
//   outreach load.
export const PORTAL_OUTREACH_BASE_CAP = 50;
export const PORTAL_OUTREACH_HEAVY_LOAD_THRESHOLD = 8;
export const PORTAL_OUTREACH_HEAVY_DAY_CAP_FACTOR = 0.6;

function s(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function resolveClinicKey(facility: string | null | undefined): string {
  const raw = s(facility).toLowerCase();
  if (raw.includes("spring")) return "spring";
  if (raw.includes("veteran")) return "veterans";
  if (raw.includes("taylor")) return "taylor";
  return "unassigned";
}

export function resolveSchedulerForClinic(facility: string | null | undefined): TeamMember | null {
  const key = resolveClinicKey(facility);
  if (key === "spring") return TEAM_MEMBERS.find((m) => m.id === "spring-scheduler") || null;
  if (key === "veterans") return TEAM_MEMBERS.find((m) => m.id === "veterans-scheduler") || null;
  if (key === "taylor") return TEAM_MEMBERS.find((m) => m.id === "taylor-scheduler") || null;
  return null;
}
