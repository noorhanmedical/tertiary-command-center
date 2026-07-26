// Phase 2E-B — canonical Ancillary Documents UI (read-only).
//
// Renders the shared /api/ancillary-documents contract. Used by:
//   • the /ancillary-documents page (full list + filters)
//   • Patient EHR (compact card scoped to a screening/global patient)
//   • ACS/PCS (tiny read-only status summary)
//
// NEVER shows: an upload control, a Procedure Note generation button, a
// Billing Document control, document bytes, or fabricated readiness. Signed
// notes are read-only. Every surface uses the SAME reference/source ids.

import { useMemo, useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchAncillaryDocuments,
  documentKindLabel,
  documentStatusBucket,
  type AncillaryDocumentContractItem,
  type AncillaryDocumentsListParams,
} from "@/lib/ancillaryDocumentsApi";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function StatusBadge({ item }: { item: AncillaryDocumentContractItem }) {
  const bucket = documentStatusBucket(item);
  const label =
    bucket === "signed" ? "Signed"
    : bucket === "pending_signature" ? "Pending signature"
    : bucket === "uploaded" ? "Uploaded"
    : bucket === "history" ? "History"
    : "Pending";
  const variant: "default" | "secondary" | "outline" =
    bucket === "signed" || bucket === "uploaded" ? "default"
    : bucket === "history" ? "outline" : "secondary";
  return <Badge variant={variant} data-testid={`doc-status-${item.ancillaryDocumentReferenceId}`}>{label}</Badge>;
}

function DocRow({ item }: { item: AncillaryDocumentContractItem }) {
  return (
    <div
      className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0"
      data-testid={`ancillary-doc-${item.ancillaryDocumentReferenceId}`}
      data-source-id={item.sourceId}
      data-reference-id={item.ancillaryDocumentReferenceId}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{documentKindLabel(item.documentKind)}</span>
          <StatusBadge item={item} />
          {!item.isCurrent && <span className="text-xs text-muted-foreground">(superseded)</span>}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {item.serviceType ?? "—"} · ref #{item.ancillaryDocumentReferenceId} · src {item.sourceTable}:{item.sourceId}
          {" · "}created {fmtDate(item.actualCreatedAt)}
          {item.signedAt ? ` · signed ${fmtDate(item.signedAt)}` : ""}
          {item.effectiveClinicalDate ? ` · effective ${fmtDate(item.effectiveClinicalDate)}` : ""}
        </div>
        {item.warnings.length > 0 && (
          <div className="text-xs text-amber-600">{item.warnings.join(", ")}</div>
        )}
      </div>
      {isAuthorizedDownloadRoute(item.downloadReference) && (
        // A real View action to an authorized internal route — never the raw
        // reference string, never a bucket key. Only rendered when valid.
        <a
          href={item.downloadReference as string}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline shrink-0"
          data-testid={`doc-download-${item.ancillaryDocumentReferenceId}`}
        >
          View
        </a>
      )}
    </div>
  );
}

/** Only allow same-origin authorized API routes as the download action. */
function isAuthorizedDownloadRoute(ref: string | null): boolean {
  return typeof ref === "string" && ref.startsWith("/api/");
}

export function useAncillaryDocuments(params: AncillaryDocumentsListParams, enabled: boolean) {
  return useQuery({
    queryKey: ["/api/ancillary-documents", params],
    queryFn: () => fetchAncillaryDocuments(params),
    enabled,
  });
}

// Keyset-paginated infinite query for the global list. The queryKey carries
// the filter params, so changing ANY filter starts a brand-new query (pages
// reset to page one). Each page requests the previous page's opaque
// nextCursor; a background page-fetch error keeps already-loaded pages.
export function useAncillaryDocumentsInfinite(params: AncillaryDocumentsListParams, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["/api/ancillary-documents", "infinite", params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchAncillaryDocuments({ ...params, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

// ─── Compact card (Patient EHR + embeddable) ────────────────────────
export function AncillaryDocumentsCard(props: {
  params: AncillaryDocumentsListParams;
  enabled: boolean;
  title?: string;
}) {
  const { data, isLoading } = useAncillaryDocuments(props.params, props.enabled);
  const items = data?.items ?? [];
  const byCase = useMemo(() => {
    const m = new Map<string, AncillaryDocumentContractItem[]>();
    for (const it of items) {
      const key = `${it.ancillaryCaseId}::${it.serviceType ?? ""}`;
      const arr = m.get(key) ?? [];
      arr.push(it);
      m.set(key, arr);
    }
    return Array.from(m.entries());
  }, [items]);

  if (!props.enabled) return null;
  return (
    <Card className="p-4" data-testid="ancillary-documents-card">
      <div className="font-semibold mb-2">{props.title ?? "Ancillary Documents"}</div>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && items.length === 0 && (
        <div className="text-sm text-muted-foreground" data-testid="ancillary-documents-empty">No canonical documents.</div>
      )}
      {byCase.map(([key, docs]) => (
        <div key={key} className="mb-3" data-testid={`ancillary-case-group-${key}`}>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            {docs[0].serviceType ?? "Service"} · case #{docs[0].ancillaryCaseId}
          </div>
          {docs.map((d) => <DocRow key={d.ancillaryDocumentReferenceId} item={d} />)}
        </div>
      ))}
    </Card>
  );
}

// ─── Tiny read-only status summary (ACS/PCS) — PRESENTATION ONLY ────
// No useQuery, no per-card fetch. The parent supplies `items` from ONE
// batched query (getAncillaryDocumentsSummaryForScreenings) so mounting many
// cards issues zero canonical requests. `items` should already be current-only.
export function AncillaryDocumentsSummary(props: {
  items: AncillaryDocumentContractItem[];
  enabled?: boolean;
}) {
  if (props.enabled === false) return null;
  const current = props.items.filter((it) => it.isCurrent);
  if (current.length === 0) return null;
  const byKind = new Map<string, AncillaryDocumentContractItem>();
  for (const it of current) if (!byKind.has(it.documentKind)) byKind.set(it.documentKind, it);
  return (
    <div className="flex flex-wrap gap-1" data-testid="ancillary-documents-summary">
      {Array.from(byKind.values()).map((it) => (
        <Badge key={it.documentKind} variant="outline" data-testid={`doc-summary-${it.documentKind}`}>
          {documentKindLabel(it.documentKind)}: {documentStatusBucket(it)}
        </Badge>
      ))}
    </div>
  );
}

// ─── Full list (the /ancillary-documents page canonical mode) ───────
const KIND_FILTERS = ["", "order_note", "report", "consent", "screening_form"] as const;
const STATUS_FILTERS = ["", "pending_signature", "signed", "uploaded", "superseded"] as const;

export function CanonicalAncillaryDocumentsList({ enabled }: { enabled: boolean }) {
  const [screeningId, setScreeningId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [documentKind, setDocumentKind] = useState("");
  const [documentStatus, setDocumentStatus] = useState("");

  const params: AncillaryDocumentsListParams = {
    patientScreeningId: screeningId ? Number(screeningId) : undefined,
    serviceType: serviceType || undefined,
    documentKind: documentKind || undefined,
    documentStatus: documentStatus || undefined,
  };
  // Accumulated keyset pages. Changing any filter above changes the queryKey
  // (params) → a fresh query → pages reset to page one.
  const query = useAncillaryDocumentsInfinite(params, enabled);
  const isLoading = query.isLoading;
  // Flatten pages in server order + dedupe defensively by reference id.
  const items = useMemo(() => {
    const seen = new Set<number>();
    const out: AncillaryDocumentContractItem[] = [];
    for (const pg of query.data?.pages ?? []) {
      for (const it of pg.items) {
        if (seen.has(it.ancillaryDocumentReferenceId)) continue;
        seen.add(it.ancillaryDocumentReferenceId);
        out.push(it);
      }
    }
    return out;
  }, [query.data]);

  return (
    <div data-testid="canonical-ancillary-documents">
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="Patient screening ID"
          value={screeningId}
          onChange={(e) => setScreeningId(e.target.value.replace(/[^0-9]/g, ""))}
          data-testid="filter-screening-id"
        />
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="Service"
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
          data-testid="filter-service"
        />
        <select className="border rounded px-2 py-1 text-sm" value={documentKind} onChange={(e) => setDocumentKind(e.target.value)} data-testid="filter-kind">
          {KIND_FILTERS.map((k) => <option key={k} value={k}>{k ? documentKindLabel(k) : "All kinds"}</option>)}
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={documentStatus} onChange={(e) => setDocumentStatus(e.target.value)} data-testid="filter-status">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
        </select>
      </div>
      <Card className="p-4">
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && items.length === 0 && (
          <div className="text-sm text-muted-foreground" data-testid="canonical-empty">No ancillary documents.</div>
        )}
        {items.map((d) => <DocRow key={d.ancillaryDocumentReferenceId} item={d} />)}
        {query.isError && items.length > 0 && (
          <div className="text-xs text-amber-600 mt-2" data-testid="canonical-page-error">Could not load more — showing loaded records.</div>
        )}
        {query.hasNextPage && (
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
              data-testid="load-more"
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
