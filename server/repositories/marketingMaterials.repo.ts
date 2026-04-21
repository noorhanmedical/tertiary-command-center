import { db } from "../db";
import { desc, eq } from "drizzle-orm";
import {
  marketingMaterials,
  type MarketingMaterial,
  type InsertMarketingMaterial,
} from "@shared/schema/documents";

export interface IMarketingMaterialsRepository {
  listAll(): Promise<MarketingMaterial[]>;
  getById(id: number): Promise<MarketingMaterial | undefined>;
  create(record: InsertMarketingMaterial): Promise<MarketingMaterial>;
  updateStorage(
    id: number,
    patch: { storagePath: string; sha256: string; filename: string; sizeBytes: number },
  ): Promise<MarketingMaterial>;
  remove(id: number): Promise<void>;
}

export class DbMarketingMaterialsRepository implements IMarketingMaterialsRepository {
  async listAll(): Promise<MarketingMaterial[]> {
    return db.select().from(marketingMaterials).orderBy(desc(marketingMaterials.createdAt));
  }

  async getById(id: number): Promise<MarketingMaterial | undefined> {
    const [row] = await db.select().from(marketingMaterials).where(eq(marketingMaterials.id, id));
    return row;
  }

  async create(record: InsertMarketingMaterial): Promise<MarketingMaterial> {
    const [row] = await db.insert(marketingMaterials).values(record).returning();
    return row;
  }

  async updateStorage(
    id: number,
    patch: { storagePath: string; sha256: string; filename: string; sizeBytes: number },
  ): Promise<MarketingMaterial> {
    const [row] = await db.update(marketingMaterials).set(patch).where(eq(marketingMaterials.id, id)).returning();
    return row;
  }

  async remove(id: number): Promise<void> {
    await db.delete(marketingMaterials).where(eq(marketingMaterials.id, id));
  }
}

export const marketingMaterialsRepository: IMarketingMaterialsRepository = new DbMarketingMaterialsRepository();
