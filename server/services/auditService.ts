import type { Request } from "express";
import { storage } from "../storage";

export async function logAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string | number | null,
  changes?: Record<string, unknown> | null
): Promise<void> {
  try {
    await storage.createAuditLog({
      userId: req.session?.userId ?? null,
      username: req.session?.username ?? null,
      action,
      entityType,
      entityId: entityId != null ? String(entityId) : null,
      changes: changes ?? null,
    });
  } catch (auditErr: any) {
    console.error("[audit] Failed to write audit log:", auditErr.message);
  }
}
