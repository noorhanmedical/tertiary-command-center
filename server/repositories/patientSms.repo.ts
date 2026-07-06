import { db } from "../db";
import { and, eq, desc, asc, sql } from "drizzle-orm";
import {
  patientSmsMessages,
  type PatientSmsMessage,
  type InsertPatientSmsMessage,
} from "@shared/schema/patientSms";

export type PatientSmsThread = {
  patientPhone: string;
  patientName: string | null;
  lastBody: string;
  lastDirection: string;
  lastAt: string;
  unread: number;
};

export interface IPatientSmsRepository {
  /** One row per phone number, newest conversation first, with unread counts. */
  listThreads(): Promise<PatientSmsThread[]>;
  /** Full conversation for one phone number, oldest-first. */
  listThread(patientPhone: string): Promise<PatientSmsMessage[]>;
  /** Persist a message row (outbound sent/failed, or inbound received). */
  record(input: InsertPatientSmsMessage): Promise<PatientSmsMessage>;
  /** Mark all inbound messages in a thread as read. */
  markThreadRead(patientPhone: string): Promise<void>;
  /** Total unread inbound messages across all threads. */
  unreadTotal(): Promise<number>;
}

export class DbPatientSmsRepository implements IPatientSmsRepository {
  async listThreads(): Promise<PatientSmsThread[]> {
    const rows = await db.execute(sql`
      SELECT
        m.patient_phone,
        (SELECT m2.patient_name FROM patient_sms_messages m2
          WHERE m2.patient_phone = m.patient_phone AND m2.patient_name IS NOT NULL
          ORDER BY m2.created_at DESC LIMIT 1) AS patient_name,
        (SELECT m3.body FROM patient_sms_messages m3
          WHERE m3.patient_phone = m.patient_phone
          ORDER BY m3.created_at DESC LIMIT 1) AS last_body,
        (SELECT m4.direction FROM patient_sms_messages m4
          WHERE m4.patient_phone = m.patient_phone
          ORDER BY m4.created_at DESC LIMIT 1) AS last_direction,
        MAX(m.created_at) AS last_at,
        COUNT(*) FILTER (WHERE m.direction = 'inbound' AND m.read_at IS NULL)::int AS unread
      FROM patient_sms_messages m
      GROUP BY m.patient_phone
      ORDER BY MAX(m.created_at) DESC
    `);
    return (rows.rows as any[]).map((r) => ({
      patientPhone: String(r.patient_phone),
      patientName: r.patient_name != null ? String(r.patient_name) : null,
      lastBody: String(r.last_body ?? ""),
      lastDirection: String(r.last_direction ?? ""),
      lastAt: new Date(r.last_at).toISOString(),
      unread: Number(r.unread ?? 0),
    }));
  }

  async listThread(patientPhone: string): Promise<PatientSmsMessage[]> {
    return db
      .select()
      .from(patientSmsMessages)
      .where(eq(patientSmsMessages.patientPhone, patientPhone))
      .orderBy(asc(patientSmsMessages.createdAt));
  }

  async record(input: InsertPatientSmsMessage): Promise<PatientSmsMessage> {
    const [row] = await db.insert(patientSmsMessages).values(input).returning();
    return row;
  }

  async markThreadRead(patientPhone: string): Promise<void> {
    await db
      .update(patientSmsMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(patientSmsMessages.patientPhone, patientPhone),
          eq(patientSmsMessages.direction, "inbound"),
          sql`${patientSmsMessages.readAt} IS NULL`,
        ),
      );
  }

  async unreadTotal(): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(patientSmsMessages)
      .where(
        and(eq(patientSmsMessages.direction, "inbound"), sql`${patientSmsMessages.readAt} IS NULL`),
      );
    return Number(row?.count ?? 0);
  }
}

export const patientSmsRepository: IPatientSmsRepository = new DbPatientSmsRepository();
