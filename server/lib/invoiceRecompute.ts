import type { InvoiceStatus } from "@shared/schema";

export type RecomputeInput = {
  totalCharges: string | number;
  initialPaid: string | number;
  currentStatus: string;
  payments: Array<{ amount: string | number }>;
};

export type RecomputeResult = {
  totalPaid: number;
  totalBalance: number;
  status: InvoiceStatus;
};

function num(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function recomputeInvoiceTotals(input: RecomputeInput): RecomputeResult {
  const charges = num(input.totalCharges);
  const initialPaid = num(input.initialPaid);
  const paymentsSum = input.payments.reduce((s, p) => s + num(p.amount), 0);
  const totalPaid = initialPaid + paymentsSum;
  const balance = Math.max(0, charges - totalPaid);
  let status: InvoiceStatus;
  if (input.currentStatus === "Draft") {
    status = "Draft";
  } else if (totalPaid <= 0) {
    status = "Sent";
  } else if (balance <= 0.005) {
    status = "Paid";
  } else {
    status = "Partially Paid";
  }
  return { totalPaid, totalBalance: balance, status };
}
