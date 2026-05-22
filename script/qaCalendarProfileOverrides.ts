// QA for admin_settings-driven calendar profile overrides.
//
// Run with: `npm run qa:calendar-profile-overrides`. Pure-function
// tests — no DB required. Exercises `resolveCalendarProfileSettings`
// across the realistic scope ladder:
//   global  →  user  →  facility  →  user+facility
// (ascending rank; later applies on top of earlier).
//
// Verifies:
//   - PCS base profile resolves patientCareSpecialist defaults.
//   - ACS base profile resolves ancillaryCareSpecialist defaults.
//   - facility-scoped override changes defaultView.
//   - facility-scoped override changes defaultFilters (within the
//     base availableFilters set; profile cannot promote a filter
//     outside its allowed universe unless it's manager/admin).
//   - user-scoped override takes correct precedence over facility.
//   - user+facility override wins over both.
//   - missing override falls back to the base profile defaults.

import {
  CALENDAR_PROFILES,
  type CalendarFilterId,
} from "../client/src/calendar/calendarProfiles";
import {
  CALENDAR_SETTINGS_DOMAIN,
  CALENDAR_SETTINGS_KEY,
  resolveCalendarProfileSettings,
  type CalendarAdminSettingLike,
} from "../client/src/calendar/calendarSettings";

let passes = 0;
let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

function setting(args: {
  profileId: string;
  facilityId?: string | null;
  userId?: string | null;
  defaultView?: string;
  defaultFilters?: CalendarFilterId[];
  active?: boolean;
}): CalendarAdminSettingLike {
  const profileBody: Record<string, unknown> = {};
  if (args.defaultView) profileBody.defaultView = args.defaultView;
  if (args.defaultFilters) profileBody.defaultFilters = args.defaultFilters;
  return {
    settingDomain: CALENDAR_SETTINGS_DOMAIN,
    settingKey: CALENDAR_SETTINGS_KEY,
    settingValue: {
      profiles: {
        [args.profileId]: profileBody,
      },
    },
    facilityId: args.facilityId ?? null,
    userId: args.userId ?? null,
    active: args.active ?? true,
  };
}

function main() {
  // ─── 1. Base resolution returns the spec'd profile defaults ──────
  console.log("\n--- base profile resolution ---");
  const pcsBase = resolveCalendarProfileSettings("patientCareSpecialist", {}, []);
  assert(pcsBase.id === "patientCareSpecialist", "PCS base id is patientCareSpecialist");
  assert(pcsBase.defaultView === "day", "PCS base defaultView is day");
  assert(
    pcsBase.defaultFilters.includes("clinicVisits"),
    "PCS base defaultFilters includes clinicVisits",
  );

  const acsBase = resolveCalendarProfileSettings("ancillaryCareSpecialist", {}, []);
  assert(acsBase.id === "ancillaryCareSpecialist", "ACS base id is ancillaryCareSpecialist");
  assert(acsBase.defaultView === "day", "ACS base defaultView is day");
  assert(
    acsBase.defaultFilters.includes("procedureCompleted"),
    "ACS base defaultFilters includes procedureCompleted",
  );

  // ─── 2. Missing override → fallback to base ──────────────────────
  console.log("\n--- missing override falls back to base ---");
  const fallback = resolveCalendarProfileSettings(
    "ancillaryCareSpecialist",
    { facilityId: "TFP", userId: "u-1" },
    [
      // Setting targets a different profile — must not affect ACS.
      setting({ profileId: "patientCareSpecialist", facilityId: "TFP", defaultView: "month" }),
    ],
  );
  assert(fallback.defaultView === "day", "ACS defaultView unchanged when no ACS-targeting override exists");
  assert(
    JSON.stringify(fallback.defaultFilters) === JSON.stringify(acsBase.defaultFilters),
    "ACS defaultFilters unchanged when no override exists",
  );

  // ─── 3. Facility-scoped override changes defaultView ─────────────
  console.log("\n--- facility-scoped defaultView override ---");
  const facilityViewOverride = resolveCalendarProfileSettings(
    "ancillaryCareSpecialist",
    { facilityId: "TFP" },
    [setting({ profileId: "ancillaryCareSpecialist", facilityId: "TFP", defaultView: "week" })],
  );
  assert(
    facilityViewOverride.defaultView === "week",
    "facility-scoped override flips ACS defaultView to week",
  );
  // Unrelated context (different facility) must NOT apply the override.
  const unrelatedFacility = resolveCalendarProfileSettings(
    "ancillaryCareSpecialist",
    { facilityId: "NWPG" },
    [setting({ profileId: "ancillaryCareSpecialist", facilityId: "TFP", defaultView: "week" })],
  );
  assert(
    unrelatedFacility.defaultView === "day",
    "unrelated facility context falls back to base defaultView",
  );

  // ─── 4. Facility-scoped override changes defaultFilters ──────────
  console.log("\n--- facility-scoped defaultFilters override ---");
  const filterOverride = resolveCalendarProfileSettings(
    "ancillaryCareSpecialist",
    { facilityId: "TFP" },
    [
      setting({
        profileId: "ancillaryCareSpecialist",
        facilityId: "TFP",
        defaultFilters: ["clinicVisits", "ancillaryScheduled"],
      }),
    ],
  );
  assert(
    JSON.stringify(filterOverride.defaultFilters) ===
      JSON.stringify(["clinicVisits", "ancillaryScheduled"]),
    "facility-scoped override sets ACS defaultFilters to spec",
  );

  // Override filters that aren't in the base availableFilters set
  // should be dropped (profile cannot promote unknowns unless
  // manager/admin).
  const invalidFilterOverride = resolveCalendarProfileSettings(
    "ancillaryCareSpecialist",
    { facilityId: "TFP" },
    [
      setting({
        profileId: "ancillaryCareSpecialist",
        facilityId: "TFP",
        defaultFilters: [
          "clinicVisits",
          // qualificationIncomplete is NOT in ACS availableFilters.
          "qualificationIncomplete",
        ],
      }),
    ],
  );
  assert(
    !invalidFilterOverride.defaultFilters.includes("qualificationIncomplete"),
    "ACS override cannot promote qualificationIncomplete (outside availableFilters)",
  );

  // ─── 5. User-scoped override applies + precedence vs facility ────
  console.log("\n--- scope precedence (global < user < facility < user+facility) ---");
  const userOnly = resolveCalendarProfileSettings(
    "patientCareSpecialist",
    { userId: "u-1" },
    [setting({ profileId: "patientCareSpecialist", userId: "u-1", defaultView: "week" })],
  );
  assert(userOnly.defaultView === "week", "user-scoped override applies");

  const facilityWinsOverUser = resolveCalendarProfileSettings(
    "patientCareSpecialist",
    { userId: "u-1", facilityId: "TFP" },
    [
      setting({ profileId: "patientCareSpecialist", userId: "u-1", defaultView: "week" }),
      setting({ profileId: "patientCareSpecialist", facilityId: "TFP", defaultView: "agenda" }),
    ],
  );
  assert(
    facilityWinsOverUser.defaultView === "agenda",
    "facility-scoped override beats user-only when both match",
  );

  const userFacilityWinsOverFacility = resolveCalendarProfileSettings(
    "patientCareSpecialist",
    { userId: "u-1", facilityId: "TFP" },
    [
      setting({ profileId: "patientCareSpecialist", facilityId: "TFP", defaultView: "agenda" }),
      setting({
        profileId: "patientCareSpecialist",
        userId: "u-1",
        facilityId: "TFP",
        defaultView: "month",
      }),
    ],
  );
  assert(
    userFacilityWinsOverFacility.defaultView === "month",
    "user+facility override beats facility-only",
  );

  const globalLosesToFacility = resolveCalendarProfileSettings(
    "patientCareSpecialist",
    { facilityId: "TFP" },
    [
      setting({ profileId: "patientCareSpecialist", defaultView: "week" }),
      setting({ profileId: "patientCareSpecialist", facilityId: "TFP", defaultView: "agenda" }),
    ],
  );
  assert(
    globalLosesToFacility.defaultView === "agenda",
    "facility-scoped override beats global-only",
  );

  // ─── 6. Inactive override is ignored ─────────────────────────────
  console.log("\n--- inactive overrides are ignored ---");
  const inactiveIgnored = resolveCalendarProfileSettings(
    "patientCareSpecialist",
    { facilityId: "TFP" },
    [
      setting({
        profileId: "patientCareSpecialist",
        facilityId: "TFP",
        defaultView: "week",
        active: false,
      }),
    ],
  );
  assert(
    inactiveIgnored.defaultView === pcsBase.defaultView,
    "inactive override does not change profile",
  );

  // ─── 7. Original base profile remains untouched ──────────────────
  console.log("\n--- base profile object is not mutated ---");
  const acsBase2 = CALENDAR_PROFILES.ancillaryCareSpecialist;
  assert(
    acsBase2.defaultView === "day",
    "CALENDAR_PROFILES.ancillaryCareSpecialist.defaultView is still 'day' (override did not mutate base)",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();
