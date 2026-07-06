import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Send, RotateCcw, StickyNote, X, Landmark } from "lucide-react";
import {
  usePlexusBank,
  updateBank,
  logAuditEvent,
  bankId,
  fmtMoney,
  BANK_CLINICS,
  CLINIC_REGION,
  BANK_SERVICES,
  type BankInvoice,
} from "@/pages/plexus-bank/mockData";

const STATUS_TONE: Record<BankInvoice["status"], string> = {
  Draft: "bg-slate-100 text-slate-600",
  Sent: "bg-blue-50 text-blue-700",
  Paid: "bg-emerald-50 text-emerald-700",
  Unpaid: "bg-amber-50 text-amber-700",
  Overdue: "bg-red-50 text-red-700",
  Void: "bg-slate-100 text-slate-400 line-through",
  "Partially Paid": "bg-indigo-50 text-indigo-700",
};

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#0d1b3e] focus:ring-1 focus:ring-[#0d1b3e]/30";

export default function InvoiceDeskPanel() {
  const bank = usePlexusBank();
  const { data: me } = useQuery<{ username?: string } | null>({ queryKey: ["/api/auth/me"] });
  const actor = me?.username ?? "Team Portal User";

  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const [form, setForm] = useState({
    patient: "",
    patientEmail: "",
    clinic: BANK_CLINICS[0] as string,
    service: BANK_SERVICES[0]?.service ?? "",
    amount: "",
    dueDate: "",
  });

  const invoices = useMemo(
    () =>
      [...bank.invoices].sort((a, b) => (a.issuedDate < b.issuedDate ? 1 : -1)),
    [bank.invoices],
  );

  const detail = invoices.find((i) => i.id === detailId) ?? null;

  function createInvoice(sendNow: boolean) {
    const amount = Number(form.amount);
    if (!form.patient.trim() || !amount || amount <= 0) return;
    const id = bankId("inv");
    const number = `INV-${String(1000 + bank.invoices.length + 1)}`;
    const today = new Date().toISOString().slice(0, 10);
    const invoice: BankInvoice = {
      id,
      number,
      patient: form.patient.trim(),
      patientEmail: form.patientEmail.trim(),
      clinic: form.clinic,
      region: CLINIC_REGION[form.clinic] ?? "",
      service: form.service,
      amount,
      balance: amount,
      status: sendNow ? "Sent" : "Draft",
      issuedDate: today,
      dueDate: form.dueDate || today,
      sentBy: sendNow ? actor : "",
      source: "teamPortal",
      paymentLink: sendNow ? `https://pay.plexus.example/${number.toLowerCase()}` : null,
      resendHistory: [],
      payments: [],
      adjustments: [],
      contactNotes: [],
      paymentPlan: null,
      batchId: null,
    };
    updateBank((draft) => {
      draft.invoices = [invoice, ...draft.invoices];
    });
    logAuditEvent({
      actor,
      module: "Invoice Desk (Team Portal)",
      action: sendNow ? `Created and sent invoice ${number}` : `Created draft invoice ${number}`,
      newValue: `${invoice.patient} · ${fmtMoney(amount)}`,
    });
    setShowCreate(false);
    setForm({ patient: "", patientEmail: "", clinic: BANK_CLINICS[0], service: BANK_SERVICES[0]?.service ?? "", amount: "", dueDate: "" });
  }

  function sendInvoice(inv: BankInvoice) {
    updateBank((draft) => {
      draft.invoices = draft.invoices.map((i) =>
        i.id === inv.id
          ? {
              ...i,
              status: "Sent" as const,
              sentBy: actor,
              paymentLink: i.paymentLink ?? `https://pay.plexus.example/${i.number.toLowerCase()}`,
            }
          : i,
      );
    });
    logAuditEvent({
      actor,
      module: "Invoice Desk (Team Portal)",
      action: `Sent invoice ${inv.number}`,
      oldValue: inv.status,
      newValue: "Sent",
    });
  }

  function resendInvoice(inv: BankInvoice) {
    const entry = { date: new Date().toISOString().slice(0, 10), by: actor, channel: "email" };
    updateBank((draft) => {
      draft.invoices = draft.invoices.map((i) =>
        i.id === inv.id ? { ...i, resendHistory: [...i.resendHistory, entry] } : i,
      );
    });
    logAuditEvent({
      actor,
      module: "Invoice Desk (Team Portal)",
      action: `Resent invoice ${inv.number} via email`,
    });
  }

  function addContactNote(inv: BankInvoice) {
    const note = noteDraft.trim();
    if (!note) return;
    const entry = { date: new Date().toISOString().slice(0, 10), by: actor, note };
    updateBank((draft) => {
      draft.invoices = draft.invoices.map((i) =>
        i.id === inv.id ? { ...i, contactNotes: [...i.contactNotes, entry] } : i,
      );
    });
    logAuditEvent({
      actor,
      module: "Invoice Desk (Team Portal)",
      action: `Added contact note to invoice ${inv.number}`,
      newValue: note.slice(0, 80),
    });
    setNoteDraft("");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0d1b3e] text-white">
            <Landmark className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[15px] font-semibold text-slate-900" data-testid="text-invoice-desk-title">
              Invoice Desk
            </div>
            <div className="text-xs text-slate-500">
              Create and send patient invoices. Full billing controls live in Plexus Bank.
            </div>
          </div>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d1b3e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#16295c]"
          onClick={() => setShowCreate((v) => !v)}
          data-testid="button-invoice-desk-new"
        >
          <Plus className="h-3.5 w-3.5" /> New Invoice
        </button>
      </div>

      {showCreate && (
        <div className="border-b border-slate-100 bg-slate-50/60 px-6 py-4" data-testid="panel-invoice-desk-create">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Patient</label>
              <input className={inputCls} value={form.patient} onChange={(e) => setForm({ ...form, patient: e.target.value })} placeholder="Patient name" data-testid="input-invoice-desk-patient" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email</label>
              <input className={inputCls} value={form.patientEmail} onChange={(e) => setForm({ ...form, patientEmail: e.target.value })} placeholder="patient@email.com" data-testid="input-invoice-desk-email" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Clinic</label>
              <select className={inputCls} value={form.clinic} onChange={(e) => setForm({ ...form, clinic: e.target.value })} data-testid="select-invoice-desk-clinic">
                {BANK_CLINICS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Service</label>
              <select className={inputCls} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} data-testid="select-invoice-desk-service">
                {BANK_SERVICES.map((s) => (
                  <option key={s.service} value={s.service}>{s.service}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Amount ($)</label>
              <input className={inputCls} type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" data-testid="input-invoice-desk-amount" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Due Date</label>
              <input className={inputCls} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} data-testid="input-invoice-desk-due" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-lg bg-[#0d1b3e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#16295c] disabled:opacity-40"
              disabled={!form.patient.trim() || !Number(form.amount)}
              onClick={() => createInvoice(true)}
              data-testid="button-invoice-desk-create-send"
            >
              Create &amp; Send
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              disabled={!form.patient.trim() || !Number(form.amount)}
              onClick={() => createInvoice(false)}
              data-testid="button-invoice-desk-create-draft"
            >
              Save Draft
            </button>
            <button
              className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
              onClick={() => setShowCreate(false)}
              data-testid="button-invoice-desk-create-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3 font-semibold">Invoice</th>
                <th className="px-3 py-3 font-semibold">Patient</th>
                <th className="px-3 py-3 font-semibold">Amount</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Due</th>
                <th className="px-3 py-3 font-semibold">Source</th>
                <th className="px-6 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className={`cursor-pointer border-b border-slate-50 hover:bg-slate-50/70 ${detailId === inv.id ? "bg-slate-50" : ""}`}
                  onClick={() => setDetailId(inv.id)}
                  data-testid={`row-invoice-desk-${inv.id}`}
                >
                  <td className="px-6 py-3 font-medium text-slate-800">{inv.number}</td>
                  <td className="px-3 py-3 text-slate-700">{inv.patient}</td>
                  <td className="px-3 py-3 tabular-nums text-slate-800">{fmtMoney(inv.amount)}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[inv.status]}`} data-testid={`status-invoice-desk-${inv.id}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-500">{inv.dueDate}</td>
                  <td className="px-3 py-3 text-[11px] text-slate-400">{inv.source === "teamPortal" ? "Team Portal" : "Plexus Bank"}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {inv.status === "Draft" && (
                        <button
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => sendInvoice(inv)}
                          data-testid={`button-invoice-desk-send-${inv.id}`}
                        >
                          <Send className="h-3 w-3" /> Send
                        </button>
                      )}
                      {inv.status !== "Draft" && inv.status !== "Void" && inv.status !== "Paid" && (
                        <button
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => resendInvoice(inv)}
                          data-testid={`button-invoice-desk-resend-${inv.id}`}
                        >
                          <RotateCcw className="h-3 w-3" /> Resend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-400">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {detail && (
          <div className="w-[340px] shrink-0 overflow-y-auto border-l border-slate-100 bg-slate-50/40 px-5 py-4" data-testid="panel-invoice-desk-detail">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">{detail.number}</div>
                <div className="text-xs text-slate-500">{detail.patient} · {detail.clinic}</div>
              </div>
              <button className="rounded-md p-1 text-slate-400 hover:text-slate-600" onClick={() => setDetailId(null)} data-testid="button-invoice-desk-detail-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-500">Service</span><span className="font-medium text-slate-800">{detail.service}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-medium tabular-nums text-slate-800">{fmtMoney(detail.amount)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Balance</span><span className="font-medium tabular-nums text-slate-800">{fmtMoney(detail.balance)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Status</span><span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[detail.status]}`}>{detail.status}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Issued</span><span className="text-slate-700">{detail.issuedDate}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Due</span><span className="text-slate-700">{detail.dueDate}</span></div>
              {detail.paymentLink && (
                <div className="truncate rounded-md bg-white px-2 py-1.5 text-[11px] text-blue-700">{detail.paymentLink}</div>
              )}
            </div>

            {detail.resendHistory.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Resend History</div>
                <div className="space-y-1">
                  {detail.resendHistory.map((r, i) => (
                    <div key={i} className="rounded-md bg-white px-2 py-1.5 text-[11px] text-slate-600">
                      {r.date} · {r.by} · {r.channel}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <StickyNote className="h-3 w-3" /> Contact Notes
              </div>
              <div className="space-y-1">
                {detail.contactNotes.map((n, i) => (
                  <div key={i} className="rounded-md bg-white px-2 py-1.5 text-[11px] text-slate-600" data-testid={`text-invoice-desk-note-${detail.id}-${i}`}>
                    <span className="font-medium text-slate-700">{n.by}</span> · {n.date}
                    <div>{n.note}</div>
                  </div>
                ))}
                {detail.contactNotes.length === 0 && (
                  <div className="text-[11px] text-slate-400">No contact notes yet.</div>
                )}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-[#0d1b3e]"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Log a patient contact..."
                  data-testid="input-invoice-desk-note"
                />
                <button
                  className="rounded-md bg-[#0d1b3e] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#16295c] disabled:opacity-40"
                  disabled={!noteDraft.trim()}
                  onClick={() => addContactNote(detail)}
                  data-testid="button-invoice-desk-note-add"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
              Payments, refunds, adjustments, and voids are managed in Plexus Bank by billing admins.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
