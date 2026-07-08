import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  engagementCallSettings,
  type EngagementCallSettings,
  type InsertEngagementCallSettings,
} from "@shared/schema";

// Repository for per-team-member Engagement Call Settings. Additive and
// narrow — one row per outreach_schedulers.id. New code should import this
// directly rather than reaching through the legacy storage god-object.
export interface IEngagementCallSettingsRepository {
  list(): Promise<EngagementCallSettings[]>;
  listForSchedulers(schedulerIds: number[]): Promise<EngagementCallSettings[]>;
  getByScheduler(schedulerId: number): Promise<EngagementCallSettings | undefined>;
  upsert(
    schedulerId: number,
    patch: Partial<Omit<InsertEngagementCallSettings, "schedulerId">>,
  ): Promise<EngagementCallSettings>;
}

class DbEngagementCallSettingsRepository
  implements IEngagementCallSettingsRepository
{
  async list(): Promise<EngagementCallSettings[]> {
    return db.select().from(engagementCallSettings);
  }

  async listForSchedulers(
    schedulerIds: number[],
  ): Promise<EngagementCallSettings[]> {
    if (schedulerIds.length === 0) return [];
    return db
      .select()
      .from(engagementCallSettings)
      .where(inArray(engagementCallSettings.schedulerId, schedulerIds));
  }

  async getByScheduler(
    schedulerId: number,
  ): Promise<EngagementCallSettings | undefined> {
    const [row] = await db
      .select()
      .from(engagementCallSettings)
      .where(eq(engagementCallSettings.schedulerId, schedulerId))
      .limit(1);
    return row;
  }

  async upsert(
    schedulerId: number,
    patch: Partial<Omit<InsertEngagementCallSettings, "schedulerId">>,
  ): Promise<EngagementCallSettings> {
    const [row] = await db
      .insert(engagementCallSettings)
      .values({ schedulerId, ...patch })
      .onConflictDoUpdate({
        target: engagementCallSettings.schedulerId,
        set: { ...patch, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
}

export const engagementCallSettingsRepository: IEngagementCallSettingsRepository =
  new DbEngagementCallSettingsRepository();
