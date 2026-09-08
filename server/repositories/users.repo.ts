import { db } from "../db";
import bcrypt from "bcryptjs";
import { eq, asc, sql } from "drizzle-orm";
import { users, type User, type InsertUser } from "@shared/schema/users";

/**
 * The safe summary projection returned by the list methods — the subset of
 * columns explicitly selected (never the password hash, and not the wider
 * access-control identity fields added in Phase 1). Kept as its own type so
 * additive columns on `users` don't force a select-list change here.
 */
export type UserSummary = {
  id: string;
  clinicId: number | null;
  username: string;
  role: string;
  active: boolean;
};

/**
 * APPLICATION user record — the full user row WITHOUT the password hash. This
 * is what every general-purpose getter returns, so a route handler can never
 * accidentally serialize a password hash (Phase 3.5). The hash lives only on
 * the AUTHENTICATION record (see UserAuthRecord + getAuthRecord*).
 */
export type SafeUser = Omit<User, "password">;

/**
 * AUTHENTICATION-only record — includes the stored password hash. ONLY the
 * password-verification / credential code inside this repository should ever
 * hold this shape; it is intentionally NOT returned to the application layer.
 */
export type UserAuthRecord = User;

function stripPassword(u: User): SafeUser {
  // Explicitly drop the hash; never rely on callers to omit it.
  const { password: _password, ...safe } = u;
  return safe;
}

/**
 * Per-domain repository for the `users` table.
 *
 * Repositories own the raw drizzle calls for one domain. The legacy
 * `IStorage` god-object delegates here so existing routes keep working,
 * and new code can import this repository directly.
 *
 * PASSWORD-HASH SAFETY (Phase 3.5): general-purpose getters return SafeUser
 * (no hash). The hash is reachable ONLY via the explicitly-named auth methods
 * used internally for credential verification.
 */
export interface IUsersRepository {
  getById(id: string): Promise<SafeUser | undefined>;
  getByUsername(username: string): Promise<SafeUser | undefined>;
  create(insertUser: InsertUser): Promise<SafeUser>;
  count(): Promise<number>;
  updatePassword(id: string, plaintext: string): Promise<void>;
  updateRole(id: string, role: string): Promise<void>;
  /** Verify by username; returns the SAFE (hash-free) record on success. */
  validatePassword(username: string, plaintext: string): Promise<SafeUser | null>;
  /**
   * Resolve a login by EMAIL (case-insensitive) OR username, then verify the
   * password. Preferred going forward; `validatePassword` remains for callers
   * that pass a username specifically. Returns the SAFE (hash-free) record.
   */
  validatePasswordByIdentifier(identifier: string, plaintext: string): Promise<SafeUser | null>;
  /**
   * AUTH-ONLY: fetch the full record INCLUDING the password hash. Intended for
   * credential/security flows exclusively. Do NOT pass the result to the
   * application/response layer.
   */
  getAuthRecordByUsername(username: string): Promise<UserAuthRecord | undefined>;
  /** Stamp last_login_at = now. Best-effort; never blocks login. */
  touchLastLogin(id: string): Promise<void>;
  listAll(): Promise<UserSummary[]>;
  listByRole(role: string): Promise<UserSummary[]>;
  deactivate(id: string): Promise<void>;
  reactivate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export class DbUsersRepository implements IUsersRepository {
  async getById(id: string): Promise<SafeUser | undefined> {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    return u ? stripPassword(u) : undefined;
  }

  async getByUsername(username: string): Promise<SafeUser | undefined> {
    const [u] = await db.select().from(users).where(eq(users.username, username));
    return u ? stripPassword(u) : undefined;
  }

  async create(insertUser: InsertUser): Promise<SafeUser> {
    const hashed = await bcrypt.hash(insertUser.password, 12);
    const [u] = await db.insert(users).values({ ...insertUser, password: hashed }).returning();
    return stripPassword(u);
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

  // ─── AUTH-ONLY credential paths (hold the hash internally only) ────────────

  async getAuthRecordByUsername(username: string): Promise<UserAuthRecord | undefined> {
    const [u] = await db.select().from(users).where(eq(users.username, username));
    return u;
  }

  private async getAuthRecordByIdentifier(identifier: string): Promise<UserAuthRecord | undefined> {
    const id = (identifier ?? "").trim();
    if (!id) return undefined;
    // Resolve by case-insensitive email first (preferred credential), then fall
    // back to exact username for legacy accounts.
    if (id.includes("@")) {
      const emailLc = id.toLowerCase();
      const [byEmail] = await db.select().from(users).where(sql`lower(${users.email}) = ${emailLc}`);
      if (byEmail) return byEmail;
      return this.getAuthRecordByUsername(id);
    }
    return this.getAuthRecordByUsername(id);
  }

  async validatePassword(username: string, plaintext: string): Promise<SafeUser | null> {
    const u = await this.getAuthRecordByUsername(username);
    if (!u) return null;
    const ok = await bcrypt.compare(plaintext, u.password);
    return ok ? stripPassword(u) : null;
  }

  async validatePasswordByIdentifier(identifier: string, plaintext: string): Promise<SafeUser | null> {
    const u = await this.getAuthRecordByIdentifier(identifier);
    if (!u) return null;
    const ok = await bcrypt.compare(plaintext, u.password);
    return ok ? stripPassword(u) : null;
  }

  async touchLastLogin(id: string): Promise<void> {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  }

  async listAll(): Promise<UserSummary[]> {
    return db.select({
      id: users.id,
      clinicId: users.clinicId,
      username: users.username,
      role: users.role,
      active: users.active,
    }).from(users).orderBy(asc(users.username));
  }

  async listByRole(role: string): Promise<UserSummary[]> {
    return db.select({
      id: users.id,
      clinicId: users.clinicId,
      username: users.username,
      role: users.role,
      active: users.active,
    }).from(users).where(eq(users.role, role)).orderBy(asc(users.username));
  }

  async deactivate(id: string): Promise<void> {
    await db.update(users).set({ active: false }).where(eq(users.id, id));
  }

  async reactivate(id: string): Promise<void> {
    await db.update(users).set({ active: true }).where(eq(users.id, id));
  }

  async remove(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }
}

export const usersRepository: IUsersRepository = new DbUsersRepository();
