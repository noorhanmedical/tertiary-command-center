import { db } from "../db";
import { and, eq, isNull, asc } from "drizzle-orm";
import { contacts, type Contact, type InsertContact } from "@shared/schema/contacts";

export type ListContactsFilters = {
  category?: string;
  facilityId?: string;
  includeArchived?: boolean;
};

export async function listContacts(filters: ListContactsFilters, limit = 200): Promise<Contact[]> {
  const conditions = [];
  if (filters.category) conditions.push(eq(contacts.category, filters.category));
  if (filters.facilityId) conditions.push(eq(contacts.facilityId, filters.facilityId));
  if (!filters.includeArchived) conditions.push(isNull(contacts.archivedAt));
  let q = db.select().from(contacts);
  if (conditions.length > 0) q = q.where(and(...conditions)) as typeof q;
  return q.orderBy(asc(contacts.name)).limit(limit);
}

export async function createContact(input: InsertContact): Promise<Contact> {
  const [row] = await db.insert(contacts).values(input).returning();
  return row;
}

export async function updateContact(id: number, patch: Partial<InsertContact>): Promise<Contact | undefined> {
  const [row] = await db
    .update(contacts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(contacts.id, id))
    .returning();
  return row;
}

export async function archiveContact(id: number): Promise<Contact | undefined> {
  return updateContact(id, { archivedAt: new Date() } as Partial<InsertContact>);
}
