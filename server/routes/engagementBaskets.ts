import type { Express, Request, Response } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  patientExecutionCases,
  patientScreenings,
  screeningBatches,
  caseDocumentReadiness,
} from "@shared/schema";
import { mapOutcomeToDisposition } from "../services/engagement/teamMetricsService";
import type {
  EngagementBasketKey,
  EngagementBasketRow,
  EngagementBasketsResponse,
  BasketReadinessStatus,
} from "@shared/contracts/engagementBaskets";
import { BASKET_DEFS } from "@shared/contracts/engagementBaskets";

// ─── Engagement baskets read model ──────────────────────────────────────────
//
// The Engagement Center's assignment board deliberately excludes terminal
// cases (scheduled / completed / declined), so it can't answer the operational
// question "how many patients did we schedule / decline / leave a voicemail for
// this cycle?". This read model spans EVERY relevant execution case and buckets
// each one into the nine engagement baskets from REAL data only:
//   • patient_execution_cases   — assignment, engagement status, last outcome
//   • patient_screenings/batches — identity, facility, approval, ancillary
//   • case_document_readiness    — report / order / procedure / billing status
//
// Disposition buckets (voicemail / no-answer / completed conversation / …) are
// derived from the SAME mapOutcomeToDisposition the Team Metrics workspace uses,
// so a basket count can never drift from the metric it mirrors. Voicemail and
// no-answer are NEVER counted as completed conversations.
//
// Honest counts: a basket with no matching cases reports 0. Nothing is
// fabricated and no case is invented.

const TERMINAL_ENGAGEMENT_STATUSES = new Set(["scheduled", "completed"]);

function startOfTodayUtc(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function endOfTodayUtc(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function derivePriority(
  nextActionAt: Date | null,
  missingInfoCount: number,
  startToday: Date,
  endToday: Date,
): "high" | "medium" | "normal" {
  if (nextActionAt) {
    if (nextActionAt < startToday) return "high";
    if (nextActionAt <= endToday) return "medium";
  }
  if (missingInfoCount > 0) return "medium";
  return "normal";
}

function deriveCallReason(bucket: string | null, patientType: string | null): string {
  const b = (bucket ?? "").toLowerCase();
  if (b === "outreach") return "Outreach call";
  if (b === "scheduling_triage") return "Scheduling triage";
  if (b === "visit") return "Visit follow-up";
  if (patientType) return `${patientType} follow-up`;
  return "Engagement call";
}

function computeMissingInfo(
  s: typeof patientScreenings.$inferSelect | undefined,
): string[] {
  const out: string[] = [];
  if (!s) return ["patient_record"];
  if (!s.name?.trim()) out.push("name");
  if (!s.dob?.trim()) out.push("DOB");
  if (!s.phoneNumber?.trim()) out.push("phone");
  if (!s.facility?.trim()) out.push("facility");
  return out;
}

function cooldownNames(c: unknown): string[] {
  if (!c) return [];
  if (Array.isArray(c)) {
    return c
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          return (
            (o.test as string) ??
            (o.name as string) ??
            (o.testName as string) ??
            ""
          );
        }
        return "";
      })
      .filter(Boolean) as string[];
  }
  if (typeof c === "object") return Object.keys(c as Record<string, unknown>);
  return [];
}

// Which baskets does a single enriched case belong to? A case can appear in
// more than one tile (e.g. an assigned overdue voicemail is both Carryover and
// Voicemail Left) — the tiles are filters, not a partition.
function basketsForCase(args: {
  isAssigned: boolean;
  isActive: boolean;
  engagementStatus: string | null;
  disposition: string | null;
  nextActionAt: Date | null;
  startToday: Date;
  endToday: Date;
}): EngagementBasketKey[] {
  const keys: EngagementBasketKey[] = [];
  const status = (args.engagementStatus ?? "").toLowerCase();
  const isTerminalStatus = TERMINAL_ENGAGEMENT_STATUSES.has(status);

  if (!args.isAssigned && args.isActive && !isTerminalStatus) {
    keys.push("unassigned");
  }
  if (args.isAssigned && args.isActive && !isTerminalStatus) {
    if (args.nextActionAt && args.nextActionAt < args.startToday) {
      keys.push("carryover");
    } else if (
      args.nextActionAt &&
      args.nextActionAt >= args.startToday &&
      args.nextActionAt <= args.endToday
    ) {
      keys.push("assignedToday");
    }
  }
  if (args.disposition === "completed") keys.push("completedConversations");
  if (status === "scheduled" || args.disposition === "scheduled") {
    keys.push("scheduled");
  }
  if (args.disposition === "voicemail") keys.push("voicemailLeft");
  if (args.disposition === "noAnswer") keys.push("noAnswer");
  if (args.disposition === "followUp") keys.push("followUpNeeded");
  if (args.disposition === "declined") keys.push("declined");
  return keys;
}

// Map a document-readiness status onto the compact basket status the card
// shows. Anything unrecognised (or absent) reads as "not generated" — an
// honest boundary rather than a fake success.
function readinessStatus(
  status: string | null | undefined,
): BasketReadinessStatus {
  switch ((status ?? "").toLowerCase()) {
    case "uploaded":
      return "uploaded";
    case "generated":
      return "generated";
    case "approved":
    case "completed":
      return "finalized";
    case "blocked":
      return "blocked";
    case "pending":
      return "pending";
    default:
      return "not_generated";
  }
}

export function registerEngagementBasketsRoutes(app: Express) {
  app.get(
    "/api/engagement/baskets",
    async (_req: Request, res: Response) => {
      try {
        const now = new Date();
        const startToday = startOfTodayUtc(now);
        const endToday = endOfTodayUtc(now);
        // Terminal cases are only interesting for a bounded recent window — a
        // patient scheduled 8 months ago is not part of today's operational
        // picture. Active cases are always included.
        const recentWindow = new Date(now);
        recentWindow.setUTCDate(recentWindow.getUTCDate() - 90);

        const cases = await db
          .select()
          .from(patientExecutionCases)
          .where(
            or(
              or(
                isNull(patientExecutionCases.lifecycleStatus),
                eq(patientExecutionCases.lifecycleStatus, "active"),
              ),
              sql`${patientExecutionCases.updatedAt} >= ${recentWindow}`,
            ),
          )
          .orderBy(desc(patientExecutionCases.updatedAt));

        if (cases.length === 0) {
          const empty: EngagementBasketsResponse = {
            generatedAt: now.toISOString(),
            baskets: BASKET_DEFS.map((b) => ({ ...b, count: 0 })),
            rows: [],
          };
          return res.json(empty);
        }

        const caseIds = cases.map((c) => c.id);
        const screeningIds = Array.from(
          new Set(
            cases
              .map((c) => c.patientScreeningId)
              .filter((id): id is number => id != null),
          ),
        );
        const screenings = screeningIds.length
          ? await db
              .select()
              .from(patientScreenings)
              .where(
                and(
                  inArray(patientScreenings.id, screeningIds),
                  isNull(patientScreenings.deletedAt),
                ),
              )
          : [];
        const screeningById = new Map(screenings.map((s) => [s.id, s]));

        const batchIds = Array.from(
          new Set(
            screenings
              .map((s) => s.batchId)
              .filter((id): id is number => id != null),
          ),
        );
        const batches = batchIds.length
          ? await db
              .select()
              .from(screeningBatches)
              .where(inArray(screeningBatches.id, batchIds))
          : [];
        const batchById = new Map(batches.map((b) => [b.id, b]));

        const schedulers = await storage.getOutreachSchedulers();
        const schedulerById = new Map(schedulers.map((s) => [s.id, s]));

        // Latest readiness row per (case, documentType).
        const readinessByCase = new Map<
          number,
          Record<string, string>
        >();
        if (caseIds.length > 0) {
          const readinessRows = await db
            .select({
              executionCaseId: caseDocumentReadiness.executionCaseId,
              documentType: caseDocumentReadiness.documentType,
              documentStatus: caseDocumentReadiness.documentStatus,
              updatedAt: caseDocumentReadiness.updatedAt,
            })
            .from(caseDocumentReadiness)
            .where(inArray(caseDocumentReadiness.executionCaseId, caseIds))
            .orderBy(desc(caseDocumentReadiness.updatedAt));
          for (const r of readinessRows) {
            if (r.executionCaseId == null) continue;
            const bucket =
              readinessByCase.get(r.executionCaseId) ??
              ({} as Record<string, string>);
            // First (newest) wins per documentType.
            if (!(r.documentType in bucket)) {
              bucket[r.documentType] = r.documentStatus;
            }
            readinessByCase.set(r.executionCaseId, bucket);
          }
        }

        const counts: Record<EngagementBasketKey, number> = {
          unassigned: 0,
          assignedToday: 0,
          carryover: 0,
          completedConversations: 0,
          scheduled: 0,
          voicemailLeft: 0,
          noAnswer: 0,
          followUpNeeded: 0,
          declined: 0,
        };

        const rows: EngagementBasketRow[] = cases.map((c) => {
          const screening =
            c.patientScreeningId != null
              ? screeningById.get(c.patientScreeningId)
              : undefined;
          const batch =
            screening?.batchId != null
              ? batchById.get(screening.batchId)
              : undefined;
          const assignedScheduler =
            c.assignedTeamMemberId != null
              ? schedulerById.get(c.assignedTeamMemberId)
              : undefined;

          const nextActionAt =
            c.nextActionAt instanceof Date
              ? c.nextActionAt
              : c.nextActionAt
                ? new Date(c.nextActionAt as unknown as string)
                : null;
          const disposition = c.lastCallOutcome
            ? mapOutcomeToDisposition(c.lastCallOutcome)
            : null;
          const isAssigned = c.assignedTeamMemberId != null;
          const isActive = (c.lifecycleStatus ?? "active") === "active";
          const missingInfo = computeMissingInfo(screening);

          const basketKeys = basketsForCase({
            isAssigned,
            isActive,
            engagementStatus: c.engagementStatus ?? null,
            disposition,
            nextActionAt,
            startToday,
            endToday,
          });
          for (const k of basketKeys) counts[k] += 1;

          const ancillary =
            (Array.isArray(c.selectedServices) && c.selectedServices.length
              ? (c.selectedServices as string[])
              : (screening?.qualifyingTests as string[] | null)) ?? [];

          const readiness = readinessByCase.get(c.id) ?? {};

          return {
            executionCaseId: c.id,
            patientScreeningId: c.patientScreeningId ?? null,
            patientName: c.patientName ?? screening?.name ?? "Unnamed",
            patientDob: c.patientDob ?? screening?.dob ?? null,
            phoneNumber: screening?.phoneNumber ?? null,
            facility:
              screening?.facility ?? batch?.facility ?? c.facilityId ?? null,
            scheduleDate: batch?.scheduleDate ?? null,
            patientType: screening?.patientType ?? null,
            engagementBucket: c.engagementBucket ?? null,
            engagementStatus: c.engagementStatus ?? null,
            lifecycleStatus: c.lifecycleStatus ?? null,
            commitStatus: screening?.commitStatus ?? null,
            approvalStatus: screening?.adminApprovalStatus ?? null,
            assignedTeamMemberId: c.assignedTeamMemberId ?? null,
            assignedRole: c.assignedRole ?? null,
            assignedName: assignedScheduler?.name ?? null,
            ancillary,
            callReason: deriveCallReason(
              c.engagementBucket ?? null,
              screening?.patientType ?? null,
            ),
            priority: derivePriority(
              nextActionAt,
              missingInfo.length,
              startToday,
              endToday,
            ),
            cooldownTests: cooldownNames(screening?.cooldownTests),
            missingInfo,
            lastCallOutcome: c.lastCallOutcome ?? null,
            disposition,
            callAttemptCount: c.callAttemptCount ?? 0,
            lastAttemptAt: toIso(c.lastAttemptAt),
            nextActionAt: toIso(c.nextActionAt),
            createdAt: toIso(c.createdAt),
            approvedAt: toIso(screening?.adminApprovedAt),
            readiness: {
              report: readinessStatus(readiness["report"]),
              orderNote: readinessStatus(readiness["order_note"]),
              procedureNote: readinessStatus(readiness["post_procedure_note"]),
              billing: readinessStatus(readiness["billing_document"]),
            },
            basketKeys,
          };
        });

        const response: EngagementBasketsResponse = {
          generatedAt: now.toISOString(),
          baskets: BASKET_DEFS.map((b) => ({ ...b, count: counts[b.key] })),
          rows,
        };
        return res.json(response);
      } catch (error: unknown) {
        console.error(
          "[engagement/baskets:get] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to load baskets",
        });
      }
    },
  );
}
