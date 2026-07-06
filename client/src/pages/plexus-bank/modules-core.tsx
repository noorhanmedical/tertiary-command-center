// Plexus Bank core modules: Dashboard, Billing Center, Billing Auditor,
// Invoicing Center, Team Invoice Desk Monitor. Mock data + localStorage only.

import { useMemo, useState } from "react";
import { AlertTriangle, Flag, Plus, Send, RefreshCw, Ban, CalendarClock, Eye } from "lucide-react";
import {
  usePlexusBank, updateBank, logAuditEvent, bankId, fmtMoney,
  NETWORK_STATUS_OPTIONS, CLAIM_STATUS_OPTIONS, BANK_CLINICS, CLINIC_REGION,
  BANK_SERVICES,
  type BankClaim, type BankInvoice,
} from "./mockData";
import { usePlexusBankFilters, matchesFilters } from "@/pages/plexus-bank";
import {
  ModuleHeader, Panel, StatCard, StatusBadge, BankButton, BankDrawer,
  BankModal, Field, inputCls, Th, Td, ChartPlaceholder,
} from "./ui";

// ─── Dashboard ──────────────────────────────────────────────────────────────

export function DashboardModule() {
  const bank = usePlexusBank();
  const { filters } = usePlexusBankFilters();

  const claims = bank.claims.filter((c) => matchesFilters(filters, { clinic: c.clinic, region: c.region, state: c.state, provider: c.provider, payer: c.payer, date: c.dateOfService }));
  const invoices = bank.invoices.filter((i) => matchesFilters(filters, { clinic: i.clinic, region: i.region, date: i.issuedDate }));

  const grossRevenue = claims.reduce((s, c) => s + c.charge, 0);
  const collections = claims.reduce((s, c) => s + c.paid, 0) + invoices.reduce((s, i) => s + i.payments.filter((p) => p.status === "succeeded").reduce((x, p) => x + p.amount, 0), 0);
  const ar = claims.reduce((s, c) => s + c.balance, 0);
  const pendingInvoices = invoices.filter((i) => ["Sent", "Unpaid", "Overdue", "Partially Paid"].includes(i.status));
  const pendingInvoiceTotal = pendingInvoices.reduce((s, i) => s + i.balance, 0);
  const payrollDue = bank.payoutEntries.filter((p) => p.status !== "paid").reduce((s, p) => s + p.totalAmount, 0) + bank.employees.reduce((s, e) => s + e.basePay, 0);
  const rvuDue = bank.payoutEntries.filter((p) => p.status !== "paid").reduce((s, p) => s + p.baseAmount, 0);
  const plexDue = bank.payoutEntries.filter((p) => p.status !== "paid").reduce((s, p) => s + p.plexFactorBonus, 0);
  const expensesTotal = bank.expenses.filter((e) => matchesFilters(filters, { clinic: e.clinic, date: e.date })).reduce((s, e) => s + e.amount, 0);
  const vendorOpen = bank.vendorBills.filter((b) => b.status !== "paid").reduce((s, b) => s + b.amount, 0);
  const denied = claims.filter((c) => ["Denied", "Rejected"].includes(c.status));
  const redFlags = claims.filter((c) => c.readinessScore === "red" || c.flaggedForAudit);
  const overdueInvoices = invoices.filter((i) => i.status === "Overdue");
  const approvalsPending = bank.approvals.filter((a) => a.status === "pending").length;
  const profit = collections - expensesTotal - payrollDue * 0.5;

  return (
    <div className="space-y-4" data-testid="bank-dashboard">
      <ModuleHeader title="Dashboard" subtitle="Financial command center — all figures reflect the global filter bar." />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Gross Revenue" value={fmtMoney(grossRevenue)} tone="navy" testId="kpi-gross-revenue" />
        <StatCard label="Collections" value={fmtMoney(collections)} tone="green" testId="kpi-collections" />
        <StatCard label="Accounts Receivable" value={fmtMoney(ar)} tone="amber" testId="kpi-ar" />
        <StatCard label="Pending Invoices" value={String(pendingInvoices.length)} hint={fmtMoney(pendingInvoiceTotal)} tone="amber" testId="kpi-pending-invoices" />
        <StatCard label="Payroll Due" value={fmtMoney(payrollDue)} tone="navy" testId="kpi-payroll-due" />
        <StatCard label="RVU Payout Due" value={fmtMoney(rvuDue)} tone="violet" testId="kpi-rvu-due" />
        <StatCard label="Plex Factor Due" value={fmtMoney(plexDue)} tone="violet" testId="kpi-plex-due" />
        <StatCard label="Expenses (period)" value={fmtMoney(expensesTotal)} tone="red" testId="kpi-expenses" />
        <StatCard label="Vendor Bills Open" value={fmtMoney(vendorOpen)} tone="amber" testId="kpi-vendor-open" />
        <StatCard label="Denied Claims" value={String(denied.length)} tone="red" testId="kpi-denied" />
        <StatCard label="Overdue Invoices" value={String(overdueInvoices.length)} tone="red" testId="kpi-overdue-invoices" />
        <StatCard label="Approvals Pending" value={String(approvalsPending)} tone="amber" testId="kpi-approvals" />
        <StatCard label="Clinic Profitability" value={fmtMoney(profit)} hint="est. net after payroll share" tone={profit >= 0 ? "green" : "red"} testId="kpi-profit" />
        <StatCard label="Region Profitability" value={fmtMoney(profit * 0.94)} hint="after regional overhead" tone={profit >= 0 ? "green" : "red"} testId="kpi-region-profit" />
        <StatCard label="Cash Position" value="Connect banking" hint="placeholder — no live bank feed" tone="navy" testId="kpi-cash" />
        <StatCard label="Claims in Flight" value={String(claims.filter((c) => ["Submitted", "Pending", "Accepted"].includes(c.status)).length)} tone="navy" testId="kpi-claims-inflight" />
        <StatCard label="Audit Flags" value={String(redFlags.length)} tone="red" testId="kpi-audit-flags" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ChartPlaceholder title="Revenue by Month" kind="bar" />
        <ChartPlaceholder title="Collections Trend" kind="line" />
        <ChartPlaceholder title="Payer Mix" kind="donut" />
        <ChartPlaceholder title="AR Aging Buckets" kind="bar" />
        <ChartPlaceholder title="Denial Rate by Payer" kind="bar" />
        <ChartPlaceholder title="RVU Production" kind="line" />
        <ChartPlaceholder title="Plex Factor Activations" kind="bar" />
        <ChartPlaceholder title="Expense Categories" kind="donut" />
        <ChartPlaceholder title="Clinic Profitability" kind="bar" />
        <ChartPlaceholder title="Invoice Collection Rate" kind="line" />
        <ChartPlaceholder title="Vendor Spend Trend" kind="line" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel className="p-4" testId="dashboard-urgent-alerts">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-900">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Urgent Alerts
          </div>
          <ul className="space-y-1.5 text-xs text-slate-600">
            {overdueInvoices.map((i) => (
              <li key={i.id} className="flex items-center gap-2"><StatusBadge value="Overdue" /> Invoice {i.number} — {i.patient} — {fmtMoney(i.balance)} past due</li>
            ))}
            {denied.map((c) => (
              <li key={c.id} className="flex items-center gap-2"><StatusBadge value="Denied" /> Claim {c.id} — {c.patient} — {c.service}</li>
            ))}
            {bank.vendorBills.filter((b) => b.status === "pending-approval" && b.dueDate < new Date().toISOString().slice(0, 10)).map((b) => (
              <li key={b.id} className="flex items-center gap-2"><StatusBadge value="Overdue" /> Vendor bill {b.invoiceNumber} ({b.vendor}) awaiting approval past due date</li>
            ))}
            {overdueInvoices.length === 0 && denied.length === 0 && <li className="italic text-slate-400">No urgent alerts for the current filters.</li>}
          </ul>
        </Panel>
        <Panel className="p-4" testId="dashboard-red-flags">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-900">
            <Flag className="h-4 w-4 text-red-500" /> Billing Red Flags
          </div>
          <ul className="space-y-1.5 text-xs text-slate-600">
            {redFlags.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <StatusBadge value={c.readinessScore === "red" ? "Red" : "Flagged"} />
                {c.patient} — {c.service} — {c.readinessReasons.join("; ")}
              </li>
            ))}
            {redFlags.length === 0 && <li className="italic text-slate-400">No red-flagged claims for the current filters.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

// ─── Billing Center ─────────────────────────────────────────────────────────

type ClaimSortKey = "patient" | "service" | "clinic" | "payer" | "dateOfService" | "charge" | "balance" | "status";

export function BillingCenterModule() {
  const bank = usePlexusBank();
  const { filters, actor } = usePlexusBankFilters();
  const [sortKey, setSortKey] = useState<ClaimSortKey>("dateOfService");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [viewClaim, setViewClaim] = useState<BankClaim | null>(null);
  const [noteFor, setNoteFor] = useState<BankClaim | null>(null);
  const [noteText, setNoteText] = useState("");

  const rows = useMemo(() => {
    const filtered = bank.claims.filter((c) => matchesFilters(filters, { clinic: c.clinic, region: c.region, state: c.state, provider: c.provider, payer: c.payer, status: c.status, date: c.dateOfService }));
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return cmp * sortDir;
    });
  }, [bank.claims, filters, sortKey, sortDir]);

  function sortBy(key: ClaimSortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  }

  function setClaimStatus(claim: BankClaim, status: string) {
    updateBank((draft) => {
      draft.claims = draft.claims.map((c) => (c.id === claim.id ? { ...c, status } : c));
    });
    logAuditEvent({ actor, module: "Billing Center", action: `Updated claim ${claim.id} status`, oldValue: claim.status, newValue: status });
  }

  function toggleFlag(claim: BankClaim) {
    updateBank((draft) => {
      draft.claims = draft.claims.map((c) => (c.id === claim.id ? { ...c, flaggedForAudit: !c.flaggedForAudit } : c));
    });
    logAuditEvent({ actor, module: "Billing Center", action: `${claim.flaggedForAudit ? "Unflagged" : "Flagged"} claim ${claim.id} for audit`, oldValue: String(claim.flaggedForAudit), newValue: String(!claim.flaggedForAudit) });
  }

  function sendToAuditor(claim: BankClaim) {
    updateBank((draft) => {
      draft.claims = draft.claims.map((c) => (c.id === claim.id ? { ...c, sentToAuditor: true } : c));
    });
    logAuditEvent({ actor, module: "Billing Center", action: `Sent claim ${claim.id} to Billing Auditor`, reason: "Manual referral" });
  }

  function createFollowUpTask(claim: BankClaim) {
    logAuditEvent({ actor, module: "Billing Center", action: `Created follow-up task for claim ${claim.id}`, newValue: `Follow up on ${claim.patient} · ${claim.service}`, reason: "Billing follow-up (mock task entry)" });
  }

  function addNote() {
    if (!noteFor || !noteText.trim()) return;
    const claim = noteFor;
    updateBank((draft) => {
      draft.claims = draft.claims.map((c) => (c.id === claim.id ? { ...c, notes: [...c.notes, noteText.trim()] } : c));
    });
    logAuditEvent({ actor, module: "Billing Center", action: `Added note to claim ${claim.id}`, newValue: noteText.trim() });
    setNoteFor(null);
    setNoteText("");
  }

  return (
    <div data-testid="bank-billing-center">
      <ModuleHeader title="Billing Center" subtitle="All claims across clinics. Row actions: view, status, notes, audit flag, auditor referral, ready/hold." />
      <Panel className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="billing-claims-table">
          <thead className="border-b border-slate-100 bg-slate-50/70">
            <tr>
              <Th onClick={() => sortBy("patient")}>Patient</Th>
              <Th>MRN</Th>
              <Th onClick={() => sortBy("service")}>Service / CPT</Th>
              <Th onClick={() => sortBy("clinic")}>Clinic</Th>
              <Th>Provider</Th>
              <Th onClick={() => sortBy("payer")}>Payer</Th>
              <Th onClick={() => sortBy("dateOfService")}>DOS</Th>
              <Th onClick={() => sortBy("charge")}>Charge</Th>
              <Th>Allowed</Th>
              <Th>Paid</Th>
              <Th onClick={() => sortBy("balance")}>Balance</Th>
              <Th onClick={() => sortBy("status")}>Status</Th>
              <Th>Readiness</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`claim-row-${c.id}`}>
                <Td className="font-semibold">{c.patient}{c.flaggedForAudit && <Flag className="ml-1 inline h-3 w-3 text-red-500" />}</Td>
                <Td className="text-slate-400">{c.mrn}</Td>
                <Td>{c.service} <span className="text-slate-400">({c.cpt})</span></Td>
                <Td>{c.clinic}</Td>
                <Td>{c.provider}</Td>
                <Td>{c.payer}</Td>
                <Td>{c.dateOfService}</Td>
                <Td>{fmtMoney(c.charge)}</Td>
                <Td>{c.allowed ? fmtMoney(c.allowed) : "—"}</Td>
                <Td className="text-emerald-700">{c.paid ? fmtMoney(c.paid) : "—"}</Td>
                <Td className={c.balance > 0 ? "font-semibold text-amber-700" : ""}>{fmtMoney(c.balance)}</Td>
                <Td>
                  <select
                    value={c.status}
                    onChange={(e) => setClaimStatus(c, e.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-1 py-0.5 text-[10px]"
                    data-testid={`claim-status-${c.id}`}
                  >
                    {CLAIM_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Td>
                <Td><StatusBadge value={c.readinessScore} /></Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <BankButton size="xs" variant="secondary" onClick={() => setViewClaim(c)} testId={`claim-view-${c.id}`}><Eye className="h-3 w-3" /> View</BankButton>
                    <BankButton size="xs" variant="secondary" onClick={() => setNoteFor(c)} testId={`claim-note-${c.id}`}>Note</BankButton>
                    <BankButton size="xs" variant={c.flaggedForAudit ? "danger" : "secondary"} onClick={() => toggleFlag(c)} testId={`claim-flag-${c.id}`}>{c.flaggedForAudit ? "Unflag" : "Flag"}</BankButton>
                    <BankButton size="xs" variant="secondary" disabled={c.sentToAuditor} onClick={() => sendToAuditor(c)} testId={`claim-auditor-${c.id}`}>{c.sentToAuditor ? "With auditor" : "To auditor"}</BankButton>
                    <BankButton size="xs" variant="secondary" onClick={() => setClaimStatus(c, c.status === "On Hold" ? "Ready" : "On Hold")} testId={`claim-hold-${c.id}`}>{c.status === "On Hold" ? "Mark ready" : "Hold"}</BankButton>
                    <BankButton size="xs" variant="ghost" onClick={() => createFollowUpTask(c)} testId={`claim-task-${c.id}`}><CalendarClock className="h-3 w-3" /> Task</BankButton>
                  </div>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={14} className="px-3 py-8 text-center text-xs italic text-slate-400">No claims match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      <BankDrawer open={!!viewClaim} onClose={() => setViewClaim(null)} title={viewClaim ? `Claim ${viewClaim.id} — ${viewClaim.patient}` : ""}>
        {viewClaim && (
          <div className="space-y-3 text-xs text-slate-700">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-slate-400">Service:</span> {viewClaim.service} ({viewClaim.cpt})</div>
              <div><span className="text-slate-400">DOS:</span> {viewClaim.dateOfService}</div>
              <div><span className="text-slate-400">Clinic:</span> {viewClaim.clinic}</div>
              <div><span className="text-slate-400">Provider:</span> {viewClaim.provider}</div>
              <div><span className="text-slate-400">Payer:</span> {viewClaim.payer}</div>
              <div><span className="text-slate-400">Status:</span> <StatusBadge value={viewClaim.status} /></div>
              <div><span className="text-slate-400">Charge:</span> {fmtMoney(viewClaim.charge)}</div>
              <div><span className="text-slate-400">Balance:</span> {fmtMoney(viewClaim.balance)}</div>
            </div>
            <div>
              <div className="mb-1 font-semibold text-slate-900">Readiness</div>
              <div className="flex items-center gap-2"><StatusBadge value={viewClaim.readinessScore} /><span>{viewClaim.readinessReasons.join(" · ")}</span></div>
            </div>
            <div>
              <div className="mb-1 font-semibold text-slate-900">EOB / ERA</div>
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-center italic text-slate-400">
                EOB/ERA viewer placeholder — remittance documents attach here when a clearinghouse is connected.
              </div>
            </div>
            <div>
              <div className="mb-1 font-semibold text-slate-900">Notes</div>
              {viewClaim.notes.length === 0 ? <div className="italic text-slate-400">No notes yet.</div> : (
                <ul className="list-inside list-disc space-y-1">{viewClaim.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              )}
            </div>
          </div>
        )}
      </BankDrawer>

      <BankModal open={!!noteFor} onClose={() => { setNoteFor(null); setNoteText(""); }} title={noteFor ? `Add note — ${noteFor.patient}` : ""}>
        <div className="space-y-3">
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 p-2 text-xs" placeholder="Billing note…" data-testid="claim-note-input" />
          <div className="flex justify-end gap-2">
            <BankButton variant="secondary" onClick={() => { setNoteFor(null); setNoteText(""); }}>Cancel</BankButton>
            <BankButton onClick={addNote} disabled={!noteText.trim()} testId="claim-note-save">Save note</BankButton>
          </div>
        </div>
      </BankModal>
    </div>
  );
}

// ─── Billing Auditor ────────────────────────────────────────────────────────

export function BillingAuditorModule() {
  const bank = usePlexusBank();
  const { filters, actor } = usePlexusBankFilters();
  const [tab, setTab] = useState<"matrix" | "readiness">("matrix");

  const matrixRows = bank.networkMatrix.filter((r) => matchesFilters(filters, { clinic: r.facility, provider: r.provider, payer: r.payer }));
  const claims = bank.claims.filter((c) => (c.sentToAuditor || c.flaggedForAudit || c.readinessScore !== "green") && matchesFilters(filters, { clinic: c.clinic, payer: c.payer, provider: c.provider, date: c.dateOfService }));

  function setNetworkStatus(id: string, status: string) {
    const row = bank.networkMatrix.find((r) => r.id === id);
    updateBank((draft) => {
      draft.networkMatrix = draft.networkMatrix.map((r) => (r.id === id ? { ...r, networkStatus: status } : r));
    });
    logAuditEvent({ actor, module: "Billing Auditor", action: `Updated network status for ${row?.payer} / ${row?.provider} / ${row?.facility}`, oldValue: row?.networkStatus ?? null, newValue: status });
  }

  function auditorAction(claim: BankClaim, action: string, statusChange?: string) {
    if (statusChange) {
      updateBank((draft) => {
        draft.claims = draft.claims.map((c) => (c.id === claim.id ? { ...c, status: statusChange } : c));
      });
    }
    logAuditEvent({ actor, module: "Billing Auditor", action: `${action} — claim ${claim.id} (${claim.patient})`, oldValue: statusChange ? claim.status : null, newValue: statusChange ?? null });
  }

  return (
    <div data-testid="bank-billing-auditor">
      <ModuleHeader title="Billing Auditor" subtitle="Network credentialing matrix and claim readiness review. AI-assisted claim analysis coming soon (placeholder)." />
      <div className="mb-3 flex gap-1">
        <BankButton variant={tab === "matrix" ? "primary" : "secondary"} onClick={() => setTab("matrix")} testId="auditor-tab-matrix">Network Matrix</BankButton>
        <BankButton variant={tab === "readiness" ? "primary" : "secondary"} onClick={() => setTab("readiness")} testId="auditor-tab-readiness">Claim Readiness</BankButton>
      </div>

      {tab === "matrix" && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="network-matrix-table">
            <thead className="border-b border-slate-100 bg-slate-50/70">
              <tr>
                <Th>Payer</Th><Th>Provider</Th><Th>Facility</Th><Th>NPI</Th><Th>TIN</Th><Th>Network Status</Th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`matrix-row-${r.id}`}>
                  <Td className="font-semibold">{r.payer}</Td>
                  <Td>{r.provider}</Td>
                  <Td>{r.facility}</Td>
                  <Td className="font-mono text-[10px] text-slate-400">{r.npi}</Td>
                  <Td className="font-mono text-[10px] text-slate-400">{r.tin}</Td>
                  <Td>
                    <select value={r.networkStatus} onChange={(e) => setNetworkStatus(r.id, e.target.value)} className="rounded-md border border-slate-200 bg-white px-1 py-0.5 text-[10px]" data-testid={`matrix-status-${r.id}`}>
                      {NETWORK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className="ml-2"><StatusBadge value={r.networkStatus} /></span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "readiness" && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {claims.map((c) => (
            <Panel key={c.id} className="p-4" testId={`readiness-card-${c.id}`}>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900">{c.patient} <span className="font-normal text-slate-400">· {c.service}</span></div>
                <StatusBadge value={c.readinessScore === "green" ? "Green — ready" : c.readinessScore === "yellow" ? "Yellow — review" : "Red — blocked"} testId={`readiness-score-${c.id}`} />
              </div>
              <div className="mb-2 text-[11px] text-slate-500">{c.clinic} · {c.payer} · DOS {c.dateOfService} · {fmtMoney(c.charge)}</div>
              <div className="mb-3 flex flex-wrap gap-1">
                {c.readinessReasons.map((r, i) => (
                  <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{r}</span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <BankButton size="xs" onClick={() => auditorAction(c, "Approved claim for submission", "Ready")} testId={`auditor-approve-${c.id}`}>Approve</BankButton>
                <BankButton size="xs" variant="secondary" onClick={() => auditorAction(c, "Placed claim on hold", "On Hold")} testId={`auditor-hold-${c.id}`}>Hold</BankButton>
                <BankButton size="xs" variant="secondary" onClick={() => auditorAction(c, "Requested eligibility verification")} testId={`auditor-verify-${c.id}`}>Request verification</BankButton>
                <BankButton size="xs" variant="secondary" onClick={() => auditorAction(c, "Upload placeholder — supporting doc slot reserved")} testId={`auditor-upload-${c.id}`}>Upload doc</BankButton>
                <BankButton size="xs" variant="secondary" onClick={() => auditorAction(c, "Added auditor note")} testId={`auditor-note-${c.id}`}>Add note</BankButton>
                <BankButton size="xs" variant="secondary" onClick={() => auditorAction(c, "Created issue for billing team")} testId={`auditor-issue-${c.id}`}>Create issue</BankButton>
                <BankButton size="xs" variant="danger" onClick={() => auditorAction(c, "Sent claim back to Billing Center", "Not Billed")} testId={`auditor-sendback-${c.id}`}>Send back</BankButton>
              </div>
            </Panel>
          ))}
          {claims.length === 0 && <div className="text-xs italic text-slate-400">No claims in the auditor queue for the current filters.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Invoicing Center ───────────────────────────────────────────────────────

type InvoiceTab = "all" | "paid" | "unpaid" | "overdue" | "batches";

export function InvoicingCenterModule() {
  const bank = usePlexusBank();
  const { filters, actor } = usePlexusBankFilters();
  const [tab, setTab] = useState<InvoiceTab>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [planFor, setPlanFor] = useState<BankInvoice | null>(null);
  const [detail, setDetail] = useState<BankInvoice | null>(null);
  const [form, setForm] = useState({ patient: "", email: "", clinic: BANK_CLINICS[0] as string, service: BANK_SERVICES[0].service, amount: "", dueDate: "" });
  const [plan, setPlan] = useState({ installments: "3", firstDueDate: "" });

  const detailLive = detail ? bank.invoices.find((i) => i.id === detail.id) ?? null : null;

  const list = bank.invoices
    .filter((i) => matchesFilters(filters, { clinic: i.clinic, region: i.region, date: i.issuedDate }))
    .filter((i) => {
      if (tab === "paid") return i.status === "Paid";
      if (tab === "unpaid") return ["Unpaid", "Sent", "Partially Paid", "Draft"].includes(i.status);
      if (tab === "overdue") return i.status === "Overdue";
      if (tab === "batches") return !!i.batchId;
      return true;
    });

  function createInvoice() {
    const amount = parseFloat(form.amount);
    if (!form.patient.trim() || !amount || !form.dueDate) return;
    const number = `PB-${1048 + bank.invoices.length}`;
    updateBank((draft) => {
      draft.invoices = [
        {
          id: bankId("inv"), number, patient: form.patient.trim(), patientEmail: form.email.trim() || "unknown@example.com",
          clinic: form.clinic, region: CLINIC_REGION[form.clinic] ?? "", service: form.service, amount, balance: amount,
          status: "Draft", issuedDate: new Date().toISOString().slice(0, 10), dueDate: form.dueDate, sentBy: actor,
          source: "bank", paymentLink: null, resendHistory: [], payments: [], adjustments: [], contactNotes: [], paymentPlan: null, batchId: null,
        },
        ...draft.invoices,
      ];
    });
    logAuditEvent({ actor, module: "Invoicing Center", action: `Created invoice ${number}`, newValue: `${form.patient} · ${fmtMoney(amount)}` });
    setCreateOpen(false);
    setForm({ patient: "", email: "", clinic: BANK_CLINICS[0], service: BANK_SERVICES[0].service, amount: "", dueDate: "" });
  }

  function sendInvoice(inv: BankInvoice, resend: boolean) {
    const link = inv.paymentLink ?? `https://pay.plexus.example/${inv.number}`;
    updateBank((draft) => {
      draft.invoices = draft.invoices.map((i) =>
        i.id === inv.id
          ? {
              ...i,
              status: i.status === "Draft" ? "Sent" : i.status,
              paymentLink: link,
              resendHistory: resend ? [...i.resendHistory, { date: new Date().toISOString().slice(0, 10), by: actor, channel: "email" }] : i.resendHistory,
            }
          : i,
      );
    });
    logAuditEvent({ actor, module: "Invoicing Center", action: `${resend ? "Resent" : "Sent"} invoice ${inv.number}`, newValue: link });
  }

  function voidInvoice(inv: BankInvoice) {
    updateBank((draft) => {
      draft.invoices = draft.invoices.map((i) => (i.id === inv.id ? { ...i, status: "Void" as const, balance: 0 } : i));
    });
    logAuditEvent({ actor, module: "Invoicing Center", action: `Voided invoice ${inv.number}`, oldValue: inv.status, newValue: "Void" });
  }

  function markPaid(inv: BankInvoice) {
    updateBank((draft) => {
      draft.invoices = draft.invoices.map((i) =>
        i.id === inv.id
          ? { ...i, status: "Paid" as const, balance: 0, payments: [...i.payments, { id: bankId("pay"), date: new Date().toISOString().slice(0, 10), amount: i.balance, method: "manual", status: "succeeded" as const }] }
          : i,
      );
    });
    logAuditEvent({ actor, module: "Invoicing Center", action: `Marked invoice ${inv.number} paid`, oldValue: fmtMoney(inv.balance), newValue: "$0.00" });
  }

  function savePlan() {
    if (!planFor || !plan.firstDueDate) return;
    const inv = planFor;
    const n = Math.max(2, parseInt(plan.installments, 10) || 2);
    updateBank((draft) => {
      draft.invoices = draft.invoices.map((i) =>
        i.id === inv.id ? { ...i, paymentPlan: { totalAmount: i.balance, installments: n, firstDueDate: plan.firstDueDate, installmentAmount: Math.round((i.balance / n) * 100) / 100 } } : i,
      );
    });
    logAuditEvent({ actor, module: "Invoicing Center", action: `Set payment plan on ${inv.number}`, newValue: `${n} installments starting ${plan.firstDueDate}` });
    setPlanFor(null);
  }

  const tabs: { id: InvoiceTab; label: string }[] = [
    { id: "all", label: `All (${bank.invoices.length})` },
    { id: "paid", label: "Paid" },
    { id: "unpaid", label: "Unpaid" },
    { id: "overdue", label: "Overdue" },
    { id: "batches", label: "Batches" },
  ];

  return (
    <div data-testid="bank-invoicing-center">
      <ModuleHeader
        title="Invoicing Center"
        subtitle="Patient invoices, payment links, payment plans, and batch tracking."
        actions={<BankButton onClick={() => setCreateOpen(true)} testId="invoice-create-open"><Plus className="h-3 w-3" /> Create invoice</BankButton>}
      />
      <div className="mb-3 flex gap-1">
        {tabs.map((t) => (
          <BankButton key={t.id} variant={tab === t.id ? "primary" : "secondary"} onClick={() => setTab(t.id)} testId={`invoice-tab-${t.id}`}>{t.label}</BankButton>
        ))}
      </div>

      <Panel className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="invoices-table">
          <thead className="border-b border-slate-100 bg-slate-50/70">
            <tr>
              <Th>Invoice</Th><Th>Patient</Th><Th>Clinic</Th><Th>Service</Th><Th>Amount</Th><Th>Balance</Th><Th>Status</Th><Th>Due</Th><Th>Sent by</Th><Th>Source</Th>{tab === "batches" && <Th>Batch</Th>}<Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`invoice-row-${i.id}`}>
                <Td className="font-semibold">{i.number}</Td>
                <Td>{i.patient}</Td>
                <Td>{i.clinic}</Td>
                <Td>{i.service}</Td>
                <Td>{fmtMoney(i.amount)}</Td>
                <Td className={i.balance > 0 ? "font-semibold text-amber-700" : "text-emerald-700"}>{fmtMoney(i.balance)}</Td>
                <Td><StatusBadge value={i.status} testId={`invoice-status-${i.id}`} /></Td>
                <Td>{i.dueDate}</Td>
                <Td>{i.sentBy}</Td>
                <Td><span className={`rounded-full px-2 py-0.5 text-[10px] ${i.source === "teamPortal" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{i.source === "teamPortal" ? "Team Portal" : "Bank"}</span></Td>
                {tab === "batches" && <Td>{i.batchId}</Td>}
                <Td>
                  <div className="flex items-center gap-1">
                    <BankButton size="xs" variant="secondary" onClick={() => setDetail(i)} testId={`invoice-view-${i.id}`}><Eye className="h-3 w-3" /></BankButton>
                    {i.status === "Draft" && <BankButton size="xs" onClick={() => sendInvoice(i, false)} testId={`invoice-send-${i.id}`}><Send className="h-3 w-3" /> Send</BankButton>}
                    {["Sent", "Unpaid", "Overdue", "Partially Paid"].includes(i.status) && (
                      <>
                        <BankButton size="xs" variant="secondary" onClick={() => sendInvoice(i, true)} testId={`invoice-resend-${i.id}`}><RefreshCw className="h-3 w-3" /> Resend</BankButton>
                        <BankButton size="xs" variant="secondary" onClick={() => markPaid(i)} testId={`invoice-markpaid-${i.id}`}>Mark paid</BankButton>
                        <BankButton size="xs" variant="secondary" onClick={() => { setPlanFor(i); setPlan({ installments: "3", firstDueDate: "" }); }} testId={`invoice-plan-${i.id}`}>Plan</BankButton>
                      </>
                    )}
                    {i.status !== "Void" && i.status !== "Paid" && <BankButton size="xs" variant="danger" onClick={() => voidInvoice(i)} testId={`invoice-void-${i.id}`}><Ban className="h-3 w-3" /></BankButton>}
                  </div>
                </Td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-xs italic text-slate-400">No invoices in this view.</td></tr>}
          </tbody>
        </table>
      </Panel>

      <BankModal open={createOpen} onClose={() => setCreateOpen(false)} title="Create invoice" wide>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Patient name"><input className={inputCls} value={form.patient} onChange={(e) => setForm({ ...form, patient: e.target.value })} data-testid="invoice-form-patient" /></Field>
          <Field label="Patient email"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="invoice-form-email" /></Field>
          <Field label="Clinic">
            <select className={inputCls} value={form.clinic} onChange={(e) => setForm({ ...form, clinic: e.target.value })} data-testid="invoice-form-clinic">
              {BANK_CLINICS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Service">
            <select className={inputCls} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} data-testid="invoice-form-service">
              {BANK_SERVICES.map((s) => <option key={s.service} value={s.service}>{s.service}</option>)}
            </select>
          </Field>
          <Field label="Amount ($)"><input type="number" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="invoice-form-amount" /></Field>
          <Field label="Due date"><input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} data-testid="invoice-form-due" /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <BankButton variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</BankButton>
          <BankButton onClick={createInvoice} disabled={!form.patient.trim() || !parseFloat(form.amount) || !form.dueDate} testId="invoice-form-submit">Create draft</BankButton>
        </div>
      </BankModal>

      <BankModal open={!!planFor} onClose={() => setPlanFor(null)} title={planFor ? `Payment plan — ${planFor.number}` : ""}>
        {planFor && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">Balance {fmtMoney(planFor.balance)} for {planFor.patient}</div>
            <Field label="Installments">
              <input type="number" min={2} max={12} className={inputCls} value={plan.installments} onChange={(e) => setPlan({ ...plan, installments: e.target.value })} data-testid="plan-installments" />
            </Field>
            <Field label="First due date">
              <input type="date" className={inputCls} value={plan.firstDueDate} onChange={(e) => setPlan({ ...plan, firstDueDate: e.target.value })} data-testid="plan-first-due" />
            </Field>
            {plan.firstDueDate && (
              <div className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                {plan.installments || 2} payments of {fmtMoney(planFor.balance / Math.max(2, parseInt(plan.installments, 10) || 2))} starting {plan.firstDueDate}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <BankButton variant="secondary" onClick={() => setPlanFor(null)}>Cancel</BankButton>
              <BankButton onClick={savePlan} disabled={!plan.firstDueDate} testId="plan-save">Save plan</BankButton>
            </div>
          </div>
        )}
      </BankModal>

      <BankDrawer open={!!detailLive} onClose={() => setDetail(null)} title={detailLive ? `Invoice ${detailLive.number}` : ""} wide>
        {detailLive && <InvoiceDetail invoice={detailLive} />}
      </BankDrawer>
    </div>
  );
}

export function InvoiceDetail({ invoice }: { invoice: BankInvoice }) {
  const bank = usePlexusBank();
  const trail = bank.auditLog.filter((e) => (e.action + (e.newValue ?? "")).includes(invoice.number));
  return (
    <div className="space-y-4 text-xs text-slate-700">
      <div className="grid grid-cols-2 gap-2">
        <div><span className="text-slate-400">Patient:</span> {invoice.patient}</div>
        <div><span className="text-slate-400">Email:</span> {invoice.patientEmail}</div>
        <div><span className="text-slate-400">Clinic:</span> {invoice.clinic}</div>
        <div><span className="text-slate-400">Service:</span> {invoice.service}</div>
        <div><span className="text-slate-400">Amount:</span> {fmtMoney(invoice.amount)}</div>
        <div><span className="text-slate-400">Balance:</span> {fmtMoney(invoice.balance)}</div>
        <div><span className="text-slate-400">Status:</span> <StatusBadge value={invoice.status} /></div>
        <div><span className="text-slate-400">Due:</span> {invoice.dueDate}</div>
        <div><span className="text-slate-400">Sent by:</span> {invoice.sentBy}</div>
        <div><span className="text-slate-400">Source:</span> {invoice.source === "teamPortal" ? "Team Portal" : "Plexus Bank"}</div>
      </div>
      {invoice.paymentLink && (
        <div className="rounded-lg bg-blue-50 p-2 font-mono text-[10px] text-blue-800" data-testid="invoice-payment-link">{invoice.paymentLink}</div>
      )}
      {invoice.paymentPlan && (
        <div className="rounded-lg bg-violet-50 p-2 text-[11px] text-violet-800">
          Payment plan: {invoice.paymentPlan.installments} × {fmtMoney(invoice.paymentPlan.installmentAmount)} starting {invoice.paymentPlan.firstDueDate}
        </div>
      )}
      <div>
        <div className="mb-1 font-semibold text-slate-900">Payments</div>
        {invoice.payments.length === 0 ? <div className="italic text-slate-400">No payments recorded.</div> : (
          <ul className="space-y-1">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2">{p.date} · {fmtMoney(p.amount)} · {p.method} <StatusBadge value={p.status} /></li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-1 font-semibold text-slate-900">Resend history</div>
        {invoice.resendHistory.length === 0 ? <div className="italic text-slate-400">Never resent.</div> : (
          <ul className="space-y-1">{invoice.resendHistory.map((r, i) => <li key={i}>{r.date} · {r.by} · via {r.channel}</li>)}</ul>
        )}
      </div>
      <div>
        <div className="mb-1 font-semibold text-slate-900">Refunds / adjustments</div>
        {invoice.adjustments.length === 0 ? <div className="italic text-slate-400">None.</div> : (
          <ul className="space-y-1">{invoice.adjustments.map((a) => <li key={a.id}>{a.date} · {a.kind} · {fmtMoney(a.amount)} — {a.reason} ({a.by})</li>)}</ul>
        )}
      </div>
      <div>
        <div className="mb-1 font-semibold text-slate-900">Contact notes</div>
        {invoice.contactNotes.length === 0 ? <div className="italic text-slate-400">No contact notes.</div> : (
          <ul className="space-y-1">{invoice.contactNotes.map((n, i) => <li key={i}>{n.date} · {n.by}: {n.note}</li>)}</ul>
        )}
      </div>
      <div>
        <div className="mb-1 font-semibold text-slate-900">Audit trail</div>
        {trail.length === 0 ? <div className="italic text-slate-400">No workspace events for this invoice yet.</div> : (
          <ul className="space-y-1">
            {trail.map((e) => <li key={e.id}>{new Date(e.timestamp).toLocaleString()} · {e.actor} · {e.action}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Team Invoice Desk Monitor ──────────────────────────────────────────────

export function TeamInvoiceMonitorModule() {
  const bank = usePlexusBank();
  const { filters, actor } = usePlexusBankFilters();
  const [detail, setDetail] = useState<BankInvoice | null>(null);
  const detailLive = detail ? bank.invoices.find((i) => i.id === detail.id) ?? null : null;

  const list = bank.invoices.filter((i) => i.source === "teamPortal" && matchesFilters(filters, { clinic: i.clinic, region: i.region, date: i.issuedDate }));

  function recordAdjustment(inv: BankInvoice, kind: "refund" | "adjustment") {
    const amount = kind === "refund" ? -Math.min(50, inv.amount) : -25;
    updateBank((draft) => {
      draft.invoices = draft.invoices.map((i) =>
        i.id === inv.id
          ? { ...i, balance: Math.max(0, i.balance + amount), adjustments: [...i.adjustments, { id: bankId("adj"), date: new Date().toISOString().slice(0, 10), by: actor, kind, amount, reason: kind === "refund" ? "Admin-issued refund" : "Courtesy adjustment" }] }
          : i,
      );
    });
    logAuditEvent({ actor, module: "Team Invoice Desk", action: `Recorded ${kind} on ${inv.number}`, newValue: fmtMoney(amount) });
  }

  return (
    <div data-testid="bank-team-invoice-monitor">
      <ModuleHeader title="Team Invoice Desk Monitor" subtitle="Admin oversight of every invoice sent from the Team Portal Invoice Desk." />
      <Panel className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="team-invoice-table">
          <thead className="border-b border-slate-100 bg-slate-50/70">
            <tr>
              <Th>Invoice</Th><Th>Sender</Th><Th>Patient</Th><Th>Clinic</Th><Th>Amount</Th><Th>Balance</Th><Th>Status</Th><Th>Resends</Th><Th>Failed payments</Th><Th>Refunds/Adj</Th><Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const failed = i.payments.filter((p) => p.status === "failed").length;
              return (
                <tr key={i.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`team-invoice-row-${i.id}`}>
                  <Td className="font-semibold">{i.number}</Td>
                  <Td>{i.sentBy}</Td>
                  <Td>{i.patient}</Td>
                  <Td>{i.clinic}</Td>
                  <Td>{fmtMoney(i.amount)}</Td>
                  <Td>{fmtMoney(i.balance)}</Td>
                  <Td><StatusBadge value={i.status} /></Td>
                  <Td>{i.resendHistory.length > 0 ? `${i.resendHistory.length}× (last ${i.resendHistory[i.resendHistory.length - 1].date})` : "—"}</Td>
                  <Td>{failed > 0 ? <span className="font-semibold text-red-600">{failed} failed</span> : "—"}</Td>
                  <Td>{i.adjustments.length > 0 ? i.adjustments.map((a) => `${a.kind} ${fmtMoney(a.amount)}`).join(", ") : "—"}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <BankButton size="xs" variant="secondary" onClick={() => setDetail(i)} testId={`team-invoice-view-${i.id}`}><Eye className="h-3 w-3" /> Trail</BankButton>
                      <BankButton size="xs" variant="secondary" onClick={() => recordAdjustment(i, "refund")} testId={`team-invoice-refund-${i.id}`}>Refund</BankButton>
                      <BankButton size="xs" variant="secondary" onClick={() => recordAdjustment(i, "adjustment")} testId={`team-invoice-adjust-${i.id}`}>Adjust</BankButton>
                    </div>
                  </Td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-xs italic text-slate-400">No Team Portal invoices yet — invoices sent from the portal Invoice Desk appear here.</td></tr>}
          </tbody>
        </table>
      </Panel>

      <BankDrawer open={!!detailLive} onClose={() => setDetail(null)} title={detailLive ? `Invoice ${detailLive.number} — audit trail` : ""} wide>
        {detailLive && <InvoiceDetail invoice={detailLive} />}
      </BankDrawer>
    </div>
  );
}
