// Patient EHR — canonical section registry + role-based access model.
//
// This is the single source of truth for every chart section the Patient
// Directory renders, and the default per-role visibility used when an admin
// has not (yet) configured a custom access matrix. Both the client runtime
// guard and the admin configuration UI read these definitions so the two
// never drift.
//
// Note on section IDs: the ids below intentionally match the existing
// PatientChart section anchors (`section-<id>`) so access control keys line
// up with the DOM/scroll-spy anchors already in place — no anchor rename is
// required. Every section that renders in the chart has an entry here.

export const PATIENT_DIRECTORY_ROLES = [
  "admin",
  "clinician",
  "biller",
  "scheduler",
] as const;

export type PatientDirectoryRole = (typeof PATIENT_DIRECTORY_ROLES)[number];

export const SECTION_ACCESS_LEVELS = ["hidden", "summary", "full"] as const;
export type SectionAccessLevel = (typeof SECTION_ACCESS_LEVELS)[number];

export type PatientDirectorySectionCategory =
  | "summary"
  | "clinical"
  | "workflow"
  | "outreach";

export type PatientDirectorySectionDef = {
  /** Matches the PatientChart section anchor id (`section-<sectionId>`). */
  sectionId: string;
  label: string;
  description: string;
  /** Whether the section is shown at all by default (kept for future use;
   *  the effective gate is `defaultAllowedRoles`). */
  defaultVisible: boolean;
  /** Per-role default access level. Admin is always `full`. */
  defaultAllowedRoles: Record<PatientDirectoryRole, SectionAccessLevel>;
  /** Access level applied when a role is missing from a stored matrix. */
  defaultAccessLevel: SectionAccessLevel;
  category: PatientDirectorySectionCategory;
  sortOrder: number;
  /** Sensitive sections carry PHI that most non-clinical roles should not
   *  see in full by default. */
  sensitive: boolean;
};

// Access shorthand: [admin, clinician, biller, scheduler].
function roles(
  clinician: SectionAccessLevel,
  biller: SectionAccessLevel,
  scheduler: SectionAccessLevel,
): Record<PatientDirectoryRole, SectionAccessLevel> {
  return { admin: "full", clinician, biller, scheduler };
}

export const PATIENT_DIRECTORY_SECTIONS: PatientDirectorySectionDef[] = [
  {
    sectionId: "overview",
    label: "Overview",
    description: "Ancillary qualification headline + clinical context.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "full", "full"),
    defaultAccessLevel: "full",
    category: "summary",
    sortOrder: 10,
    sensitive: false,
  },
  {
    sectionId: "plexus-iq",
    label: "Qualifying Tests",
    description: "Plexus IQ qualifying ancillary tests + justifications.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "summary", "full"),
    defaultAccessLevel: "full",
    category: "summary",
    sortOrder: 20,
    sensitive: false,
  },
  {
    sectionId: "cooldown",
    label: "Cooldown Eligibility",
    description: "Per-test cooldown windows and re-eligibility dates.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "full", "full"),
    defaultAccessLevel: "full",
    category: "summary",
    sortOrder: 30,
    sensitive: false,
  },
  {
    sectionId: "admin-review",
    label: "Admin Review",
    description: "Admin approval status for Plexus IQ qualification. Permission controlled.",
    defaultVisible: true,
    // Admin full; clinicians see a summary; billers/schedulers hidden by default.
    defaultAllowedRoles: roles("summary", "hidden", "hidden"),
    defaultAccessLevel: "summary",
    category: "summary",
    sortOrder: 35,
    sensitive: false,
  },
  {
    sectionId: "ancillary-journey",
    label: "Ancillary Journey",
    description: "Per-service operational pipeline for qualifying ancillary tests.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "full", "full"),
    defaultAccessLevel: "full",
    category: "summary",
    sortOrder: 15,
    sensitive: false,
  },
  {
    sectionId: "diagnoses",
    label: "Diagnoses",
    description: "Problem list / active diagnoses.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "summary", "summary"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 40,
    sensitive: true,
  },
  {
    sectionId: "medications",
    label: "Medications",
    description: "Active medications.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "hidden", "summary"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 50,
    sensitive: true,
  },
  {
    sectionId: "allergies",
    label: "Allergies",
    description: "Allergy and intolerance records.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "hidden", "summary"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 60,
    sensitive: true,
  },
  {
    sectionId: "demographics",
    label: "Demographics",
    description: "Identity and contact details.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "full", "full"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 70,
    sensitive: false,
  },
  {
    sectionId: "insurance",
    label: "Insurance & Eligibility",
    description: "Primary insurance, eligibility and prior-auth status.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "full", "summary"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 80,
    sensitive: false,
  },
  {
    sectionId: "providers",
    label: "Providers",
    description: "Referring / ordering care team.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "full", "full"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 90,
    sensitive: false,
  },
  {
    sectionId: "labs",
    label: "Labs",
    description: "Lab results from connected sources.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "hidden", "hidden"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 100,
    sensitive: true,
  },
  {
    sectionId: "imaging",
    label: "Imaging",
    description: "Imaging studies and impressions.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "hidden", "hidden"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 110,
    sensitive: true,
  },
  {
    sectionId: "vitals",
    label: "Vitals",
    description: "Vital signs.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "hidden", "summary"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 120,
    sensitive: true,
  },
  {
    sectionId: "encounters",
    label: "Encounters / Notes",
    description: "Visit notes and encounter summaries.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "hidden", "hidden"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 130,
    sensitive: true,
  },
  {
    sectionId: "calls",
    label: "Calls & Comms",
    description: "Call history and communication log.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "summary", "full"),
    defaultAccessLevel: "full",
    category: "workflow",
    sortOrder: 140,
    sensitive: false,
  },
  {
    sectionId: "scheduling",
    label: "Scheduling",
    description: "Ancillary appointments.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "summary", "full"),
    defaultAccessLevel: "full",
    category: "workflow",
    sortOrder: 150,
    sensitive: false,
  },
  {
    sectionId: "documents",
    label: "Plexus Notes & Documents",
    description: "Per-service Plexus clinical notes, patient/test documents and atlases.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "full", "summary"),
    defaultAccessLevel: "full",
    category: "workflow",
    sortOrder: 160,
    sensitive: false,
  },
  {
    sectionId: "billing",
    label: "Billing / Readiness",
    description: "Billing readiness checks and billing records.",
    defaultVisible: true,
    defaultAllowedRoles: roles("summary", "full", "hidden"),
    defaultAccessLevel: "full",
    category: "workflow",
    sortOrder: 170,
    sensitive: true,
  },
  {
    sectionId: "re-engagement",
    label: "Re-engagement",
    description: "Future outreach, cooldown recurrence and repeat eligibility across channels.",
    defaultVisible: true,
    defaultAllowedRoles: roles("summary", "hidden", "full"),
    defaultAccessLevel: "full",
    category: "outreach",
    sortOrder: 180,
    sensitive: false,
  },
  {
    sectionId: "ancillary-cases",
    label: "Ancillary Cases",
    description: "Per-service ancillary cases. Permission controlled; hidden by default for non-admin roles.",
    defaultVisible: true,
    // Admin/manager visible; PCS/ACS (scheduler/clinician) hidden by default
    // unless enabled in Settings.
    defaultAllowedRoles: roles("hidden", "hidden", "hidden"),
    defaultAccessLevel: "hidden",
    category: "outreach",
    sortOrder: 190,
    sensitive: false,
  },
  {
    sectionId: "plexus-story",
    label: "Patient's Plexus Story",
    description: "Human-readable timeline of patient_journey_events across the record.",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "full", "full"),
    defaultAccessLevel: "full",
    category: "outreach",
    sortOrder: 200,
    sensitive: false,
  },
  {
    sectionId: "plexus-data-signals",
    label: "Plexus Data Signals",
    description: "AI-identified clinical signals (rendered last).",
    defaultVisible: true,
    defaultAllowedRoles: roles("full", "summary", "summary"),
    defaultAccessLevel: "full",
    category: "clinical",
    sortOrder: 210,
    sensitive: true,
  },
];

export type SectionAccessMatrix = Record<
  string,
  Record<PatientDirectoryRole, SectionAccessLevel>
>;

/** A possibly-incomplete matrix (rows may omit some roles). Accepted by
 *  `normalizeSectionAccessMatrix` / the save path; validated zod payloads and
 *  stored JSON both take this shape. */
export type PartialSectionAccessMatrix = Record<
  string,
  Partial<Record<PatientDirectoryRole, SectionAccessLevel>>
>;

/** Full default matrix keyed by sectionId → role → access level. */
export function defaultSectionAccessMatrix(): SectionAccessMatrix {
  const out: SectionAccessMatrix = {};
  for (const s of PATIENT_DIRECTORY_SECTIONS) {
    out[s.sectionId] = { ...s.defaultAllowedRoles };
  }
  return out;
}

const SECTION_BY_ID: Record<string, PatientDirectorySectionDef> = Object.fromEntries(
  PATIENT_DIRECTORY_SECTIONS.map((s) => [s.sectionId, s]),
);

/** The default access level for a single (section, role) pair. Admin is
 *  always `full`. Falls back to the section's `defaultAccessLevel` when the
 *  role is unknown, and to `full` for unknown sections. */
export function defaultAccessFor(
  sectionId: string,
  role: string,
): SectionAccessLevel {
  if (role === "admin") return "full";
  const def = SECTION_BY_ID[sectionId];
  if (!def) return "full";
  const r = role as PatientDirectoryRole;
  return def.defaultAllowedRoles[r] ?? def.defaultAccessLevel;
}

/** Normalize a possibly-partial stored matrix into a complete matrix that
 *  covers every registry section + role, filling gaps with defaults. Admin
 *  is always forced to `full`. */
export function normalizeSectionAccessMatrix(
  stored: PartialSectionAccessMatrix | null | undefined,
): SectionAccessMatrix {
  const out: SectionAccessMatrix = {};
  for (const s of PATIENT_DIRECTORY_SECTIONS) {
    const storedRow = stored?.[s.sectionId];
    const row = {} as Record<PatientDirectoryRole, SectionAccessLevel>;
    for (const role of PATIENT_DIRECTORY_ROLES) {
      if (role === "admin") {
        row.admin = "full";
        continue;
      }
      const v = storedRow?.[role];
      row[role] =
        v && (SECTION_ACCESS_LEVELS as readonly string[]).includes(v)
          ? v
          : s.defaultAllowedRoles[role];
    }
    out[s.sectionId] = row;
  }
  return out;
}
