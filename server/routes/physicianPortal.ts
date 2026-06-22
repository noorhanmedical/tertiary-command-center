import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { sql, eq, and, inArray, desc } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientScreenings } from "@shared/schema/screening";
import { logAudit } from "../services/auditService";
import { updateGeneratedNote } from "../repositories/generatedNotes.repo";
import { evaluateBillingReadinessForProcedure } from "../repositories/billingReadiness.repo";

// ─── Physician Owner Portal ──────────────────────────────────────────────────
// Aggregates from canonical tables only — no parallel data store.
//   Signatures   → procedure_notes (signature_status state machine)
//   Reports      → case_document_readiness (+ procedure_events, screenings)
//   Metrics      → patient_execution_cases + procedure_events + billing_readiness_checks
//   Financials   → invoices + remittance_events + invoice_denials + completed_billing_packages
//
// All routes require the clinician or admin role (global requireAuth already
// applied at /api in server/routes.ts).

const PLEXUS_SERVICE_TYPES = ["BrainWave", "VitalWave", "Ultrasound", "PGx"] as const;

// generation_status values that mean a note body actually exists and is
// therefore eligible to be signed.
const SIGNABLE_GEN_STATUSES = ["generated", "approved"];

function requireClinicianOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const role = req.session.role ?? "clinician";
  if (role !== "admin" && role !== "clinician") {
    return res.status(403).json({ error: "Forbidden — requires clinician or admin access" });
  }
  return next();
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function registerPhysicianPortalRoutes(app: Express) {
  // ─── GET /api/physician-portal/summary ─────────────────────────────────────
  // Tile counts: needs signature · reports pending · pending AR.
  app.get("/api/physician-portal/summary", requireClinicianOrAdmin, async (_req, res) => {
    try {
      const result = await db.execute<{
        needs_signature: number;
        reports_pending: number;
        pending_ar: string | null;
      }>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM procedure_notes pn
             WHERE pn.generation_status IN ('generated', 'approved')
               AND COALESCE(pn.signature_status, 'needs_signature') <> 'signed') AS needs_signature,
          (SELECT COUNT(*)::int FROM case_document_readiness cdr
             WHERE cdr.document_type = 'report'
               AND cdr.document_status IN ('uploaded', 'pending')) AS reports_pending,
          (SELECT COALESCE(SUM(total_balance), 0) FROM invoices
             WHERE status <> 'Paid') AS pending_ar
      `);
      const row = result.rows[0];
      res.json({
        needsSignature: row?.needs_signature ?? 0,
        reportsPending: row?.reports_pending ?? 0,
        pendingAR: round2(num(row?.pending_ar)),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── GET /api/physician-portal/signature-items ─────────────────────────────
  // The signature queue: procedure_notes that still need a physician signature.
  // Optional filters: serviceType, signatureStatus, facilityId.
  app.get("/api/physician-portal/signature-items", requireClinicianOrAdmin, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 500) : 200;

      const conditions = [
        inArray(procedureNotes.generationStatus, SIGNABLE_GEN_STATUSES),
        sql`COALESCE(${procedureNotes.signatureStatus}, 'needs_signature') <> 'signed'`,
      ];
      if (q.serviceType) conditions.push(eq(procedureNotes.serviceType, q.serviceType));
      if (q.signatureStatus) {
        conditions.push(sql`COALESCE(${procedureNotes.signatureStatus}, 'needs_signature') = ${q.signatureStatus}`);
      }

      const notes = await db
        .select({
          id: procedureNotes.id,
          executionCaseId: procedureNotes.executionCaseId,
          patientScreeningId: procedureNotes.patientScreeningId,
          procedureEventId: procedureNotes.procedureEventId,
          serviceType: procedureNotes.serviceType,
          noteType: procedureNotes.noteType,
          generationStatus: procedureNotes.generationStatus,
          generatedText: procedureNotes.generatedText,
          signatureStatus: procedureNotes.signatureStatus,
          returnReason: procedureNotes.returnReason,
          createdAt: procedureNotes.createdAt,
          patientName: patientScreenings.name,
          patientDob: patientScreenings.dob,
          patientAge: patientScreenings.age,
          patientGender: patientScreenings.gender,
          patientInsurance: patientScreenings.insurance,
          patientFacility: patientScreenings.facility,
          diagnoses: patientScreenings.diagnoses,
          history: patientScreenings.history,
          medications: patientScreenings.medications,
        })
        .from(procedureNotes)
        .leftJoin(patientScreenings, eq(procedureNotes.patientScreeningId, patientScreenings.id))
        .where(and(...conditions))
        .orderBy(desc(procedureNotes.createdAt))
        .limit(limit);

      const filteredByFacility = q.facilityId
        ? notes.filter((n) => n.patientFacility === q.facilityId)
        : notes;

      const screeningIds = Array.from(
        new Set(filteredByFacility.map((n) => n.patientScreeningId).filter((v): v is number => v != null)),
      );

      // Report uploaded? (per patient+service) and billing readiness status.
      const reportMap = new Map<string, boolean>();
      const billingMap = new Map<string, string>();
      if (screeningIds.length > 0) {
        const reportRows = await db.execute<{ patient_screening_id: number; service_type: string }>(sql`
          SELECT DISTINCT patient_screening_id, service_type
            FROM case_document_readiness
           WHERE document_type = 'report'
             AND document_status IN ('uploaded', 'approved', 'completed')
             AND patient_screening_id IN (${sql.join(screeningIds, sql`, `)})
        `);
        for (const r of reportRows.rows) reportMap.set(`${r.patient_screening_id}::${r.service_type}`, true);

        const brcRows = await db.execute<{ patient_screening_id: number; service_type: string; readiness_status: string }>(sql`
          SELECT DISTINCT ON (patient_screening_id, service_type)
                 patient_screening_id, service_type, readiness_status
            FROM billing_readiness_checks
           WHERE patient_screening_id IN (${sql.join(screeningIds, sql`, `)})
           ORDER BY patient_screening_id, service_type, updated_at DESC
        `);
        for (const r of brcRows.rows) billingMap.set(`${r.patient_screening_id}::${r.service_type}`, r.readiness_status);
      }

      const READY_BILLING = new Set(["ready_to_generate", "billing_document_generated", "sent_to_billing"]);

      const items = filteredByFacility.map((n) => {
        const key = `${n.patientScreeningId}::${n.serviceType}`;
        const reportUploaded = reportMap.get(key) ?? false;
        const billingStatus = billingMap.get(key) ?? "not_ready";
        const signatureStatus = n.signatureStatus ?? "needs_signature";
        const hasBody = !!n.generatedText && SIGNABLE_GEN_STATUSES.includes(n.generationStatus);
        // A post-procedure note can only be meaningfully signed once its
        // report is in; order notes don't depend on a report.
        const reportRequired = n.noteType === "post_procedure_note";
        const signable = hasBody && (!reportRequired || reportUploaded) && signatureStatus !== "signed";
        return {
          ...n,
          signatureStatus,
          reportUploaded,
          billingStatus,
          billingBlocked: !READY_BILLING.has(billingStatus),
          signable,
          flags: {
            missingReport: reportRequired && !reportUploaded,
            notSignable: !signable,
            billingBlocked: !READY_BILLING.has(billingStatus),
          },
        };
      });

      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── POST /api/physician-portal/signature-items/:id/sign ───────────────────
  app.post("/api/physician-portal/signature-items/:id/sign", requireClinicianOrAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const signed = await signNoteById(id, req);
      if (!signed.ok) return res.status(signed.code).json({ error: signed.error });
      res.json(signed.note);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── POST /api/physician-portal/signature-items/bulk-sign ──────────────────
  app.post("/api/physician-portal/signature-items/bulk-sign", requireClinicianOrAdmin, async (req, res) => {
    try {
      const ids: unknown = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids[] is required" });
      }
      const numericIds = ids.map((v) => parseInt(String(v), 10)).filter((v) => !isNaN(v));
      const results: { signed: number[]; skipped: { id: number; reason: string }[] } = { signed: [], skipped: [] };
      for (const id of numericIds) {
        const r = await signNoteById(id, req);
        if (r.ok) results.signed.push(id);
        else results.skipped.push({ id, reason: r.error });
      }
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── POST /api/physician-portal/signature-items/:id/return ─────────────────
  app.post("/api/physician-portal/signature-items/:id/return", requireClinicianOrAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) return res.status(400).json({ error: "A return reason is required" });

      const updated = await updateGeneratedNote(id, {
        signatureStatus: "returned_for_correction",
        returnReason: reason,
      });
      if (!updated) return res.status(404).json({ error: "Note not found" });

      void logAudit(req, "return_for_correction", "procedure_note", id, { reason });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Shared sign helper used by single + bulk.
  async function signNoteById(
    id: number,
    req: Request,
  ): Promise<{ ok: true; note: any } | { ok: false; code: number; error: string }> {
    const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, id)).limit(1);
    if (!note) return { ok: false, code: 404, error: "Note not found" };
    if (note.signatureStatus === "signed") return { ok: false, code: 409, error: "Already signed" };
    if (!SIGNABLE_GEN_STATUSES.includes(note.generationStatus) || !note.generatedText) {
      return { ok: false, code: 409, error: "Note has no generated content to sign" };
    }

    const updated = await updateGeneratedNote(id, {
      signatureStatus: "signed",
      signedAt: new Date(),
      signedByUserId: req.session.userId ?? null,
      // Promote to approved so existing billing readiness rules treat the
      // note as a passing document (passingStatuses include 'approved').
      generationStatus: "approved",
    });

    void logAudit(req, "sign", "procedure_note", id, {
      serviceType: note.serviceType,
      noteType: note.noteType,
    });

    // Re-evaluate billing readiness — signing may have been the blocker.
    if (note.serviceType) {
      void evaluateBillingReadinessForProcedure({
        executionCaseId: note.executionCaseId,
        patientScreeningId: note.patientScreeningId,
        procedureEventId: note.procedureEventId,
        serviceType: note.serviceType,
      }).catch((err) => console.error("[physicianPortal] billing re-eval failed:", err));
    }

    return { ok: true, note: updated };
  }

  // ─── GET /api/physician-portal/reports ─────────────────────────────────────
  // Ancillary reports from case_document_readiness joined to context.
  app.get("/api/physician-portal/reports", requireClinicianOrAdmin, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 500) : 200;

      const filters = [sql`cdr.document_type = 'report'`, sql`cdr.document_status IN ('uploaded', 'approved', 'completed')`];
      if (q.clinic) filters.push(sql`COALESCE(cdr.facility_id, ps.facility) = ${q.clinic}`);
      if (q.ancillaryType) filters.push(sql`cdr.service_type = ${q.ancillaryType}`);
      if (q.resultStatus) filters.push(sql`cdr.document_status = ${q.resultStatus}`);
      if (q.fromDate) filters.push(sql`cdr.updated_at >= ${q.fromDate}::timestamp`);
      if (q.toDate) filters.push(sql`cdr.updated_at <= ${q.toDate}::timestamp`);

      const result = await db.execute<any>(sql`
        SELECT
          cdr.id,
          cdr.patient_screening_id        AS "patientScreeningId",
          cdr.execution_case_id           AS "executionCaseId",
          COALESCE(cdr.patient_name, ps.name)     AS "patientName",
          COALESCE(cdr.patient_dob, ps.dob)       AS "patientDob",
          COALESCE(cdr.facility_id, ps.facility)  AS "clinic",
          cdr.service_type                AS "serviceType",
          cdr.document_status             AS "resultStatus",
          cdr.document_id                 AS "documentId",
          cdr.completed_at                AS "completedAt",
          cdr.updated_at                  AS "updatedAt",
          pe.procedure_status             AS "procedureStatus",
          pe.completed_at                 AS "procedureCompletedAt",
          ppn.signature_status            AS "signatureStatus",
          brc.readiness_status            AS "billingStatus"
        FROM case_document_readiness cdr
        LEFT JOIN patient_screenings ps ON ps.id = cdr.patient_screening_id
        LEFT JOIN LATERAL (
          SELECT procedure_status, completed_at FROM procedure_events pe2
           WHERE pe2.patient_screening_id = cdr.patient_screening_id
             AND pe2.service_type = cdr.service_type
           ORDER BY pe2.updated_at DESC LIMIT 1
        ) pe ON true
        LEFT JOIN LATERAL (
          SELECT signature_status FROM procedure_notes pn2
           WHERE pn2.patient_screening_id = cdr.patient_screening_id
             AND pn2.service_type = cdr.service_type
             AND pn2.note_type = 'post_procedure_note'
           ORDER BY pn2.updated_at DESC LIMIT 1
        ) ppn ON true
        LEFT JOIN LATERAL (
          SELECT readiness_status FROM billing_readiness_checks brc2
           WHERE brc2.patient_screening_id = cdr.patient_screening_id
             AND brc2.service_type = cdr.service_type
           ORDER BY brc2.updated_at DESC LIMIT 1
        ) brc ON true
        WHERE ${sql.join(filters, sql` AND `)}
        ORDER BY cdr.updated_at DESC
        LIMIT ${limit}
      `);

      let rows = result.rows;
      if (q.signatureStatus) {
        rows = rows.filter((r: any) => (r.signatureStatus ?? "needs_signature") === q.signatureStatus);
      }
      if (q.billingStatus) {
        rows = rows.filter((r: any) => (r.billingStatus ?? "not_ready") === q.billingStatus);
      }

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── GET /api/physician-portal/ancillary-metrics ───────────────────────────
  // Funnel by service type.
  app.get("/api/physician-portal/ancillary-metrics", requireClinicianOrAdmin, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const clinic = q.clinic;

      // Execution-case stages (screened/qualified/contacted/scheduled), one
      // row per unnested selected service.
      const ecRows = await db.execute<any>(sql`
        SELECT s AS service_type,
          COUNT(*)::int AS screened,
          COUNT(*) FILTER (WHERE pec.qualification_status = 'qualified')::int AS qualified,
          COUNT(*) FILTER (WHERE pec.engagement_status IN ('contacted', 'scheduled', 'completed'))::int AS contacted,
          COUNT(*) FILTER (WHERE pec.engagement_status IN ('scheduled', 'completed'))::int AS scheduled
        FROM patient_execution_cases pec,
             unnest(COALESCE(pec.selected_services, ARRAY[]::text[])) AS s
        WHERE pec.lifecycle_status <> 'archived'
          ${clinic ? sql`AND pec.facility_id = ${clinic}` : sql``}
        GROUP BY s
      `);

      const peRows = await db.execute<any>(sql`
        SELECT service_type,
          COUNT(*) FILTER (WHERE procedure_status = 'complete')::int AS completed
        FROM procedure_events
        WHERE 1=1 ${clinic ? sql`AND facility_id = ${clinic}` : sql``}
        GROUP BY service_type
      `);

      const reportRows = await db.execute<any>(sql`
        SELECT service_type,
          COUNT(DISTINCT (patient_screening_id, service_type))::int AS reports_uploaded
        FROM case_document_readiness
        WHERE document_type = 'report'
          AND document_status IN ('uploaded', 'approved', 'completed')
          ${clinic ? sql`AND facility_id = ${clinic}` : sql``}
        GROUP BY service_type
      `);

      const signedRows = await db.execute<any>(sql`
        SELECT service_type,
          COUNT(*) FILTER (WHERE signature_status = 'signed')::int AS signed
        FROM procedure_notes
        GROUP BY service_type
      `);

      const billingRows = await db.execute<any>(sql`
        SELECT service_type,
          COUNT(*) FILTER (WHERE readiness_status IN ('ready_to_generate', 'billing_document_generated', 'sent_to_billing'))::int AS billing_ready
        FROM billing_readiness_checks
        WHERE 1=1 ${clinic ? sql`AND facility_id = ${clinic}` : sql``}
        GROUP BY service_type
      `);

      type Stage = {
        serviceType: string;
        screened: number; qualified: number; contacted: number; scheduled: number;
        completed: number; reportsUploaded: number; signed: number; billingReady: number;
      };
      const map = new Map<string, Stage>();
      const bucket = (st: string) => (PLEXUS_SERVICE_TYPES.includes(st as any) ? st : "other");
      const ensure = (st: string): Stage => {
        const key = bucket(st);
        if (!map.has(key)) {
          map.set(key, { serviceType: key, screened: 0, qualified: 0, contacted: 0, scheduled: 0, completed: 0, reportsUploaded: 0, signed: 0, billingReady: 0 });
        }
        return map.get(key)!;
      };
      for (const r of ecRows.rows) { const s = ensure(r.service_type); s.screened += r.screened; s.qualified += r.qualified; s.contacted += r.contacted; s.scheduled += r.scheduled; }
      for (const r of peRows.rows) { ensure(r.service_type).completed += r.completed; }
      for (const r of reportRows.rows) { ensure(r.service_type).reportsUploaded += r.reports_uploaded; }
      for (const r of signedRows.rows) { ensure(r.service_type).signed += r.signed; }
      for (const r of billingRows.rows) { ensure(r.service_type).billingReady += r.billing_ready; }

      const order = [...PLEXUS_SERVICE_TYPES, "other"];
      const rows = order
        .filter((st) => map.has(st))
        .map((st) => {
          const s = map.get(st)!;
          const pct = (a: number, b: number) => (b > 0 ? round2((a / b) * 100) : 0);
          // Identify the lowest non-trivial conversion stage as bottleneck.
          const transitions: { stage: string; rate: number }[] = [
            { stage: "qualified", rate: pct(s.qualified, s.screened) },
            { stage: "contacted", rate: pct(s.contacted, s.qualified) },
            { stage: "scheduled", rate: pct(s.scheduled, s.contacted) },
            { stage: "completed", rate: pct(s.completed, s.scheduled) },
            { stage: "reportsUploaded", rate: pct(s.reportsUploaded, s.completed) },
            { stage: "signed", rate: pct(s.signed, s.reportsUploaded) },
            { stage: "billingReady", rate: pct(s.billingReady, s.signed) },
          ];
          const considered = transitions.filter((t) => t.rate > 0 || s.screened > 0);
          const bottleneck = considered.length
            ? considered.reduce((min, t) => (t.rate < min.rate ? t : min), considered[0])
            : null;
          return { ...s, conversionRates: Object.fromEntries(transitions.map((t) => [t.stage, t.rate])), bottleneckStage: bottleneck?.stage ?? null };
        });

      res.json({ serviceTypes: rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── GET /api/physician-portal/financial-health ────────────────────────────
  app.get("/api/physician-portal/financial-health", requireClinicianOrAdmin, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const facility = q.clinic;

      const overallRes = await db.execute<any>(sql`
        SELECT
          COALESCE(SUM(total_charges), 0) AS total_billed,
          COALESCE(SUM(total_paid), 0)    AS total_paid,
          COALESCE(SUM(CASE WHEN status <> 'Paid' THEN total_balance ELSE 0 END), 0) AS pending_ar,
          COUNT(*)::int AS invoice_count
        FROM invoices
        WHERE 1=1 ${facility ? sql`AND facility = ${facility}` : sql``}
      `);
      const o = overallRes.rows[0] ?? {};

      const deniedRes = await db.execute<any>(sql`
        SELECT
          COALESCE(SUM(re.amount), 0) AS denied_amount,
          COUNT(DISTINCT id.id)::int  AS open_denials
        FROM invoices inv
        LEFT JOIN remittance_events re ON re.invoice_id = inv.id AND re.event_type = 'denial_received'
        LEFT JOIN invoice_denials id ON id.invoice_id = inv.id AND id.status = 'open'
        WHERE 1=1 ${facility ? sql`AND inv.facility = ${facility}` : sql``}
      `);
      const d = deniedRes.rows[0] ?? {};

      const submittedRes = await db.execute<any>(sql`
        SELECT COALESCE(SUM(re.amount), 0) AS submitted_amount
        FROM invoices inv
        JOIN remittance_events re ON re.invoice_id = inv.id
        WHERE re.event_type IN ('remittance_received', 'payment_posted')
          ${facility ? sql`AND inv.facility = ${facility}` : sql``}
      `);

      const totalBilled = num(o.total_billed);
      const totalPaid = num(o.total_paid);
      const pendingAR = num(o.pending_ar);
      const deniedAmount = num(d.denied_amount);
      const overall = {
        totalBilled: round2(totalBilled),
        totalPaid: round2(totalPaid),
        pendingAR: round2(pendingAR),
        deniedAmount: round2(deniedAmount),
        openDenials: d.open_denials ?? 0,
        invoiceCount: o.invoice_count ?? 0,
        collectionRate: totalBilled > 0 ? round2((totalPaid / totalBilled) * 100) : 0,
        denialRate: totalBilled > 0 ? round2((deniedAmount / totalBilled) * 100) : 0,
      };

      // ── Plexus Ancillary Contribution ──
      // Derived from completed_billing_packages + billing_readiness_checks,
      // filtered to Plexus service types, priced via cash_price_settings.
      const priceRows = await db.execute<any>(sql`
        SELECT DISTINCT ON (service_type) service_type, cash_price
          FROM cash_price_settings
         WHERE active = true
           AND service_type IN (${sql.join(PLEXUS_SERVICE_TYPES.map((s) => sql`${s}`), sql`, `)})
         ORDER BY service_type, facility_id NULLS FIRST, updated_at DESC
      `);
      const priceMap = new Map<string, number>();
      for (const r of priceRows.rows) priceMap.set(r.service_type, num(r.cash_price));

      const readyRes = await db.execute<any>(sql`
        SELECT service_type, COUNT(*)::int AS ready_count
          FROM billing_readiness_checks
         WHERE readiness_status IN ('ready_to_generate', 'billing_document_generated', 'sent_to_billing')
           AND service_type IN (${sql.join(PLEXUS_SERVICE_TYPES.map((s) => sql`${s}`), sql`, `)})
           ${facility ? sql`AND facility_id = ${facility}` : sql``}
         GROUP BY service_type
      `);

      const pkgRes = await db.execute<any>(sql`
        SELECT service_type,
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE package_status IN ('added_to_invoice', 'invoiced'))::int AS submitted_count,
          COUNT(*) FILTER (WHERE payment_status = 'updated')::int AS paid_count,
          COUNT(*) FILTER (WHERE payment_status IN ('disputed', 'reversed'))::int AS denied_count,
          COALESCE(SUM(CASE WHEN payment_status = 'updated'
                            THEN NULLIF(regexp_replace(COALESCE(full_amount_paid, '0'), '[^0-9.]', '', 'g'), '')::numeric
                            ELSE 0 END), 0) AS paid_amount
        FROM completed_billing_packages
        WHERE service_type IN (${sql.join(PLEXUS_SERVICE_TYPES.map((s) => sql`${s}`), sql`, `)})
          ${facility ? sql`AND facility_id = ${facility}` : sql``}
        GROUP BY service_type
      `);

      const readyByService = new Map<string, number>();
      for (const r of readyRes.rows) readyByService.set(r.service_type, r.ready_count);
      const pkgByService = new Map<string, any>();
      for (const r of pkgRes.rows) pkgByService.set(r.service_type, r);

      let estimatedGross = 0, billingReady = 0, submitted = 0, paid = 0, denied = 0, pending = 0;
      const perService = PLEXUS_SERVICE_TYPES.map((st) => {
        const price = priceMap.get(st) ?? 0;
        const readyCount = readyByService.get(st) ?? 0;
        const pkg = pkgByService.get(st) ?? {};
        const totalCount = pkg.total_count ?? 0;
        const submittedCount = pkg.submitted_count ?? 0;
        const paidCount = pkg.paid_count ?? 0;
        const deniedCount = pkg.denied_count ?? 0;
        const paidAmount = num(pkg.paid_amount);
        // Gross = priced over everything we have a package or readiness signal for.
        const grossCount = Math.max(totalCount, readyCount);
        const gross = round2(grossCount * price);
        const readyAmt = round2(readyCount * price);
        const submittedAmt = round2(submittedCount * price);
        const deniedAmt = round2(deniedCount * price);
        const pendingAmt = round2(Math.max(0, gross - paidAmount));
        estimatedGross += gross; billingReady += readyAmt; submitted += submittedAmt;
        paid += paidAmount; denied += deniedAmt; pending += pendingAmt;
        return { serviceType: st, unitPrice: price, grossCount, readyCount, submittedCount, paidCount, deniedCount, estimatedGross: gross, billingReady: readyAmt, submitted: submittedAmt, paid: round2(paidAmount), denied: deniedAmt, pending: pendingAmt };
      });

      const plexusContribution = {
        estimatedGross: round2(estimatedGross),
        billingReady: round2(billingReady),
        submitted: round2(submitted),
        paid: round2(paid),
        denied: round2(denied),
        pending: round2(pending),
        perService,
      };

      // ── Bottlenecks: billing blockers tied back to the Signatures queue. ──
      const blockRes = await db.execute<any>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM procedure_notes pn
             WHERE pn.generation_status IN ('generated', 'approved')
               AND COALESCE(pn.signature_status, 'needs_signature') <> 'signed') AS missing_signature,
          (SELECT COUNT(*)::int FROM billing_readiness_checks brc
             WHERE brc.readiness_status = 'missing_requirements') AS missing_requirements,
          (SELECT COUNT(*)::int FROM case_document_readiness cdr
             WHERE cdr.document_type = 'report' AND cdr.document_status IN ('missing', 'pending')) AS missing_report
      `);
      const b = blockRes.rows[0] ?? {};
      const bottlenecks = [
        { key: "missing_signature", label: "Notes awaiting physician signature", count: b.missing_signature ?? 0, action: "signatures" },
        { key: "missing_report", label: "Procedures missing an uploaded report", count: b.missing_report ?? 0, action: "reports" },
        { key: "missing_requirements", label: "Cases blocked on missing billing requirements", count: b.missing_requirements ?? 0, action: "reports" },
      ].filter((x) => x.count > 0);

      res.json({ overall, plexusContribution, bottlenecks });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
