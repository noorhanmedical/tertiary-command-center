import { useMemo } from "react";
import type { OutreachCall } from "@shared/schema";
import { useCurrentUser } from "@/hooks/api/auth";
import { useAppointmentsByFacility } from "@/hooks/api/appointments";
import {
  usePlexusUsers,
  useMyWorkTasks,
  useUrgentTasks,
  useUnreadPerTask,
} from "@/hooks/api/plexus";
import { useSchedulerAssignments } from "@/hooks/api/scheduler-assignments";
import {
  useMyOperationalQueue,
  type OperationalQueueItem,
} from "@/hooks/api/operationalQueue";
import {
  useOutreachDashboard,
  useOutreachSchedulers,
  useOutreachCallsToday,
  useOutreachCallsByPatients,
} from "@/hooks/api/outreach";
import {
  bucketForItem,
  callbackIsDueSoon,
  toTime,
  BUCKET_RANK,
} from "./utils";
import type {
  AssignmentRow,
  CallBucket,
  Facility,
  OutreachCallItem,
  OutreachDashboard,
} from "./types";

export type SortedCallEntry = {
  item: OutreachCallItem;
  latest: OutreachCall | undefined;
  bucket: CallBucket;
};

export function useOutreachData(schedulerId: string) {
  const { data: dashboard, isLoading } = useOutreachDashboard<OutreachDashboard>();

  const card = useMemo(
    () => dashboard?.schedulerCards.find((c) => c.id === schedulerId) ?? null,
    [dashboard, schedulerId],
  );
  const facility = card?.facility as Facility | undefined;

  const { data: appointments = [] } = useAppointmentsByFacility(facility);

  const { data: currentUser } = useCurrentUser();

  const { data: users = [] } = usePlexusUsers();

  const { data: myWorkTasks = [] } = useMyWorkTasks();
  const { data: urgentTasks = [] } = useUrgentTasks();
  const { data: unreadPerTask = [] } = useUnreadPerTask();

  const unreadTaskIds = useMemo(() => {
    const s = new Set<number>();
    for (const u of unreadPerTask) if (u.unreadCount > 0) s.add(u.taskId);
    return s;
  }, [unreadPerTask]);

  const openTasks = useMemo(
    () => myWorkTasks.filter((t) => t.status === "open" || t.status === "in_progress"),
    [myWorkTasks],
  );

  const { data: todayCalls = [] } = useOutreachCallsToday(currentUser?.id);

  const patientIds = useMemo(() => (card?.callList ?? []).map((p) => p.patientId), [card]);

  const { data: assignmentRows = [] } = useSchedulerAssignments() as {
    data: AssignmentRow[];
  };
  const assignmentByPatient = useMemo(() => {
    const m = new Map<number, AssignmentRow>();
    for (const a of assignmentRows) m.set(a.patientScreeningId, a);
    return m;
  }, [assignmentRows]);

  const { data: allSchedulerCards = [] } =
    useOutreachSchedulers<{ id: number; name: string; facility: string }>();
  const schedulerNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const sc of allSchedulerCards) m.set(sc.id, sc.name);
    return m;
  }, [allSchedulerCards]);

  // Mirror server cardIdFor(name, facility) so engagement cases (assigned to an
  // outreach_schedulers row) can be scoped to the selected dashboard card.
  const cardIdBySchedulerId = useMemo(() => {
    const m = new Map<number, string>();
    for (const sc of allSchedulerCards) {
      if (!sc.name || !sc.facility) continue;
      const id = `${sc.name.toLowerCase().replace(/\s+/g, "-")}__${sc.facility
        .toLowerCase()
        .replace(/\s+/g, "-")}`;
      m.set(sc.id, id);
    }
    return m;
  }, [allSchedulerCards]);

  const { data: callsByPatient = {} } = useOutreachCallsByPatients(patientIds);

  const latestCallByPatient = useMemo(() => {
    const m = new Map<number, OutreachCall>();
    for (const [pid, calls] of Object.entries(callsByPatient)) {
      if (calls.length > 0) m.set(Number(pid), calls[0]);
    }
    return m;
  }, [callsByPatient]);

  // Option 2: engagement-assigned call work is sourced from the operational
  // queue (/api/operational-queue/me), NOT the legacy scheduler_assignments
  // path. We merge the engagement-assigned screening IDs into the visible set
  // and synthesize rows for any assigned patient that is not already in the
  // facility dashboard call list, so assigned work always surfaces.
  const { data: opQueue } = useMyOperationalQueue();

  // /me can return engagement cases for every scheduler row the user is mapped
  // to (potentially across facilities/cards). Scope to the currently selected
  // card so one card never shows another scheduler's patients. Prefer exact
  // scheduler→card identity; fall back to facility match when the assigned
  // scheduler id is unknown.
  const engagementItems = useMemo<OperationalQueueItem[]>(() => {
    const all = (opQueue?.items ?? []).filter(
      (i) => i.kind === "scheduler_task" && i.ownerType === "engagement_case",
    );
    if (!card) return [];
    return all.filter((i) => {
      const meta = (i.metadata ?? {}) as Record<string, unknown>;
      const assignedSchedulerId =
        typeof meta.assignedTeamMemberId === "number"
          ? (meta.assignedTeamMemberId as number)
          : null;
      const mappedCardId =
        assignedSchedulerId != null
          ? cardIdBySchedulerId.get(assignedSchedulerId)
          : undefined;
      if (mappedCardId != null) return mappedCardId === card.id;
      return i.facility != null && i.facility === card.facility;
    });
  }, [opQueue, card, cardIdBySchedulerId]);

  const schedulerMappingMissing =
    opQueue?.meta?.schedulerMapping === "missing_user_mapping";

  const engagementByScreeningId = useMemo(() => {
    const m = new Map<number, OperationalQueueItem>();
    for (const it of engagementItems) {
      if (it.patientScreeningId != null) m.set(it.patientScreeningId, it);
    }
    return m;
  }, [engagementItems]);

  const myEngineAssignedIds = useMemo(() => {
    const s = new Set(assignmentRows.map((a) => a.patientScreeningId));
    for (const id of engagementByScreeningId.keys()) s.add(id);
    return s;
  }, [assignmentRows, engagementByScreeningId]);

  const sortedCallList = useMemo<SortedCallEntry[]>(() => {
    const list = card?.callList ?? [];
    const presentIds = new Set(list.map((i) => i.patientId));

    // Synthetic rows for engagement-assigned patients that are not in the
    // facility dashboard call list (e.g. outreach-bucket cases not yet in the
    // outreach pool). Built from the operational-queue item metadata.
    const synthetic: SortedCallEntry[] = [];
    for (const it of engagementItems) {
      const pid = it.patientScreeningId;
      if (pid == null || presentIds.has(pid)) continue;
      const meta = (it.metadata ?? {}) as Record<string, unknown>;
      const services = Array.isArray(meta.selectedServices)
        ? (meta.selectedServices as string[])
        : [];
      const synthItem: OutreachCallItem = {
        id: it.id,
        patientId: pid,
        patientName: it.patientName ?? "Unknown patient",
        facility: it.facility ?? card?.facility ?? "",
        phoneNumber: (meta.phoneNumber as string) ?? "",
        email: "",
        insurance: (meta.insurance as string) ?? "",
        qualifyingTests: services,
        appointmentStatus: it.status ?? "pending",
        patientType: "outreach",
        batchId: 0,
        scheduleDate: it.scheduledDate ?? "",
        time: it.scheduledTime ?? "",
        providerName: "",
        notes: null,
        dob: it.patientDob ?? null,
        age: null,
        gender: null,
        diagnoses: null,
        history: null,
        medications: null,
        previousTests: null,
        previousTestsDate: null,
        noPreviousTests: false,
        reasoning: [],
        priorTestHistory: [],
      };
      const latest = latestCallByPatient.get(pid);
      synthetic.push({
        item: synthItem,
        latest,
        bucket: bucketForItem(synthItem, latest),
      });
    }

    const fromDashboard = list
      .filter((item) => myEngineAssignedIds.has(item.patientId))
      .map((item) => {
        const latest = latestCallByPatient.get(item.patientId);
        return { item, latest, bucket: bucketForItem(item, latest) };
      });

    return [...fromDashboard, ...synthetic]
      .sort((a, b) => {
        const r = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
        if (r !== 0) return r;
        if (a.bucket === "callback_due" && b.bucket === "callback_due" && a.latest?.callbackAt && b.latest?.callbackAt) {
          return toTime(a.latest.callbackAt) - toTime(b.latest.callbackAt);
        }
        return a.item.patientName.localeCompare(b.item.patientName);
      });
  }, [card, latestCallByPatient, myEngineAssignedIds, engagementItems]);

  const callbacksDue = useMemo(() => {
    let count = 0;
    for (const p of card?.callList ?? []) {
      if (callbackIsDueSoon(latestCallByPatient.get(p.patientId))) count++;
    }
    return count;
  }, [card, latestCallByPatient]);

  return {
    dashboard,
    isLoading,
    card,
    facility,
    appointments,
    currentUser,
    users,
    myWorkTasks,
    urgentTasks,
    unreadTaskIds,
    openTasks,
    todayCalls,
    assignmentRows,
    assignmentByPatient,
    schedulerNameById,
    callsByPatient,
    latestCallByPatient,
    myEngineAssignedIds,
    sortedCallList,
    callbacksDue,
    schedulerMappingMissing,
    engagementItems,
  };
}
