// Phase 4B — Service Access catalog (read-only universe of ancillary services).
//
// The service universe comes from the backend ancillary service registry — the
// three current services are NOT the whole universe. Per-user service grants /
// denies are managed inside a user's detail (Services tab); this section shows
// what services exist and are available for assignment.

import { useAccessServices } from "@/hooks/api/access";
import { describeAccessError } from "@/lib/access/accessApi";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccessGroup, LoadingState, EmptyState, ErrorState } from "./AccessPrimitives";

export function ServiceAccessCatalogSection() {
  const query = useAccessServices();

  return (
    <AccessGroup
      title="Service Access"
      desc="Ancillary services available for user-level access. A service (e.g. Ultrasound) is distinct from a capability permission (e.g. procedure.perform) — a workflow may require both. Assign per-user access from a user's Services tab."
    >
      <div className="overflow-hidden rounded-xl border border-slate-200/80">
        {query.isLoading ? (
          <LoadingState label="Loading services…" />
        ) : query.isError ? (
          <ErrorState message={describeAccessError(query.error)} onRetry={() => query.refetch()} />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState label="No services registered" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Service</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data ?? []).map((s) => (
                <TableRow key={s.internalCode} data-testid={`row-service-${s.internalCode}`}>
                  <TableCell className="font-medium text-slate-900">{s.displayName}</TableCell>
                  <TableCell><code className="text-[12px] text-slate-500">{s.internalCode}</code></TableCell>
                  <TableCell className="text-slate-500">{s.category ?? "—"}</TableCell>
                  <TableCell className="text-slate-600">{s.active ? "Active" : "Inactive"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </AccessGroup>
  );
}
