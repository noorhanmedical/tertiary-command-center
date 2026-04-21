import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recomputeInvoiceTotals } from "../server/lib/invoiceRecompute";

describe("recomputeInvoiceTotals", () => {
  it("keeps Draft status regardless of payments", () => {
    const r = recomputeInvoiceTotals({
      totalCharges: "500",
      initialPaid: "0",
      currentStatus: "Draft",
      payments: [{ amount: "100" }],
    });
    assert.equal(r.status, "Draft");
    assert.equal(r.totalPaid, 100);
    assert.equal(r.totalBalance, 400);
  });

  it("Sent stays Sent when no payments", () => {
    const r = recomputeInvoiceTotals({
      totalCharges: "500",
      initialPaid: "0",
      currentStatus: "Sent",
      payments: [],
    });
    assert.equal(r.status, "Sent");
    assert.equal(r.totalBalance, 500);
  });

  it("Sent transitions to Partially Paid on partial payment", () => {
    const r = recomputeInvoiceTotals({
      totalCharges: "500",
      initialPaid: "0",
      currentStatus: "Sent",
      payments: [{ amount: "100" }],
    });
    assert.equal(r.status, "Partially Paid");
    assert.equal(r.totalPaid, 100);
    assert.equal(r.totalBalance, 400);
  });

  it("Partially Paid transitions to Paid when balance reaches 0", () => {
    const r = recomputeInvoiceTotals({
      totalCharges: "500",
      initialPaid: "0",
      currentStatus: "Partially Paid",
      payments: [{ amount: "200" }, { amount: "300" }],
    });
    assert.equal(r.status, "Paid");
    assert.equal(r.totalPaid, 500);
    assert.equal(r.totalBalance, 0);
  });

  it("overpayment clamps balance to 0 and marks Paid", () => {
    const r = recomputeInvoiceTotals({
      totalCharges: "500",
      initialPaid: "0",
      currentStatus: "Sent",
      payments: [{ amount: "600" }],
    });
    assert.equal(r.status, "Paid");
    assert.equal(r.totalPaid, 600);
    assert.equal(r.totalBalance, 0);
  });

  it("respects initialPaid snapshot from billing records", () => {
    const r = recomputeInvoiceTotals({
      totalCharges: "1000",
      initialPaid: "200",
      currentStatus: "Sent",
      payments: [{ amount: "300" }],
    });
    assert.equal(r.status, "Partially Paid");
    assert.equal(r.totalPaid, 500);
    assert.equal(r.totalBalance, 500);
  });

  it("removing all payments returns Sent (when not Draft)", () => {
    const r = recomputeInvoiceTotals({
      totalCharges: "500",
      initialPaid: "0",
      currentStatus: "Paid",
      payments: [],
    });
    assert.equal(r.status, "Sent");
    assert.equal(r.totalPaid, 0);
    assert.equal(r.totalBalance, 500);
  });

  it("treats balances within half a cent as Paid", () => {
    const r = recomputeInvoiceTotals({
      totalCharges: "100.00",
      initialPaid: "0",
      currentStatus: "Sent",
      payments: [{ amount: "99.999" }],
    });
    assert.equal(r.status, "Paid");
    assert.equal(r.totalBalance, 0.0010000000000047748);
    // status flips at 0.005 threshold
  });
});
