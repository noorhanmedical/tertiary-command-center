/**
 * Canonical scheduling capacity DEFAULTS.
 *
 * This is the single source of truth for the current operational defaults so
 * the numbers are never scattered across React components or server code.
 * A facility's stored `facility_resource_capacity` rows override these; when a
 * facility has no row for a resource, these defaults apply.
 *
 * Current Taylor Family Practice setup (also the seed values):
 *   BrainWave  — 2 machines, 45-minute occupancy
 *   VitalWave  — 2 machines, 30-minute occupancy
 *   Ultrasound — 1 machine, 15 minutes per study, 5-minute patient turnover
 */

import type { ResourceType } from "../schema/schedulingCapacity";

export type ResourceCapacityConfig = {
  resourceType: ResourceType;
  /** Number of machines (concurrency limit) for this resource. */
  machineCount: number;
  /** BrainWave/VitalWave per-appointment occupancy in minutes. */
  durationMinutes: number;
  /** Ultrasound minutes consumed per study (null for non-ultrasound). */
  minutesPerStudy: number | null;
  /** Rooming buffer between DIFFERENT patients on the same machine. */
  turnoverMinutes: number;
  /**
   * Weekdays this resource is NORMALLY offered (0=Sun … 6=Sat). A SOFT
   * constraint: off-days warn + suggest the next eligible operating day, but
   * an authorized user may override.
   */
  operatingDays: number[];
};

/** Mon–Fri. */
export const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];
/** The system default operating days when a facility hasn't configured any. */
export const DEFAULT_OPERATING_DAYS = WEEKDAYS_MON_FRI;

export const DEFAULT_RESOURCE_CAPACITY: Record<
  ResourceType,
  ResourceCapacityConfig
> = {
  brainwave: {
    resourceType: "brainwave",
    machineCount: 2,
    durationMinutes: 45,
    minutesPerStudy: null,
    turnoverMinutes: 0,
    operatingDays: [1, 2, 3, 4, 5],
  },
  vitalwave: {
    resourceType: "vitalwave",
    machineCount: 2,
    durationMinutes: 30,
    minutesPerStudy: null,
    turnoverMinutes: 0,
    operatingDays: [1, 2, 3, 4, 5],
  },
  ultrasound: {
    resourceType: "ultrasound",
    machineCount: 1,
    durationMinutes: 15,
    minutesPerStudy: 15,
    turnoverMinutes: 5,
    // Ultrasound is a specialty day at Taylor — Tue/Thu by default.
    operatingDays: [2, 4],
  },
};

/** Operating window for generated candidate slots (local clinic time). */
export const SCHEDULING_DAY_START_MINUTES = 8 * 60; // 08:00
export const SCHEDULING_DAY_END_MINUTES = 17 * 60; // 17:00 (last block must end by/at)
/** Candidate slot granularity in minutes. */
export const SCHEDULING_SLOT_STEP_MINUTES = 15;

/** Human labels for the three resource pools. */
export const RESOURCE_LABELS: Record<ResourceType, string> = {
  brainwave: "BrainWave",
  vitalwave: "VitalWave",
  ultrasound: "Ultrasound",
};
