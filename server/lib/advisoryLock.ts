import { createHash } from "crypto";
import { pool } from "../db";

function lockKey(name: string): string {
  const hash = createHash("sha256").update(name).digest();
  const high = hash.readInt32BE(0);
  const low = hash.readInt32BE(4);
  return `${high}, ${low}`;
}

export interface AdvisoryLockResult<T> {
  acquired: boolean;
  result: T | null;
}

export async function withAdvisoryLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  const key = lockKey(name);
  const client = await pool.connect();
  try {
    const acquireRes = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(${key}) AS locked`,
    );
    const acquired = acquireRes.rows[0]?.locked === true;
    if (!acquired) {
      return { acquired: false, result: null };
    }
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      try {
        await client.query(`SELECT pg_advisory_unlock(${key})`);
      } catch (err: any) {
        console.error(`[advisoryLock] failed to release lock '${name}':`, err.message);
      }
    }
  } finally {
    client.release();
  }
}
