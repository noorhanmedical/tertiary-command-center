import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AncillaryAppointment, OutreachCall } from "@shared/schema";
import type { AuthUser } from "@/App";
import type { PlexusTaskSummary, UserEntry } from "@/components/plexus/SchedulerIcon";
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
  const { data: dashboard, isLoading } = useQuery<OutreachDashboard>({
    queryKey: ["/api/outreach/dashboard"],
    refetchInterval: 60_000,
  });

  const card = useMemo(
    () => dashboard?.schedulerCards.find((c) => c.id === schedulerId) ?? null,
    [dashboard, schedulerId],
  );
  const facility = card?.facility as Facility | undefined;

  const { data: appointments = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", facility],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent(facility!)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!facility,
    refetchInterval: 30_000,
  });

  const { data: currentUser } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: users = [] } = useQuery<UserEntry[]>({
    queryKey: ["/api/plexus/users"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: myWorkTasks = [] } = useQuery<PlexusTaskSummary[]>({
    queryKey: ["/api/plexus/tasks/my-work"],
    refetchInterval: 60_000,
  });
  const { data: urgentTasks = [] } = useQuery<PlexusTaskSummary[]>({
    queryKey: ["/api/plexus/tasks/urgent"],
    refetchInterval: 30_000,
  });
  const { data: unreadPerTask = [] } = useQuery<{ taskId: number; unreadCount: number }[]>({
    queryKey: ["/api/plexus/tasks/unread-per-task"],
    refetchInterval: 60_000,
  });

  const unreadTaskIds = useMemo(() => {
    const s = new Set<number>();
    for (const u of unreadPerTask) if (u.unreadCount > 0) s.add(u.taskId);
    return s;
  }, [unreadPerTask]);

  const openTasks = useMemo(
    () => myWorkTasks.filter((t) => t.status === "open" || t.status === "in_progress"),
    [myWorkTasks],
  );

  const { data: todayCalls = [] } = useQuery<OutreachCall[]>({
    queryKey: ["/api/outreach/calls/today", currentUser?.id],
    queryFn: async () => {
      const res = await fetch(`/api/outreach/calls/today?schedulerUserId=${encodeURIComponent(currentUser!.id)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!currentUser?.id,
    refetchInterval: 30_000,
  });

  const patientIds = useMemo(() => (card?.callList ?? []).map((p) => p.patientId), [card]);

  const { data: assignmentRows = [] } = useQuery<AssignmentRow[]>({
    queryKey: ["/api/scheduler-assignments"],
    refetchInterval: 60_000,
  });
  const assignmentByPatient = useMemo(() => {
    const m = new Map<number, AssignmentRow>();
    for (const a of assignmentRows) m.set(a.patientScreeningId, a);
    return m;
  }, [assignmentRows]);

  const { data: allSchedulerCards = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/outreach/schedulers"],
    staleTime: 5 * 60 * 1000,
  });
  const schedulerNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const sc of allSchedulerCards) m.set(sc.id, sc.name);
    return m;
  }, [allSchedulerCards]);

  const { data: callsByPatient = {} } = useQuery<Record<number, OutreachCall[]>>({
    queryKey: ["/api/outreach/calls/by-patients", patientIds.join(",")],
    queryFn: async () => {
      const res = await fetch(`/api/outreach/calls/by-patients?ids=${patientIds.join(",")}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load calls");
      return res.json();
    },
    enabled: patientIds.length > 0,
    refetchInterval: 60_000,
  });

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
