import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  clinicianPortalNoteStates,
  clinicianPortalCallStates,
  clinicianPortalScheduleItems,
  type ClinicianPortalNoteState,
  type ClinicianPortalCallState,
  type ClinicianPortalScheduleItem,
} from "@shared/schema/clinicianPortal";

type NoteSoap = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};

type CallHistoryEntry = { label: string; outcome: string; date: string };

export interface IClinicianPortalRepository {
  // Notes
  listNoteStates(): Promise<ClinicianPortalNoteState[]>;
  getNoteState(noteId: string): Promise<ClinicianPortalNoteState | undefined>;
  upsertNoteState(noteId: string, fields: {
    status: string;
    version: number;
    soap?: NoteSoap | null;
    signedByName?: string | null;
    signedAt?: Date | null;
  }): Promise<ClinicianPortalNoteState>;
  // Calls
  listCallStates(): Promise<ClinicianPortalCallState[]>;
  getCallState(callId: string): Promise<ClinicianPortalCallState | undefined>;
  upsertCallState(callId: string, fields: {
    status: string;
    lastOutcome: string | null;
    history: CallHistoryEntry[];
  }): Promise<ClinicianPortalCallState>;
  // Schedule
  listScheduleItems(): Promise<ClinicianPortalScheduleItem[]>;
  findScheduleItem(patientId: string, service: string): Promise<ClinicianPortalScheduleItem | undefined>;
  addScheduleItem(item: {
    patientId: string;
    patientName: string;
    service: string;
    time: string;
    technician: string;
    status: string;
    source: string;
  }): Promise<ClinicianPortalScheduleItem>;
}

export class DbClinicianPortalRepository implements IClinicianPortalRepository {
  // ─── Notes ────────────────────────────────────────────────────────────────
  async listNoteStates(): Promise<ClinicianPortalNoteState[]> {
    return db.select().from(clinicianPortalNoteStates);
  }

  async getNoteState(noteId: string): Promise<ClinicianPortalNoteState | undefined> {
    const [row] = await db
      .select()
      .from(clinicianPortalNoteStates)
      .where(eq(clinicianPortalNoteStates.noteId, noteId));
    return row;
  }

  async upsertNoteState(noteId: string, fields: {
    status: string;
    version: number;
    soap?: NoteSoap | null;
    signedByName?: string | null;
    signedAt?: Date | null;
  }): Promise<ClinicianPortalNoteState> {
    const values = {
      noteId,
      status: fields.status,
      version: fields.version,
      soap: fields.soap ?? null,
      signedByName: fields.signedByName ?? null,
      signedAt: fields.signedAt ?? null,
      updatedAt: new Date(),
    };
    // Only overwrite columns the caller actually supplied, so e.g. a re-sign
    // never clobbers a previously saved soap draft with null.
    const update: Record<string, unknown> = {
      status: fields.status,
      version: fields.version,
      updatedAt: new Date(),
    };
    if (fields.soap !== undefined) update.soap = fields.soap;
    if (fields.signedByName !== undefined) update.signedByName = fields.signedByName;
    if (fields.signedAt !== undefined) update.signedAt = fields.signedAt;

    const [row] = await db
      .insert(clinicianPortalNoteStates)
      .values(values)
      .onConflictDoUpdate({
        target: clinicianPortalNoteStates.noteId,
        set: update,
      })
      .returning();
    return row;
  }

  // ─── Calls ────────────────────────────────────────────────────────────────
  async listCallStates(): Promise<ClinicianPortalCallState[]> {
    return db.select().from(clinicianPortalCallStates);
  }

  async getCallState(callId: string): Promise<ClinicianPortalCallState | undefined> {
    const [row] = await db
      .select()
      .from(clinicianPortalCallStates)
      .where(eq(clinicianPortalCallStates.callId, callId));
    return row;
  }

  async upsertCallState(callId: string, fields: {
    status: string;
    lastOutcome: string | null;
    history: CallHistoryEntry[];
  }): Promise<ClinicianPortalCallState> {
    const [row] = await db
      .insert(clinicianPortalCallStates)
      .values({
        callId,
        status: fields.status,
        lastOutcome: fields.lastOutcome,
        history: fields.history,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: clinicianPortalCallStates.callId,
        set: {
          status: fields.status,
          lastOutcome: fields.lastOutcome,
          history: fields.history,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  // ─── Schedule ─────────────────────────────────────────────────────────────
  async listScheduleItems(): Promise<ClinicianPortalScheduleItem[]> {
    return db.select().from(clinicianPortalScheduleItems);
  }

  async findScheduleItem(patientId: string, service: string): Promise<ClinicianPortalScheduleItem | undefined> {
    const rows = await db
      .select()
      .from(clinicianPortalScheduleItems)
      .where(eq(clinicianPortalScheduleItems.patientId, patientId));
    return rows.find((r) => r.service === service);
  }

  async addScheduleItem(item: {
    patientId: string;
    patientName: string;
    service: string;
    time: string;
    technician: string;
    status: string;
    source: string;
  }): Promise<ClinicianPortalScheduleItem> {
    const [row] = await db
      .insert(clinicianPortalScheduleItems)
      .values(item)
      .onConflictDoNothing({ target: [clinicianPortalScheduleItems.patientId, clinicianPortalScheduleItems.service] })
      .returning();
    if (row) return row;
    // Conflict — return the existing row.
    const existing = await this.findScheduleItem(item.patientId, item.service);
    return existing!;
  }
}

export const clinicianPortalRepository: IClinicianPortalRepository =
  new DbClinicianPortalRepository();
