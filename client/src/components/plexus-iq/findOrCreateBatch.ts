import { apiRequest } from "@/lib/queryClient";
import type { ScreeningBatch } from "@shared/schema";

export type CreateBatchFn = (input: {
  name: string;
  facility: string;
  scheduleDate?: string;
}) => Promise<{ id: number } & Partial<ScreeningBatch>>;

// Find an existing screening batch keyed by (facility, scheduleDate). If
// none exists, create one through the canonical /api/batches endpoint and
// return the new batch id. This is the single source of truth for Plexus IQ
// patient placement — Plexus IQ never creates a batch of its own outside
// this helper, and never persists a workspace-level batch reference.
export async function findOrCreateBatchByFacilityDate({
  facility,
  scheduleDate,
  allBatches,
  createBatch,
}: {
  facility: string;
  scheduleDate: string;
  allBatches: ScreeningBatch[];
  createBatch: CreateBatchFn;
}): Promise<number> {
  const existing = allBatches.find(
    (b) => b.facility === facility && b.scheduleDate === scheduleDate,
  );
  if (existing) return existing.id;

  const created = await createBatch({
    name: `${facility} - ${scheduleDate}`,
    facility,
    scheduleDate,
  });
  return created.id;
}

// Thin wrapper around POST /api/patients used by Plexus IQ flows that have
// already resolved the target batch id. Kept here to keep the routing logic
// in one place.
export async function postPatient(input: {
  batchId: number;
  name: string;
  time?: string;
  patientType?: "visit" | "outreach";
}): Promise<unknown> {
  const { batchId, ...body } = input;
  const res = await apiRequest("POST", `/api/batches/${batchId}/patients`, body);
  return res.json();
}
