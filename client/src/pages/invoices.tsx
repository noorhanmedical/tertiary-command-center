import { useState, useMemo, useRef, useEffect } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { Receipt, Plus, Download, ArrowLeft, Send, FileText, Trash2, Mail, TrendingUp, Wallet, AlertTriangle } from "lucide-react";
import { VALID_FACILITIES, DEFAULT_CLINIC, CLINIC_HUMBLE, formatClinicAddress, type ClinicProfile } from "@shared/plexus";

type AgingBucket = "0-30" | "31-60" | "60+";

type AgingClinicRow = {
  facility: string;
  invoiceCount: number;
  totalBalance: string;
  buckets: Record<AgingBucket, string>;
  bucketCounts: Record<AgingBucket, number>;
};

type AgingResponse = {
  clinics: AgingClinicRow[];
  totals: {
    totalBalance: string;
    invoiceCount: number;
    buckets: Record<AgingBucket, string>;
    bucketCounts: Record<AgingBucket, number>;
  };
};

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
  sentTo: string | null;
  sentAt: string | null;
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

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  if (status === "Sent") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function InvoicesPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<"overview" | "list">("overview");
  const [filterFacility, setFilterFacility] = useState<string>("");
  const [filterBucket, setFilterBucket] = useState<AgingBucket | "">("");

  if (selectedId != null) {
    return <InvoiceDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return (
    <InvoicesShell
      tab={tab}
      setTab={setTab}
      filterFacility={filterFacility}
      setFilterFacility={setFilterFacility}
      filterBucket={filterBucket}
      setFilterBucket={setFilterBucket}
      onOpen={(id) => setSelectedId(id)}
    />
  );
}

function InvoicesShell({
  tab,
  setTab,
  filterFacility,
  setFilterFacility,
  filterBucket,
  setFilterBucket,
  onOpen,
}: {
  tab: "overview" | "list";
  setTab: (t: "overview" | "list") => void;
  filterFacility: string;
  setFilterFacility: (v: string) => void;
  filterBucket: AgingBucket | "";
  setFilterBucket: (v: AgingBucket | "") => void;
  onOpen: (id: number) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);

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

      <Tabs value={tab} onValueChange={(v) => setTab(v as "overview" | "list")}>
        <TabsList data-testid="tabs-invoices">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <TrendingUp className="w-4 h-4 mr-1.5" /> Billing Overview
          </TabsTrigger>
          <TabsTrigger value="list" data-testid="tab-list">
            <FileText className="w-4 h-4 mr-1.5" /> Invoices
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <BillingOverview
            onSelectClinic={(facility) => {
              setFilterFacility(facility);
              setFilterBucket("");
              setTab("list");
            }}
            onSelectBucket={(bucket, facility) => {
              setFilterBucket(bucket);
              setFilterFacility(facility ?? "");
              setTab("list");
            }}
          />
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          <InvoicesList
            onOpen={onOpen}
            filterFacility={filterFacility}
            setFilterFacility={setFilterFacility}
            filterBucket={filterBucket}
            setFilterBucket={setFilterBucket}
          />
        </TabsContent>
      </Tabs>

      <CreateInvoiceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); onOpen(id); }}
      />
    </div>
  );
}

function bucketForDate(invoiceDate: string): AgingBucket {
  const parts = invoiceDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return "0-30";
  const [y, m, d] = parts;
  const t = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.floor((today - t) / 86400000);
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  return "60+";
}

function fmtMoneyNum(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function BillingOverview({
  onSelectClinic,
  onSelectBucket,
}: {
  onSelectClinic: (facility: string) => void;
  onSelectBucket: (bucket: AgingBucket, facility?: string) => void;
}) {
  const { data, isLoading } = useQuery<AgingResponse>({
    queryKey: ["/api/invoices/aging"],
  });

  if (isLoading || !data) {
    return <div className="py-12 text-center text-slate-400 text-sm">Loading overview…</div>;
  }

  const { clinics, totals } = data;
  const totalBal = parseFloat(totals.totalBalance);

  const bucketMeta: { key: AgingBucket; label: string; tone: string; icon: typeof Wallet }[] = [
    { key: "0-30", label: "0–30 days", tone: "bg-emerald-50 border-emerald-200 text-emerald-800", icon: Wallet },
    { key: "31-60", label: "31–60 days", tone: "bg-amber-50 border-amber-200 text-amber-800", icon: TrendingUp },
    { key: "60+", label: "60+ days", tone: "bg-red-50 border-red-200 text-red-800", icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4" data-testid="card-total-outstanding">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Total Outstanding</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums" data-testid="text-total-outstanding">
            {fmtMoneyNum(totalBal)}
          </div>
          <div className="text-xs text-slate-500 mt-1">{totals.invoiceCount} unpaid invoice{totals.invoiceCount === 1 ? "" : "s"}</div>
        </Card>
        {bucketMeta.map((b) => {
          const amt = parseFloat(totals.buckets[b.key]);
          const cnt = totals.bucketCounts[b.key];
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onSelectBucket(b.key)}
              disabled={cnt === 0}
              className={`text-left p-4 rounded-lg border transition-all ${b.tone} ${cnt > 0 ? "hover-elevate cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
              data-testid={`card-bucket-${b.key}`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs uppercase tracking-wider font-semibold">{b.label}</div>
                <b.icon className="w-4 h-4 opacity-70" />
              </div>
              <div className="text-2xl font-bold tabular-nums" data-testid={`text-bucket-amount-${b.key}`}>
                {fmtMoneyNum(amt)}
              </div>
              <div className="text-xs opacity-80 mt-1">{cnt} invoice{cnt === 1 ? "" : "s"}</div>
            </button>
          );
        })}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-800 text-sm">Outstanding Balances by Clinic</div>
            <div className="text-xs text-slate-500">Click a clinic or aging bucket to filter the invoice list.</div>
          </div>
        </div>
        {clinics.length === 0 ? (
          <div className="py-16 text-center" data-testid="empty-overview">
            <Wallet className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">No outstanding balances.</p>
            <p className="text-xs text-slate-400 mt-1">All invoices are paid in full.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-2.5">Clinic</th>
                  <th className="px-3 py-2.5 text-right">Invoices</th>
                  <th className="px-3 py-2.5 text-right">0–30 days</th>
                  <th className="px-3 py-2.5 text-right">31–60 days</th>
                  <th className="px-3 py-2.5 text-right">60+ days</th>
                  <th className="px-4 py-2.5 text-right">Total Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map((c) => (
                  <tr
                    key={c.facility}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => onSelectClinic(c.facility)}
                    data-testid={`row-overview-${c.facility.replace(/\s+/g, "-")}`}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-900" data-testid={`text-overview-clinic-${c.facility.replace(/\s+/g, "-")}`}>
                      {c.facility}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{c.invoiceCount}</td>
                    {(["0-30", "31-60", "60+"] as AgingBucket[]).map((b) => {
                      const amt = parseFloat(c.buckets[b]);
                      const cnt = c.bucketCounts[b];
                      return (
                        <td key={b} className="px-3 py-2.5 text-right">
                          {cnt > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onSelectBucket(b, c.facility); }}
                              className={`tabular-nums px-2 py-0.5 rounded font-medium hover:underline ${
                                b === "60+" ? "text-red-700" : b === "31-60" ? "text-amber-700" : "text-slate-700"
                              }`}
                              data-testid={`button-overview-bucket-${c.facility.replace(/\s+/g, "-")}-${b}`}
                            >
                              {fmtMoneyNum(amt)}
                            </button>
                          ) : (
                            <span className="text-slate-300 tabular-nums">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900" data-testid={`text-overview-total-${c.facility.replace(/\s+/g, "-")}`}>
                      {fmtMoneyNum(parseFloat(c.totalBalance))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td className="px-4 py-2.5 font-semibold text-slate-700 text-xs uppercase">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-700">{totals.invoiceCount}</td>
                  {(["0-30", "31-60", "60+"] as AgingBucket[]).map((b) => (
                    <td key={b} className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-700">
                      {fmtMoneyNum(parseFloat(totals.buckets[b]))}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-900">
                    {fmtMoneyNum(totalBal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function InvoicesList({
  onOpen,
  filterFacility,
  setFilterFacility,
  filterBucket,
  setFilterBucket,
}: {
  onOpen: (id: number) => void;
  filterFacility: string;
  setFilterFacility: (v: string) => void;
  filterBucket: AgingBucket | "";
  setFilterBucket: (v: AgingBucket | "") => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const filtered = useMemo(() => {
    return invoices.filter((i) => {
      if (filterFacility && i.facility !== filterFacility) return false;
      if (filterBucket) {
        if (parseFloat(i.totalBalance) <= 0.005) return false;
        if (bucketForDate(i.invoiceDate) !== filterBucket) return false;
      }
      return true;
    });
  }, [invoices, filterFacility, filterBucket]);

  const bucketLabel: Record<AgingBucket, string> = { "0-30": "0–30 days", "31-60": "31–60 days", "60+": "60+ days" };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3 mb-4">
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
        {filterBucket && (
          <Badge
            variant="outline"
            className="bg-amber-50 border-amber-200 text-amber-800 cursor-pointer hover:bg-amber-100"
            onClick={() => setFilterBucket("")}
            data-testid="badge-bucket-filter"
          >
            Aging: {bucketLabel[filterBucket]} <span className="ml-1.5 text-amber-600">×</span>
          </Badge>
        )}
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
                  <th className="px-3 py-2">Emailed</th>
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
                    <td className="px-3 py-2.5 text-xs text-slate-500" data-testid={`text-emailed-${inv.id}`}>
                      {inv.sentAt ? (
                        <div className="flex flex-col leading-tight">
                          <span className="text-slate-700">{fmtDateTime(inv.sentAt)}</span>
                          {inv.sentTo && <span className="text-slate-500 truncate max-w-[200px]" title={inv.sentTo}>to {inv.sentTo}</span>}
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
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
                              queryClient.invalidateQueries({ queryKey: ["/api/invoices/aging"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/aging"] });
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

type Html2PdfOptions = Parameters<ReturnType<typeof import("html2pdf.js")["default"]>["set"]>[0];

function pdfOptionsFor(invoice: Invoice): { filename: string; options: Html2PdfOptions } {
  const safeFacility = invoice.facility.replace(/[^A-Za-z0-9-]+/g, "_");
  const filename = `${invoice.invoiceNumber}_${safeFacility}.pdf`;
  const options = {
    margin: [0.4, 0.4, 0.4, 0.4],
    filename,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
  } as unknown as Html2PdfOptions;
  return { filename, options };
}

function InvoiceDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const { data, isLoading } = useQuery<{ invoice: Invoice; lineItems: InvoiceLineItem[] }>({
    queryKey: ["/api/invoices", id],
  });

  async function handleDownloadPdf() {
    if (!printRef.current || !data) return;
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const { options } = pdfOptionsFor(data.invoice);
      await html2pdf().set(options).from(printRef.current).save();
    } catch (err: any) {
      toast({ title: "PDF export failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  async function generatePdfBase64(): Promise<{ base64: string; filename: string }> {
    if (!printRef.current || !data) throw new Error("Invoice is not ready.");
    const html2pdf = (await import("html2pdf.js")).default;
    const { options, filename } = pdfOptionsFor(data.invoice);
    const blob: Blob = await html2pdf().set(options).from(printRef.current).outputPdf("blob");
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return { base64: btoa(binary), filename };
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
          <Button variant="outline" onClick={() => setEmailOpen(true)} data-testid="button-email-invoice">
            <Mail className="w-4 h-4 mr-1.5" />
            Email Invoice
          </Button>
          <Button onClick={handleDownloadPdf} disabled={downloading} data-testid="button-download-pdf">
            <Download className="w-4 h-4 mr-1.5" />
            {downloading ? "Generating…" : "Download PDF"}
          </Button>
        </div>
      </div>

      {invoice.sentAt && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 print:hidden" data-testid="banner-invoice-sent">
          <Send className="w-3.5 h-3.5" />
          <span>
            Emailed {invoice.sentTo ? <>to <span className="font-medium">{invoice.sentTo}</span></> : null} on {fmtDateTime(invoice.sentAt)}
          </span>
        </div>
      )}

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

      <EmailInvoiceDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        invoice={invoice}
        clinic={clinic}
        generatePdfBase64={generatePdfBase64}
      />
    </div>
  );
}

function EmailInvoiceDialog({
  open,
  onClose,
  invoice,
  clinic,
  generatePdfBase64,
}: {
  open: boolean;
  onClose: () => void;
  invoice: Invoice;
  clinic: ClinicProfile;
  generatePdfBase64: () => Promise<{ base64: string; filename: string }>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const defaultTo = clinic.billingContactEmail ?? "";
  const defaultSubject = `Invoice ${invoice.invoiceNumber} from ${clinic.name}`;
  const defaultMessage =
    `Hello,\n\n` +
    `Please find attached invoice ${invoice.invoiceNumber} from ${clinic.name} ` +
    `for services dated ${fmtDate(invoice.invoiceDate)}.\n\n` +
    `Total amount due: $${parseFloat(invoice.totalBalance || "0").toFixed(2)}.\n\n` +
    `Please reply to this email with any questions.\n\n` +
    `Thank you,\nBilling Team`;

  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);

  // Reset fields each time the dialog reopens for a given invoice.
  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setCc("");
      setSubject(defaultSubject);
      setMessage(defaultMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice.id]);

  function splitAddresses(input: string): string[] {
    return input
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const send = useMutation({
    mutationFn: async () => {
      const toList = splitAddresses(to);
      const ccList = splitAddresses(cc);
      if (toList.length === 0) throw new Error("At least one recipient is required.");

      const { base64, filename } = await generatePdfBase64();
      const res = await apiRequest("POST", `/api/invoices/${invoice.id}/send-email`, {
        to: toList,
        cc: ccList,
        subject,
        message,
        pdfBase64: base64,
        pdfFilename: filename,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoice.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice emailed", description: `Sent to ${to}` });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Failed to send invoice", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-email-invoice">
        <DialogHeader>
          <DialogTitle>Email Invoice {invoice.invoiceNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="email-to">To <span className="text-slate-400 text-xs">(comma-separated)</span></Label>
            <Input
              id="email-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="billing@clinic.com"
              data-testid="input-email-to"
            />
            {!clinic.billingContactEmail && (
              <p className="text-xs text-slate-400 mt-1">No billing contact on file for this clinic — enter one above.</p>
            )}
          </div>
          <div>
            <Label htmlFor="email-cc">CC <span className="text-slate-400 text-xs">(optional)</span></Label>
            <Input
              id="email-cc"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder=""
              data-testid="input-email-cc"
            />
          </div>
          <div>
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              data-testid="input-email-subject"
            />
          </div>
          <div>
            <Label htmlFor="email-message">Message</Label>
            <Textarea
              id="email-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              data-testid="input-email-message"
            />
          </div>
          <p className="text-xs text-slate-500">
            The invoice PDF will be attached automatically. Sending will mark this invoice as Sent.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={send.isPending} data-testid="button-cancel-email">
            Cancel
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={send.isPending || !to.trim() || !subject.trim() || !message.trim()}
            data-testid="button-send-email"
          >
            <Send className="w-4 h-4 mr-1.5" />
            {send.isPending ? "Sending…" : "Send Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
