import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { Receipt, Plus, Download, ArrowLeft, Send, FileText, Trash2 } from "lucide-react";
import { VALID_FACILITIES, DEFAULT_CLINIC, CLINIC_HUMBLE, formatClinicAddress, type ClinicProfile } from "@shared/plexus";

type Invoice = {
  id: number;
  invoiceNumber: string;
  facility: string;
  invoiceDate: string;
  fromDate: string | null;
  toDate: string | null;
  status: "Draft" | "Sent";
  notes: string | null;
  totalCharges: string;
  totalPaid: string;
  totalBalance: string;
  createdAt: string;
};

type InvoiceLineItem = {
  id: number;
  invoiceId: number;
  billingRecordId: number | null;
  patientName: string;
  dateOfService: string | null;
  service: string;
  mrn: string | null;
  clinician: string | null;
  totalCharges: string | null;
  paidAmount: string | null;
  balanceRemaining: string | null;
};

function fmtMoney(v: string | null | undefined): string {
  if (v == null || v === "") return "$0.00";
  const n = parseFloat(v);
  return isNaN(n) ? "$0.00" : `$${n.toFixed(2)}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const parts = d.split("-").map(Number);
  if (parts.length !== 3) return d;
  const [yyyy, mm, dd] = parts;
  return new Date(yyyy, mm - 1, dd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function clinicForFacility(facility: string): ClinicProfile {
  if (facility === "Taylor Family Practice") return CLINIC_HUMBLE;
  return { ...DEFAULT_CLINIC, name: facility };
}

function statusBadgeClass(status: string): string {
  if (status === "Sent") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function InvoicesPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (selectedId != null) {
    return <InvoiceDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return <InvoicesList onOpen={(id) => setSelectedId(id)} />;
}

function InvoicesList({ onOpen }: { onOpen: (id: number) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [filterFacility, setFilterFacility] = useState<string>("");

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const filtered = useMemo(() => {
    if (!filterFacility) return invoices;
    return invoices.filter((i) => i.facility === filterFacility);
  }, [invoices, filterFacility]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        subtitle="Generate and manage clinic invoices from billing records"
        icon={Receipt}
        iconAccent="bg-emerald-100 text-emerald-700"
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-invoice">
            <Plus className="w-4 h-4 mr-1.5" />
            New Invoice
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex items-center gap-3 mb-4">
          <Label className="text-xs text-slate-500">Filter by clinic:</Label>
          <Select value={filterFacility || "__all"} onValueChange={(v) => setFilterFacility(v === "__all" ? "" : v)}>
            <SelectTrigger className="w-64" data-testid="select-filter-facility">
              <SelectValue placeholder="All clinics" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All clinics</SelectItem>
              {VALID_FACILITIES.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Loading invoices…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center" data-testid="empty-invoices">
            <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">No invoices yet.</p>
            <p className="text-xs text-slate-400 mt-1">Click "New Invoice" to generate one for a clinic.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2">Invoice #</th>
                  <th className="px-3 py-2">Clinic</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Total Charges</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => onOpen(inv.id)}
                    data-testid={`row-invoice-${inv.id}`}
                  >
                    <td className="px-3 py-2.5 font-mono text-[12px] font-medium text-slate-900" data-testid={`text-invoice-number-${inv.id}`}>{inv.invoiceNumber}</td>
                    <td className="px-3 py-2.5 text-slate-700">{inv.facility}</td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(inv.invoiceDate)}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">
                      {inv.fromDate || inv.toDate ? `${fmtDate(inv.fromDate)} – ${fmtDate(inv.toDate)}` : "All dates"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtMoney(inv.totalCharges)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">{fmtMoney(inv.totalBalance)}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={statusBadgeClass(inv.status)} data-testid={`badge-status-${inv.id}`}>
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete invoice ${inv.invoiceNumber}?`)) return;
                          apiRequest("DELETE", `/api/invoices/${inv.id}`)
                            .then(() => {
                              queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
                              toast({ title: "Invoice deleted" });
                            })
                            .catch((err) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }));
                        }}
                        data-testid={`button-delete-invoice-${inv.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateInvoiceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); onOpen(id); }}
      />
    </div>
  );
}

function CreateInvoiceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [facility, setFacility] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invoices", {
        facility,
        invoiceDate,
        fromDate: fromDate || null,
        toDate: toDate || null,
        notes: notes || null,
      });
      return res.json() as Promise<Invoice>;
    },
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice created", description: inv.invoiceNumber });
      setFacility("");
      setFromDate("");
      setToDate("");
      setNotes("");
      onCreated(inv.id);
    },
    onError: (e: Error) => toast({ title: "Failed to create invoice", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-create-invoice">
        <DialogHeader>
          <DialogTitle>Generate New Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="invoice-facility">Clinic</Label>
            <Select value={facility} onValueChange={setFacility}>
              <SelectTrigger id="invoice-facility" data-testid="select-invoice-facility">
                <SelectValue placeholder="Select a clinic" />
              </SelectTrigger>
              <SelectContent>
                {VALID_FACILITIES.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="invoice-date">Invoice Date</Label>
            <Input id="invoice-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} data-testid="input-invoice-date" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="from-date">DOS From (optional)</Label>
              <Input id="from-date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} data-testid="input-from-date" />
            </div>
            <div>
              <Label htmlFor="to-date">DOS To (optional)</Label>
              <Input id="to-date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} data-testid="input-to-date" />
            </div>
          </div>
          <div>
            <Label htmlFor="invoice-notes">Notes (optional)</Label>
            <Textarea id="invoice-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-invoice-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!facility || !invoiceDate || create.isPending}
            data-testid="button-submit-create-invoice"
          >
            {create.isPending ? "Generating…" : "Generate Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading } = useQuery<{ invoice: Invoice; lineItems: InvoiceLineItem[] }>({
    queryKey: ["/api/invoices", id],
  });

  const markSent = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/invoices/${id}/status`, { status: "Sent" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice marked as Sent" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  async function handleDownloadPdf() {
    if (!printRef.current || !data) return;
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const safeFacility = data.invoice.facility.replace(/[^A-Za-z0-9-]+/g, "_");
      const filename = `${data.invoice.invoiceNumber}_${safeFacility}.pdf`;
      const options = {
        margin: [0.4, 0.4, 0.4, 0.4],
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      } as unknown as Parameters<ReturnType<typeof html2pdf>["set"]>[0];
      await html2pdf().set(options).from(printRef.current).save();
    } catch (err: any) {
      toast({ title: "PDF export failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="text-sm text-slate-400">Loading invoice…</div>
      </div>
    );
  }

  const { invoice, lineItems } = data;
  const clinic = clinicForFacility(invoice.facility);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-invoices">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Invoices
        </Button>
        <div className="flex items-center gap-2">
          {invoice.status === "Draft" && (
            <Button variant="outline" onClick={() => markSent.mutate()} disabled={markSent.isPending} data-testid="button-mark-sent">
              <Send className="w-4 h-4 mr-1.5" />
              {markSent.isPending ? "Saving…" : "Mark as Sent"}
            </Button>
          )}
          <Button onClick={handleDownloadPdf} disabled={downloading} data-testid="button-download-pdf">
            <Download className="w-4 h-4 mr-1.5" />
            {downloading ? "Generating…" : "Download PDF"}
          </Button>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div ref={printRef} className="bg-white p-10" data-testid="invoice-printable">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6 mb-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Bill To</div>
              <div className="text-lg font-semibold text-slate-900" data-testid="text-detail-facility">{invoice.facility}</div>
              <pre className="text-sm text-slate-600 mt-1 whitespace-pre-wrap font-sans">{formatClinicAddress(clinic)}</pre>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900">INVOICE</div>
              <div className="mt-2 text-sm">
                <div className="text-slate-500">Invoice #</div>
                <div className="font-mono font-medium text-slate-900" data-testid="text-detail-invoice-number">{invoice.invoiceNumber}</div>
              </div>
              <div className="mt-2 text-sm">
                <div className="text-slate-500">Date</div>
                <div className="text-slate-900">{fmtDate(invoice.invoiceDate)}</div>
              </div>
              {(invoice.fromDate || invoice.toDate) && (
                <div className="mt-2 text-sm">
                  <div className="text-slate-500">Service Period</div>
                  <div className="text-slate-900">{fmtDate(invoice.fromDate)} – {fmtDate(invoice.toDate)}</div>
                </div>
              )}
              <div className="mt-3">
                <Badge variant="outline" className={statusBadgeClass(invoice.status)}>{invoice.status}</Badge>
              </div>
            </div>
          </div>

          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[11px] uppercase text-slate-500 bg-slate-50">
                <th className="px-3 py-2 font-semibold">Patient</th>
                <th className="px-3 py-2 font-semibold">DOS</th>
                <th className="px-3 py-2 font-semibold">Service</th>
                <th className="px-3 py-2 font-semibold">MRN</th>
                <th className="px-3 py-2 font-semibold">Clinician</th>
                <th className="px-3 py-2 font-semibold text-right">Charges</th>
                <th className="px-3 py-2 font-semibold text-right">Paid</th>
                <th className="px-3 py-2 font-semibold text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id} className="border-b border-slate-100" data-testid={`row-line-item-${li.id}`}>
                  <td className="px-3 py-2 text-slate-800">{li.patientName}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(li.dateOfService)}</td>
                  <td className="px-3 py-2 text-slate-700">{li.service}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{li.mrn ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{li.clinician ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtMoney(li.totalCharges)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtMoney(li.paidAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{fmtMoney(li.balanceRemaining)}</td>
                </tr>
              ))}
              {lineItems.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400 text-sm">No line items.</td></tr>
              )}
            </tbody>
          </table>

          <div className="mt-6 flex justify-end">
            <div className="w-72 space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Total Charges</span>
                <span className="tabular-nums" data-testid="text-total-charges">{fmtMoney(invoice.totalCharges)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Total Paid</span>
                <span className="tabular-nums" data-testid="text-total-paid">{fmtMoney(invoice.totalPaid)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
                <span>Balance Due</span>
                <span className="tabular-nums" data-testid="text-total-balance">{fmtMoney(invoice.totalBalance)}</span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-8 pt-4 border-t border-slate-200">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Notes</div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
