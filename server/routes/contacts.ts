import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listContacts,
  createContact,
  updateContact,
  archiveContact,
} from "../repositories/contacts.repo";
import { CONTACT_CATEGORIES } from "@shared/schema/contacts";

// Read is open to any authenticated session (PCS/ACS/admin) so the
// Internal Contacts left-rail tool works without admin privileges.
// Write is admin-only.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  if ((req.session.role ?? "") !== "admin") return res.status(403).json({ error: "Forbidden — admin role required" });
  return next();
}

const createSchema = z.object({
  category: z.enum(CONTACT_CATEGORIES),
  name: z.string().min(1).max(200),
  role: z.string().optional().nullable(),
  organization: z.string().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  phone: z.string().min(1).max(64),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  isOnCall: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const patchSchema = createSchema.partial();

export function registerContactsRoutes(app: Express) {
  app.get("/api/contacts", requireAuth, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const filters: Parameters<typeof listContacts>[0] = {};
      if (q.category) filters.category = q.category;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.includeArchived === "true") filters.includeArchived = true;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 500) : 200;
      const rows = await listContacts(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/contacts", requireAdmin, async (req, res) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const row = await createContact({
        category: parsed.data.category,
        name: parsed.data.name,
        role: parsed.data.role ?? null,
        organization: parsed.data.organization ?? null,
        facilityId: parsed.data.facilityId ?? null,
        phone: parsed.data.phone,
        email: parsed.data.email ?? null,
        notes: parsed.data.notes ?? null,
        userId: parsed.data.userId ?? null,
        isOnCall: parsed.data.isOnCall ?? false,
        metadata: parsed.data.metadata ?? {},
        archivedAt: null,
      });
      res.status(201).json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/contacts/:id", requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id as string;
      const id = parseInt(rawId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const row = await updateContact(id, parsed.data as any);
      if (!row) return res.status(404).json({ error: "Contact not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/contacts/:id/archive", requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id as string;
      const id = parseInt(rawId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await archiveContact(id);
      if (!row) return res.status(404).json({ error: "Contact not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
