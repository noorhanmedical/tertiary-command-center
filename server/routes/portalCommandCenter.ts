import type { Express, Request, Response } from "express";
import { and, desc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  patientScreenings,
  screeningBatches,
  patientExecutionCases,
  patientJourneyEvents,
  outreachCalls,
  globalScheduleEvents,
  procedureEvents,
  plexusTasks,
  patientTestHistory,
  insuranceEligibilityReviews,
  documents,
} from "@shared/schema";

// Patient Command Center read-model endpoints.
//
// One canonical endpoint aggregates a patient's identity, clinical
// profile, latest activity, full history, tasks, and documents from
// existing canonical tables — patient_screenings, patient_execution_cases,
// patient_journey_events, outreach_calls, global_schedule_events,
// procedure_events, plexus_tasks, patient_test_history,
// insurance_eligibility_reviews, and documents.
//
// Two companion endpoints power the left-rail tools:
//   - GET /api/portal/my-patients  — patients the session user has
//     touched recently (joins journey_events / outreach_calls /
//     plexus_tasks by actor user id).
//   - GET /api/portal/patient-search — name/dob search constrained to
//     the requesting user's profile facilities.
//
// All endpoints filter soft-deleted patient_screenings out (deletedAt
// IS NULL) and respect the team-member profile facility scope on the
// session user where available.

function activePatient() {
  return isNull(patientScreenings.deletedAt);
}

async function resolveSessionFacilities(req: Request): Promise<string[] | "all"> {
  // Admin sees every facility; everyone else sees only the facilities
  // mapped via outreach_schedulers.userId — the same mapping the rest
  // of the portal already uses for facility scope. We don't add a new
  // ownership concept here.
  const role = (req.session as any)?.role as string | undefined;
  const userId = (req.session as any)?.userId as string | undefined;
  if (role === "admin") return "all";
  if (!userId) return [];
  try {
    const allSchedulers = await storage.getOutreachSchedulers();
    const mine = allSchedulers
      .filter((s) => s.userId === userId)
      .map((s) => s.facility)
      .filter((f): f is string => !!f);
    return Array.from(new Set(mine));
  } catch {
    return [];
  }
}

function applyFacilityFilter<T>(
  rows: T[],
  facilities: string[] | "all",
  pick: (r: T) => string | null | undefined,
): T[] {
  if (facilities === "all") return rows;
  const allowed = new Set(facilities);
  return rows.filter((r) => {
    const f = pick(r);
    return f != null && allowed.has(f);
  });
}

export function registerPortalCommandCenterRoutes(app: Express) {
  // ─── Read model for one patient ─────────────────────────────────────
  app.get(
    "/api/portal/patient-command-center/:patientScreeningId",
    async (req: Request, res: Response) => {
      try {
        const pid = Number.parseInt(String(req.params.patientScreeningId), 10);
        if (!Number.isFinite(pid)) {
          return res.status(400).json({ error: "Invalid patientScreeningId" });
        }

        const screening = await storage.getPatientScreening(pid);
        if (!screening) return res.status(404).json({ error: "Patient not found" });

        const facilities = await resolveSessionFacilities(req);
        if (facilities !== "all" && screening.facility && !facilities.includes(screening.facility)) {
          return res.status(403).json({ error: "Facility access denied" });
        }

        const batch = screening.batchId
          ? await storage.getScreeningBatch(screening.batchId)
          : null;
        const facility = screening.facility ?? batch?.facility ?? null;

        // Execution case (canonical engagement spine)
        const [execCase] = await db
          .select()
          .from(patientExecutionCases)
          .where(eq(patientExecutionCases.patientScreeningId, pid))
          .orderBy(desc(patientExecutionCases.id))
          .limit(1);

        // Journey events (full audit trail)
        const journey = await db
          .select()
          .from(patientJourneyEvents)
          .where(
            execCase
              ? or(
                  eq(patientJourneyEvents.patientScreeningId, pid),
                  eq(patientJourneyEvents.executionCaseId, execCase.id),
                )
              : eq(patientJourneyEvents.patientScreeningId, pid),
          )
          .orderBy(desc(patientJourneyEvents.createdAt))
          .limit(200);

        // Outreach calls
        const calls = await db
          .select()
          .from(outreachCalls)
          .where(eq(outreachCalls.patientScreeningId, pid))
          .orderBy(desc(outreachCalls.startedAt))
          .limit(100);

        // Schedule events (appointments + blocks)
        const scheduleWhere = execCase
          ? or(
              eq(globalScheduleEvents.patientScreeningId, pid),
              eq(globalScheduleEvents.executionCaseId, execCase.id),
            )
          : eq(globalScheduleEvents.patientScreeningId, pid);
        const scheduleRows = await db
          .select()
          .from(globalScheduleEvents)
          .where(scheduleWhere)
          .orderBy(desc(globalScheduleEvents.startsAt))
          .limit(100);

        // Procedure events
        const procedureRows = execCase
          ? await db
              .select()
              .from(procedureEvents)
              .where(
                or(
                  eq(procedureEvents.patientScreeningId, pid),
                  eq(procedureEvents.executionCaseId, execCase.id),
                ),
              )
              .orderBy(desc(procedureEvents.completedAt))
              .limit(50)
          : await db
              .select()
              .from(procedureEvents)
              .where(eq(procedureEvents.patientScreeningId, pid))
              .orderBy(desc(procedureEvents.completedAt))
              .limit(50);

        // Tasks
        const tasks = await db
          .select()
          .from(plexusTasks)
          .where(eq(plexusTasks.patientScreeningId, pid))
          .orderBy(desc(plexusTasks.id))
          .limit(100);

        // Test history (previous ancillaries + cooldown source)
        const testHistory = await db
          .select()
          .from(patientTestHistory)
          .where(
            and(
              eq(patientTestHistory.patientName, screening.name),
              screening.dob
                ? eq(patientTestHistory.dob, screening.dob)
                : isNull(patientTestHistory.dob),
            ),
          )
          .orderBy(desc(patientTestHistory.dateOfService))
          .limit(50);

        // Insurance eligibility reviews
        const eligibilityRows = await db
          .select()
          .from(insuranceEligibilityReviews)
          .where(eq(insuranceEligibilityReviews.patientScreeningId, pid))
          .orderBy(desc(insuranceEligibilityReviews.reviewedAt))
          .limit(20);

        // Documents linked to this patient
        const docs = await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.patientScreeningId, pid),
              ne(documents.kind, "marketing"),
            ),
          )
          .orderBy(desc(documents.id))
          .limit(50);

        // Bucket activity for the "latest" + "histories" sections.
        // Texts/emails: no canonical patient_communications table exists
        // yet — return empty arrays with a TODO so the client knows the
        // shape is canonical but the source is pending.
        const latest = {
          call: calls[0] ?? null,
          text: null as null, // TODO: patient_communications table for SMS history
          email: null as null, // TODO: patient_communications table for email history
          note: null as null, // notes flow through procedure_events.note + generated_notes
          appointment:
            scheduleRows.find((s) =>
              ["doctor_visit", "ancillary_appointment", "same_day_add"].includes(
                s.eventType ?? "",
              ),
            ) ?? null,
          ancillary: procedureRows[0] ?? null,
          journeyEvent: journey[0] ?? null,
        };

        return res.json({
          patient: {
            patientScreeningId: screening.id,
            batchId: screening.batchId,
            name: screening.name,
            dob: screening.dob,
            age: screening.age,
            gender: screening.gender,
            phone: screening.phoneNumber,
            email: screening.email,
            insurance: screening.insurance,
            facility,
            patientType: screening.patientType,
            appointmentStatus: screening.appointmentStatus,
            commitStatus: screening.commitStatus,
            engagementStatus: execCase?.engagementStatus ?? null,
            engagementBucket: execCase?.engagementBucket ?? null,
            qualificationStatus: execCase?.qualificationStatus ?? null,
            lifecycleStatus: execCase?.lifecycleStatus ?? null,
            assignedTeamMemberId: execCase?.assignedTeamMemberId ?? null,
            assignedRole: execCase?.assignedRole ?? null,
            executionCaseId: execCase?.id ?? null,
            nextActionAt: execCase?.nextActionAt ?? null,
          },
          clinicalProfile: {
            diagnoses: screening.diagnoses,
            history: screening.history,
            medications: screening.medications,
            notes: screening.notes,
            previousTests: screening.previousTests,
            previousTestsDate: screening.previousTestsDate,
            noPreviousTests: screening.noPreviousTests,
            qualifyingTests: screening.qualifyingTests ?? [],
            cooldownTests: screening.cooldownTests ?? null,
            reasoning: screening.reasoning ?? null,
          },
          latestActivity: latest,
          histories: {
            calls,
            texts: [], // see TODO above
            emails: [], // see TODO above
            notes: procedureRows
              .filter((p) => p.note)
              .map((p) => ({
                id: p.id,
                source: "procedure_event",
                createdAt: p.completedAt,
                text: p.note,
                serviceType: p.serviceType,
              })),
            appointments: scheduleRows,
            ancillaries: procedureRows,
            journeyEvents: journey,
            testHistory,
            eligibility: eligibilityRows,
          },
          tasks,
          documents: docs,
        });
      } catch (error: unknown) {
        console.error(
          "[portal/patient-command-center] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to load command center",
        });
      }
    },
  );

  // ─── My Patients: patients touched by the session user, most-recent ─
  app.get("/api/portal/my-patients", async (req: Request, res: Response) => {
    try {
      const userId: string | null = (req.session as any)?.userId ?? null;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      const query = ((req.query.query as string) ?? "").trim().toLowerCase();
      const facilityParam = ((req.query.facility as string) ?? "").trim();
      const limit = Math.min(
        Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
        200,
      );
      const facilities = await resolveSessionFacilities(req);

      // Three signal sources: journey_events.actorUserId,
      // outreach_calls.schedulerUserId, plexus_tasks.assignedToUserId /
      // createdByUserId. We compute the per-patient max activity time
      // across these so we can sort newest-first.
      const journeyTouches = await db
        .select({
          patientScreeningId: patientJourneyEvents.patientScreeningId,
          executionCaseId: patientJourneyEvents.executionCaseId,
          when: patientJourneyEvents.createdAt,
          kind: sql<string>`'journey'`,
          summary: patientJourneyEvents.summary,
        })
        .from(patientJourneyEvents)
        .where(eq(patientJourneyEvents.actorUserId, userId))
        .orderBy(desc(patientJourneyEvents.createdAt))
        .limit(500);

      const callTouches = await db
        .select({
          patientScreeningId: outreachCalls.patientScreeningId,
          when: outreachCalls.startedAt,
          kind: sql<string>`'call'`,
          summary: outreachCalls.outcome,
        })
        .from(outreachCalls)
        .where(eq(outreachCalls.schedulerUserId, userId))
        .orderBy(desc(outreachCalls.startedAt))
        .limit(500);

      const taskTouches = await db
        .select({
          patientScreeningId: plexusTasks.patientScreeningId,
          when: plexusTasks.updatedAt,
          kind: sql<string>`'task'`,
          summary: plexusTasks.title,
        })
        .from(plexusTasks)
        .where(
          and(
            or(
              eq(plexusTasks.assignedToUserId, userId),
              eq(plexusTasks.createdByUserId, userId),
            ),
            sql`${plexusTasks.patientScreeningId} IS NOT NULL`,
          ),
        )
        .orderBy(desc(plexusTasks.updatedAt))
        .limit(500);

      type Touch = {
        patientScreeningId: number | null;
        when: Date | string | null;
        kind: string;
        summary: string | null;
      };
      const all: Touch[] = [
        ...journeyTouches.map((t) => ({
          patientScreeningId: t.patientScreeningId,
          when: t.when as Date | null,
          kind: t.kind,
          summary: t.summary,
        })),
        ...callTouches.map((t) => ({
          patientScreeningId: t.patientScreeningId,
          when: t.when as Date | null,
          kind: t.kind,
          summary: t.summary,
        })),
        ...taskTouches.map((t) => ({
          patientScreeningId: t.patientScreeningId,
          when: t.when as Date | null,
          kind: t.kind,
          summary: t.summary,
        })),
      ];

      const byPatient = new Map<
        number,
        { lastAt: number; lastKind: string; lastSummary: string | null }
      >();
      for (const t of all) {
        if (t.patientScreeningId == null) continue;
        const ts = t.when ? new Date(t.when).getTime() : 0;
        const cur = byPatient.get(t.patientScreeningId);
        if (!cur || ts > cur.lastAt) {
          byPatient.set(t.patientScreeningId, {
            lastAt: ts,
            lastKind: t.kind,
            lastSummary: t.summary,
          });
        }
      }

      if (byPatient.size === 0) return res.json([]);

      // Hydrate with patient_screenings + screening_batches in a single
      // SELECT, then filter soft-deleted + facility-scope.
      const ids = Array.from(byPatient.keys());
      const rows = await db
        .select({
          screening: patientScreenings,
          batchFacility: screeningBatches.facility,
        })
        .from(patientScreenings)
        .leftJoin(
          screeningBatches,
          eq(screeningBatches.id, patientScreenings.batchId),
        )
        .where(
          and(
            sql`${patientScreenings.id} IN (${sql.join(
              ids.map((i) => sql`${i}`),
              sql`, `,
            )})`,
            activePatient(),
          ),
        );

      const facilityFiltered = applyFacilityFilter(
        rows,
        facilities,
        (r) => r.screening.facility ?? r.batchFacility,
      );

      let out = facilityFiltered.map((r) => {
        const meta = byPatient.get(r.screening.id)!;
        return {
          patientScreeningId: r.screening.id,
          name: r.screening.name,
          dob: r.screening.dob,
          facility: r.screening.facility ?? r.batchFacility ?? null,
          appointmentStatus: r.screening.appointmentStatus,
          commitStatus: r.screening.commitStatus,
          lastActivityAt: meta.lastAt ? new Date(meta.lastAt).toISOString() : null,
          lastActivityType: meta.lastKind,
          lastActivitySummary: meta.lastSummary,
        };
      });

      if (facilityParam) {
        out = out.filter((p) => (p.facility ?? "") === facilityParam);
      }
      if (query) {
        out = out.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            (p.dob ?? "").toLowerCase().includes(query),
        );
      }
      out.sort((a, b) => {
        const ad = a.lastActivityAt ?? "";
        const bd = b.lastActivityAt ?? "";
        return bd.localeCompare(ad);
      });

      res.json(out.slice(0, limit));
    } catch (error: unknown) {
      console.error(
        "[portal/my-patients] error:",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to load my patients",
      });
    }
  });

  // ─── Patient search (name / dob / facility) ─────────────────────────
  app.get("/api/portal/patient-search", async (req: Request, res: Response) => {
    try {
      const query = ((req.query.query as string) ?? "").trim();
      const facilityParam = ((req.query.facility as string) ?? "").trim();
      const limit = Math.min(
        Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
        200,
      );
      const facilities = await resolveSessionFacilities(req);

      if (!query) return res.json([]);

      const rows = await db
        .select({
          screening: patientScreenings,
          batchFacility: screeningBatches.facility,
        })
        .from(patientScreenings)
        .leftJoin(
          screeningBatches,
          eq(screeningBatches.id, patientScreenings.batchId),
        )
        .where(
          and(
            or(
              ilike(patientScreenings.name, `%${query}%`),
              ilike(patientScreenings.dob, `%${query}%`),
              ilike(patientScreenings.phoneNumber, `%${query}%`),
              ilike(patientScreenings.insurance, `%${query}%`),
            ),
            activePatient(),
          ),
        )
        .orderBy(desc(patientScreenings.id))
        .limit(limit * 2);

      let filtered = applyFacilityFilter(
        rows,
        facilities,
        (r) => r.screening.facility ?? r.batchFacility,
      );
      if (facilityParam) {
        filtered = filtered.filter(
          (r) => (r.screening.facility ?? r.batchFacility ?? "") === facilityParam,
        );
      }

      res.json(
        filtered.slice(0, limit).map((r) => ({
          patientScreeningId: r.screening.id,
          name: r.screening.name,
          dob: r.screening.dob,
          facility: r.screening.facility ?? r.batchFacility ?? null,
          insurance: r.screening.insurance,
          phone: r.screening.phoneNumber,
          appointmentStatus: r.screening.appointmentStatus,
          commitStatus: r.screening.commitStatus,
        })),
      );
    } catch (error: unknown) {
      console.error(
        "[portal/patient-search] error:",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to search patients",
      });
    }
  });
}
