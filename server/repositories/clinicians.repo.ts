// Clinician directory + facility-clinician relationship repository.
//
// Canonical source for Plexus IQ batch clinician selection. Distinct from
// patient_clinical_providers (per-patient PCP snapshot) and outreach_schedulers
// (call-staff roster). Follows the DbOutreachRepository shape.

import { db } from "../db";
import { and, asc, eq } from "drizzle-orm";
import {
  clinicians,
  facilityClinicians,
  clinics,
  type Clinician,
  type InsertClinician,
  type FacilityClinician,
} from "@shared/schema/clinics";

export type ClinicianWithFacilities = Clinician & {
  facilityIds: number[];
};

export interface IClinicianRepository {
  list(includeInactive?: boolean): Promise<Clinician[]>;
  listWithFacilities(includeInactive?: boolean): Promise<ClinicianWithFacilities[]>;
  getById(id: number): Promise<Clinician | undefined>;
  create(record: InsertClinician): Promise<Clinician>;
  update(id: number, updates: Partial<InsertClinician>): Promise<Clinician | undefined>;
  /** Active clinicians associated with a facility (for the batch dropdown). */
  listForFacility(clinicId: number, includeInactive?: boolean): Promise<Clinician[]>;
  /** Facility ids a clinician is associated with. */
  facilityIdsForClinician(clinicianId: number): Promise<number[]>;
  /** Idempotent association (reactivates if a soft row exists). */
  associate(clinicId: number, clinicianId: number): Promise<FacilityClinician>;
  /** Deactivate the association (soft — keeps the clinician globally). */
  dissociate(clinicId: number, clinicianId: number): Promise<void>;
  /** Replace the full facility set for a clinician. */
  setFacilities(clinicianId: number, clinicIds: number[]): Promise<void>;
}

export class DbClinicianRepository implements IClinicianRepository {
  async list(includeInactive = false): Promise<Clinician[]> {
    const rows = await db.select().from(clinicians).orderBy(asc(clinicians.displayName));
    return includeInactive ? rows : rows.filter((c) => c.active);
  }

  async listWithFacilities(includeInactive = false): Promise<ClinicianWithFacilities[]> {
    const list = await this.list(includeInactive);
    if (list.length === 0) return [];
    const links = await db
      .select({ clinicianId: facilityClinicians.clinicianId, clinicId: facilityClinicians.clinicId })
      .from(facilityClinicians)
      .where(eq(facilityClinicians.active, true));
    const byClinician = new Map<number, number[]>();
    for (const l of links) {
      const arr = byClinician.get(l.clinicianId) ?? [];
      arr.push(l.clinicId);
      byClinician.set(l.clinicianId, arr);
    }
    return list.map((c) => ({ ...c, facilityIds: byClinician.get(c.id) ?? [] }));
  }

  async getById(id: number): Promise<Clinician | undefined> {
    const [row] = await db.select().from(clinicians).where(eq(clinicians.id, id)).limit(1);
    return row;
  }

  async create(record: InsertClinician): Promise<Clinician> {
    const [row] = await db.insert(clinicians).values(record).returning();
    return row;
  }

  async update(id: number, updates: Partial<InsertClinician>): Promise<Clinician | undefined> {
    const [row] = await db
      .update(clinicians)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clinicians.id, id))
      .returning();
    return row;
  }

  async listForFacility(clinicId: number, includeInactive = false): Promise<Clinician[]> {
    const rows = await db
      .select({ clinician: clinicians, linkActive: facilityClinicians.active })
      .from(facilityClinicians)
      .innerJoin(clinicians, eq(clinicians.id, facilityClinicians.clinicianId))
      .where(eq(facilityClinicians.clinicId, clinicId))
      .orderBy(asc(facilityClinicians.sortOrder), asc(clinicians.displayName));
    return rows
      .filter((r) => includeInactive || (r.linkActive && r.clinician.active))
      .map((r) => r.clinician);
  }

  async facilityIdsForClinician(clinicianId: number): Promise<number[]> {
    const rows = await db
      .select({ clinicId: facilityClinicians.clinicId })
      .from(facilityClinicians)
      .where(and(eq(facilityClinicians.clinicianId, clinicianId), eq(facilityClinicians.active, true)));
    return rows.map((r) => r.clinicId);
  }

  async associate(clinicId: number, clinicianId: number): Promise<FacilityClinician> {
    const [existing] = await db
      .select()
      .from(facilityClinicians)
      .where(and(eq(facilityClinicians.clinicId, clinicId), eq(facilityClinicians.clinicianId, clinicianId)))
      .limit(1);
    if (existing) {
      if (existing.active) return existing;
      const [reactivated] = await db
        .update(facilityClinicians)
        .set({ active: true })
        .where(eq(facilityClinicians.id, existing.id))
        .returning();
      return reactivated;
    }
    const [row] = await db
      .insert(facilityClinicians)
      .values({ clinicId, clinicianId })
      .returning();
    return row;
  }

  async dissociate(clinicId: number, clinicianId: number): Promise<void> {
    await db
      .update(facilityClinicians)
      .set({ active: false })
      .where(and(eq(facilityClinicians.clinicId, clinicId), eq(facilityClinicians.clinicianId, clinicianId)));
  }

  async setFacilities(clinicianId: number, clinicIds: number[]): Promise<void> {
    const desired = new Set(clinicIds);
    const current = await db
      .select()
      .from(facilityClinicians)
      .where(eq(facilityClinicians.clinicianId, clinicianId));
    // Deactivate links not in the desired set; (re)activate/insert desired.
    for (const link of current) {
      const shouldBeActive = desired.has(link.clinicId);
      if (link.active !== shouldBeActive) {
        await db
          .update(facilityClinicians)
          .set({ active: shouldBeActive })
          .where(eq(facilityClinicians.id, link.id));
      }
      desired.delete(link.clinicId);
    }
    // Remaining desired ids have no row yet → insert.
    for (const clinicId of desired) {
      await db.insert(facilityClinicians).values({ clinicId, clinicianId });
    }
  }
}

export const clinicianRepository: IClinicianRepository = new DbClinicianRepository();

// ─── Facility (clinics) minimal repo for the Settings CRUD ────────────────
import { insertClinicSchema, type Clinic, type InsertClinic } from "@shared/schema/clinics";
import { desc } from "drizzle-orm";

export interface IFacilityRepository {
  list(includeInactive?: boolean): Promise<Clinic[]>;
  getById(id: number): Promise<Clinic | undefined>;
  create(record: InsertClinic): Promise<Clinic>;
  update(id: number, updates: Partial<InsertClinic>): Promise<Clinic | undefined>;
}

export class DbFacilityRepository implements IFacilityRepository {
  async list(includeInactive = false): Promise<Clinic[]> {
    const rows = await db.select().from(clinics).orderBy(desc(clinics.id));
    return includeInactive ? rows : rows.filter((c) => c.active);
  }
  async getById(id: number): Promise<Clinic | undefined> {
    const [row] = await db.select().from(clinics).where(eq(clinics.id, id)).limit(1);
    return row;
  }
  async create(record: InsertClinic): Promise<Clinic> {
    const [row] = await db.insert(clinics).values(record).returning();
    return row;
  }
  async update(id: number, updates: Partial<InsertClinic>): Promise<Clinic | undefined> {
    const [row] = await db.update(clinics).set(updates).where(eq(clinics.id, id)).returning();
    return row;
  }
}

export const facilityRepository: IFacilityRepository = new DbFacilityRepository();
void insertClinicSchema;
