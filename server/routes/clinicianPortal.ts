import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { canonicalDay } from "../services/scheduleDashboardService";
import type {
  PatientScreening,
  BillingRecord,
  Invoice,
  OutreachCall,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Clinician Portal aggregator. Computes every tile in the redesigned
// /clinician-portal command center (Finance, Orders & Notes, Plexus
// Engagement) from live records instead of synthetic demo data. Mirrors the
// homeStats.ts pattern: a single endpoint does the rollups server-side where
// the data lives, and the client renders the shaped payload directly.
// ---------------------------------------------------------------------------

type ServiceLine = "BrainWave" | "VitalWave" | "Ultrasound";

// Clinic keeps 70% of collections; Plexus takes 30% (the standard split used
// across the billing/invoice surfaces). Used to derive clinic-net rollups and
// the Plexus-split invoice columns from live gross figures.
const CLINIC_SPLIT = 0.7;

const SERVICE_UNIT_PRICE: Record<string, number> = {
  BrainWave: 420,
  VitalWave: 380,
  "Bilateral Carotid Duplex (93880)": 295,
  "Echocardiogram TTE (93306)": 510,
  "Renal Artery Doppler (93975)": 340,
  "Lower Extremity Arterial Doppler (93925)": 310,
  "Abdominal Aortic Aneurysm Duplex (93978)": 285,
  "Lower Extremity Venous Duplex (93971)": 300,
};

function serviceLineOf(testName: string): ServiceLine {
  const n = String(testName).toLowerCase();
  if (n.includes("brain")) return "BrainWave";
  if (n.includes("vital")) return "VitalWave";
  return "Ultrasound";
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function unitPrice(service: string): number {
  return SERVICE_UNIT_PRICE[service] ?? 320;
}

function normGender(g: unknown): "M" | "F" {
  return String(g ?? "").trim().toUpperCase().startsWith("F") ? "F" : "M";
}

function insuranceTypeOf(insurance: unknown): "PPO" | "Medicare" | "HMO" {
  const s = String(insurance ?? "").toLowerCase();
  if (s.includes("medicare")) return "Medicare";
  if (s.includes("hmo")) return "HMO";
  return "PPO";
}

function monthKey(dayKey: string): string {
  return dayKey.slice(0, 7); // YYYY-MM
}

function pctDelta(curr: number, prior: number): number {
  if (!prior) return 0;
  return Math.round(((curr - prior) / prior) * 100);
}

// ---- claim status mapping (billing record → portal claim status) ----------
type ClaimStatus = "Submitted" | "Pending" | "In Review" | "Paid";
function claimStatusOf(rec: BillingRecord): ClaimStatus {
  if (String(rec.paidStatus ?? "").toLowerCase() === "paid" || num(rec.paidAmount) > 0) {
    return "Paid";
  }
  const bs = String(rec.billingStatus ?? "").toLowerCase();
  const resp = String(rec.response ?? "").toLowerCase();
  if (bs.includes("review") || resp.includes("review")) return "In Review";
  if (bs.includes("submit") || bs.includes("billed") || rec.dateSubmitted) return "Submitted";
  return "Pending";
}

// ---- outreach outcome mapping ---------------------------------------------
function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "reached": return "Reached — Interested";
    case "scheduled": return "Scheduled";
    case "callback": return "Reached — Callback";
    case "no_answer": return "No Answer";
    case "voicemail": return "Left Voicemail";
    case "declined":
    case "not_interested":
    case "refused_dnc": return "Declined";
    default: return "No Answer";
  }
}

type CallStatus = "Not Started" | "Attempted" | "Reached" | "Scheduled" | "Do Not Contact";
function callStatusOf(outcome: string | null): CallStatus {
  if (!outcome) return "Not Started";
  switch (outcome) {
    case "scheduled": return "Scheduled";
    case "reached":
    case "callback":
    case "wants_more_info":
    case "will_think_about_it": return "Reached";
    case "declined":
    case "not_interested":
    case "refused_dnc":
    case "deceased":
    case "moved": return "Do Not Contact";
    default: return "Attempted";
  }
}

function priorityOf(p: PatientScreening): "High" | "Medium" | "Low" {
  const count = Array.isArray(p.qualifyingTests) ? p.qualifyingTests.filter(Boolean).length : 0;
  if (count >= 3) return "High";
  if (count === 2) return "Medium";
  return "Low";
}

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

export function registerClinicianPortalRoutes(app: Express) {
  app.get("/api/clinician-portal", requireClinicianOrAdmin, async (_req, res) => {
    try {
      const today = canonicalDay(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
      const thisMonth = monthKey(today);
      const priorMonthDate = new Date(`${today}T00:00:00.000Z`);
      priorMonthDate.setUTCMonth(priorMonthDate.getUTCMonth() - 1);
      const priorMonth = priorMonthDate.toISOString().slice(0, 7);

      const recent30 = new Date(`${today}T23:59:59.999Z`);
      const recent30Start = new Date(recent30);
      recent30Start.setUTCDate(recent30Start.getUTCDate() - 29);

      const [
        screenings,
        batches,
        billing,
        invoices,
        upcomingAppts,
        outreachCalls,
        users,
        schedulers,
      ] = await Promise.all([
        storage.getAllPatientScreenings(),
        storage.getAllScreeningBatches(),
        storage.getAllBillingRecords(),
        storage.getAllInvoices(),
        storage.getUpcomingAppointments(40),
        storage.listOutreachCallsInRange(recent30Start, recent30),
        storage.getAllUsers(),
        storage.getOutreachSchedulers(),
      ]);

      // ---- lookups -------------------------------------------------------
      const screeningById = new Map<number, PatientScreening>();
      for (const s of screenings) screeningById.set(s.id, s);

      const batchDateById = new Map<number, string>();
      for (const b of batches) batchDateById.set(b.id, b.scheduleDate ?? "");

      const nameById = new Map<string, string>();
      for (const u of users) if (u.username?.trim()) nameById.set(u.id, u.username.trim());
      for (const sc of schedulers) if (sc.userId && sc.name?.trim()) nameById.set(sc.userId, sc.name.trim());
      const schedulerName = (id: string | null) => (id ? nameById.get(id) ?? "Unassigned" : "Unassigned");

      const mrnOf = (s: PatientScreening | undefined, fallbackId: number | string) =>
        (s && (s as any).mrn) || `PS-${fallbackId}`;

      // outreach calls grouped by patient (sorted oldest → newest)
      const callsByPatient = new Map<number, OutreachCall[]>();
      for (const c of [...outreachCalls].sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt))) {
        const arr = callsByPatient.get(c.patientScreeningId);
        if (arr) arr.push(c);
        else callsByPatient.set(c.patientScreeningId, [c]);
      }

      // =====================================================================
      // FINANCE
      // =====================================================================
      const claims = billing.map((rec) => {
        const s = rec.patientId != null ? screeningById.get(rec.patientId) : undefined;
        const status = claimStatusOf(rec);
        const dos = rec.dateOfService ?? "";
        const submitted = rec.dateSubmitted ?? dos;
        const amount = num(rec.totalCharges) || unitPrice(rec.service);
        const timeline: { label: string; date: string }[] = [];
        if (dos) timeline.push({ label: "Study completed", date: dos });
        if (rec.dateSubmitted) timeline.push({ label: "Claim submitted", date: rec.dateSubmitted });
        if (status === "In Review" && rec.followUpDate) timeline.push({ label: "Payer review", date: rec.followUpDate });
        if (status === "Paid") timeline.push({ label: "Payment posted", date: rec.lastBillerUpdate ?? submitted });
        return {
          id: `CLM-${rec.id}`,
          patientName: rec.patientName,
          mrn: rec.mrn || mrnOf(s, rec.patientId ?? rec.id),
          service: rec.service,
          payer: rec.insuranceInfo || s?.insurance || "—",
          dos,
          submittedDate: submitted,
          amount,
          status,
          provider: rec.clinician || "—",
          paidAmount: num(rec.paidAmount),
          paidDate: rec.lastBillerUpdate ?? submitted,
          balanceRemaining: num(rec.balanceRemaining) || Math.max(0, amount - num(rec.paidAmount)),
          timeline,
        };
      });

      const paidClaims = claims
        .filter((c) => c.status === "Paid")
        .map((c) => ({ ...c, paidAmount: c.paidAmount || Math.round(c.amount * 0.92) }));

      // Service-line revenue (paid, MTD) + studies count
      const lineAgg: Record<ServiceLine, { revenue: number; studies: number }> = {
        BrainWave: { revenue: 0, studies: 0 },
        VitalWave: { revenue: 0, studies: 0 },
        Ultrasound: { revenue: 0, studies: 0 },
      };
      let grossMtd = 0, grossPrior = 0, paymentsPosted = 0, paymentsPriorMtd = 0;
      let outstandingAR = 0, expectedReimbursement = 0;
      let claimsPaidMtd = 0;
      const payerAgg = new Map<string, { claims: number; billed: number; paid: number }>();
      const provAgg = new Map<string, { studies: number; billed: number; paid: number }>();

      for (const rec of billing) {
        const day = canonicalDay(rec.dateOfService ?? "");
        const mk = day ? monthKey(day) : "";
        const charges = num(rec.totalCharges) || unitPrice(rec.service);
        const paid = num(rec.paidAmount);
        const bal = num(rec.balanceRemaining) || Math.max(0, charges - paid);
        outstandingAR += bal;
        expectedReimbursement += num(rec.allowedAmount) || paid;
        paymentsPosted += paid;

        if (mk === thisMonth) {
          grossMtd += charges;
          const ln = serviceLineOf(rec.service);
          lineAgg[ln].revenue += paid || charges;
          lineAgg[ln].studies += 1;
        }
        if (mk === priorMonth) {
          grossPrior += charges;
          paymentsPriorMtd += paid;
        }
        if (claimStatusOf(rec) === "Paid" && mk === thisMonth) claimsPaidMtd += 1;

        const payer = rec.insuranceInfo || "Unspecified";
        const pa = payerAgg.get(payer) ?? { claims: 0, billed: 0, paid: 0 };
        pa.claims += 1; pa.billed += charges; pa.paid += paid;
        payerAgg.set(payer, pa);

        const prov = rec.clinician || "Unassigned";
        const pr = provAgg.get(prov) ?? { studies: 0, billed: 0, paid: 0 };
        pr.studies += 1; pr.billed += charges; pr.paid += paid;
        provAgg.set(prov, pr);
      }

      const totalPaidAll = Array.from(payerAgg.values()).reduce((s, p) => s + p.paid, 0) || 1;
      const payerMix = Array.from(payerAgg.entries())
        .map(([payer, v]) => ({ payer, claims: v.claims, billed: Math.round(v.billed), paid: Math.round(v.paid), share: Math.round((v.paid / totalPaidAll) * 100) }))
        .sort((a, b) => b.paid - a.paid);

      const providerFinancials = Array.from(provAgg.entries())
        .map(([provider, v]) => ({ provider, studies: v.studies, billed: Math.round(v.billed), paid: Math.round(v.paid), net: Math.round(v.paid * CLINIC_SPLIT) }))
        .sort((a, b) => b.paid - a.paid);

      const serviceLineRevenue = (Object.keys(lineAgg) as ServiceLine[])
        .map((line) => ({ line, revenue: Math.round(lineAgg[line].revenue), studies: lineAgg[line].studies }));

      const clinicNet = Math.round(paymentsPosted * CLINIC_SPLIT);
      const pendingSubmitted = claims.filter((c) => c.status === "Submitted" || c.status === "Pending" || c.status === "In Review").length;

      const financeKpis = {
        claimsSubmittedMtd: { value: claims.filter((c) => monthKey(canonicalDay(c.submittedDate) || "") === thisMonth).length, delta: 0 },
        claimsPaidMtd: { value: claimsPaidMtd, delta: 0 },
        ancillaryRevenueMtd: { value: Math.round(grossMtd), delta: pctDelta(grossMtd, grossPrior) },
        pendingSubmittedClaims: { value: pendingSubmitted, delta: 0 },
        clinicNet: { value: clinicNet, delta: pctDelta(paymentsPosted * CLINIC_SPLIT, paymentsPriorMtd * CLINIC_SPLIT) },
        paymentsPosted: { value: Math.round(paymentsPosted), delta: pctDelta(paymentsPosted, paymentsPriorMtd) },
      };

      const revenueSummary = [
        { metric: "Gross Charges (MTD)", value: Math.round(grossMtd) },
        { metric: "Expected Reimbursement", value: Math.round(expectedReimbursement) },
        { metric: "Payments Posted", value: Math.round(paymentsPosted) },
        { metric: "Outstanding A/R", value: Math.round(outstandingAR) },
        { metric: "Clinic Net (MTD)", value: clinicNet },
      ];

      const practiceOverview = [
        { metric: "All-Practice Charges (MTD)", value: Math.round(grossMtd) },
        { metric: "All-Practice Payments (MTD)", value: Math.round(paymentsPosted) },
        { metric: "Practice A/R", value: Math.round(outstandingAR) },
        { metric: "Ancillary Share of Net", value: clinicNet },
      ];

      // ---- Invoices ------------------------------------------------------
      const invoiceLineItems = await Promise.all(invoices.map((inv) => storage.getInvoiceLineItems(inv.id)));
      const mappedInvoices = invoices.map((inv: Invoice, i) => {
        const items = invoiceLineItems[i] ?? [];
        const gross = num(inv.totalCharges);
        const lineGroups = new Map<string, { count: number; amount: number }>();
        for (const li of items) {
          const key = serviceLineOf(li.service) === "Ultrasound" ? "Ultrasound studies" : serviceLineOf(li.service);
          const g = lineGroups.get(key) ?? { count: 0, amount: 0 };
          g.count += 1; g.amount += num(li.totalCharges);
          lineGroups.set(key, g);
        }
        const status: "Open" | "Sent" | "Paid" =
          String(inv.status).toLowerCase() === "paid" || (num(inv.totalBalance) === 0 && num(inv.totalPaid) > 0)
            ? "Paid"
            : String(inv.status).toLowerCase() === "sent" || inv.sentAt
              ? "Sent"
              : "Open";
        return {
          id: inv.invoiceNumber,
          period: inv.fromDate && inv.toDate ? `${inv.fromDate} – ${inv.toDate}` : inv.invoiceDate,
          studies: items.length,
          gross: Math.round(gross),
          clinicSplit: Math.round(gross * CLINIC_SPLIT),
          plexusSplit: Math.round(gross * (1 - CLINIC_SPLIT)),
          status,
          issuedDate: inv.invoiceDate,
          lines: Array.from(lineGroups.entries()).map(([service, g]) => ({ service, count: g.count, amount: Math.round(g.amount) })),
        };
      });

      // ---- A/R aging (billing records with an outstanding balance) -------
      const arBucketDefs = [
        { key: "0-30", label: "0–30 days", min: 0, max: 30 },
        { key: "31-60", label: "31–60 days", min: 31, max: 60 },
        { key: "61-90", label: "61–90 days", min: 61, max: 90 },
        { key: "90+", label: "90+ days", min: 91, max: Infinity },
      ];
      const arAgg: Record<string, { amount: number; count: number }> = {};
      const arRows: any[] = [];
      const todayMs = +new Date(`${today}T00:00:00.000Z`);
      for (const rec of billing) {
        const charges = num(rec.totalCharges) || unitPrice(rec.service);
        const bal = num(rec.balanceRemaining) || Math.max(0, charges - num(rec.paidAmount));
        if (bal <= 0 || claimStatusOf(rec) === "Paid") continue;
        const day = canonicalDay(rec.dateOfService ?? "");
        if (!day) continue;
        const ageDays = Math.floor((todayMs - +new Date(`${day}T00:00:00.000Z`)) / 86400000);
        const def = arBucketDefs.find((b) => ageDays >= b.min && ageDays <= b.max);
        if (!def) continue;
        const s = rec.patientId != null ? screeningById.get(rec.patientId) : undefined;
        const agg = arAgg[def.key] ?? { amount: 0, count: 0 };
        agg.amount += bal; agg.count += 1; arAgg[def.key] = agg;
        arRows.push({
          bucket: def.key,
          patientName: rec.patientName,
          mrn: rec.mrn || mrnOf(s, rec.patientId ?? rec.id),
          service: rec.service,
          payer: rec.insuranceInfo || "—",
          amount: Math.round(bal),
          dos: day,
        });
      }
      const arBuckets = arBucketDefs.map((b) => ({ key: b.key, label: b.label, amount: Math.round(arAgg[b.key]?.amount ?? 0), count: arAgg[b.key]?.count ?? 0 }));

      // ---- Pipeline ------------------------------------------------------
      const qualifyingScreenings = screenings.filter((s) => Array.isArray(s.qualifyingTests) && s.qualifyingTests.filter(Boolean).length > 0);
      const qualifiedValue = qualifyingScreenings.reduce((sum, s) => sum + (s.qualifyingTests ?? []).reduce((a, t) => a + unitPrice(String(t)), 0), 0);
      const calledCount = new Set(outreachCalls.map((c) => c.patientScreeningId)).size;
      const scheduledScreenings = qualifyingScreenings.filter((s) => s.commitStatus === "Scheduled" || s.appointmentStatus === "scheduled");
      const completedScreenings = qualifyingScreenings.filter((s) => s.appointmentStatus === "completed" || s.commitStatus === "Completed");
      const submittedClaimsCount = claims.filter((c) => c.status !== "Pending").length;
      const paidClaimsCount = claims.filter((c) => c.status === "Paid").length;
      const avgQualPrice = qualifyingScreenings.length ? qualifiedValue / Math.max(1, qualifyingScreenings.reduce((a, s) => a + (s.qualifyingTests?.length ?? 0), 0)) : 350;

      const pipeline = [
        { key: "qualified", label: "Qualified", count: qualifyingScreenings.length, value: Math.round(qualifiedValue) },
        { key: "called", label: "Called", count: calledCount, value: Math.round(calledCount * avgQualPrice) },
        { key: "scheduled", label: "Scheduled", count: scheduledScreenings.length, value: Math.round(scheduledScreenings.length * avgQualPrice) },
        { key: "completed", label: "Completed", count: completedScreenings.length, value: Math.round(completedScreenings.length * avgQualPrice) },
        { key: "claim_submitted", label: "Claim Submitted", count: submittedClaimsCount, value: Math.round(claims.filter((c) => c.status !== "Pending").reduce((a, c) => a + c.amount, 0)) },
        { key: "claim_paid", label: "Claim Paid", count: paidClaimsCount, value: Math.round(paidClaims.reduce((a, c) => a + c.amount, 0)) },
      ];

      // =====================================================================
      // ORDERS & NOTES
      // =====================================================================
      const orders: any[] = [];
      for (const s of qualifyingScreenings) {
        const tests = (s.qualifyingTests ?? []).filter(Boolean) as string[];
        const orderedDate = (s.committedAt ? new Date(s.committedAt).toISOString().slice(0, 10) : "") || batchDateById.get(s.batchId) || (s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : "");
        const status =
          s.appointmentStatus === "completed" || s.commitStatus === "Completed" ? "Completed Study"
            : s.commitStatus === "Committed" || s.commitStatus === "Scheduled" ? "Approved"
              : "Pending Review";
        const source = s.patientType === "outreach" ? "Plexus Qualification" : "Clinician Order";
        tests.forEach((t, idx) => {
          orders.push({
            id: `ORD-${s.id}-${idx}`,
            patientName: s.name,
            mrn: mrnOf(s, s.id),
            age: s.age ?? 0,
            gender: normGender(s.gender),
            service: t,
            source,
            status,
            orderedDate,
          });
        });
      }

      // Notes — built from committed/qualified screenings. SOAP is sourced
      // from the real clinical fields; no synthetic vitals are invented.
      const noteScreenings = qualifyingScreenings.filter((s) => s.commitStatus !== "Draft").slice(0, 60);
      const notes = noteScreenings.map((s) => {
        const tests = (s.qualifyingTests ?? []).filter(Boolean) as string[];
        const status: "Draft" | "Needs Signature" | "Signed" =
          s.adminApprovalStatus === "approved" ? "Signed"
            : s.commitStatus === "Committed" || s.commitStatus === "Scheduled" || s.commitStatus === "Completed" ? "Needs Signature"
              : "Draft";
        return {
          id: `NOTE-${s.id}`,
          patientName: s.name,
          mrn: mrnOf(s, s.id),
          age: s.age ?? 0,
          gender: normGender(s.gender),
          service: tests[0] ?? "—",
          encounterDate: (s.committedAt ? new Date(s.committedAt).toISOString().slice(0, 10) : "") || batchDateById.get(s.batchId) || "",
          author: s.committedByUserId ? schedulerName(s.committedByUserId) : "—",
          status,
          vitals: {} as Record<string, string>,
          soap: {
            subjective: s.history || "—",
            objective: s.previousTests || "—",
            assessment: s.diagnoses || "—",
            plan: tests.length ? `Qualifying studies: ${tests.join(", ")}.` : (s.medications || "—"),
          },
          version: 1,
        };
      });

      // =====================================================================
      // PLEXUS ENGAGEMENT
      // =====================================================================
      const openCallScreenings = qualifyingScreenings
        .filter((s) => s.commitStatus !== "Completed" && s.appointmentStatus !== "completed")
        .slice(0, 60);
      const callTasks = openCallScreenings.map((s) => {
        const history = callsByPatient.get(s.id) ?? [];
        const last = history[history.length - 1];
        const lastOutcomeRaw = last?.outcome ?? null;
        const assignedTo = schedulerName(last?.schedulerUserId ?? null);
        const status = callStatusOf(lastOutcomeRaw);
        const tests = (s.qualifyingTests ?? []).filter(Boolean) as string[];
        return {
          id: `CALL-${s.id}`,
          patientName: s.name,
          mrn: mrnOf(s, s.id),
          age: s.age ?? 0,
          gender: normGender(s.gender),
          phone: s.phoneNumber ?? "—",
          services: tests,
          priority: priorityOf(s),
          assignedTo,
          status,
          lastOutcome: lastOutcomeRaw ? outcomeLabel(lastOutcomeRaw) : "—",
          nextStep: status === "Scheduled" ? "Confirm appointment" : status === "Reached" ? "Schedule study" : status === "Attempted" ? "Retry call" : "Initial outreach",
          reason: s.diagnoses || "Qualified for ancillary studies.",
          lastAppointment: s.previousTestsDate || "—",
          history: history.map((c) => ({ label: "Call attempt", outcome: outcomeLabel(c.outcome), date: new Date(c.startedAt).toISOString().slice(0, 16).replace("T", " ") })),
        };
      });

      const qualifications = qualifyingScreenings.slice(0, 60).map((s) => {
        const completedAt = (s.committedAt ? new Date(s.committedAt) : s.createdAt ? new Date(s.createdAt) : null);
        return {
          id: `Q-${s.id}`,
          patientName: s.name,
          mrn: mrnOf(s, s.id),
          services: (s.qualifyingTests ?? []).filter(Boolean) as string[],
          source: s.patientType === "outreach" ? "Outreach" : "Visit",
          status: s.status === "completed" ? "Completed" : "In Review",
          nextStep: s.appointmentStatus === "scheduled" ? "Scheduled" : s.commitStatus === "Committed" ? "Call to schedule" : "Clinician review",
          reason: s.diagnoses || "Clinical indicators support ancillary screening.",
          completedAt: completedAt ? completedAt.toISOString().slice(0, 16).replace("T", " ") : "",
        };
      });

      const activity = [...outreachCalls]
        .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))
        .slice(0, 30)
        .map((c) => {
          const s = screeningById.get(c.patientScreeningId);
          return {
            id: `EA-${c.id}`,
            time: new Date(c.startedAt).toISOString().slice(11, 16),
            actor: schedulerName(c.schedulerUserId),
            action: outcomeLabel(c.outcome),
            patientName: s?.name,
          };
        });

      const schedule = upcomingAppts.slice(0, 30).map((a) => ({
        id: `SCH-${a.id}`,
        time: a.scheduledTime,
        patientName: a.patientName,
        mrn: a.patientScreeningId != null ? mrnOf(screeningById.get(a.patientScreeningId), a.patientScreeningId) : "—",
        service: a.testType,
        technician: "—",
        status: a.status === "completed" ? "Completed" : a.status === "cancelled" ? "Scheduled" : "Scheduled",
        source: "Plexus Qualification",
      }));

      // Escalations — patients with 3+ logged calls and still no appointment.
      const escalations = openCallScreenings
        .map((s) => ({ s, calls: callsByPatient.get(s.id) ?? [] }))
        .filter(({ s, calls }) => calls.length >= 3 && s.appointmentStatus !== "scheduled")
        .slice(0, 10)
        .map(({ s, calls }) => ({
          id: `ESC-${s.id}`,
          patientName: s.name,
          mrn: mrnOf(s, s.id),
          reason: "Multiple call attempts, no resolution",
          service: (s.qualifyingTests ?? []).filter(Boolean)[0] ?? "—",
          assignedTo: schedulerName(calls[calls.length - 1]?.schedulerUserId ?? null),
          ageDays: Math.max(1, Math.floor((todayMs - +new Date(calls[0].startedAt)) / 86400000)),
        }));

      const callsToday = outreachCalls.filter((c) => canonicalDay(new Date(c.startedAt).toISOString()) === today);
      const engagementKpis = {
        activeCallList: callTasks.length,
        qualificationsToday: qualifications.filter((q) => q.completedAt.slice(0, 10) === today).length,
        callsCompletedToday: callsToday.length,
        patientsReached: new Set(callsToday.filter((c) => ["reached", "scheduled", "callback"].includes(c.outcome)).map((c) => c.patientScreeningId)).size,
        scheduledToday: upcomingAppts.filter((a) => a.scheduledDate === today).length,
        pendingCallbacks: outreachCalls.filter((c) => c.callbackAt && +new Date(c.callbackAt) >= todayMs).length,
        escalations: escalations.length,
      };

      // staff list for engagement filters
      const staff = Array.from(new Set([...callTasks.map((c) => c.assignedTo), ...activity.map((a) => a.actor)].filter((n) => n && n !== "Unassigned")));

      res.json({
        finance: {
          kpis: financeKpis,
          revenueSummary,
          serviceLineRevenue,
          claims,
          paidClaims,
          invoices: mappedInvoices,
          pipeline,
          practiceOverview,
          arBuckets,
          arRows,
          payerMix,
          providerFinancials,
        },
        orders,
        notes,
        engagement: {
          kpis: engagementKpis,
          callTasks,
          qualifications,
          activity,
          schedule,
          escalations,
          staff,
        },
      });
    } catch (error: any) {
      console.error("[clinician-portal] failed:", error);
      res.status(500).json({ error: error.message || "Failed to load clinician portal data" });
    }
  });
}
