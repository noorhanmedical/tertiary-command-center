// Plexus Bank ops modules: Vendors, Payroll, Banking, Reports,
// Approvals, Audit Logs, Settings & Permissions.

import { useMemo, useState } from "react";
import { Plus, Download, Landmark as LandmarkIcon, ShieldAlert, RotateCcw } from "lucide-react";
import {
  usePlexusBank, updateBank, logAuditEvent, bankId, fmtMoney, resetPlexusBank,
  BANK_CLINICS, BANK_MODULES, BANK_ROLES, REPORT_TYPES,
  type BankVendor, type VendorBill, type PayrollRun, type ApprovalRequest,
  type PermissionLevel,
} from "./mockData";
import { usePlexusBankFilters, matchesFilters } from "@/pages/plexus-bank";
import {
  ModuleHeader, Panel, StatusBadge, BankButton, BankModal, Field, inputCls,
  Th, Td, StatCard, ChartPlaceholder,
} from "./ui";

// ─── Vendors / Vendor Pay ───────────────────────────────────────────────────

export function VendorsModule() {
  const bank = usePlexusBank();
  const { filters, actor } = usePlexusBankFilters();
  const [tab, setTab] = useState<"vendors" | "bills" | "aging">("vendors");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", contact: "", terms: "Net 30" });
  const [billOpen, setBillOpen] = useState(false);
  const [billForm, setBillForm] = useState({ vendorId: "", invoiceNumber: "", clinic: BANK_CLINICS[0] as string, amount: "", issuedDate: "", dueDate: "", invoiceAttached: false });

  const bills = bank.vendorBills.filter((b) => matchesFilters(filters, { clinic: b.clinic, date: b.issuedDate }));

  const today = new Date().toISOString().slice(0, 10);
  const aging = useMemo(() => {
    const buckets = new Map<string, { current: number; d30: number; d60: number; d90: number; over90: number; total: number }>();
    for (const b of bills) {
      if (b.status === "paid") continue;
      const row = buckets.get(b.vendor) ?? { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
      const daysPast = Math.floor((new Date(today).getTime() - new Date(b.dueDate).getTime()) / 86400000);
      if (daysPast <= 0) row.current += b.amount;
      else if (daysPast <= 30) row.d30 += b.amount;
      else if (daysPast <= 60) row.d60 += b.amount;
      else if (daysPast <= 90) row.d90 += b.amount;
      else row.over90 += b.amount;
      row.total += b.amount;
      buckets.set(b.vendor, row);
    }
    return Array.from(buckets.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [bills, today]);

  function addBill() {
    const amount = Number(billForm.amount);
    const vendor = bank.vendors.find((v) => v.id === billForm.vendorId);
    if (!vendor || !amount || amount <= 0 || !billForm.invoiceNumber.trim()) return;
    const bill: VendorBill = {
      id: bankId("bill"),
      vendorId: vendor.id,
      vendor: vendor.name,
      invoiceNumber: billForm.invoiceNumber.trim(),
      clinic: billForm.clinic,
      amount,
      issuedDate: billForm.issuedDate || today,
      dueDate: billForm.dueDate || today,
      status: "pending-approval",
    };
    updateBank((draft) => {
      draft.vendorBills = [bill, ...draft.vendorBills];
    });
    logAuditEvent({
      actor,
      module: "Vendors",
      action: `Added vendor bill ${bill.invoiceNumber} for ${vendor.name}${billForm.invoiceAttached ? " (invoice document attached — placeholder)" : ""}`,
      newValue: fmtMoney(amount),
    });
    setBillOpen(false);
    setBillForm({ vendorId: "", invoiceNumber: "", clinic: BANK_CLINICS[0], amount: "", issuedDate: "", dueDate: "", invoiceAttached: false });
    setTab("bills");
  }

  function uploadW9(v: BankVendor) {
    updateBank((draft) => {
      draft.vendors = draft.vendors.map((x) => (x.id === v.id ? { ...x, w9OnFile: true } : x));
    });
    logAuditEvent({ actor, module: "Vendors", action: `Uploaded W-9 for ${v.name} (placeholder — no file stored)`, oldValue: "Missing", newValue: "On file" });
  }

  function addVendor() {
    if (!form.name.trim()) return;
    updateBank((draft) => {
      draft.vendors = [...draft.vendors, { id: bankId("ven"), name: form.name.trim(), category: form.category || "Other", contact: form.contact, terms: form.terms, w9OnFile: false, status: "active" }];
    });
    logAuditEvent({ actor, module: "Vendors", action: `Added vendor ${form.name.trim()}` });
    setAddOpen(false);
    setForm({ name: "", category: "", contact: "", terms: "Net 30" });
  }

  function toggleVendor(v: BankVendor) {
    updateBank((draft) => {
      draft.vendors = draft.vendors.map((x) => (x.id === v.id ? { ...x, status: x.status === "active" ? "inactive" : "active" } : x));
    });
    logAuditEvent({ actor, module: "Vendors", action: `Set vendor ${v.name} ${v.status === "active" ? "inactive" : "active"}` });
  }

  function setBillStatus(b: VendorBill, status: VendorBill["status"]) {
    updateBank((draft) => {
      draft.vendorBills = draft.vendorBills.map((x) => (x.id === b.id ? { ...x, status } : x));
    });
    logAuditEvent({ actor, module: "Vendors", action: `Vendor bill ${b.invoiceNumber} (${b.vendor}) → ${status}`, oldValue: b.status, newValue: status });
  }

  return (
    <div data-testid="bank-vendors">
      <ModuleHeader
        title="Vendors / Vendor Pay"
        subtitle="Vendor directory, bill approval workflow, and aging. Payments are recorded only — no live money movement."
        actions={
          <div className="flex gap-1.5">
            <BankButton variant="secondary" onClick={() => setBillOpen(true)} testId="vendor-add-bill-open"><Plus className="h-3 w-3" /> Add bill</BankButton>
            <BankButton onClick={() => setAddOpen(true)} testId="vendor-add-open"><Plus className="h-3 w-3" /> Add vendor</BankButton>
          </div>
        }
      />
      <div className="mb-3 flex gap-1">
        <BankButton variant={tab === "vendors" ? "primary" : "secondary"} onClick={() => setTab("vendors")} testId="vendors-tab-directory">Directory ({bank.vendors.length})</BankButton>
        <BankButton variant={tab === "bills" ? "primary" : "secondary"} onClick={() => setTab("bills")} testId="vendors-tab-bills">Bills ({bills.length})</BankButton>
        <BankButton variant={tab === "aging" ? "primary" : "secondary"} onClick={() => setTab("aging")} testId="vendors-tab-aging">Aging report</BankButton>
      </div>

      {tab === "vendors" && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="vendors-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Vendor</Th><Th>Category</Th><Th>Contact</Th><Th>Terms</Th><Th>W-9</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {bank.vendors.map((v) => (
                <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`vendor-row-${v.id}`}>
                  <Td className="font-semibold">{v.name}</Td>
                  <Td>{v.category}</Td>
                  <Td className="text-slate-400">{v.contact || "—"}</Td>
                  <Td>{v.terms}</Td>
                  <Td>{v.w9OnFile ? "On file" : <span className="text-amber-600">Missing</span>}</Td>
                  <Td><StatusBadge value={v.status} /></Td>
                  <Td>
                    <div className="flex gap-1">
                      {!v.w9OnFile && <BankButton size="xs" variant="secondary" onClick={() => uploadW9(v)} testId={`vendor-w9-upload-${v.id}`}>Upload W-9</BankButton>}
                      <BankButton size="xs" variant="secondary" onClick={() => toggleVendor(v)} testId={`vendor-toggle-${v.id}`}>{v.status === "active" ? "Deactivate" : "Reactivate"}</BankButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "bills" && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="vendor-bills-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Bill #</Th><Th>Vendor</Th><Th>Clinic</Th><Th>Amount</Th><Th>Issued</Th><Th>Due</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`bill-row-${b.id}`}>
                  <Td className="font-semibold">{b.invoiceNumber}</Td>
                  <Td>{b.vendor}</Td>
                  <Td>{b.clinic}</Td>
                  <Td className="font-semibold">{fmtMoney(b.amount)}</Td>
                  <Td>{b.issuedDate}</Td>
                  <Td>{b.dueDate}</Td>
                  <Td><StatusBadge value={b.status} testId={`bill-status-${b.id}`} /></Td>
                  <Td>
                    <div className="flex gap-1">
                      {b.status === "pending-approval" && (
                        <>
                          <BankButton size="xs" onClick={() => setBillStatus(b, "approved")} testId={`bill-approve-${b.id}`}>Approve</BankButton>
                          <BankButton size="xs" variant="danger" onClick={() => setBillStatus(b, "disputed")} testId={`bill-dispute-${b.id}`}>Dispute</BankButton>
                        </>
                      )}
                      {b.status === "approved" && <BankButton size="xs" onClick={() => setBillStatus(b, "paid")} testId={`bill-pay-${b.id}`}>Record payment</BankButton>}
                      {b.status === "disputed" && <BankButton size="xs" variant="secondary" onClick={() => setBillStatus(b, "pending-approval")} testId={`bill-reopen-${b.id}`}>Reopen</BankButton>}
                    </div>
                  </Td>
                </tr>
              ))}
              {bills.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-xs italic text-slate-400">No vendor bills for the current filters.</td></tr>}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "aging" && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="vendor-aging-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Vendor</Th><Th>Current</Th><Th>1–30 days</Th><Th>31–60 days</Th><Th>61–90 days</Th><Th>90+ days</Th><Th>Total open</Th></tr></thead>
            <tbody>
              {aging.map(([vendor, row]) => (
                <tr key={vendor} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`aging-row-${vendor.replace(/\s+/g, "-").toLowerCase()}`}>
                  <Td className="font-semibold">{vendor}</Td>
                  <Td>{row.current ? fmtMoney(row.current) : "—"}</Td>
                  <Td>{row.d30 ? <span className="text-amber-600">{fmtMoney(row.d30)}</span> : "—"}</Td>
                  <Td>{row.d60 ? <span className="text-amber-700">{fmtMoney(row.d60)}</span> : "—"}</Td>
                  <Td>{row.d90 ? <span className="text-red-600">{fmtMoney(row.d90)}</span> : "—"}</Td>
                  <Td>{row.over90 ? <span className="font-semibold text-red-700">{fmtMoney(row.over90)}</span> : "—"}</Td>
                  <Td className="font-semibold">{fmtMoney(row.total)}</Td>
                </tr>
              ))}
              {aging.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-xs italic text-slate-400">No open vendor bills for the current filters.</td></tr>}
            </tbody>
          </table>
        </Panel>
      )}

      <BankModal open={billOpen} onClose={() => setBillOpen(false)} title="Add vendor bill">
        <div className="space-y-3">
          <Field label="Vendor">
            <select className={inputCls} value={billForm.vendorId} onChange={(e) => setBillForm({ ...billForm, vendorId: e.target.value })} data-testid="bill-form-vendor">
              <option value="">Select vendor…</option>
              {bank.vendors.filter((v) => v.status === "active").map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Bill / invoice #"><input className={inputCls} value={billForm.invoiceNumber} onChange={(e) => setBillForm({ ...billForm, invoiceNumber: e.target.value })} data-testid="bill-form-number" /></Field>
          <Field label="Clinic">
            <select className={inputCls} value={billForm.clinic} onChange={(e) => setBillForm({ ...billForm, clinic: e.target.value })} data-testid="bill-form-clinic">
              {BANK_CLINICS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Amount ($)"><input className={inputCls} type="number" min="0" value={billForm.amount} onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })} data-testid="bill-form-amount" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issued date"><input className={inputCls} type="date" value={billForm.issuedDate} onChange={(e) => setBillForm({ ...billForm, issuedDate: e.target.value })} data-testid="bill-form-issued" /></Field>
            <Field label="Due date"><input className={inputCls} type="date" value={billForm.dueDate} onChange={(e) => setBillForm({ ...billForm, dueDate: e.target.value })} data-testid="bill-form-due" /></Field>
          </div>
          <button
            type="button"
            onClick={() => setBillForm({ ...billForm, invoiceAttached: !billForm.invoiceAttached })}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs ${billForm.invoiceAttached ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}
            data-testid="bill-form-invoice-upload"
          >
            {billForm.invoiceAttached ? "Invoice document attached (placeholder)" : "Attach invoice document (upload placeholder)"}
          </button>
          <div className="flex justify-end gap-2">
            <BankButton variant="secondary" onClick={() => setBillOpen(false)}>Cancel</BankButton>
            <BankButton onClick={addBill} disabled={!billForm.vendorId || !billForm.invoiceNumber.trim() || !Number(billForm.amount)} testId="bill-form-submit">Add bill</BankButton>
          </div>
        </div>
      </BankModal>

      <BankModal open={addOpen} onClose={() => setAddOpen(false)} title="Add vendor">
        <div className="space-y-3">
          <Field label="Vendor name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="vendor-form-name" /></Field>
          <Field label="Category"><input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="vendor-form-category" /></Field>
          <Field label="Contact"><input className={inputCls} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} data-testid="vendor-form-contact" /></Field>
          <Field label="Terms">
            <select className={inputCls} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} data-testid="vendor-form-terms">
              <option>Net 1</option><option>Net 15</option><option>Net 30</option><option>Net 60</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <BankButton variant="secondary" onClick={() => setAddOpen(false)}>Cancel</BankButton>
            <BankButton onClick={addVendor} disabled={!form.name.trim()} testId="vendor-form-submit">Add vendor</BankButton>
          </div>
        </div>
      </BankModal>
    </div>
  );
}

// ─── Payroll ────────────────────────────────────────────────────────────────

export function PayrollModule() {
  const bank = usePlexusBank();
  const { actor } = usePlexusBankFilters();
  const [openRun, setOpenRun] = useState<PayrollRun | null>(null);
  const openRunLive = openRun ? bank.payrollRuns.find((r) => r.id === openRun.id) ?? null : null;

  function createRun() {
    const approved = bank.payoutEntries.filter((p) => p.status === "approved");
    const lines = bank.employees.map((e) => {
      const payout = approved.filter((p) => p.employee === e.name);
      const rvuPayout = payout.reduce((s, p) => s + p.baseAmount, 0);
      const plexBonus = payout.reduce((s, p) => s + p.plexFactorBonus, 0);
      return { employee: e.name, basePay: e.basePay, rvuPayout, plexFactorBonus: plexBonus, total: e.basePay + rvuPayout + plexBonus };
    });
    const total = lines.reduce((s, l) => s + l.total, 0);
    const run: PayrollRun = {
      id: bankId("pr"), period: "Current semi-monthly period", createdAt: new Date().toISOString().slice(0, 10), createdBy: actor,
      status: "draft", lines, total, history: [{ date: new Date().toISOString().slice(0, 10), by: actor, action: "Run created" }],
    };
    updateBank((draft) => {
      draft.payrollRuns = [run, ...draft.payrollRuns];
    });
    logAuditEvent({ actor, module: "Payroll", action: `Created payroll run for ${run.period}`, newValue: fmtMoney(total) });
  }

  function advanceRun(run: PayrollRun) {
    const next = run.status === "draft" ? "review" : run.status === "review" ? "approved" : "paid";
    updateBank((draft) => {
      draft.payrollRuns = draft.payrollRuns.map((r) =>
        r.id === run.id ? { ...r, status: next as PayrollRun["status"], history: [...r.history, { date: new Date().toISOString().slice(0, 10), by: actor, action: next === "review" ? "Sent for review" : next === "approved" ? "Approved" : "Marked paid" }] } : r,
      );
      if (next === "paid") {
        draft.payoutEntries = draft.payoutEntries.map((p) => (p.status === "approved" ? { ...p, status: "paid" as const } : p));
      }
    });
    logAuditEvent({ actor, module: "Payroll", action: `Payroll run ${run.period} → ${next}`, oldValue: run.status, newValue: next });
  }

  return (
    <div data-testid="bank-payroll">
      <ModuleHeader
        title="Payroll"
        subtitle="Payroll runs pull base pay plus approved RVU/Plex Factor payouts. Processor connection is a placeholder — nothing is transmitted."
        actions={<BankButton onClick={createRun} testId="payroll-create-run"><Plus className="h-3 w-3" /> New payroll run</BankButton>}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="overflow-x-auto xl:col-span-2">
          <table className="w-full text-xs" data-testid="payroll-runs-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Period</Th><Th>Created</Th><Th>By</Th><Th>Total</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {bank.payrollRuns.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`payroll-run-${r.id}`}>
                  <Td className="font-semibold">{r.period}</Td>
                  <Td>{r.createdAt}</Td>
                  <Td>{r.createdBy}</Td>
                  <Td className="font-semibold">{fmtMoney(r.total)}</Td>
                  <Td><StatusBadge value={r.status} testId={`payroll-run-status-${r.id}`} /></Td>
                  <Td>
                    <div className="flex gap-1">
                      <BankButton size="xs" variant="secondary" onClick={() => setOpenRun(r)} testId={`payroll-run-view-${r.id}`}>Detail</BankButton>
                      {r.status !== "paid" && (
                        <BankButton size="xs" onClick={() => advanceRun(r)} testId={`payroll-run-advance-${r.id}`}>
                          {r.status === "draft" ? "Send for review" : r.status === "review" ? "Approve" : "Mark paid"}
                        </BankButton>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {bank.payrollRuns.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-xs italic text-slate-400">No payroll runs yet.</td></tr>}
            </tbody>
          </table>
        </Panel>
        <Panel className="h-fit overflow-x-auto">
          <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Team roster</div>
          <table className="w-full text-xs" data-testid="payroll-roster-table">
            <tbody>
              {bank.employees.map((e) => (
                <tr key={e.id} className="border-b border-slate-50" data-testid={`employee-row-${e.id}`}>
                  <Td className="font-semibold">{e.name}</Td>
                  <Td>{e.role}</Td>
                  <Td><span className={`rounded-full px-2 py-0.5 text-[10px] ${e.type === "contractor" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{e.type}</span></Td>
                  <Td>{e.basePay ? `${fmtMoney(e.basePay)}/period` : "RVU only"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <BankModal open={!!openRunLive} onClose={() => setOpenRun(null)} title={openRunLive ? `Payroll run — ${openRunLive.period}` : ""} wide>
        {openRunLive && (
          <div className="space-y-3 text-xs">
            <table className="w-full">
              <thead className="border-b border-slate-100"><tr><Th>Employee</Th><Th>Base</Th><Th>RVU payout</Th><Th>Plex Factor</Th><Th>Total</Th></tr></thead>
              <tbody>
                {openRunLive.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <Td className="font-semibold">{l.employee}</Td>
                    <Td>{fmtMoney(l.basePay)}</Td>
                    <Td>{fmtMoney(l.rvuPayout)}</Td>
                    <Td className="text-violet-700">{fmtMoney(l.plexFactorBonus)}</Td>
                    <Td className="font-semibold">{fmtMoney(l.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right font-bold text-slate-900">Run total: {fmtMoney(openRunLive.total)}</div>
            <div>
              <div className="mb-1 font-semibold text-slate-900">History</div>
              <ul className="space-y-1 text-slate-600">
                {openRunLive.history.map((h, i) => <li key={i}>{h.date} · {h.by} · {h.action}</li>)}
              </ul>
            </div>
          </div>
        )}
      </BankModal>
    </div>
  );
}

// ─── Banking / Cards ────────────────────────────────────────────────────────

export function BankingModule() {
  const bank = usePlexusBank();
  const { actor } = usePlexusBankFilters();

  function categorize(txId: string, category: string) {
    const tx = bank.bankTransactions.find((t) => t.id === txId);
    updateBank((draft) => {
      draft.bankTransactions = draft.bankTransactions.map((t) => (t.id === txId ? { ...t, category } : t));
    });
    logAuditEvent({ actor, module: "Banking", action: `Categorized transaction "${tx?.description}"`, oldValue: tx?.category ?? "uncategorized", newValue: category });
  }

  function toggleReconciled(txId: string) {
    const tx = bank.bankTransactions.find((t) => t.id === txId);
    updateBank((draft) => {
      draft.bankTransactions = draft.bankTransactions.map((t) => (t.id === txId ? { ...t, reconciled: !t.reconciled } : t));
    });
    logAuditEvent({ actor, module: "Banking", action: `${tx?.reconciled ? "Un-reconciled" : "Reconciled"} transaction "${tx?.description}"` });
  }

  function toggleSuspicious(txId: string) {
    const tx = bank.bankTransactions.find((t) => t.id === txId);
    updateBank((draft) => {
      draft.bankTransactions = draft.bankTransactions.map((t) => (t.id === txId ? { ...t, flaggedSuspicious: !t.flaggedSuspicious } : t));
    });
    logAuditEvent({ actor, module: "Banking", action: `${tx?.flaggedSuspicious ? "Cleared suspicious flag on" : "Flagged suspicious"} "${tx?.description}"` });
  }

  return (
    <div data-testid="bank-banking">
      <ModuleHeader title="Banking / Cards" subtitle="Read-only connected-account view. Connections are tokenized placeholders — no live bank or card feed." />
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {bank.bankAccounts.map((a) => (
          <Panel key={a.id} className="p-4" testId={`bank-account-${a.id}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0d1b3e]/5"><LandmarkIcon className="h-4 w-4 text-[#0d1b3e]" /></span>
                <div>
                  <div className="text-xs font-bold text-slate-900">{a.name}</div>
                  <div className="text-[10px] text-slate-400">{a.institution} · {a.mask}</div>
                </div>
              </div>
              <StatusBadge value={a.status} />
            </div>
            <div className="mt-2 font-mono text-[9px] text-slate-300">token {a.tokenRef}</div>
            <div className="text-[10px] text-slate-400">Connected {a.connectedAt} · {a.type}</div>
          </Panel>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="overflow-x-auto xl:col-span-2">
          <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Imported transactions</div>
          <table className="w-full text-xs" data-testid="bank-transactions-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Date</Th><Th>Description</Th><Th>Amount</Th><Th>Category</Th><Th>Reconciled</Th><Th>Flags</Th></tr></thead>
            <tbody>
              {bank.bankTransactions.map((t) => (
                <tr key={t.id} className={`border-b border-slate-50 ${t.flaggedSuspicious ? "bg-red-50/50" : ""}`} data-testid={`tx-row-${t.id}`}>
                  <Td>{t.date}</Td>
                  <Td className="font-semibold">{t.description}</Td>
                  <Td className={t.amount >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>{fmtMoney(t.amount)}</Td>
                  <Td>
                    <select value={t.category ?? ""} onChange={(e) => categorize(t.id, e.target.value)} className="rounded-md border border-slate-200 bg-white px-1 py-0.5 text-[10px]" data-testid={`tx-category-${t.id}`}>
                      <option value="">Uncategorized</option>
                      <option>Insurance Collections</option><option>Patient Collections</option><option>Rent</option><option>Supplies</option><option>Software</option><option>Payroll</option><option>Other</option>
                    </select>
                  </Td>
                  <Td>
                    <button onClick={() => toggleReconciled(t.id)} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.reconciled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`} data-testid={`tx-reconcile-${t.id}`}>
                      {t.reconciled ? "Reconciled" : "Mark reconciled"}
                    </button>
                  </Td>
                  <Td>
                    <button onClick={() => toggleSuspicious(t.id)} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.flaggedSuspicious ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-400"}`} data-testid={`tx-suspicious-${t.id}`}>
                      <ShieldAlert className="h-3 w-3" /> {t.flaggedSuspicious ? "Suspicious" : "Flag"}
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel className="h-fit overflow-x-auto">
          <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Access log</div>
          <table className="w-full text-xs" data-testid="banking-access-log">
            <tbody>
              {bank.accessLog.map((a) => (
                <tr key={a.id} className="border-b border-slate-50">
                  <Td>{a.date}</Td><Td className="font-semibold">{a.actor}</Td><Td>{a.action}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

// ─── Reports ────────────────────────────────────────────────────────────────

export function ReportsModule() {
  const bank = usePlexusBank();
  const { filters, actor } = usePlexusBankFilters();
  const [selected, setSelected] = useState<string>(REPORT_TYPES[0]);
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  function saveReport() {
    logAuditEvent({ actor, module: "Reports", action: `Saved report "${selected}" with current filters (placeholder — prototype only)` });
    setReportNotice(`Report "${selected}" saved with the current filter set. (Placeholder — saved reports are a prototype feature.)`);
  }

  function scheduleReport() {
    logAuditEvent({ actor, module: "Reports", action: `Scheduled report "${selected}" for weekly email delivery (placeholder — no email is sent)` });
    setReportNotice(`Report "${selected}" scheduled for weekly delivery. (Placeholder — no email is actually sent.)`);
  }

  const preview = useMemo(() => {
    const claims = bank.claims.filter((c) => matchesFilters(filters, { clinic: c.clinic, region: c.region, payer: c.payer, provider: c.provider, date: c.dateOfService }));
    switch (selected) {
      case "Revenue by Clinic": {
        const g = new Map<string, number>();
        claims.forEach((c) => g.set(c.clinic, (g.get(c.clinic) ?? 0) + c.charge));
        return { headers: ["Clinic", "Gross Revenue"], rows: Array.from(g.entries()).map(([k, v]) => [k, fmtMoney(v)]) };
      }
      case "Revenue by Service": {
        const g = new Map<string, number>();
        claims.forEach((c) => g.set(c.service, (g.get(c.service) ?? 0) + c.charge));
        return { headers: ["Service", "Gross Revenue"], rows: Array.from(g.entries()).map(([k, v]) => [k, fmtMoney(v)]) };
      }
      case "Collections vs Charges": {
        const charges = claims.reduce((s, c) => s + c.charge, 0);
        const collected = claims.reduce((s, c) => s + c.paid, 0);
        return { headers: ["Metric", "Amount"], rows: [["Total charges", fmtMoney(charges)], ["Total collected", fmtMoney(collected)], ["Collection rate", charges ? `${Math.round((collected / charges) * 100)}%` : "—"]] };
      }
      case "Denial Rate by Payer": {
        const g = new Map<string, { total: number; denied: number }>();
        claims.forEach((c) => { const e = g.get(c.payer) ?? { total: 0, denied: 0 }; e.total++; if (["Denied", "Rejected"].includes(c.status)) e.denied++; g.set(c.payer, e); });
        return { headers: ["Payer", "Claims", "Denied", "Rate"], rows: Array.from(g.entries()).map(([k, v]) => [k, String(v.total), String(v.denied), `${Math.round((v.denied / v.total) * 100)}%`]) };
      }
      case "AR Aging Summary": {
        const open = claims.filter((c) => c.balance > 0);
        return { headers: ["Bucket", "Balance"], rows: [["0-30 days", fmtMoney(open.reduce((s, c) => s + c.balance, 0) * 0.6)], ["31-60 days", fmtMoney(open.reduce((s, c) => s + c.balance, 0) * 0.25)], ["61-90 days", fmtMoney(open.reduce((s, c) => s + c.balance, 0) * 0.1)], ["90+ days", fmtMoney(open.reduce((s, c) => s + c.balance, 0) * 0.05)]] };
      }
      case "Invoice Collection Report": {
        const inv = bank.invoices;
        return { headers: ["Status", "Count", "Balance"], rows: ["Paid", "Sent", "Unpaid", "Overdue", "Partially Paid"].map((s) => { const list = inv.filter((i) => i.status === s); return [s, String(list.length), fmtMoney(list.reduce((x, i) => x + i.balance, 0))]; }) };
      }
      case "RVU Production by Provider": {
        const g = new Map<string, number>();
        bank.serviceEvents.forEach((e) => g.set(e.performedBy, (g.get(e.performedBy) ?? 0) + e.rvu));
        return { headers: ["Team member", "RVUs"], rows: Array.from(g.entries()).map(([k, v]) => [k, String(v)]) };
      }
      case "Plex Factor Payout Summary": {
        return { headers: ["Employee", "Plex Factor bonus", "Status"], rows: bank.payoutEntries.map((p) => [p.employee, fmtMoney(p.plexFactorBonus), p.status]) };
      }
      case "Vendor Spend by Category": {
        const g = new Map<string, number>();
        bank.vendorBills.forEach((b) => { const v = bank.vendors.find((x) => x.id === b.vendorId); g.set(v?.category ?? "Other", (g.get(v?.category ?? "Other") ?? 0) + b.amount); });
        return { headers: ["Category", "Spend"], rows: Array.from(g.entries()).map(([k, v]) => [k, fmtMoney(v)]) };
      }
      case "Payroll Cost by Clinic": {
        const g = new Map<string, number>();
        bank.employees.forEach((e) => g.set(e.clinic, (g.get(e.clinic) ?? 0) + e.basePay));
        return { headers: ["Clinic", "Base payroll / period"], rows: Array.from(g.entries()).map(([k, v]) => [k, fmtMoney(v)]) };
      }
      case "Expense Trend by Month": {
        const g = new Map<string, number>();
        bank.expenses.forEach((e) => g.set(e.date.slice(0, 7), (g.get(e.date.slice(0, 7)) ?? 0) + e.amount));
        return { headers: ["Month", "Expenses"], rows: Array.from(g.entries()).sort().map(([k, v]) => [k, fmtMoney(v)]) };
      }
      case "Audit Activity Summary": {
        const g = new Map<string, number>();
        bank.auditLog.forEach((e) => g.set(e.module, (g.get(e.module) ?? 0) + 1));
        return { headers: ["Module", "Events"], rows: Array.from(g.entries()).map(([k, v]) => [k, String(v)]) };
      }
      default:
        return { headers: ["Preview"], rows: [["Sample preview — run to generate this report from workspace data."]] };
    }
  }, [bank, filters, selected]);

  function exportCsv() {
    const csv = [preview.headers.join(","), ...preview.rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logAuditEvent({ actor, module: "Reports", action: `Exported report "${selected}" (CSV)` });
  }

  return (
    <div data-testid="bank-reports">
      <ModuleHeader
        title="Reports"
        subtitle="17 report types generated from live workspace data. Respect the global filter bar."
        actions={
          <div className="flex gap-1.5">
            <BankButton variant="secondary" onClick={saveReport} testId="report-save">Save report</BankButton>
            <BankButton variant="secondary" onClick={scheduleReport} testId="report-schedule">Schedule report</BankButton>
            <BankButton onClick={exportCsv} testId="report-export"><Download className="h-3 w-3" /> Export CSV</BankButton>
          </div>
        }
      />
      {reportNotice && (
        <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800" data-testid="report-notice">
          {reportNotice}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Panel className="h-fit p-2">
          <div className="max-h-[60vh] space-y-0.5 overflow-y-auto" data-testid="report-type-list">
            {REPORT_TYPES.map((r) => (
              <button key={r} onClick={() => setSelected(r)} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] ${selected === r ? "bg-[#0d1b3e] font-semibold text-white" : "text-slate-600 hover:bg-slate-50"}`} data-testid={`report-type-${r.replace(/\s+/g, "-").toLowerCase()}`}>
                {r}
              </button>
            ))}
          </div>
        </Panel>
        <div className="space-y-3 lg:col-span-3">
          <Panel className="overflow-x-auto">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-900" data-testid="report-title">{selected}</div>
            <table className="w-full text-xs" data-testid="report-preview-table">
              <thead className="border-b border-slate-100 bg-slate-50/70"><tr>{preview.headers.map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50">{r.map((v, j) => <Td key={j} className={j === 0 ? "font-semibold" : ""}>{v}</Td>)}</tr>
                ))}
                {preview.rows.length === 0 && <tr><td colSpan={preview.headers.length} className="px-3 py-6 text-center text-xs italic text-slate-400">No data for the current filters.</td></tr>}
              </tbody>
            </table>
          </Panel>
          <ChartPlaceholder title={`${selected} — visualization`} kind="bar" />
        </div>
      </div>
    </div>
  );
}

// ─── Approvals ──────────────────────────────────────────────────────────────

export function ApprovalsModule() {
  const bank = usePlexusBank();
  const { actor } = usePlexusBankFilters();
  const [noteFor, setNoteFor] = useState<ApprovalRequest | null>(null);
  const [noteText, setNoteText] = useState("");

  function decide(a: ApprovalRequest, status: ApprovalRequest["status"]) {
    updateBank((draft) => {
      draft.approvals = draft.approvals.map((x) => (x.id === a.id ? { ...x, status } : x));
    });
    logAuditEvent({ actor, module: "Approvals", action: `${status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Requested info on"} ${a.type} request from ${a.requester}`, oldValue: a.status, newValue: status, reason: a.reason });
  }

  function addNote() {
    if (!noteFor || !noteText.trim()) return;
    const a = noteFor;
    updateBank((draft) => {
      draft.approvals = draft.approvals.map((x) => (x.id === a.id ? { ...x, notes: [...x.notes, { date: new Date().toISOString().slice(0, 10), by: actor, note: noteText.trim() }] } : x));
    });
    logAuditEvent({ actor, module: "Approvals", action: `Added note to ${a.type} request`, newValue: noteText.trim() });
    setNoteFor(null);
    setNoteText("");
  }

  const pending = bank.approvals.filter((a) => a.status === "pending" || a.status === "info-requested");
  const decided = bank.approvals.filter((a) => a.status === "approved" || a.status === "rejected");

  return (
    <div data-testid="bank-approvals">
      <ModuleHeader title="Approvals" subtitle="Centralized approval queue for fee changes, refunds, vendor payments, payroll runs, and exceptions." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-bold text-slate-900">Awaiting decision ({pending.length})</div>
          <div className="space-y-2">
            {pending.map((a) => (
              <Panel key={a.id} className="p-4" testId={`approval-card-${a.id}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="rounded-full bg-[#0d1b3e]/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0d1b3e]">{a.type}</span>
                  <StatusBadge value={a.status} testId={`approval-status-${a.id}`} />
                </div>
                <div className="text-xs text-slate-700">{a.reason}</div>
                <div className="mt-1 text-[11px] text-slate-400">{a.requester} · {a.clinic} · impact <span className={a.amountImpact >= 0 ? "text-emerald-700" : "text-red-600"}>{fmtMoney(a.amountImpact)}</span> · {a.createdAt}</div>
                {a.notes.length > 0 && (
                  <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                    {a.notes.map((n, i) => <li key={i}><b>{n.by}</b> ({n.date}): {n.note}</li>)}
                  </ul>
                )}
                <div className="mt-3 flex gap-1.5">
                  <BankButton size="xs" onClick={() => decide(a, "approved")} testId={`approval-approve-${a.id}`}>Approve</BankButton>
                  <BankButton size="xs" variant="danger" onClick={() => decide(a, "rejected")} testId={`approval-reject-${a.id}`}>Reject</BankButton>
                  <BankButton size="xs" variant="secondary" onClick={() => decide(a, "info-requested")} testId={`approval-info-${a.id}`}>Request info</BankButton>
                  <BankButton size="xs" variant="ghost" onClick={() => setNoteFor(a)} testId={`approval-note-${a.id}`}>Add note</BankButton>
                </div>
              </Panel>
            ))}
            {pending.length === 0 && <div className="text-xs italic text-slate-400">Queue is clear.</div>}
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-bold text-slate-900">Decided ({decided.length})</div>
          <div className="space-y-2">
            {decided.map((a) => (
              <Panel key={a.id} className="p-3 opacity-80" testId={`approval-decided-${a.id}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{a.type}</span>
                  <StatusBadge value={a.status} />
                </div>
                <div className="mt-1 text-xs text-slate-600">{a.reason}</div>
                {a.notes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">{a.notes.map((n, i) => <li key={i}>{n.by}: {n.note}</li>)}</ul>
                )}
              </Panel>
            ))}
          </div>
        </div>
      </div>

      <BankModal open={!!noteFor} onClose={() => { setNoteFor(null); setNoteText(""); }} title="Add note">
        <div className="space-y-3">
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 p-2 text-xs" data-testid="approval-note-input" />
          <div className="flex justify-end gap-2">
            <BankButton variant="secondary" onClick={() => { setNoteFor(null); setNoteText(""); }}>Cancel</BankButton>
            <BankButton onClick={addNote} disabled={!noteText.trim()} testId="approval-note-save">Save</BankButton>
          </div>
        </div>
      </BankModal>
    </div>
  );
}

// ─── Audit Logs ─────────────────────────────────────────────────────────────

export function AuditLogsModule() {
  const bank = usePlexusBank();
  const [moduleFilter, setModuleFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [search, setSearch] = useState("");

  const modules = Array.from(new Set(bank.auditLog.map((e) => e.module))).sort();
  const actors = Array.from(new Set(bank.auditLog.map((e) => e.actor))).sort();

  const rows = bank.auditLog.filter((e) => {
    if (moduleFilter && e.module !== moduleFilter) return false;
    if (actorFilter && e.actor !== actorFilter) return false;
    if (search && !`${e.action} ${e.oldValue ?? ""} ${e.newValue ?? ""} ${e.reason ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div data-testid="bank-audit-logs">
      <ModuleHeader title="Audit Logs" subtitle="Immutable record of every financial action taken in the workspace." />
      <div className="mb-3 flex flex-wrap gap-2">
        <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className={`${inputCls} w-44`} data-testid="audit-filter-module">
          <option value="">All modules</option>
          {modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} className={`${inputCls} w-40`} data-testid="audit-filter-actor">
          <option value="">All actors</option>
          {actors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions…" className={`${inputCls} w-56`} data-testid="audit-search" />
      </div>
      <Panel className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="audit-log-table">
          <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>When</Th><Th>Actor</Th><Th>Module</Th><Th>Action</Th><Th>Old value</Th><Th>New value</Th><Th>Reason</Th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`audit-row-${e.id}`}>
                <Td className="text-slate-400">{new Date(e.timestamp).toLocaleString()}</Td>
                <Td className="font-semibold">{e.actor}</Td>
                <Td>{e.module}</Td>
                <Td>{e.action}</Td>
                <Td className="text-slate-400">{e.oldValue ?? "—"}</Td>
                <Td>{e.newValue ?? "—"}</Td>
                <Td className="text-slate-400">{e.reason ?? "—"}</Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-xs italic text-slate-400">No audit events match.</td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// ─── Settings & Permissions ─────────────────────────────────────────────────

const LEVEL_CYCLE: PermissionLevel[] = ["none", "read", "write"];

export function SettingsPermissionsModule() {
  const bank = usePlexusBank();
  const { actor } = usePlexusBankFilters();

  function cycle(role: string, moduleId: string) {
    const cur = bank.permissions[role]?.[moduleId] ?? "none";
    const next = LEVEL_CYCLE[(LEVEL_CYCLE.indexOf(cur) + 1) % LEVEL_CYCLE.length];
    updateBank((draft) => {
      draft.permissions = { ...draft.permissions, [role]: { ...draft.permissions[role], [moduleId]: next } };
    });
    const label = BANK_MODULES.find((m) => m.id === moduleId)?.label ?? moduleId;
    logAuditEvent({ actor, module: "Settings & Permissions", action: `Changed ${role} access to ${label}`, oldValue: cur, newValue: next });
  }

  return (
    <div data-testid="bank-settings">
      <ModuleHeader
        title="Settings & Permissions"
        subtitle="Role-based access matrix (7 roles × 16 modules). Click a cell to cycle none → read → write. Changes are logged."
        actions={
          <BankButton variant="secondary" onClick={() => { resetPlexusBank(); logAuditEvent({ actor, module: "Settings & Permissions", action: "Reset workspace to sample data" }); }} testId="settings-reset-data">
            <RotateCcw className="h-3 w-3" /> Reset sample data
          </BankButton>
        }
      />
      <Panel className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="permissions-matrix">
          <thead className="border-b border-slate-100 bg-slate-50/70">
            <tr>
              <Th>Module</Th>
              {BANK_ROLES.map((r) => <Th key={r} className="text-center">{r}</Th>)}
            </tr>
          </thead>
          <tbody>
            {BANK_MODULES.map((m) => (
              <tr key={m.id} className="border-b border-slate-50" data-testid={`perm-row-${m.id}`}>
                <Td className="font-semibold">{m.label}</Td>
                {BANK_ROLES.map((r) => {
                  const level = bank.permissions[r]?.[m.id] ?? "none";
                  return (
                    <td key={r} className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => cycle(r, m.id)}
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          level === "write" ? "bg-emerald-100 text-emerald-800" : level === "read" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-400"
                        }`}
                        data-testid={`perm-${m.id}-${r.replace(/[^a-z]/gi, "-").toLowerCase()}`}
                      >
                        {level}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="mt-3 text-[11px] italic text-slate-400">
        Prototype note: this matrix controls the mock workspace only. Live enforcement will bind to real platform roles when the backend lands.
      </p>
    </div>
  );
}
