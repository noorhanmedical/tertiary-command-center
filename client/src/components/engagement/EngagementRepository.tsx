// Phase 2C — Repository tab component for the Engagement Center.
//
// Renders:
//   • "Most Recently Sent" section (top 10 sends across all service
//     dates) — visible only when the recent-lists client flag is ON.
//   • Full Repository list ordered by sentToEngagementAt DESC, id DESC.
//
// Every card renders SEPARATELY: label, facility, sent-to-engagement
// timestamp, service date, eligible-patient count, active-work-item
// count, and active/inactive status. Stable React keys use
// list.id (immutable) — never date or facility. Multiple lists sharing
// facility + service_date each render independently.

import React from "react";
import { useQuery as defaultUseQuery } from "@tanstack/react-query";

export type EngagementRepositoryList = {
  id: number;
  clinicId: number;
  sourceType: string;
  sourceId: string;
  sendIdempotencyKey?: string;
  label: string;
  facility: string | null;
  serviceDate: string | null;
  sentToEngagementAt: string;
  status: "active" | "archived" | "cancelled";
  metadata?: Record<string, unknown> & {
    eligiblePatientCount?: number;
    activeWorkItemCount?: number;
  };
};

/**
 * Query-hook signature. Matches @tanstack/react-query's useQuery just
 * enough for what the component needs. Injectable so tests can render
 * arbitrary loading / error / empty / populated states without a DOM.
 */
type UseQueryLike = <TData>(opts: {
  queryKey: readonly unknown[];
  queryFn: () => Promise<TData>;
  enabled?: boolean;
}) => {
  data?: TData;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
};

export type EngagementRepositoryProps = {
  /** Multi-list flag — controls whether Repository is rendered at all. */
  multiListFlagOn: boolean;
  /** Recent-lists flag — controls whether Most Recently Sent is rendered. */
  recentListsFlagOn: boolean;
  /** Optional query-hook injection (test-only). Defaults to react-query's useQuery. */
  useQuery?: UseQueryLike;
};

/** Format a Sent-to-Engagement timestamp for display. */
function formatSentAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

/** Format a Service Date for display. */
function formatServiceDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function ListCard({ list }: { list: EngagementRepositoryList }) {
  const eligible = list.metadata?.eligiblePatientCount ?? 0;
  const activeItems = list.metadata?.activeWorkItemCount ?? 0;
  return (
    <div
      data-testid={`engagement-repository-list-card-${list.id}`}
      className="rounded-lg border p-4 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-base truncate">{list.label}</div>
        <span
          data-testid={`engagement-repository-list-status-${list.id}`}
          className={
            list.status === "active"
              ? "text-xs px-2 py-0.5 rounded bg-green-100 text-green-800"
              : "text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700"
          }
        >
          {list.status}
        </span>
      </div>
      <div className="text-sm text-gray-600">
        <span className="font-medium">Facility:</span>{" "}
        <span data-testid={`engagement-repository-list-facility-${list.id}`}>
          {list.facility ?? "—"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-700">
        <div>
          <span className="font-medium">Sent to Engagement:</span>{" "}
          <span data-testid={`engagement-repository-list-sent-${list.id}`}>
            {formatSentAt(list.sentToEngagementAt)}
          </span>
        </div>
        <div>
          <span className="font-medium">Service Date:</span>{" "}
          <span data-testid={`engagement-repository-list-service-date-${list.id}`}>
            {formatServiceDate(list.serviceDate)}
          </span>
        </div>
        <div>
          <span className="font-medium">Eligible patients:</span>{" "}
          <span data-testid={`engagement-repository-list-eligible-${list.id}`}>{eligible}</span>
        </div>
        <div>
          <span className="font-medium">Active work items:</span>{" "}
          <span data-testid={`engagement-repository-list-active-${list.id}`}>{activeItems}</span>
        </div>
      </div>
    </div>
  );
}

export function EngagementRepository({
  multiListFlagOn, recentListsFlagOn, useQuery,
}: EngagementRepositoryProps) {
  // Feature-off contract: when the multi-list flag is OFF, we render
  // nothing AND fire no requests. The parent should not mount this
  // component in the first place, but this guard is belt-and-braces.
  if (!multiListFlagOn) return null;
  const useQueryImpl: UseQueryLike = useQuery ?? (defaultUseQuery as unknown as UseQueryLike);

  const lists = useQueryImpl<{ lists: EngagementRepositoryList[] }>({
    queryKey: ["/api/engagement/repository/lists"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/repository/lists", { credentials: "include" });
      if (!res.ok) throw new Error(`repository lists failed: ${res.status}`);
      return res.json();
    },
    enabled: multiListFlagOn,
  });

  const recent = useQueryImpl<{ lists: EngagementRepositoryList[] }>({
    queryKey: ["/api/engagement/repository/recent"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/repository/recent", { credentials: "include" });
      if (!res.ok) throw new Error(`recent lists failed: ${res.status}`);
      return res.json();
    },
    // Recent-lists section only fires when its own flag is ON.
    enabled: multiListFlagOn && recentListsFlagOn,
  });

  return (
    <div data-testid="engagement-repository-tab" className="flex flex-col gap-6 p-4">
      {recentListsFlagOn && (
        <section data-testid="engagement-repository-recent-section">
          <h2 className="text-lg font-semibold mb-2">Most Recently Sent</h2>
          {recent.isLoading ? (
            <div data-testid="engagement-repository-recent-loading" className="text-sm text-gray-500">
              Loading…
            </div>
          ) : recent.isError ? (
            <div
              data-testid="engagement-repository-recent-error"
              className="text-sm text-red-600"
            >
              {(recent.error as Error).message}
            </div>
          ) : (recent.data?.lists ?? []).length === 0 ? (
            <div data-testid="engagement-repository-recent-empty" className="text-sm text-gray-500">
              No recent lists.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {recent.data!.lists.map((l) => (
                <ListCard key={`recent-${l.id}`} list={l} />
              ))}
            </div>
          )}
        </section>
      )}

      <section data-testid="engagement-repository-all-section">
        <h2 className="text-lg font-semibold mb-2">All Lists</h2>
        {lists.isLoading ? (
          <div data-testid="engagement-repository-loading" className="text-sm text-gray-500">
            Loading…
          </div>
        ) : lists.isError ? (
          <div data-testid="engagement-repository-error" className="text-sm text-red-600">
            {(lists.error as Error).message}
          </div>
        ) : (lists.data?.lists ?? []).length === 0 ? (
          <div data-testid="engagement-repository-empty" className="text-sm text-gray-500">
            No lists yet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {lists.data!.lists.map((l) => (
              <ListCard key={`all-${l.id}`} list={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
