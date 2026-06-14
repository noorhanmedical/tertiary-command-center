// invoiceApprovalService — Phase 4 PR 4.4.
//
// State machine for invoices.approvalStatus:
//   draft → pending_review → approved → (delivery flow)
//                        → revised → pending_review → ...
//                        → voided
//
// Records actor + timestamp on every transition.

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { invoices } from "@shared/schema/invoices";

export type ApprovalTransition = "submit_for_review" | "approve" | "void" | "revise";

const VALID_TRANSITIONS: Record<string, Set<ApprovalTransition>> = {
  draft: new Set(["submit_for_review", "void"]),
  pending_review: new Set(["approve", "void", "revise"]),
  approved: new Set(["void"]),
  voided: new Set([]),
  revised: new Set(["submit_for_review", "void"]),
};

const TRANSITION_TO_STATUS: Record<ApprovalTransition, string> = {
  submit_for_review: "pending_review",
  approve: "approved",
  void: "voided",
  revise: "revised",
};

export type ApplyApprovalInput = {
  invoiceId: number;
  transition: ApprovalTransition;
  actorUserId: string | null;
  reason?: string | null;
};

export type ApplyApprovalResult =
  | { ok: true; fromStatus: string; toStatus: string }
  | { ok: false; error: string; status: 400 | 404 | 409 };

export async function applyApprovalTransition(input: ApplyApprovalInput): Promise<ApplyApprovalResult> {
  const [existing] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
  if (!existing) return { ok: false, error: "Invoice not found", status: 404 };

  const from = (existing as any).approvalStatus as string;
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.has(input.transition)) {
    return { ok: false, error: `Cannot ${input.transition} an invoice in status "${from}"`, status: 409 };
  }
  if (input.transition === "void" && !input.reason) {
    return { ok: false, error: "void requires a reason", status: 400 };
  }

  const toStatus = TRANSITION_TO_STATUS[input.transition];
  const updates: Record<string, unknown> = {
    approvalStatus: toStatus,
  };
  if (input.transition === "approve") {
    updates.approvedByUserId = input.actorUserId;
    updates.approvedAt = new Date();
    updates.deliveryStatus = "ready_to_send";
  } else if (input.transition === "void") {
    updates.voidedAt = new Date();
    updates.voidReason = input.reason ?? null;
  }
  await db.update(invoices).set(updates as any).where(eq(invoices.id, input.invoiceId));
  return { ok: true, fromStatus: from, toStatus };
}
