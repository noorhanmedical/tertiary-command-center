// Clinic timezone resolution (Phase 2 / hardened in Phase 2B).
//
// Reads the FIRST-CLASS clinic timezone (clinics.timezone, an IANA id) and
// reports BOTH a usable zone AND whether the stored value is valid, so callers
// can choose the right policy:
//
//   • The 5 AM reconciliation trigger FAILS CLOSED on an invalid/missing
//     timezone (it must never run a clinic's "5 AM" in the wrong zone — a
//     Los-Angeles clinic misconfigured as an invalid string must NOT reconcile
//     hours early in Central). It checks `valid` / `status`.
//   • Best-effort callers (e.g. the disposition business-day retry roll, which
//     must still record a call result even for a misconfigured clinic) use the
//     always-usable `timeZone`, which falls back to the schema default.
//
// Timezone-value policy (Phase 2B Part 7):
//   A. A VALID stored IANA id (including the schema default "America/Chicago"
//      populated at insert) → status "valid"; used normally.
//   B. A NON-NULL INVALID value (e.g. "Amerca/Los_Angeles") → status
//      "invalid_timezone"; fail closed. NEVER silently Central.
//   C. NULL / empty → status "missing_timezone"; fail closed (prefer safe). A
//      stored NULL is "unknown", not the default — the column DEFAULT applies
//      only at insert, it does not define the meaning of a stored NULL.
//
// Timezone is NEVER inferred from facility name, state, browser, or server tz.

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { clinics } from "@shared/schema/clinics";
import { DEFAULT_CLINIC_TIME_ZONE, isValidTimeZone } from "../../lib/clinicTime";

export type ClinicTimeZoneStatus = "valid" | "invalid_timezone" | "missing_timezone";

export type ClinicTimeZoneResolution = {
  clinicId: number | null;
  /** The raw stored clinics.timezone value (or null). */
  configuredTimeZone: string | null;
  /** True only when configuredTimeZone is a valid IANA zone. */
  valid: boolean;
  /**
   * An ALWAYS-USABLE IANA zone for best-effort callers: the valid configured
   * zone, or the schema default when the stored value is invalid/missing.
   * The reconciliation trigger must consult `valid`/`status` — NOT this — to
   * decide whether to run.
   */
  timeZone: string;
  status: ClinicTimeZoneStatus;
};

const cache = new Map<number, ClinicTimeZoneResolution>();

/** Test-only: clear the per-clinic timezone cache. */
export function __resetClinicTimeZoneCacheForTests(): void {
  cache.clear();
}

/**
 * Resolve a clinic's operational timezone with validity. Reads clinics.timezone
 * once per clinic (memoized). Emits a PHI-safe warning when the value is
 * invalid/missing so misconfiguration is observable.
 */
export async function resolveClinicTimeZone(
  clinicId: number | null | undefined,
): Promise<ClinicTimeZoneResolution> {
  if (clinicId == null) {
    return {
      clinicId: null,
      configuredTimeZone: null,
      valid: false,
      timeZone: DEFAULT_CLINIC_TIME_ZONE,
      status: "missing_timezone",
    };
  }

  const cached = cache.get(clinicId);
  if (cached) return cached;

  let configured: string | null = null;
  let readFailed = false;
  try {
    const [row] = await db
      .select({ timezone: clinics.timezone })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
    configured = (row?.timezone ?? null) || null; // treat "" as null
  } catch (err) {
    readFailed = true;
    console.warn(
      `[clinicTime] failed to read clinics.timezone for clinic ${clinicId}: ${(err as Error).message}`,
    );
  }

  let resolution: ClinicTimeZoneResolution;
  if (configured && isValidTimeZone(configured)) {
    resolution = {
      clinicId,
      configuredTimeZone: configured,
      valid: true,
      timeZone: configured,
      status: "valid",
    };
  } else if (configured) {
    // Non-null but not a valid IANA zone → explicit misconfiguration.
    console.warn(
      `[clinicTime] clinic ${clinicId} has an INVALID timezone "${configured}" — ` +
        `it will NOT reconcile until fixed (fail-closed; not silently Central). ` +
        `Set clinics.timezone to a valid IANA zone.`,
    );
    resolution = {
      clinicId,
      configuredTimeZone: configured,
      valid: false,
      timeZone: DEFAULT_CLINIC_TIME_ZONE,
      status: "invalid_timezone",
    };
  } else {
    // NULL / empty (or unreadable) → unknown → fail closed.
    if (!readFailed) {
      console.warn(
        `[clinicTime] clinic ${clinicId} has NO timezone configured — ` +
          `it will NOT reconcile until set (fail-closed). Set clinics.timezone.`,
      );
    }
    resolution = {
      clinicId,
      configuredTimeZone: null,
      valid: false,
      timeZone: DEFAULT_CLINIC_TIME_ZONE,
      status: "missing_timezone",
    };
  }

  // Do not cache a transient DB-read failure (retry next time); cache resolved
  // config outcomes (they change only via Settings, which can clear the cache).
  if (!readFailed) cache.set(clinicId, resolution);
  return resolution;
}
