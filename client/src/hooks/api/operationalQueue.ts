import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";

// Client view of the unified operational queue (GET /api/operational-queue/me).
// Option 2: this is the canonical source for engagement-assigned call work in
// the Team Member Portal. `meta.schedulerMapping` distinguishes "no work" from
// "your login is not linked to a scheduler row".

export type OperationalQueueItemKind =
  | "call_list_item"
  | "scheduler_task"
  | "visit_appointment"
  | "global_calendar_event";

export type OperationalQueueItem = {
  id: string;
  kind: OperationalQueueItemKind;
  ownerType: string;
  ownerId: number;
  assigneeUserId: string | null;
  assigneeName: string | null;
  patientScreeningId: number | null;
  patientName: string | null;
  patientDob: string | null;
  facility: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  status: string | null;
  isOpen: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type OperationalQueueMeta = {
  schedulerMapping: "ok" | "missing_user_mapping";
  schedulerIds: number[];
};

export type OperationalQueueResponse = {
  items: OperationalQueueItem[];
  meta: OperationalQueueMeta;
};

export function useMyOperationalQueue() {
  return useQuery<OperationalQueueResponse>({
    queryKey: qk.operationalQueue.me(),
    refetchInterval: 60_000,
  });
}
