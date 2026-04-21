import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { qk } from "./keys";

export type AgingBucket = "0-30" | "31-60" | "60+";

export type AgingClinicRow = {
  facility: string;
  invoiceCount: number;
  totalBalance: string;
  buckets: Record<AgingBucket, string>;
  bucketCounts: Record<AgingBucket, number>;
};

export type AgingResponse = {
  clinics: AgingClinicRow[];
  totals: {
    totalBalance: string;
    invoiceCount: number;
    buckets: Record<AgingBucket, string>;
    bucketCounts: Record<AgingBucket, number>;
  };
};

export type Invoice = {
  id: number;
  invoiceNumber: string;
  facility: string;
  invoiceDate: string;
  fromDate: string | null;
  toDate: string | null;
  status: "Draft" | "Sent" | "Partially Paid" | "Paid";
  notes: string | null;
  totalCharges: string;
  initialPaid: string;
  totalPaid: string;
  totalBalance: string;
  sentTo: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type InvoicePayment = {
  id: number;
  invoiceId: number;
  amount: string;
  paymentDate: string;
  method: string;
  reference: string | null;
  note: string | null;
  recordedByUserId: string | null;
  createdAt: string;
};

export type InvoiceLineItem = {
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

export type InvoiceDetail = {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  payments: InvoicePayment[];
};

function invalidateAll(id?: number) {
  queryClient.invalidateQueries({ queryKey: qk.invoices.all() });
  queryClient.invalidateQueries({ queryKey: qk.invoices.aging() });
  if (id != null) {
    queryClient.invalidateQueries({ queryKey: qk.invoices.detail(id) });
  }
}

export function useInvoiceAging() {
  return useQuery<AgingResponse>({ queryKey: qk.invoices.aging() });
}

export function useInvoices() {
  return useQuery<Invoice[]>({ queryKey: qk.invoices.all() });
}

export function useInvoice(id: number) {
  return useQuery<InvoiceDetail>({ queryKey: qk.invoices.detail(id) });
}

export function useCreateInvoice() {
  return useMutation({
    mutationFn: async (input: {
      facility: string;
      invoiceDate: string;
      fromDate: string | null;
      toDate: string | null;
      notes: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/invoices", input);
      return (await res.json()) as Invoice;
    },
    onSuccess: () => invalidateAll(),
  });
}

export function useDeleteInvoice() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/invoices/${id}`);
      return id;
    },
    onSuccess: () => invalidateAll(),
  });
}

export function useRecordPayment(invoiceId: number) {
  return useMutation({
    mutationFn: async (input: {
      amount: string;
      paymentDate: string;
      method: string;
      reference: string | null;
      note: string | null;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/invoices/${invoiceId}/payments`,
        input,
      );
      return res.json();
    },
    onSuccess: () => invalidateAll(invoiceId),
  });
}

export function useDeletePayment(invoiceId: number) {
  return useMutation({
    mutationFn: async (paymentId: number) => {
      const res = await apiRequest(
        "DELETE",
        `/api/invoices/${invoiceId}/payments/${paymentId}`,
      );
      return res.json();
    },
    onSuccess: () => invalidateAll(invoiceId),
  });
}

export function useUpdateInvoiceStatus(invoiceId: number) {
  return useMutation({
    mutationFn: async (status: Invoice["status"]) => {
      const res = await apiRequest(
        "PATCH",
        `/api/invoices/${invoiceId}/status`,
        { status },
      );
      return (await res.json()) as Invoice;
    },
    onSuccess: () => invalidateAll(invoiceId),
  });
}

export function useSendInvoiceEmail(invoiceId: number) {
  return useMutation({
    mutationFn: async (input: {
      to: string[];
      cc: string[];
      subject: string;
      message: string;
      pdfBase64: string;
      pdfFilename: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/invoices/${invoiceId}/send-email`,
        input,
      );
      return res.json();
    },
    onSuccess: () => invalidateAll(invoiceId),
  });
}
