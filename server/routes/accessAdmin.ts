// Access-management API routes (Phase 4A) — the backend control plane for the
// future Settings UI. Thin handlers: authenticate + authorize (requirePermission
// with an admin legacy fallback), load the ACTOR access context, then delegate
// to accessAdminService (which enforces per-target escalation + writes audit).
//
// NOTE: these endpoints are inherently part of the NEW access model. They are
// fully functional when FEATURE_PERMISSION_ENFORCEMENT is ON and the access
// tables are provisioned/seeded/backfilled (see the disposable Phase 4A test).
// The Settings UI that consumes them is Phase 4B.

import type { Express, Request, Response } from "express";
import { requirePermission, requireAnyPermission, ensureAccessContext, legacyRequireAdmin } from "../middleware/accessControl";
import type { AccessContext } from "../services/access/accessContextService";
import * as svc from "../services/access/accessAdminService";
import { AccessError } from "../services/access/accessAdminService";
import { storage } from "../storage";

async function withActor(req: Request, res: Response, fn: (actor: AccessContext) => Promise<unknown>) {
  const actor = await ensureAccessContext(req);
  if (!actor || !actor.isActive) return res.status(401).json({ error: "Not authenticated" });
  try {
    const result = await fn(actor);
    return res.json(result);
  } catch (e) {
    if (e instanceof AccessError) return res.status(e.status).json({ error: e.message });
    console.error("[accessAdmin] error:", e instanceof Error ? e.message : e);
    return res.status(500).json({ error: "Access administration error" });
  }
}

const num = (v: unknown): number => parseInt(String(v), 10);

export function registerAccessAdminRoutes(app: Express) {
  const usersView = requireAnyPermission(["users.view", "users.manage"], { legacy: legacyRequireAdmin });
  const usersManage = requirePermission("users.manage", { legacy: legacyRequireAdmin });
  const orgView = requireAnyPermission(["organization.view", "organization.manage"], { legacy: legacyRequireAdmin });
  const orgManage = requirePermission("organization.manage", { legacy: legacyRequireAdmin });
  const clinicView = requireAnyPermission(["clinic.view", "clinic.manage"], { legacy: legacyRequireAdmin });
  const clinicManage = requirePermission("clinic.manage", { legacy: legacyRequireAdmin });
  const auditView = requireAnyPermission(["platform.audit.view", "audit.organization.view"], { legacy: legacyRequireAdmin });

  // ── Users & Access ──────────────────────────────────────────────────────
  app.get("/api/access/users", usersView, (req, res) => withActor(req, res, (a) => svc.listUsers(a, {
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    organizationId: req.query.organizationId ? num(req.query.organizationId) : undefined,
    clinicId: req.query.clinicId ? num(req.query.clinicId) : undefined,
    role: typeof req.query.role === "string" ? req.query.role : undefined,
  })));

  app.get("/api/access/users/:id", usersView, (req, res) => withActor(req, res, (a) => svc.getUserAccessProfile(a, String(req.params.id))));

  app.post("/api/access/users", usersManage, (req, res) => withActor(req, res, async (a) => {
    const b = req.body ?? {};
    if (typeof b.username !== "string" || typeof b.password !== "string") throw new AccessError(400, "username_and_password_required");
    const created = await storage.createUser({ username: b.username, password: b.password } as never);
    if (b.firstName || b.lastName || b.displayName || b.email || b.jobTitle) {
      await svc.updateUserIdentity(a, created.id, { firstName: b.firstName, lastName: b.lastName, displayName: b.displayName, email: b.email, jobTitle: b.jobTitle });
    }
    return { id: created.id, username: created.username };
  }));

  app.patch("/api/access/users/:id", usersManage, (req, res) => withActor(req, res, (a) => svc.updateUserIdentity(a, String(req.params.id), req.body ?? {})));
  app.patch("/api/access/users/:id/status", usersManage, (req, res) => withActor(req, res, (a) => svc.setUserStatus(a, String(req.params.id), String((req.body ?? {}).status))));
  app.put("/api/access/users/:id/roles", usersManage, (req, res) => withActor(req, res, (a) => svc.setUserRoles(a, String(req.params.id), req.body ?? {})));
  app.put("/api/access/users/:id/organizations", usersManage, (req, res) => withActor(req, res, (a) => svc.setUserOrganizations(a, String(req.params.id), (req.body ?? {}).organizations ?? [])));
  app.put("/api/access/users/:id/clinics", usersManage, (req, res) => withActor(req, res, (a) => svc.setUserClinics(a, String(req.params.id), (req.body ?? {}).clinics ?? [])));
  app.put("/api/access/users/:id/permissions", usersManage, (req, res) => withActor(req, res, (a) => svc.setUserPermissionOverrides(a, String(req.params.id), req.body ?? {})));
  app.put("/api/access/users/:id/services", usersManage, (req, res) => withActor(req, res, (a) => svc.setUserServiceAccess(a, String(req.params.id), req.body ?? {})));
  app.put("/api/access/users/:id/default-workspace", usersManage, (req, res) => withActor(req, res, (a) => svc.setUserDefaultWorkspace(a, String(req.params.id), String((req.body ?? {}).defaultWorkspace))));

  // ── Organizations ─────────────────────────────────────────────────────────
  app.get("/api/access/organizations", orgView, (req, res) => withActor(req, res, (a) => svc.listOrganizations(a)));
  app.get("/api/access/organizations/:id", orgView, (req, res) => withActor(req, res, (a) => svc.getOrganization(a, num(req.params.id))));
  app.post("/api/access/organizations", orgManage, (req, res) => withActor(req, res, (a) => svc.createOrganization(a, req.body ?? {})));
  app.patch("/api/access/organizations/:id", orgManage, (req, res) => withActor(req, res, (a) => svc.updateOrganization(a, num(req.params.id), req.body ?? {})));

  // ── Clinics ─────────────────────────────────────────────────────────────────
  app.get("/api/access/clinics", clinicView, (req, res) => withActor(req, res, (a) => svc.listClinics(a)));
  app.get("/api/access/clinics/:id", clinicView, (req, res) => withActor(req, res, (a) => svc.getClinic(a, num(req.params.id))));
  app.patch("/api/access/clinics/:id", clinicManage, (req, res) => withActor(req, res, (a) => svc.updateClinic(a, num(req.params.id), req.body ?? {})));

  // ── Roles / Permissions / Services (read-only catalogs) ───────────────────
  app.get("/api/access/roles", usersView, (_req, res) => withActor(_req, res, () => svc.listRoles()));
  app.get("/api/access/roles/:key", usersView, (req, res) => withActor(req, res, () => svc.getRole(String(req.params.key))));
  app.get("/api/access/permissions", usersView, (_req, res) => withActor(_req, res, () => svc.listPermissions()));
  app.get("/api/access/services", usersView, (_req, res) => withActor(_req, res, () => svc.listServices()));

  // ── Audit (platform-wide OR organization-scoped) ──────────────────────────
  app.get("/api/access/audit", auditView, (req, res) => withActor(req, res, (a) =>
    svc.queryAudit(a, {
      platform: a.permissions.includes("platform.audit.view"),
      limit: req.query.limit ? num(req.query.limit) : undefined,
      entityType: typeof req.query.entityType === "string" ? req.query.entityType : undefined,
    }),
  ));
}
