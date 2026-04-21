import { db } from "../db";
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import {
  invoices,
  invoiceLineItems,
  invoicePayments,
  type Invoice,
  type InsertInvoice,
  type InvoiceLineItem,
  type InsertInvoiceLineItem,
  type InvoicePayment,
  type InsertInvoicePayment,
} from "@shared/schema/invoices";
import { recomputeInvoiceTotals } from "../lib/invoiceRecompute";

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface IInvoicesRepository {
  listAll(): Promise<Invoice[]>;
  getById(id: number): Promise<Invoice | undefined>;
  listLineItems(invoiceId: number): Promise<InvoiceLineItem[]>;
  createWithLineItems(invoice: InsertInvoice, lineItems: Omit<InsertInvoiceLineItem, "invoiceId">[]): Promise<Invoice>;
  updateStatus(id: number, status: string): Promise<Invoice | undefined>;
  markSent(id: number, sentTo: string): Promise<Invoice | undefined>;
  remove(id: number): Promise<void>;
  nextInvoiceNumber(): Promise<string>;
  listPayments(invoiceId: number): Promise<InvoicePayment[]>;
  createPayment(payment: InsertInvoicePayment): Promise<{ payment: InvoicePayment; invoice: Invoice }>;
  deletePayment(invoiceId: number, paymentId: number): Promise<{ invoice: Invoice } | undefined>;
}

export class DbInvoicesRepository implements IInvoicesRepository {
  async listAll(): Promise<Invoice[]> {
    return db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async getById(id: number): Promise<Invoice | undefined> {
    const [r] = await db.select().from(invoices).where(eq(invoices.id, id));
    return r;
  }

  async listLineItems(invoiceId: number): Promise<InvoiceLineItem[]> {
    return db.select().from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .orderBy(asc(invoiceLineItems.id));
  }

  async createWithLineItems(
    invoice: InsertInvoice,
    lineItems: Omit<InsertInvoiceLineItem, "invoiceId">[],
  ): Promise<Invoice> {
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(invoices).values(invoice).returning();
      if (lineItems.length > 0) {
        await tx.insert(invoiceLineItems).values(
          lineItems.map((li) => ({ ...li, invoiceId: created.id })),
        );
      }
      return created;
    });
  }

  async updateStatus(id: number, status: string): Promise<Invoice | undefined> {
    const [r] = await db.update(invoices).set({ status }).where(eq(invoices.id, id)).returning();
    return r;
  }

  async markSent(id: number, sentTo: string): Promise<Invoice | undefined> {
    const [r] = await db.update(invoices)
      .set({ status: "Sent", sentTo, sentAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    return r;
  }

  async remove(id: number): Promise<void> {
    await db.delete(invoices).where(eq(invoices.id, id));
  }

  async listPayments(invoiceId: number): Promise<InvoicePayment[]> {
    return db.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId))
      .orderBy(asc(invoicePayments.paymentDate), asc(invoicePayments.id));
  }

  async createPayment(payment: InsertInvoicePayment): Promise<{ payment: InvoicePayment; invoice: Invoice }> {
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(invoicePayments).values(payment).returning();
      const updated = await this.recomputeInvoiceTotalsTx(tx, payment.invoiceId);
      return { payment: created, invoice: updated };
    });
  }

  async deletePayment(invoiceId: number, paymentId: number): Promise<{ invoice: Invoice } | undefined> {
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(invoicePayments)
        .where(and(eq(invoicePayments.id, paymentId), eq(invoicePayments.invoiceId, invoiceId)));
      if (!existing) return undefined;
      await tx.delete(invoicePayments)
        .where(and(eq(invoicePayments.id, paymentId), eq(invoicePayments.invoiceId, invoiceId)));
      const updated = await this.recomputeInvoiceTotalsTx(tx, invoiceId);
      return { invoice: updated };
    });
  }

  private async recomputeInvoiceTotalsTx(tx: TxClient, invoiceId: number): Promise<Invoice> {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!inv) throw new Error("Invoice not found");
    const payments = await tx.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId));
    const result = recomputeInvoiceTotals({
      totalCharges: inv.totalCharges,
      initialPaid: inv.initialPaid,
      currentStatus: inv.status,
      payments,
    });
    const [updated] = await tx.update(invoices).set({
      totalPaid: result.totalPaid.toFixed(2),
      totalBalance: result.totalBalance.toFixed(2),
      status: result.status,
    }).where(eq(invoices.id, invoiceId)).returning();
    return updated;
  }

  async nextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const rows = await db.select({ n: invoices.invoiceNumber })
      .from(invoices)
      .where(ilike(invoices.invoiceNumber, `${prefix}%`));
    let max = 0;
    for (const { n } of rows) {
      const m = n.match(/-(\d+)$/);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v > max) max = v;
      }
    }
    return `${prefix}${String(max + 1).padStart(4, "0")}`;
  }
}

export const invoicesRepository: IInvoicesRepository = new DbInvoicesRepository();
