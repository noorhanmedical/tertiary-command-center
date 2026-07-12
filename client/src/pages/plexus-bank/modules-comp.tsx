// Plexus Bank comp modules: Fee Schedule Manager, RVU & Plex Factor
// Compensation (10 sub-tabs), P&L / Profitability, Expenses.

import { useMemo, useState } from "react";
import { Plus, Copy, History, FlaskConical, Sparkles } from "lucide-react";
import {
  usePlexusBank, updateBank, logAuditEvent, bankId, fmtMoney, resolveFee,
  computePlexFactor, BANK_CLINICS, BANK_PAYERS, BANK_SERVICES, BANK_REGIONS,
  CLINIC_REGION, EXPENSE_CATEGORIES,
  type FeeScheduleEntry, type BankExpense,
} from "./mockData";
import { usePlexusBankFilters, matchesFilters } from "@/pages/plexus-bank";
import {
  ModuleHeader, Panel, StatusBadge, BankButton, BankDrawer, BankModal,
  Field, inputCls, Th, Td, StatCard,
} from "./ui";

// ─── Fee Schedule Manager ───────────────────────────────────────────────────

const LEVEL_ORDER: FeeScheduleEntry["level"][] = ["global", "region", "state", "clinic", "payer"];
const LEVEL_LABEL: Record<FeeScheduleEntry["level"], string> = {
  global: "Global default", region: "Region", state: "State", clinic: "Clinic", payer: "Payer",
};

export function FeeScheduleModule() {
  const bank = usePlexusBank();
  const { actor } = usePlexusBankFilters();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftPrice, setDraftPrice] = useState("");
  const [historyFor, setHistoryFor] = useState<FeeScheduleEntry | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovr, setOvr] = useState({ service: BANK_SERVICES[0].service, level: "clinic" as FeeScheduleEntry["level"], scope: BANK_CLINICS[0] as string, price: "" });
  const [tester, setTester] = useState({ service: BANK_SERVICES[0].service, clinic: BANK_CLINICS[0] as string, payer: BANK_PAYERS[0] as string });
  const [testResult, setTestResult] = useState<{ price: number; chain: string[] } | null>(null);

  const sorted = useMemo(
    () => [...bank.feeSchedules].sort((a, b) => a.service.localeCompare(b.service) || LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)),
    [bank.feeSchedules],
  );

  function commitPrice(entry: FeeScheduleEntry) {
    const price = parseFloat(draftPrice);
    setEditing(null);
    if (!price || price === entry.price) return;
    updateBank((draft) => {
      draft.feeSchedules = draft.feeSchedules.map((f) =>
        f.id === entry.id
          ? { ...f, price, version: f.version + 1, history: [...f.history, { version: f.version + 1, price, changedBy: actor, changedAt: new Date().toISOString().slice(0, 10), reason: entry.requiresApproval ? "Inline edit (approval required)" : "Inline edit" }] }
          : f,
      );
      if (entry.requiresApproval) {
        draft.approvals = [
          { id: bankId("apr"), type: "fee-change", requester: actor, amountImpact: price - entry.price, clinic: entry.level === "clinic" ? entry.scope : "All", reason: `${entry.service} ${LEVEL_LABEL[entry.level]} (${entry.scope}) ${fmtMoney(entry.price)} → ${fmtMoney(price)}`, status: "pending", notes: [], createdAt: new Date().toISOString().slice(0, 10) },
          ...draft.approvals,
        ];
      }
    });
    logAuditEvent({ actor, module: "Fee Schedules", action: `Updated ${entry.service} ${LEVEL_LABEL[entry.level]} (${entry.scope}) price`, oldValue: fmtMoney(entry.price), newValue: fmtMoney(price), reason: entry.requiresApproval ? "Approval request created" : null });
  }

  function cloneSchedule(entry: FeeScheduleEntry) {
    updateBank((draft) => {
      draft.feeSchedules = [...draft.feeSchedules, { ...entry, id: bankId("fee"), scope: `${entry.scope} (copy)`, version: 1, history: [{ version: 1, price: entry.price, changedBy: actor, changedAt: new Date().toISOString().slice(0, 10), reason: `Cloned from ${entry.scope}` }] }];
    });
    logAuditEvent({ actor, module: "Fee Schedules", action: `Cloned schedule entry ${entry.service} (${entry.scope})` });
  }

  function addOverride() {
    const price = parseFloat(ovr.price);
    if (!price) return;
    const svc = BANK_SERVICES.find((s) => s.service === ovr.service);
    updateBank((draft) => {
      draft.feeSchedules = [...draft.feeSchedules, { id: bankId("fee"), service: ovr.service, cpt: svc?.cpt ?? "", level: ovr.level, scope: ovr.scope, price, requiresApproval: true, version: 1, effectiveDate: new Date().toISOString().slice(0, 10), history: [{ version: 1, price, changedBy: actor, changedAt: new Date().toISOString().slice(0, 10), reason: "Override created" }] }];
    });
    logAuditEvent({ actor, module: "Fee Schedules", action: `Created ${LEVEL_LABEL[ovr.level]} override for ${ovr.service} (${ovr.scope})`, newValue: fmtMoney(price) });
    setOverrideOpen(false);
    setOvr({ ...ovr, price: "" });
  }

  const scopeOptions =
    ovr.level === "clinic" ? BANK_CLINICS : ovr.level === "region" ? BANK_REGIONS : ovr.level === "state" ? ["TX", "AZ"] : ovr.level === "payer" ? BANK_PAYERS : ["Global"];

  return (
    <div data-testid="bank-fee-schedules">
      <ModuleHeader
        title="Fee Schedule Manager"
        subtitle="Pricing hierarchy: payer → clinic → state → region → global default. Inline edits create approval requests."
        actions={<BankButton onClick={() => setOverrideOpen(true)} testId="fee-add-override"><Plus className="h-3 w-3" /> Add override</BankButton>}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="overflow-x-auto xl:col-span-2">
          <table className="w-full text-xs" data-testid="fee-table">
            <thead className="border-b border-slate-100 bg-slate-50/70">
              <tr><Th>Service</Th><Th>CPT</Th><Th>Level</Th><Th>Scope</Th><Th>Price</Th><Th>Ver</Th><Th>Effective</Th><Th>Actions</Th></tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`fee-row-${f.id}`}>
                  <Td className="font-semibold">{f.service}</Td>
                  <Td className="text-slate-400">{f.cpt}</Td>
                  <Td><StatusBadge value={LEVEL_LABEL[f.level]} /></Td>
                  <Td>{f.scope}</Td>
                  <Td>
                    {editing === f.id ? (
                      <input
                        autoFocus type="number" className="w-20 rounded border border-blue-800 px-1 py-0.5 text-xs" value={draftPrice}
                        onChange={(e) => setDraftPrice(e.target.value)}
                        onBlur={() => commitPrice(f)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitPrice(f); if (e.key === "Escape") setEditing(null); }}
                        data-testid={`fee-price-input-${f.id}`}
                      />
                    ) : (
                      <button className="rounded px-1 py-0.5 font-semibold text-slate-800 hover:bg-blue-50" onClick={() => { setEditing(f.id); setDraftPrice(String(f.price)); }} data-testid={`fee-price-${f.id}`}>
                        {fmtMoney(f.price)}
                      </button>
                    )}
                    {f.requiresApproval && <span className="ml-1 text-[9px] text-amber-600">approval req.</span>}
                  </Td>
                  <Td>v{f.version}</Td>
                  <Td>{f.effectiveDate}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <BankButton size="xs" variant="secondary" onClick={() => cloneSchedule(f)} testId={`fee-clone-${f.id}`}><Copy className="h-3 w-3" /> Clone</BankButton>
                      <BankButton size="xs" variant="secondary" onClick={() => setHistoryFor(f)} testId={`fee-history-${f.id}`}><History className="h-3 w-3" /> History</BankButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel className="h-fit p-4" testId="fee-test-runner">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-900"><FlaskConical className="h-4 w-4 text-blue-800" /> Pricing test runner</div>
          <div className="space-y-2">
            <Field label="Service">
              <select className={inputCls} value={tester.service} onChange={(e) => setTester({ ...tester, service: e.target.value })} data-testid="fee-test-service">
                {BANK_SERVICES.map((s) => <option key={s.service} value={s.service}>{s.service}</option>)}
              </select>
            </Field>
            <Field label="Clinic">
              <select className={inputCls} value={tester.clinic} onChange={(e) => setTester({ ...tester, clinic: e.target.value })} data-testid="fee-test-clinic">
                {BANK_CLINICS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Payer">
              <select className={inputCls} value={tester.payer} onChange={(e) => setTester({ ...tester, payer: e.target.value })} data-testid="fee-test-payer">
                {BANK_PAYERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <BankButton onClick={() => setTestResult(resolveFee(bank, tester.service, tester.clinic, tester.payer))} testId="fee-test-run">Resolve price</BankButton>
            {testResult && (
              <div className="rounded-lg bg-slate-50 p-3 text-[11px]" data-testid="fee-test-result">
                <div className="mb-1 text-base font-bold text-[#0d1b3e]">{fmtMoney(testResult.price)}</div>
                <ol className="list-inside list-decimal space-y-0.5 text-slate-600">
                  {testResult.chain.map((c, i) => <li key={i}>{c}</li>)}
                </ol>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <BankDrawer open={!!historyFor} onClose={() => setHistoryFor(null)} title={historyFor ? `Version history — ${historyFor.service} (${historyFor.scope})` : ""}>
        {historyFor && (
          <ul className="space-y-2 text-xs text-slate-700">
            {[...historyFor.history].reverse().map((h) => (
              <li key={h.version} className="rounded-lg border border-slate-100 p-2">
                <div className="font-semibold">v{h.version} — {fmtMoney(h.price)}</div>
                <div className="text-slate-400">{h.changedAt} · {h.changedBy} · {h.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </BankDrawer>

      <BankModal open={overrideOpen} onClose={() => setOverrideOpen(false)} title="Create pricing override">
        <div className="space-y-3">
          <Field label="Service">
            <select className={inputCls} value={ovr.service} onChange={(e) => setOvr({ ...ovr, service: e.target.value })} data-testid="override-service">
              {BANK_SERVICES.map((s) => <option key={s.service} value={s.service}>{s.service}</option>)}
            </select>
          </Field>
          <Field label="Level">
            <select className={inputCls} value={ovr.level} onChange={(e) => { const level = e.target.value as FeeScheduleEntry["level"]; const opts = level === "clinic" ? BANK_CLINICS : level === "region" ? BANK_REGIONS : level === "state" ? ["TX", "AZ"] : level === "payer" ? BANK_PAYERS : ["Global"]; setOvr({ ...ovr, level, scope: opts[0] }); }} data-testid="override-level">
              {(["region", "state", "clinic", "payer"] as const).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
            </select>
          </Field>
          <Field label="Scope">
            <select className={inputCls} value={ovr.scope} onChange={(e) => setOvr({ ...ovr, scope: e.target.value })} data-testid="override-scope">
              {scopeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Price ($)"><input type="number" className={inputCls} value={ovr.price} onChange={(e) => setOvr({ ...ovr, price: e.target.value })} data-testid="override-price" /></Field>
          <div className="flex justify-end gap-2">
            <BankButton variant="secondary" onClick={() => setOverrideOpen(false)}>Cancel</BankButton>
            <BankButton onClick={addOverride} disabled={!parseFloat(ovr.price)} testId="override-save">Create override</BankButton>
          </div>
        </div>
      </BankModal>
    </div>
  );
}

// ─── RVU & Plex Factor Compensation ────────────────────────────────────────

const RVU_TABS = [
  "RVU Dashboard", "Service RVU Settings", "Plex Factor Rules", "Role Payout Rates",
  "Clinic/Region Overrides", "Service Event Ledger", "Compensation Calculator",
  "Payout Review", "Payroll Integration", "RVU Audit Log",
] as const;

export function RvuCompensationModule() {
  const bank = usePlexusBank();
  const { filters, actor } = usePlexusBankFilters();
  const [tab, setTab] = useState<(typeof RVU_TABS)[number]>("RVU Dashboard");

  // Calculator state
  const [calc, setCalc] = useState({ patient: "Sample Patient", date: new Date().toISOString().slice(0, 10), clinic: BANK_CLINICS[0] as string, role: "Technician", services: ["BrainWave", "VitalWave"] as string[] });
  const calcResult = useMemo(() => (calc.services.length ? computePlexFactor(bank, calc.services, calc.role, calc.clinic) : null), [bank, calc]);

  const events = bank.serviceEvents.filter((e) => matchesFilters(filters, { clinic: e.clinic, region: e.region, date: e.date }));
  const totalRvu = events.reduce((s, e) => s + e.rvu, 0);
  const rule = bank.plexFactorRule;

  function setRvu(id: string, value: number) {
    const cur = bank.rvuSettings.find((r) => r.id === id);
    if (!cur || !value || value === cur.rvu) return;
    updateBank((draft) => {
      draft.rvuSettings = draft.rvuSettings.map((r) => (r.id === id ? { ...r, rvu: value, effectiveDate: new Date().toISOString().slice(0, 10) } : r));
    });
    logAuditEvent({ actor, module: "RVU & Plex Factor", action: `Updated RVU for ${cur.service}`, oldValue: String(cur.rvu), newValue: String(value) });
  }

  function updateRule(patch: Partial<typeof rule>, label: string, oldVal: string, newVal: string) {
    updateBank((draft) => {
      draft.plexFactorRule = { ...draft.plexFactorRule, ...patch };
    });
    logAuditEvent({ actor, module: "RVU & Plex Factor", action: `Updated Plex Factor rule: ${label}`, oldValue: oldVal, newValue: newVal });
  }

  function setPayoutStatus(id: string, status: "pending" | "approved" | "paid") {
    const cur = bank.payoutEntries.find((p) => p.id === id);
    updateBank((draft) => {
      draft.payoutEntries = draft.payoutEntries.map((p) => (p.id === id ? { ...p, status } : p));
    });
    logAuditEvent({ actor, module: "RVU & Plex Factor", action: `Payout for ${cur?.employee} → ${status}`, oldValue: cur?.status ?? null, newValue: status });
  }

  const rvuAudit = bank.auditLog.filter((e) => e.module === "RVU & Plex Factor");

  return (
    <div data-testid="bank-rvu">
      <ModuleHeader title="RVU & Plex Factor Compensation" subtitle="Production-based compensation engine. All calculations run in-browser on sample data." />
      <div className="mb-3 flex flex-wrap gap-1">
        {RVU_TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${tab === t ? "border-transparent bg-violet-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`} data-testid={`rvu-tab-${t.replace(/[^a-z]/gi, "-").toLowerCase()}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "RVU Dashboard" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <StatCard label="Total RVUs (period)" value={String(totalRvu)} tone="violet" testId="rvu-kpi-total" />
            <StatCard label="Service Events" value={String(events.length)} tone="navy" />
            <StatCard label="Plex Factor Rule" value={`${rule.minEligibleCount}+ eligible → ${rule.multiplier}x`} tone="violet" />
            <StatCard label="Payouts Pending" value={fmtMoney(bank.payoutEntries.filter((p) => p.status === "pending").reduce((s, p) => s + p.totalAmount, 0))} tone="amber" />
          </div>
          <Panel className="p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-900"><Sparkles className="h-4 w-4 text-violet-600" /> How Plex Factor works</div>
            <p className="text-xs leading-relaxed text-slate-600">
              When a team member performs <b>{rule.minEligibleCount} or more</b> eligible services ({rule.eligibleServices.join(" + ")}) on the same patient within {rule.activationWindowDays} day{rule.activationWindowDays === 1 ? "" : "s"}, their RVU payout for that visit is multiplied by <b>{rule.multiplier}x</b>. Example: BrainWave 9 RVUs + VitalWave 6 RVUs → Plex Factor active {rule.multiplier}x → Technician payout {fmtMoney(15 * 1.5 * rule.multiplier)}.
            </p>
          </Panel>
        </div>
      )}

      {tab === "Service RVU Settings" && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="rvu-settings-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Service</Th><Th>CPT</Th><Th>RVUs</Th><Th>Effective date</Th></tr></thead>
            <tbody>
              {bank.rvuSettings.map((r) => (
                <tr key={r.id} className="border-b border-slate-50" data-testid={`rvu-setting-${r.id}`}>
                  <Td className="font-semibold">{r.service}</Td>
                  <Td className="text-slate-400">{r.cpt}</Td>
                  <Td>
                    <input type="number" defaultValue={r.rvu} onBlur={(e) => setRvu(r.id, parseFloat(e.target.value))} className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs" data-testid={`rvu-input-${r.id}`} />
                  </Td>
                  <Td>{r.effectiveDate}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "Plex Factor Rules" && (
        <Panel className="max-w-xl p-4" testId="plex-rules-panel">
          <div className="space-y-3">
            <Field label="Minimum eligible services to activate">
              <input type="number" min={1} className={inputCls} defaultValue={rule.minEligibleCount} onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v && v !== rule.minEligibleCount) updateRule({ minEligibleCount: v }, "min count", String(rule.minEligibleCount), String(v)); }} data-testid="plex-min-count" />
            </Field>
            <Field label="Multiplier">
              <input type="number" step="0.5" min={1} className={inputCls} defaultValue={rule.multiplier} onBlur={(e) => { const v = parseFloat(e.target.value); if (v && v !== rule.multiplier) updateRule({ multiplier: v }, "multiplier", `${rule.multiplier}x`, `${v}x`); }} data-testid="plex-multiplier" />
            </Field>
            <Field label="Eligible services">
              <div className="flex flex-wrap gap-1.5">
                {BANK_SERVICES.map((s) => {
                  const on = rule.eligibleServices.includes(s.service);
                  return (
                    <button key={s.service} onClick={() => { const next = on ? rule.eligibleServices.filter((x) => x !== s.service) : [...rule.eligibleServices, s.service]; updateRule({ eligibleServices: next }, "eligible services", rule.eligibleServices.join(", "), next.join(", ")); }} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${on ? "border-violet-300 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-slate-500"}`} data-testid={`plex-eligible-${s.cpt}`}>
                      {s.service}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Activation window (days)">
              <input type="number" min={1} className={inputCls} defaultValue={rule.activationWindowDays} onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v && v !== rule.activationWindowDays) updateRule({ activationWindowDays: v }, "activation window", String(rule.activationWindowDays), String(v)); }} data-testid="plex-window" />
            </Field>
            <Field label="Payout trigger">
              <select className={inputCls} value={rule.payoutTrigger} onChange={(e) => updateRule({ payoutTrigger: e.target.value as typeof rule.payoutTrigger }, "payout trigger", rule.payoutTrigger, e.target.value)} data-testid="plex-trigger">
                <option value="same-day">Same day</option>
                <option value="claim-paid">When claim paid</option>
                <option value="payroll-cycle">Next payroll cycle</option>
              </select>
            </Field>
          </div>
        </Panel>
      )}

      {tab === "Role Payout Rates" && (
        <Panel className="max-w-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Role</Th><Th>Rate per RVU</Th></tr></thead>
            <tbody>
              {bank.rolePayoutRates.map((r) => (
                <tr key={r.id} className="border-b border-slate-50" data-testid={`rate-row-${r.id}`}>
                  <Td className="font-semibold">{r.role}</Td>
                  <Td>
                    <input type="number" step="0.25" defaultValue={r.ratePerRvu} onBlur={(e) => { const v = parseFloat(e.target.value); if (v && v !== r.ratePerRvu) { updateBank((draft) => { draft.rolePayoutRates = draft.rolePayoutRates.map((x) => (x.id === r.id ? { ...x, ratePerRvu: v } : x)); }); logAuditEvent({ actor, module: "RVU & Plex Factor", action: `Updated ${r.role} rate`, oldValue: fmtMoney(r.ratePerRvu), newValue: fmtMoney(v) }); } }} className="w-20 rounded border border-slate-200 px-1 py-0.5 text-xs" data-testid={`rate-input-${r.id}`} />
                    <span className="ml-1 text-slate-400">/ RVU</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "Clinic/Region Overrides" && (
        <Panel className="max-w-2xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Scope</Th><Th>Role</Th><Th>Override rate</Th></tr></thead>
            <tbody>
              {bank.payoutOverrides.map((o) => (
                <tr key={o.id} className="border-b border-slate-50" data-testid={`payout-override-${o.id}`}>
                  <Td className="font-semibold">{o.scope} <span className="text-[9px] text-slate-400">({o.scopeType})</span></Td>
                  <Td>{o.role}</Td>
                  <Td>{fmtMoney(o.ratePerRvu)} / RVU</Td>
                </tr>
              ))}
              {bank.payoutOverrides.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-xs italic text-slate-400">No overrides configured.</td></tr>}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "Service Event Ledger" && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="service-event-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Date</Th><Th>Patient</Th><Th>Clinic</Th><Th>Service</Th><Th>RVUs</Th><Th>Performed by</Th><Th>Role</Th><Th>Status</Th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-slate-50" data-testid={`service-event-${e.id}`}>
                  <Td>{e.date}</Td><Td className="font-semibold">{e.patient}</Td><Td>{e.clinic}</Td><Td>{e.service}</Td>
                  <Td className="font-semibold text-violet-700">{e.rvu}</Td><Td>{e.performedBy}</Td><Td>{e.role}</Td>
                  <Td><StatusBadge value={e.status} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "Compensation Calculator" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel className="p-4">
            <div className="space-y-3">
              <Field label="Patient"><input className={inputCls} value={calc.patient} onChange={(e) => setCalc({ ...calc, patient: e.target.value })} data-testid="calc-patient" /></Field>
              <Field label="Date"><input type="date" className={inputCls} value={calc.date} onChange={(e) => setCalc({ ...calc, date: e.target.value })} data-testid="calc-date" /></Field>
              <Field label="Clinic">
                <select className={inputCls} value={calc.clinic} onChange={(e) => setCalc({ ...calc, clinic: e.target.value })} data-testid="calc-clinic">
                  {BANK_CLINICS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Role">
                <select className={inputCls} value={calc.role} onChange={(e) => setCalc({ ...calc, role: e.target.value })} data-testid="calc-role">
                  {bank.rolePayoutRates.map((r) => <option key={r.id} value={r.role}>{r.role}</option>)}
                </select>
              </Field>
              <Field label="Services performed">
                <div className="flex flex-wrap gap-1.5">
                  {BANK_SERVICES.map((s) => {
                    const on = calc.services.includes(s.service);
                    return (
                      <button key={s.service} onClick={() => setCalc({ ...calc, services: on ? calc.services.filter((x) => x !== s.service) : [...calc.services, s.service] })} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${on ? "border-violet-300 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-slate-500"}`} data-testid={`calc-svc-${s.cpt}`}>
                        {s.service}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </Panel>
          <Panel className="p-4" testId="calc-result">
            {calcResult ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${calcResult.active ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-500"}`} data-testid="calc-plex-status">
                    {calcResult.active ? `Plex Factor ACTIVE ${bank.plexFactorRule.multiplier}x` : "Plex Factor not triggered"}
                  </span>
                  <span className="text-lg font-bold text-[#0d1b3e]" data-testid="calc-payout">{fmtMoney(calcResult.finalPayout)}</span>
                </div>
                <ol className="list-inside list-decimal space-y-1 text-xs text-slate-600">
                  {calcResult.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            ) : (
              <div className="text-xs italic text-slate-400">Select at least one service to run the calculation.</div>
            )}
          </Panel>
        </div>
      )}

      {tab === "Payout Review" && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="payout-review-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Employee</Th><Th>Role</Th><Th>Period</Th><Th>RVUs</Th><Th>Base</Th><Th>Plex Factor bonus</Th><Th>Total</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {bank.payoutEntries.map((p) => (
                <tr key={p.id} className="border-b border-slate-50" data-testid={`payout-row-${p.id}`}>
                  <Td className="font-semibold">{p.employee}</Td><Td>{p.role}</Td><Td>{p.period}</Td><Td>{p.rvuTotal}</Td>
                  <Td>{fmtMoney(p.baseAmount)}</Td><Td className="text-violet-700">{fmtMoney(p.plexFactorBonus)}</Td>
                  <Td className="font-semibold">{fmtMoney(p.totalAmount)}</Td>
                  <Td><StatusBadge value={p.status} /></Td>
                  <Td>
                    <div className="flex gap-1">
                      {p.status === "pending" && <BankButton size="xs" onClick={() => setPayoutStatus(p.id, "approved")} testId={`payout-approve-${p.id}`}>Approve</BankButton>}
                      {p.status === "approved" && <BankButton size="xs" onClick={() => setPayoutStatus(p.id, "paid")} testId={`payout-paid-${p.id}`}>Mark paid</BankButton>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "Payroll Integration" && (
        <Panel className="max-w-2xl p-4" testId="rvu-payroll-integration">
          <div className="space-y-3 text-xs text-slate-600">
            <p>Approved RVU payouts and Plex Factor bonuses flow into the next payroll run automatically. When a payroll run is created in the <b>Payroll</b> module, it pulls every payout entry with status <StatusBadge value="approved" /> for the selected period.</p>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="mb-1 font-semibold text-slate-900">Ready for next run</div>
              {bank.payoutEntries.filter((p) => p.status === "approved").length === 0 ? (
                <div className="italic text-slate-400">No approved payouts waiting.</div>
              ) : (
                <ul className="space-y-1">
                  {bank.payoutEntries.filter((p) => p.status === "approved").map((p) => (
                    <li key={p.id}>{p.employee} — {fmtMoney(p.totalAmount)} ({p.rvuTotal} RVUs{p.plexFactorBonus > 0 ? ` + ${fmtMoney(p.plexFactorBonus)} Plex Factor` : ""})</li>
                  ))}
                </ul>
              )}
            </div>
            <p className="italic text-slate-400">External payroll processor connection is a placeholder — no live payroll data is transmitted.</p>
          </div>
        </Panel>
      )}

      {tab === "RVU Audit Log" && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="rvu-audit-table">
            <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Old</Th><Th>New</Th></tr></thead>
            <tbody>
              {rvuAudit.map((e) => (
                <tr key={e.id} className="border-b border-slate-50">
                  <Td>{new Date(e.timestamp).toLocaleString()}</Td><Td>{e.actor}</Td><Td>{e.action}</Td>
                  <Td className="text-slate-400">{e.oldValue ?? "—"}</Td><Td>{e.newValue ?? "—"}</Td>
                </tr>
              ))}
              {rvuAudit.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-xs italic text-slate-400">No RVU/Plex Factor changes recorded yet.</td></tr>}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

// ─── P&L / Profitability ────────────────────────────────────────────────────

type PnlDim = "clinic" | "region" | "service" | "payer" | "month";

export function PnlModule() {
  const bank = usePlexusBank();
  const { filters } = usePlexusBankFilters();
  const [dim, setDim] = useState<PnlDim>("clinic");

  const rows = useMemo(() => {
    const claims = bank.claims.filter((c) => matchesFilters(filters, { clinic: c.clinic, region: c.region, payer: c.payer, provider: c.provider, date: c.dateOfService }));
    const keyOf = (c: (typeof claims)[number]) =>
      dim === "clinic" ? c.clinic : dim === "region" ? c.region : dim === "service" ? c.service : dim === "payer" ? c.payer : c.dateOfService.slice(0, 7);
    const groups = new Map<string, { gross: number; collections: number }>();
    for (const c of claims) {
      const k = keyOf(c);
      const g = groups.get(k) ?? { gross: 0, collections: 0 };
      g.gross += c.charge;
      g.collections += c.paid;
      groups.set(k, g);
    }
    const totalGross = claims.reduce((s, c) => s + c.charge, 0) || 1;
    const payrollTotal = bank.payrollRuns.reduce((s, r) => s + r.total, 0);
    const rvuTotal = bank.payoutEntries.reduce((s, p) => s + p.totalAmount, 0);
    const vendorTotal = bank.vendorBills.reduce((s, b) => s + b.amount, 0);
    const expenseTotal = bank.expenses.reduce((s, e) => s + e.amount, 0);

    return Array.from(groups.entries()).map(([key, g]) => {
      const share = g.gross / totalGross;
      const refunds = Math.round(g.collections * 0.02 * 100) / 100;
      const adjustments = Math.round(g.gross * 0.05 * 100) / 100;
      const writeOffs = Math.round(g.gross * 0.015 * 100) / 100;
      const payroll = Math.round(payrollTotal * share * 100) / 100;
      const rvuExp = Math.round(rvuTotal * share * 100) / 100;
      const vendorExp = Math.round(vendorTotal * share * 100) / 100;
      const billingCost = Math.round(g.gross * 0.04 * 100) / 100;
      const adminOverhead = Math.round(g.gross * 0.06 * 100) / 100;
      const expenses = Math.round(expenseTotal * share * 100) / 100;
      const grossProfit = g.collections - refunds - adjustments - writeOffs - expenses;
      const netProfit = grossProfit - payroll - rvuExp - vendorExp - billingCost - adminOverhead;
      const plexusShare = Math.round(netProfit * 0.4 * 100) / 100;
      const clinicShare = Math.round(netProfit * 0.6 * 100) / 100;
      return { key, gross: g.gross, collections: g.collections, refunds, adjustments, writeOffs, expenses, payroll, rvuExp, vendorExp, billingCost, adminOverhead, grossProfit, netProfit, plexusShare, clinicShare };
    }).sort((a, b) => b.gross - a.gross);
  }, [bank, filters, dim]);

  return (
    <div data-testid="bank-pnl">
      <ModuleHeader title="P&L / Profitability" subtitle="Derived from claims, payroll, RVU payouts, vendor bills, and expenses in the workspace (allocated by revenue share)." />
      <div className="mb-3 flex gap-1">
        {(["clinic", "region", "service", "payer", "month"] as PnlDim[]).map((d) => (
          <BankButton key={d} variant={dim === d ? "primary" : "secondary"} onClick={() => setDim(d)} testId={`pnl-dim-${d}`}>By {d}</BankButton>
        ))}
      </div>
      <Panel className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="pnl-table">
          <thead className="border-b border-slate-100 bg-slate-50/70">
            <tr>
              <Th>{dim}</Th><Th>Gross Rev</Th><Th>Collections</Th><Th>Refunds</Th><Th>Adjust.</Th><Th>Write-offs</Th><Th>Expenses</Th><Th>Payroll</Th><Th>RVU/Plex</Th><Th>Vendors</Th><Th>Billing cost</Th><Th>Admin OH</Th><Th>Gross Profit</Th><Th>Net Profit</Th><Th>Plexus share</Th><Th>Clinic share</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`pnl-row-${r.key}`}>
                <Td className="font-semibold">{r.key}</Td>
                <Td>{fmtMoney(r.gross)}</Td>
                <Td className="text-emerald-700">{fmtMoney(r.collections)}</Td>
                <Td>{fmtMoney(r.refunds)}</Td>
                <Td>{fmtMoney(r.adjustments)}</Td>
                <Td>{fmtMoney(r.writeOffs)}</Td>
                <Td>{fmtMoney(r.expenses)}</Td>
                <Td>{fmtMoney(r.payroll)}</Td>
                <Td className="text-violet-700">{fmtMoney(r.rvuExp)}</Td>
                <Td>{fmtMoney(r.vendorExp)}</Td>
                <Td>{fmtMoney(r.billingCost)}</Td>
                <Td>{fmtMoney(r.adminOverhead)}</Td>
                <Td className={r.grossProfit >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>{fmtMoney(r.grossProfit)}</Td>
                <Td className={r.netProfit >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>{fmtMoney(r.netProfit)}</Td>
                <Td>{fmtMoney(r.plexusShare)}</Td>
                <Td>{fmtMoney(r.clinicShare)}</Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={16} className="px-3 py-8 text-center text-xs italic text-slate-400">No activity for the current filters.</td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// ─── Expenses ───────────────────────────────────────────────────────────────

export function ExpensesModule() {
  const bank = usePlexusBank();
  const { filters, actor } = usePlexusBankFilters();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ vendor: "", category: EXPENSE_CATEGORIES[0] as string, clinic: BANK_CLINICS[0] as string, amount: "", date: new Date().toISOString().slice(0, 10), recurring: false, paymentMethod: "ACH" });

  const list = bank.expenses.filter((e) => matchesFilters(filters, { clinic: e.clinic, date: e.date }));

  function addExpense() {
    const amount = parseFloat(form.amount);
    if (!form.vendor.trim() || !amount) return;
    updateBank((draft) => {
      draft.expenses = [
        { id: bankId("exp"), date: form.date, vendor: form.vendor.trim(), category: form.category, clinic: form.clinic, amount, recurring: form.recurring, paymentMethod: form.paymentMethod, status: "submitted", receiptAttached: false },
        ...draft.expenses,
      ];
    });
    logAuditEvent({ actor, module: "Expenses", action: `Added expense ${form.vendor} ${fmtMoney(amount)}`, newValue: form.category });
    setAddOpen(false);
    setForm({ ...form, vendor: "", amount: "" });
  }

  function setStatus(exp: BankExpense, status: BankExpense["status"]) {
    updateBank((draft) => {
      draft.expenses = draft.expenses.map((e) => (e.id === exp.id ? { ...e, status } : e));
    });
    logAuditEvent({ actor, module: "Expenses", action: `Expense ${exp.vendor} ${fmtMoney(exp.amount)} → ${status}`, oldValue: exp.status, newValue: status });
  }

  return (
    <div data-testid="bank-expenses">
      <ModuleHeader
        title="Expenses"
        subtitle="Operating expense tracking with approval workflow."
        actions={<BankButton onClick={() => setAddOpen(true)} testId="expense-add-open"><Plus className="h-3 w-3" /> Add expense</BankButton>}
      />
      <Panel className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="expenses-table">
          <thead className="border-b border-slate-100 bg-slate-50/70"><tr><Th>Date</Th><Th>Vendor</Th><Th>Category</Th><Th>Clinic</Th><Th>Amount</Th><Th>Recurring</Th><Th>Method</Th><Th>Receipt</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60" data-testid={`expense-row-${e.id}`}>
                <Td>{e.date}</Td>
                <Td className="font-semibold">{e.vendor}</Td>
                <Td>{e.category}</Td>
                <Td>{e.clinic}</Td>
                <Td className="font-semibold">{fmtMoney(e.amount)}</Td>
                <Td>{e.recurring ? "Yes" : "—"}</Td>
                <Td>{e.paymentMethod}</Td>
                <Td>{e.receiptAttached ? "Attached" : <span className="italic text-slate-400">upload placeholder</span>}</Td>
                <Td><StatusBadge value={e.status} testId={`expense-status-${e.id}`} /></Td>
                <Td>
                  <div className="flex gap-1">
                    {e.status === "submitted" && (
                      <>
                        <BankButton size="xs" onClick={() => setStatus(e, "approved")} testId={`expense-approve-${e.id}`}>Approve</BankButton>
                        <BankButton size="xs" variant="danger" onClick={() => setStatus(e, "rejected")} testId={`expense-reject-${e.id}`}>Reject</BankButton>
                      </>
                    )}
                    {e.status === "approved" && <BankButton size="xs" onClick={() => setStatus(e, "paid")} testId={`expense-pay-${e.id}`}>Mark paid</BankButton>}
                  </div>
                </Td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-xs italic text-slate-400">No expenses match the current filters.</td></tr>}
          </tbody>
        </table>
      </Panel>

      <BankModal open={addOpen} onClose={() => setAddOpen(false)} title="Add expense" wide>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor / payee"><input className={inputCls} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} data-testid="expense-form-vendor" /></Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="expense-form-category">
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Clinic">
            <select className={inputCls} value={form.clinic} onChange={(e) => setForm({ ...form, clinic: e.target.value })} data-testid="expense-form-clinic">
              {BANK_CLINICS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Amount ($)"><input type="number" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="expense-form-amount" /></Field>
          <Field label="Date"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="expense-form-date" /></Field>
          <Field label="Payment method">
            <select className={inputCls} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} data-testid="expense-form-method">
              <option>ACH</option><option>Card •• token</option><option>Check</option><option>Wire</option>
            </select>
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} data-testid="expense-form-recurring" /> Recurring expense
        </label>
        <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-[11px] italic text-slate-400">
          Receipt upload placeholder — attach files when document storage is wired in.
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <BankButton variant="secondary" onClick={() => setAddOpen(false)}>Cancel</BankButton>
          <BankButton onClick={addExpense} disabled={!form.vendor.trim() || !parseFloat(form.amount)} testId="expense-form-submit">Submit expense</BankButton>
        </div>
      </BankModal>
    </div>
  );
}
