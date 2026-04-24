import { storage } from "../storage";
import type { OutreachScheduler, PlexusTask } from "@shared/schema";

export interface SchedulerAssignmentResult {
  scheduler: OutreachScheduler | null;
  requiresManualAssignment: boolean;
  availableSchedulers: OutreachScheduler[];
}

function getTodayString(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export async function findSchedulerForBatch(
  facility: string | null,
  scheduleDate: string | null,
): Promise<SchedulerAssignmentResult> {
  const today = getTodayString();
  const isSameDay = !scheduleDate || scheduleDate === today;
  const allSchedulers = await storage.getOutreachSchedulers();
  const facilitySchedulers = facility
    ? allSchedulers.filter((s) => s.facility === facility)
    : [];

  if (isSameDay) {
    return {
      scheduler: null,
      requiresManualAssignment: true,
      availableSchedulers: facilitySchedulers,
    };
  }

  if (facilitySchedulers.length === 1) {
    return {
      scheduler: facilitySchedulers[0],
      requiresManualAssignment: false,
      availableSchedulers: facilitySchedulers,
    };
  }

  return {
    scheduler: null,
    requiresManualAssignment: true,
    availableSchedulers: facilitySchedulers,
  };
}

export async function createAssignmentTask(
  batchId: number,
  batchName: string,
  schedulerId: number | null,
): Promise<PlexusTask> {
  let schedulerName = "Unassigned";
  let schedulerUserId: string | null = null;

  if (schedulerId !== null) {
    const schedulers = await storage.getOutreachSchedulers();
    const found = schedulers.find((s) => s.id === schedulerId);
    if (found) {
      schedulerName = found.name;
      schedulerUserId = found.userId ?? null;
    }
  }

  const isUnassigned = schedulerId === null || schedulerUserId === null;

  const task = await storage.createTask({
    title: `Scheduler Assignment — ${batchName}`,
    description: `Batch "${batchName}" (ID: ${batchId}) has been assigned to scheduler: ${schedulerName}.`,
    taskType: "scheduler_assignment",
    urgency: isUnassigned ? "EOD" : "none",
    priority: "normal",
    status: "open",
    assignedToUserId: schedulerUserId,
    createdByUserId: null,
    patientScreeningId: null,
    projectId: null,
    parentTaskId: null,
    batchId,
    dueDate: null,
  });

  return task;
}
