import type { Express, RequestHandler } from "express";
import { db } from "../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { billingReadinessChecks } from "@shared/schema/billingReadiness";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { plexusTasks } from "@shared/schema/plexus";
import { invoices } from "@shared/schema/invoices";
import { billingRecords } from "@shared/schema/billing";
import { outreachCalls, outreachSchedulers } from "@shared/schema/outreach";
import { ancillaryAppointments } from "@shared/schema/appointments";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { eq } from "drizzle-orm";

// ─── Mission Control live spine endpoint ───────────────────────────────────
//
// MONITORING ONLY. Aggregates real platform state into the executive
// oversight dashboard. No writes, no qualification. Every section that has
// no underlying source yet is returned wrapped as { value, sourceMissing }
// so the UI can render an honest "Not available" state instead of a fake
// number.

type Wrapped<T> = { value: T; sourceMissing: boolean };
const wrap = <T,>(value: T, sourceMissing: boolean): Wrapped<T> => ({ value, sourceMissing });

export type MissionLaneStatus = "Watch" | "Blocked" | "Ready" | "In Progress" | "Complete";
export type MissionPriority = "Urgent" | "High" | "Medium" | "Low";
export type MissionLaneKey =
  | "prescreen"
  | "ready-to-call"
  | "follow-up"
  | "callbacks"
  | "pending-ancillary"
  | "no-report"
  | "re-eligible"
  | "declined"
  | "billing-ready"
  | "blocked";

export interface MissionLaneRow {
  id: string;
  executionCaseId: number;
  patient: string;
  patientScreeningId: number | null;
  clinic: string;
  service: string;
  lane: MissionLaneKey;
  status: MissionLaneStatus;
  owner: string;
  team: string;
  nextAction: string;
  blocker: string | null;
  dueDate: string | null;
  priority: MissionPriority;
  callResult: string;
  callAttempts: number;
  lastContact: string | null;
  reportReadiness: string;
  billingReadiness: string;
}

const READY_BILLING_STATUSES = new Set(["ready_to_generate", "ready"]);
const REPORT_READY_STATUSES = new Set(["ready", "complete", "completed", "uploaded", "approved"]);
const CALLBACK_OUTCOMES = new Set(["callback", "no_answer", "voicemail", "patient_requested_call_later"]);
const OPEN_TASK_STATUSES = new Set(["open", "active", "in_progress"]);

function dayKey(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export function registerMissionControlRoutes(app: Express, requireRole: (...roles: string[]) => RequestHandler) {
  app.get("/api/mission-control/spine", requireRole("admin"), async (_req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const start7 = new Date(Date.now() - 7 * 86_400_000);

      const [
        cases,
        billingReady,
        docReadiness,
        tasks,
        invoiceRows,
        billingRows,
        calls,
        schedulers,
        appts,
        scheduleEvents,
      ] = await Promise.all([
        db.select().from(patientExecutionCases).where(eq(patientExecutionCases.lifecycleStatus, "active")),
        db.select().from(billingReadinessChecks),
        db.select().from(caseDocumentReadiness),
        db.select().from(plexusTasks),
        db.select().from(invoices),
        db.select().from(billingRecords),
        db.select().from(outreachCalls),
        db.select().from(outreachSchedulers),
        db.select().from(ancillaryAppointments),
        db.select().from(globalScheduleEvents),
      ]);

      // ─── Lookup maps keyed by patientScreeningId ──────────────────────────
      const schedulerById = new Map<number, string>();
      for (const s of schedulers) schedulerById.set(s.id, s.name);

      const billingReadyByScreening = new Map<number, string>();
      for (const r of billingReady) {
        if (r.patientScreeningId == null) continue;
        const status = (r.readinessStatus ?? "").toLowerCase();
        const existing = billingReadyByScreening.get(r.patientScreeningId);
        if (!existing || READY_BILLING_STATUSES.has(status)) {
          billingReadyByScreening.set(r.patientScreeningId, status);
        }
      }

      // Report readiness — keyed by screening; a screening is "missing" its
      // report if any report-type doc row exists that is not in a ready state.
      const reportStatusByScreening = new Map<number, "ready" | "missing">();
      for (const r of docReadiness) {
        if (r.patientScreeningId == null) continue;
        if ((r.documentType ?? "").toLowerCase() !== "report") continue;
        const status = (r.documentStatus ?? "").toLowerCase();
        const isReady = REPORT_READY_STATUSES.has(status);
        const existing = reportStatusByScreening.get(r.patientScreeningId);
        if (existing === "missing") continue; // sticky: any missing wins
        reportStatusByScreening.set(r.patientScreeningId, isReady ? "ready" : "missing");
      }

      // ─── Per-case derivation ──────────────────────────────────────────────
      const deriveLane = (
        c: typeof cases[number],
        reportReady: "ready" | "missing" | null,
        billingStatus: string | null,
      ): MissionLaneKey => {
        const outcome = (c.lastCallOutcome ?? "").toLowerCase();
        if (c.qualificationStatus === "pending_review") return "pending-ancillary";
        if (c.qualificationStatus === "unscreened") return "prescreen";
        if (outcome === "declined") return "declined";
        if (billingStatus && READY_BILLING_STATUSES.has(billingStatus)) return "billing-ready";
        if (reportReady === "missing") return "no-report";
        if (CALLBACK_OUTCOMES.has(outcome)) return "callbacks";
        if (c.engagementStatus === "contacted") return "follow-up";
        if (
          c.qualificationStatus === "qualified" &&
          (c.engagementStatus === "new" || c.engagementStatus === "ready")
        ) {
          return "ready-to-call";
        }
        if (c.engagementStatus === "scheduled") return "pending-ancillary";
        return "follow-up";
      };

      const overdue = (c: typeof cases[number]): boolean => {
        if (!c.nextActionAt) return false;
        const t = new Date(c.nextActionAt as unknown as string).getTime();
        return Number.isFinite(t) && t < Date.now();
      };

      const deriveStatus = (c: typeof cases[number], lane: MissionLaneKey): MissionLaneStatus => {
        if (lane === "no-report" || lane === "blocked") return "Blocked";
        if (c.engagementStatus === "completed") return "Complete";
        if (lane === "ready-to-call" || lane === "billing-ready" || lane === "re-eligible") return "Ready";
        if (c.engagementStatus === "contacted" || c.engagementStatus === "scheduled") return "In Progress";
        return "Watch";
      };

      const derivePriority = (c: typeof cases[number]): MissionPriority => {
        if (overdue(c)) return "Urgent";
        const ps = c.priorityScore ?? 0;
        if (ps >= 250) return "Urgent";
        if (ps >= 150) return "High";
        if (ps >= 50) return "Medium";
        return "Low";
      };

      const deriveBlocker = (lane: MissionLaneKey, reportReady: "ready" | "missing" | null): string | null => {
        if (lane === "no-report" || reportReady === "missing") return "Report not uploaded";
        return null;
      };

      const deriveNextAction = (lane: MissionLaneKey): string => {
        switch (lane) {
          case "prescreen": return "Run prescreen / qualify";
          case "ready-to-call": return "Outreach call";
          case "follow-up": return "Retry outreach";
          case "callbacks": return "Return scheduled callback";
          case "pending-ancillary": return "Confirm / dispatch ancillary";
          case "no-report": return "Chase report upload";
          case "declined": return "Archive / no further action";
          case "billing-ready": return "Submit claim";
          default: return "Review case";
        }
      };

      const laneTally: Record<MissionLaneKey, number> = {
        "prescreen": 0, "ready-to-call": 0, "follow-up": 0, "callbacks": 0,
        "pending-ancillary": 0, "no-report": 0, "re-eligible": 0, "declined": 0,
        "billing-ready": 0, "blocked": 0,
      };

      const roleAgg = new Map<string, { total: number; urgent: number; blocked: number; ready: number }>();
      const ensureRole = (role: string) => {
        let r = roleAgg.get(role);
        if (!r) { r = { total: 0, urgent: 0, blocked: 0, ready: 0 }; roleAgg.set(role, r); }
        return r;
      };
      let anyAssignedRole = false;

      const clinics = new Set<string>();
      const owners = new Set<string>();

      const lanes: MissionLaneRow[] = cases.map((c) => {
        const psid = c.patientScreeningId ?? null;
        const reportReady = psid != null ? reportStatusByScreening.get(psid) ?? null : null;
        const billingStatus = psid != null ? billingReadyByScreening.get(psid) ?? null : null;
        const lane = deriveLane(c, reportReady, billingStatus);
        laneTally[lane] += 1;

        const status = deriveStatus(c, lane);
        const priority = derivePriority(c);
        const owner = c.assignedTeamMemberId != null
          ? schedulerById.get(c.assignedTeamMemberId) ?? `Member #${c.assignedTeamMemberId}`
          : "Unassigned";
        const clinic = c.facilityId ?? "Unassigned";
        clinics.add(clinic);
        if (owner !== "Unassigned") owners.add(owner);

        if (c.assignedRole) {
          anyAssignedRole = true;
          const r = ensureRole(c.assignedRole.toLowerCase());
          r.total += 1;
          if (priority === "Urgent") r.urgent += 1;
          if (status === "Blocked") r.blocked += 1;
          if (status === "Ready") r.ready += 1;
        }

        return {
          id: `EC-${c.id}`,
          executionCaseId: c.id,
          patient: c.patientName,
          patientScreeningId: psid,
          clinic,
          service: Array.isArray(c.selectedServices) && c.selectedServices.length > 0
            ? c.selectedServices.join(", ")
            : "—",
          lane,
          status,
          owner,
          team: c.assignedRole ?? "Unassigned",
          nextAction: deriveNextAction(lane),
          blocker: deriveBlocker(lane, reportReady),
          dueDate: dayKey(c.nextActionAt as unknown as string | null),
          priority,
          callResult: c.lastCallOutcome ?? "—",
          callAttempts: c.callAttemptCount ?? 0,
          lastContact: dayKey(c.lastAttemptAt as unknown as string | null),
          reportReadiness: reportReady === "ready" ? "Ready" : reportReady === "missing" ? "Missing" : "N/A",
          billingReadiness: billingStatus
            ? (READY_BILLING_STATUSES.has(billingStatus) ? "Ready" : "Not ready")
            : "N/A",
        };
      });

      // Sort lanes: urgent first, then blocked, then by patient name.
      const priorityRank: Record<MissionPriority, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
      lanes.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.patient.localeCompare(b.patient));

      // ─── Spine summary buckets ────────────────────────────────────────────
      const noCases = cases.length === 0;
      const readyBillingCount = billingReady.filter((r) => READY_BILLING_STATUSES.has((r.readinessStatus ?? "").toLowerCase())).length;
      const openTaskCount = tasks.filter((t) => OPEN_TASK_STATUSES.has((t.status ?? "").toLowerCase())).length;

      const spine = {
        prescreen: wrap(laneTally["prescreen"], noCases),
        readyToCall: wrap(laneTally["ready-to-call"], noCases),
        followUp: wrap(laneTally["follow-up"], noCases),
        callbacks: wrap(laneTally["callbacks"], noCases),
        pending: wrap(laneTally["pending-ancillary"], noCases),
        noReport: wrap(laneTally["no-report"], docReadiness.length === 0),
        reEligible: wrap(0, true), // no canonical re-eligibility source yet
        declined: wrap(laneTally["declined"], noCases),
        readyForBilling: wrap(readyBillingCount, billingReady.length === 0),
        tasks: wrap(openTaskCount, tasks.length === 0),
      };

      // ─── Role queue board ─────────────────────────────────────────────────
      const ROLE_DEFS: { role: string; label: string }[] = [
        { role: "scheduler", label: "Scheduler" },
        { role: "liaison", label: "Liaison" },
        { role: "technician", label: "Technician" },
        { role: "billing", label: "Billing" },
        { role: "manager", label: "Manager" },
      ];
      const roleQueues = ROLE_DEFS.map(({ role, label }) => {
        const r = roleAgg.get(role) ?? { total: 0, urgent: 0, blocked: 0, ready: 0 };
        return { role, label, ...r, sourceMissing: !anyAssignedRole };
      });

      // ─── Calls & Communication ────────────────────────────────────────────
      const callsToday = calls.filter((c) => dayKey(c.startedAt) === today);
      const callsLast7 = calls.filter((c) => new Date(c.startedAt).getTime() >= start7.getTime());
      const reachedToday = callsToday.filter((c) => (c.outcome ?? "").toLowerCase() === "reached").length;
      const callbacksPending = calls.filter((c) => c.callbackAt && new Date(c.callbackAt).getTime() >= Date.now()).length;
      const callsSection = {
        madeToday: callsToday.length,
        reachedToday,
        callbacksPending,
        madeLast7: callsLast7.length,
        sourceMissing: calls.length === 0,
      };

      // ─── Patient Services ─────────────────────────────────────────────────
      const declinedLast7 = cases.filter((c) =>
        (c.lastCallOutcome ?? "").toLowerCase() === "declined" &&
        c.updatedAt && new Date(c.updatedAt as unknown as string).getTime() >= start7.getTime(),
      ).length;
      const patientServicesSection = {
        inPipeline: cases.length,
        prescreenBacklog: laneTally["prescreen"],
        pendingAncillary: laneTally["pending-ancillary"],
        declinedLast7,
        sourceMissing: noCases,
      };

      // ─── Finance & Revenue ────────────────────────────────────────────────
      const submittedInvoices = invoiceRows.filter((i) => {
        const s = (i.status ?? "").toLowerCase();
        return s === "sent" || s === "submitted";
      }).length;
      const paidAmount = invoiceRows.reduce((sum, i) => sum + num(i.totalPaid), 0);
      const outstandingBalance = invoiceRows.reduce((sum, i) => sum + num(i.totalBalance), 0);
      const financeSection = {
        billingReady: readyBillingCount,
        invoicesSubmitted: submittedInvoices,
        paidAmount,
        outstandingBalance,
        sourceMissing: invoiceRows.length === 0 && billingRows.length === 0,
      };

      // ─── Operations & Logistics ───────────────────────────────────────────
      const overdueTasks = tasks.filter((t) =>
        OPEN_TASK_STATUSES.has((t.status ?? "").toLowerCase()) &&
        t.dueDate && t.dueDate < today,
      ).length;
      const highPriorityTasks = tasks.filter((t) => {
        if (!OPEN_TASK_STATUSES.has((t.status ?? "").toLowerCase())) return false;
        const p = (t.priority ?? "").toLowerCase();
        const u = (t.urgency ?? "").toLowerCase();
        return p === "high" || p === "urgent" || u === "high" || u === "urgent";
      }).length;
      const operationsSection = {
        tasksOpen: openTaskCount,
        tasksOverdue: overdueTasks,
        tasksHighPriority: highPriorityTasks,
        sourceMissing: tasks.length === 0,
      };

      // ─── Today's Ancillary Operations ─────────────────────────────────────
      const apptsToday = appts.filter((a) => a.scheduledDate === today);
      const ancillaryEvents = scheduleEvents.filter((e) => (e.eventType ?? "").toLowerCase().includes("ancillary"));
      const eventsToday = ancillaryEvents.filter((e) => dayKey(e.startsAt) === today);
      const completedToday = eventsToday.filter((e) => (e.status ?? "").toLowerCase() === "completed").length;
      const ancillaryTodaySection = {
        scheduledToday: apptsToday.length + eventsToday.length,
        completedToday,
        cancelledToday: apptsToday.filter((a) => (a.status ?? "").toLowerCase() === "cancelled").length +
          eventsToday.filter((e) => (e.status ?? "").toLowerCase() === "cancelled").length,
        sourceMissing: appts.length === 0 && ancillaryEvents.length === 0,
      };

      res.json({
        generatedAt: new Date().toISOString(),
        spine,
        lanes,
        clinics: Array.from(clinics).sort(),
        owners: Array.from(owners).sort(),
        roleQueues,
        sections: {
          calls: callsSection,
          patientServices: patientServicesSection,
          finance: financeSection,
          operations: operationsSection,
          ancillaryToday: ancillaryTodaySection,
        },
        ringCentral: { connected: false },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load mission control spine" });
    }
  });
}
