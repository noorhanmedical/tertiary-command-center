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
    useOutreachSchedulers<{ id: number; name: string }>();
  const schedulerNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const sc of allSchedulerCards) m.set(sc.id, sc.name);
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

  const myEngineAssignedIds = useMemo(
    () => new Set(assignmentRows.map((a) => a.patientScreeningId)),
    [assignmentRows],
  );

  const sortedCallList = useMemo<SortedCallEntry[]>(() => {
    const list = card?.callList ?? [];
    return list
      .filter((item) => myEngineAssignedIds.has(item.patientId))
      .map((item) => {
        const latest = latestCallByPatient.get(item.patientId);
        return { item, latest, bucket: bucketForItem(item, latest) };
      })
      .sort((a, b) => {
        const r = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
        if (r !== 0) return r;
        if (a.bucket === "callback_due" && b.bucket === "callback_due" && a.latest?.callbackAt && b.latest?.callbackAt) {
          return toTime(a.latest.callbackAt) - toTime(b.latest.callbackAt);
        }
        return a.item.patientName.localeCompare(b.item.patientName);
      });
  }, [card, latestCallByPatient, myEngineAssignedIds]);

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
  };
}
