import { db } from "../db";
import { and, asc, eq, gte } from "drizzle-orm";
import {
  ancillaryAppointments,
  type AncillaryAppointment,
  type InsertAncillaryAppointment,
} from "@shared/schema/appointments";

export interface AppointmentFilters {
  facility?: string;
  date?: string;
  testType?: string;
  status?: string;
}

export interface IAppointmentsRepository {
  create(record: InsertAncillaryAppointment): Promise<AncillaryAppointment>;
  list(filters?: AppointmentFilters): Promise<AncillaryAppointment[]>;
  upcoming(limit?: number): Promise<AncillaryAppointment[]>;
  cancel(id: number): Promise<AncillaryAppointment | undefined>;
  listByPatient(patientScreeningId: number): Promise<AncillaryAppointment[]>;
}

export class DbAppointmentsRepository implements IAppointmentsRepository {
  async create(record: InsertAncillaryAppointment): Promise<AncillaryAppointment> {
    const [result] = await db.insert(ancillaryAppointments).values(record).returning();
    return result;
  }

  async list(filters?: AppointmentFilters): Promise<AncillaryAppointment[]> {
    const conditions = [];
    if (filters?.facility) conditions.push(eq(ancillaryAppointments.facility, filters.facility));
    if (filters?.date) conditions.push(eq(ancillaryAppointments.scheduledDate, filters.date));
    if (filters?.testType) conditions.push(eq(ancillaryAppointments.testType, filters.testType));
    if (filters?.status) conditions.push(eq(ancillaryAppointments.status, filters.status));

    if (conditions.length > 0) {
      return db.select().from(ancillaryAppointments)
        .where(and(...conditions))
        .orderBy(asc(ancillaryAppointments.scheduledDate), asc(ancillaryAppointments.scheduledTime));
    }
    return db.select().from(ancillaryAppointments)
      .orderBy(asc(ancillaryAppointments.scheduledDate), asc(ancillaryAppointments.scheduledTime));
  }

  async upcoming(limit?: number): Promise<AncillaryAppointment[]> {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const query = db.select().from(ancillaryAppointments)
      .where(and(
        gte(ancillaryAppointments.scheduledDate, todayStr),
        eq(ancillaryAppointments.status, "scheduled"),
      ))
      .orderBy(asc(ancillaryAppointments.scheduledDate), asc(ancillaryAppointments.scheduledTime));
    if (limit !== undefined) return query.limit(limit);
    return query;
  }

  async cancel(id: number): Promise<AncillaryAppointment | undefined> {
    const [result] = await db.update(ancillaryAppointments)
      .set({ status: "cancelled" })
      .where(eq(ancillaryAppointments.id, id))
      .returning();
    return result;
  }

  async listByPatient(patientScreeningId: number): Promise<AncillaryAppointment[]> {
    return db.select().from(ancillaryAppointments)
      .where(eq(ancillaryAppointments.patientScreeningId, patientScreeningId))
      .orderBy(asc(ancillaryAppointments.scheduledDate), asc(ancillaryAppointments.scheduledTime));
  }
}

export const appointmentsRepository: IAppointmentsRepository = new DbAppointmentsRepository();
