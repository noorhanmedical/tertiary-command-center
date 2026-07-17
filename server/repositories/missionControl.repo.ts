// Mission Control repository — bounded scoped counts only.
//
// Every helper here returns a single scalar count from an indexed WHERE
// clause. No unbounded selects, no broad getAll. New helpers must
// follow the same pattern.

import { db } from "../db";
import { and, eq, or, isNull, sql } from "drizzle-orm";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { plexusTasks } from "@shared/schema/plexus";

export async function countActiveExecutionCases(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patientExecutionCases)
    .where(
      or(
        isNull(patientExecutionCases.lifecycleStatus),
        eq(patientExecutionCases.lifecycleStatus, "active"),
      ),
    );
  return row?.n ?? 0;
}

const OPEN_TASK_STATUSES = ["open", "active", "in_progress"] as const;

export async function countOpenPlexusTasks(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(plexusTasks)
    .where(
      or(...OPEN_TASK_STATUSES.map((s) => eq(plexusTasks.status, s))),
    );
  return row?.n ?? 0;
}
