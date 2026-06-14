// invoiceDeliveryService — Phase 4 PR 4.5.
//
// Owns delivery_status transitions on the invoice + audit-event
// rows in invoice_delivery_events. Sends only when approved AND a
// recipient is resolvable from the recipient snapshot.

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { invoices } from "@shared/schema/invoices";
import { invoiceDeliveryEvents } from "@shared/schema/invoiceDelivery";

export type DeliveryAction =
  | "queue"           // mark ready_to_send → queued
  | "send_email"      // attempt email
  | "send_reminder"
  | "mark_download_generated"
  | "mark_failed"
  | "mark_blocked";

export type ResolvedRecipients = {
  to: string | null;
  cc: string[];
  bcc: string[];
  deliveryMethod: string;
};

export function resolveRecipientsFromSnapshot(snapshot: Record<string, unknown> | null | undefined): ResolvedRecipients {
  const s = (snapshot ?? {}) as any;
  return {
    to: typeof s.primaryEmail === "string" ? s.primaryEmail : null,
    cc: Array.isArray(s.ccEmails) ? s.ccEmails.filter((e: unknown) => typeof e === "string") : [],
    bcc: Array.isArray(s.bccEmails) ? s.bccEmails.filter((e: unknown) => typeof e === "string") : [],
    deliveryMethod: typeof s.deliveryMethod === "string" ? s.deliveryMethod : "download_only",
  };
}

type CommonArgs = {
  invoiceId: number;
  actorUserId: string | null;
  metadata?: Record<string, unknown>;
};

export type DeliveryServiceResult =
  | { ok: true; eventType: string; newDeliveryStatus: string }
  | { ok: false; error: string; status: 400 | 404 | 409 };

async function recordEvent(
  invoiceId: number,
  eventType: string,
  recipientSnapshot: Record<string, unknown>,
  actorUserId: string | null,
  metadata: Record<string, unknown> = {},
  extra: { messageId?: string | null; errorMessage?: string | null } = {},
) {
  await db.insert(invoiceDeliveryEvents).values({
    invoiceId,
    eventType,
    recipientSnapshot,
    actorUserId,
    messageId: extra.messageId ?? null,
    errorMessage: extra.errorMessage ?? null,
    metadata,
  });
}

export async function queueDelivery(args: CommonArgs): Promise<DeliveryServiceResult> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, args.invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Invoice not found", status: 404 };
  const i = inv as any;
  if (i.approvalStatus !== "approved") {
    await recordEvent(args.invoiceId, "blocked", i.recipientSnapshot ?? {}, args.actorUserId, { reason: "not_approved" });
    return { ok: false, error: "Invoice is not approved", status: 409 };
  }
  const recipients = resolveRecipientsFromSnapshot(i.recipientSnapshot);
  if (!recipients.to && !i.recipientSnapshot?.fallbackToFacilityContact) {
    await db.update(invoices).set({ deliveryStatus: "blocked_missing_recipient" } as any).where(eq(invoices.id, args.invoiceId));
    await recordEvent(args.invoiceId, "blocked", i.recipientSnapshot ?? {}, args.actorUserId, { reason: "missing_recipient" });
    return { ok: false, error: "Missing recipient", status: 409 };
  }
  await db.update(invoices).set({ deliveryStatus: "queued" } as any).where(eq(invoices.id, args.invoiceId));
  await recordEvent(args.invoiceId, "queued", i.recipientSnapshot ?? {}, args.actorUserId);
  return { ok: true, eventType: "queued", newDeliveryStatus: "queued" };
}

export type SendEmailExecutor = (params: { to: string; cc: string[]; bcc: string[]; subject: string; body: string }) => Promise<{ messageId: string | null }>;

export async function sendEmailDelivery(
  args: CommonArgs & { send: SendEmailExecutor; subject: string; body: string },
): Promise<DeliveryServiceResult> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, args.invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Invoice not found", status: 404 };
  const i = inv as any;
  if (i.approvalStatus !== "approved") {
    await recordEvent(args.invoiceId, "blocked", i.recipientSnapshot ?? {}, args.actorUserId, { reason: "not_approved" });
    return { ok: false, error: "Invoice is not approved", status: 409 };
  }
  const recipients = resolveRecipientsFromSnapshot(i.recipientSnapshot);
  if (!recipients.to) {
    await db.update(invoices).set({ deliveryStatus: "blocked_missing_recipient" } as any).where(eq(invoices.id, args.invoiceId));
    await recordEvent(args.invoiceId, "blocked", i.recipientSnapshot ?? {}, args.actorUserId, { reason: "missing_recipient" });
    return { ok: false, error: "Missing recipient", status: 409 };
  }
  if (recipients.deliveryMethod === "download_only") {
    await db.update(invoices).set({ deliveryStatus: "download_only" } as any).where(eq(invoices.id, args.invoiceId));
    await recordEvent(args.invoiceId, "download_generated", i.recipientSnapshot ?? {}, args.actorUserId);
    return { ok: true, eventType: "download_generated", newDeliveryStatus: "download_only" };
  }
  try {
    const result = await args.send({
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: args.subject,
      body: args.body,
    });
    await db.update(invoices).set({
      deliveryStatus: "sent",
      sentTo: recipients.to,
      sentAt: new Date(),
    } as any).where(eq(invoices.id, args.invoiceId));
    await recordEvent(args.invoiceId, "sent", i.recipientSnapshot ?? {}, args.actorUserId, {}, { messageId: result.messageId });
    return { ok: true, eventType: "sent", newDeliveryStatus: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(invoices).set({ deliveryStatus: "failed" } as any).where(eq(invoices.id, args.invoiceId));
    await recordEvent(args.invoiceId, "failed", i.recipientSnapshot ?? {}, args.actorUserId, {}, { errorMessage: msg });
    return { ok: false, error: msg, status: 400 };
  }
}

export async function sendReminderDelivery(
  args: CommonArgs & { send: SendEmailExecutor; subject: string; body: string },
): Promise<DeliveryServiceResult> {
  const result = await sendEmailDelivery(args);
  if (!result.ok) return result;
  await db.update(invoices).set({ lastRemindedAt: new Date() } as any).where(eq(invoices.id, args.invoiceId));
  await recordEvent(args.invoiceId, "reminder_sent", {} as Record<string, unknown>, args.actorUserId);
  return { ok: true, eventType: "reminder_sent", newDeliveryStatus: result.newDeliveryStatus };
}
