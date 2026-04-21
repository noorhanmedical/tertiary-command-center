import { db } from "../db";
import bcrypt from "bcryptjs";
import { eq, asc, sql } from "drizzle-orm";
import { users, type User, type InsertUser } from "@shared/schema/users";

/**
 * Per-domain repository for the `users` table.
 *
 * Repositories own the raw drizzle calls for one domain. The legacy
 * `IStorage` god-object delegates here so existing routes keep working,
 * and new code can import this repository directly.
 */
export interface IUsersRepository {
  getById(id: string): Promise<User | undefined>;
  getByUsername(username: string): Promise<User | undefined>;
  create(insertUser: InsertUser): Promise<User>;
  count(): Promise<number>;
  updatePassword(id: string, plaintext: string): Promise<void>;
  updateRole(id: string, role: string): Promise<void>;
  validatePassword(username: string, plaintext: string): Promise<User | null>;
  listAll(): Promise<Omit<User, "password">[]>;
  deactivate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export class DbUsersRepository implements IUsersRepository {
  async getById(id: string): Promise<User | undefined> {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    return u;
  }

  async getByUsername(username: string): Promise<User | undefined> {
    const [u] = await db.select().from(users).where(eq(users.username, username));
    return u;
  }

  async create(insertUser: InsertUser): Promise<User> {
    const hashed = await bcrypt.hash(insertUser.password, 12);
    const [u] = await db.insert(users).values({ ...insertUser, password: hashed }).returning();
    return u;
  }

  async count(): Promise<number> {
    const r = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    return r[0]?.count ?? 0;
  }

  async updatePassword(id: string, plaintext: string): Promise<void> {
    const hashed = await bcrypt.hash(plaintext, 12);
    await db.update(users).set({ password: hashed }).where(eq(users.id, id));
  }

  async updateRole(id: string, role: string): Promise<void> {
    await db.update(users).set({ role }).where(eq(users.id, id));
  }

  async validatePassword(username: string, plaintext: string): Promise<User | null> {
    const u = await this.getByUsername(username);
    if (!u) return null;
    const ok = await bcrypt.compare(plaintext, u.password);
    return ok ? u : null;
  }

  async listAll(): Promise<Omit<User, "password">[]> {
    return db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      active: users.active,
    }).from(users).orderBy(asc(users.username));
  }

  async deactivate(id: string): Promise<void> {
    await db.update(users).set({ active: false }).where(eq(users.id, id));
  }

  async remove(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }
}

export const usersRepository: IUsersRepository = new DbUsersRepository();
