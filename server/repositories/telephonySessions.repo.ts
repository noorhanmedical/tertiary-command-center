// Phase 6 — telephony_sessions repository (provider evidence store).
//
// Thin data access only. All ordering/idempotency/state-machine logic lives in
// server/services/telephony/telephonySessionService.ts. This table holds
// PROVIDER EVIDENCE and never a business disposition (that is outreach_calls).

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  telephonySessions,
  type InsertTelephonySession,
  type TelephonySession,
} from "@shared/schema/telephonySessions";

export async function createTelephonySession(
  input: InsertTelephonySession,
): Promise<TelephonySession> {
  const [row] = await db.insert(telephonySessions).values(input).returning();
  return row;
}

export async function findTelephonySessionByProviderId(
  provider: string,
  providerSessionId: string,
): Promise<TelephonySession | undefined> {
  const [row] = await db
    .select()
    .from(telephonySessions)
    .where(
      and(
        eq(telephonySessions.provider, provider),
        eq(telephonySessions.providerSessionId, providerSessionId),
      ),
    )
    .limit(1);
  return row;
}

export async function getTelephonySessionById(
  id: number,
): Promise<TelephonySession | undefined> {
  const [row] = await db
    .select()
    .from(telephonySessions)
    .where(eq(telephonySessions.id, id))
    .limit(1);
  return row;
}

export async function updateTelephonySession(
  id: number,
  patch: Partial<Omit<TelephonySession, "id" | "createdAt">>,
): Promise<TelephonySession | undefined> {
  const [row] = await db
    .update(telephonySessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(telephonySessions.id, id))
    .returning();
  return row;
}

/** Most-recent session for a case that carries a provider session id — used to
 *  link telephony evidence into the disposition record at close time. */
export async function findLatestProviderSessionForCase(
  executionCaseId: number,
): Promise<TelephonySession | undefined> {
  const [row] = await db
    .select()
    .from(telephonySessions)
    .where(
      and(
        eq(telephonySessions.executionCaseId, executionCaseId),
        isNotNull(telephonySessions.providerSessionId),
      ),
    )
    .orderBy(desc(telephonySessions.startedAt))
    .limit(1);
  return row;
}
