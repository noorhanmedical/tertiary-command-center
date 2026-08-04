// Phase 2D-B — shared fake-db harness for canonical appointment tests.
//
// Not a *.test.ts file, so it is NOT executed by `npm run test:unit`;
// it is imported by canonicalAppointmentRoutes.test.ts and
// canonicalAppointmentQuickSchedule.test.ts.
//
// Swaps the db singleton's query methods for a recording fake keyed by
// Drizzle table object, and toggles the Phase 2A/2B/2D feature flags
// per test.

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

export type TableSpec = {
  select?: () => unknown[];
  onInsert?: (v: Record<string, unknown>) => unknown[];
  onUpdate?: (v: Record<string, unknown>) => unknown[];
  onDelete?: () => unknown[];
};
export type Call = { op: string; table: unknown; payload?: unknown };

export function buildFakeDb(spec: Map<unknown, TableSpec>) {
  const calls: Call[] = [];
  function selectResult(t: unknown): unknown[] {
    calls.push({ op: "select", table: t });
    const s = spec.get(t);
    return s?.select ? s.select() : [];
  }
  const fake = {
    select(_cols?: unknown) {
      let t: unknown = null;
      const chain: Record<string, unknown> = {
        from(x: unknown) { t = x; return chain; },
        leftJoin() { return chain; },
        innerJoin() { return chain; },
        where() { return chain; },
        orderBy() { return chain; },
        groupBy() { return chain; },
        limit(_n: number) { return Promise.resolve(selectResult(t)); },
        $dynamic() { return chain; },
        then(res: (v: unknown[]) => void, rej?: (e: unknown) => void) {
          Promise.resolve().then(() => selectResult(t)).then(res, rej);
        },
      };
      return chain;
    },
    insert(t: unknown) {
      return {
        values(v: Record<string, unknown>) {
          calls.push({ op: "insert", table: t, payload: v });
          const s = spec.get(t);
          const settle = () => new Promise<unknown[]>((resolve, reject) => {
            try { resolve(s?.onInsert ? s.onInsert(v) : [v]); } catch (e) { reject(e); }
          });
          return {
            returning: () => settle(),
            onConflictDoNothing: () => ({ returning: () => settle(), then: (r: (v: unknown[]) => void, j?: (e: unknown) => void) => settle().then(r, j) }),
            then: (r: (v: unknown[]) => void, j?: (e: unknown) => void) => settle().then(r, j),
          };
        },
      };
    },
    update(t: unknown) {
      return {
        set(v: Record<string, unknown>) {
          return {
            where() {
              calls.push({ op: "update", table: t, payload: v });
              const s = spec.get(t);
              const settle = () => new Promise<unknown[]>((resolve, reject) => {
                try { resolve(s?.onUpdate ? s.onUpdate(v) : [{ ...v }]); } catch (e) { reject(e); }
              });
              return {
                returning: () => settle(),
                then: (r: (v: unknown[]) => void, j?: (e: unknown) => void) => settle().then(r, j),
              };
            },
          };
        },
      };
    },
    delete(t: unknown) {
      return {
        where() {
          calls.push({ op: "delete", table: t });
          const s = spec.get(t);
          const settle = () => Promise.resolve(s?.onDelete ? s.onDelete() : []);
          return {
            returning: () => settle(),
            then: (r: (v: unknown[]) => void, j?: (e: unknown) => void) => settle().then(r, j),
          };
        },
      };
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      calls.push({ op: "transaction", table: null });
      return fn(fake);
    },
    execute: async () => undefined,
  };
  return { db: fake, calls };
}

export type FlagOverrides = {
  canonicalAppointment?: boolean;
  ancillaryCaseWrite?: boolean;
  plexusIdentityWrite?: boolean;
  unifiedAncillaryDocuments?: boolean;
  canonicalOrderNote?: boolean;
  canonicalProcedureLifecycle?: boolean;
  canonicalProcedureNote?: boolean;
  procedureNoteGenerator?: boolean;
  canonicalBillingReadiness?: boolean;
  canonicalBillingDocument?: boolean;
  billingDocumentGenerator?: boolean;
  clinicianPortalCanonicalData?: boolean;
  // Phase 2C engagement + 2I surface flags (read by the 2I stage-vector builder / routes).
  serviceSpecificAdminReview?: boolean;
  engagementAdminReviewSync?: boolean;
  engagementMultiListRepository?: boolean;
  engagementRecentLists?: boolean;
  pcsCanonicalView?: boolean;
  acsCanonicalView?: boolean;
  canonicalClaims?: boolean;
  canonicalInvoices?: boolean;
  canonicalPayments?: boolean;
  canonicalClaimTransmission?: boolean;
};

// Additive Phase 2I/2J flags toggled through the same save/restore mechanism.
const EXTRA_FLAG_KEYS = [
  "serviceSpecificAdminReview", "engagementAdminReviewSync", "engagementMultiListRepository",
  "engagementRecentLists", "pcsCanonicalView", "acsCanonicalView",
  "canonicalClaims", "canonicalInvoices", "canonicalPayments", "canonicalClaimTransmission",
] as const;

export async function runWithDb<T>(
  spec: Map<unknown, TableSpec>,
  flags: FlagOverrides,
  fn: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;
  const savedDb: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) {
    savedDb[k] = dbObj[k];
  }
  const savedFlags: FlagOverrides = {
    canonicalAppointment: ff.canonicalAppointment,
    ancillaryCaseWrite: ff.ancillaryCaseWrite,
    plexusIdentityWrite: ff.plexusIdentityWrite,
    unifiedAncillaryDocuments: ff.unifiedAncillaryDocuments,
    canonicalOrderNote: ff.canonicalOrderNote,
    canonicalProcedureLifecycle: ff.canonicalProcedureLifecycle,
    canonicalProcedureNote: ff.canonicalProcedureNote,
    procedureNoteGenerator: ff.procedureNoteGenerator,
    canonicalBillingReadiness: ff.canonicalBillingReadiness,
    canonicalBillingDocument: ff.canonicalBillingDocument,
    billingDocumentGenerator: ff.billingDocumentGenerator,
    clinicianPortalCanonicalData: ff.clinicianPortalCanonicalData,
  };
  for (const k of EXTRA_FLAG_KEYS) (savedFlags as Record<string, boolean | undefined>)[k] = ff[k];
  const { db: fake, calls } = buildFakeDb(spec);
  for (const k of Object.keys(savedDb)) dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  if (flags.canonicalAppointment !== undefined) ff.canonicalAppointment = flags.canonicalAppointment;
  if (flags.ancillaryCaseWrite !== undefined) ff.ancillaryCaseWrite = flags.ancillaryCaseWrite;
  if (flags.plexusIdentityWrite !== undefined) ff.plexusIdentityWrite = flags.plexusIdentityWrite;
  if (flags.unifiedAncillaryDocuments !== undefined) ff.unifiedAncillaryDocuments = flags.unifiedAncillaryDocuments;
  if (flags.canonicalOrderNote !== undefined) ff.canonicalOrderNote = flags.canonicalOrderNote;
  if (flags.canonicalProcedureLifecycle !== undefined) ff.canonicalProcedureLifecycle = flags.canonicalProcedureLifecycle;
  if (flags.canonicalProcedureNote !== undefined) ff.canonicalProcedureNote = flags.canonicalProcedureNote;
  if (flags.procedureNoteGenerator !== undefined) ff.procedureNoteGenerator = flags.procedureNoteGenerator;
  if (flags.canonicalBillingReadiness !== undefined) ff.canonicalBillingReadiness = flags.canonicalBillingReadiness;
  if (flags.canonicalBillingDocument !== undefined) ff.canonicalBillingDocument = flags.canonicalBillingDocument;
  if (flags.billingDocumentGenerator !== undefined) ff.billingDocumentGenerator = flags.billingDocumentGenerator;
  if (flags.clinicianPortalCanonicalData !== undefined) ff.clinicianPortalCanonicalData = flags.clinicianPortalCanonicalData;
  for (const k of EXTRA_FLAG_KEYS) if (flags[k] !== undefined) ff[k] = flags[k] as boolean;
  try {
    return await fn(calls);
  } finally {
    for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v;
    ff.canonicalAppointment = savedFlags.canonicalAppointment!;
    ff.ancillaryCaseWrite = savedFlags.ancillaryCaseWrite!;
    ff.plexusIdentityWrite = savedFlags.plexusIdentityWrite!;
    ff.unifiedAncillaryDocuments = savedFlags.unifiedAncillaryDocuments!;
    ff.canonicalOrderNote = savedFlags.canonicalOrderNote!;
    ff.canonicalProcedureLifecycle = savedFlags.canonicalProcedureLifecycle!;
    ff.canonicalProcedureNote = savedFlags.canonicalProcedureNote!;
    ff.procedureNoteGenerator = savedFlags.procedureNoteGenerator!;
    ff.canonicalBillingReadiness = savedFlags.canonicalBillingReadiness!;
    ff.canonicalBillingDocument = savedFlags.canonicalBillingDocument!;
    ff.billingDocumentGenerator = savedFlags.billingDocumentGenerator!;
    ff.clinicianPortalCanonicalData = savedFlags.clinicianPortalCanonicalData!;
    for (const k of EXTRA_FLAG_KEYS) ff[k] = (savedFlags as Record<string, boolean>)[k];
  }
}

export async function loadCanonicalTables() {
  const anc = await import("../../shared/schema/ancillaryCases");
  const scr = await import("../../shared/schema/screening");
  const exec = await import("../../shared/schema/executionCase");
  const gse = await import("../../shared/schema/globalSchedule");
  const canon = await import("../../shared/schema/canonicalAppointments");
  const appts = await import("../../shared/schema/appointments");
  const plex = await import("../../shared/schema/plexusIdentity");
  const clc = await import("../../shared/schema/clinics");
  const docs = await import("../../shared/schema/ancillaryDocuments");
  const genNotes = await import("../../shared/schema/generatedNotes");
  const docReadiness = await import("../../shared/schema/documentReadiness");
  const adminRev = await import("../../shared/schema/adminReviewEvents");
  const procEvents = await import("../../shared/schema/procedureEvents");
  const prereq = await import("../../shared/schema/procedurePrerequisites");
  const billingReadiness = await import("../../shared/schema/billingReadiness");
  const billingDocs = await import("../../shared/schema/billingDocuments");
  const engagementLists = await import("../../shared/schema/engagementLists");
  const canonClaims = await import("../../shared/schema/canonicalClaims");
  const canonInvoices = await import("../../shared/schema/canonicalInvoices");
  const canonPayments = await import("../../shared/schema/canonicalPayments");
  return {
    // Phase 2C engagement identity (Phase 2H list/membership wiring reads these).
    engagementLists: engagementLists.engagementLists,
    engagementMemberships: engagementLists.engagementListMemberships,
    // Phase 2J canonical financial lifecycle.
    canonicalClaims: canonClaims.canonicalClaims,
    canonicalInvoices: canonInvoices.canonicalInvoices,
    canonicalPayments: canonPayments.canonicalPayments,
    ancillaryCases: anc.patientAncillaryCases,
    ancillaryFailures: anc.ancillaryCaseReconciliationFailures,
    screenings: scr.patientScreenings,
    executionCases: exec.patientExecutionCases,
    journeyEvents: exec.patientJourneyEvents,
    gse: gse.globalScheduleEvents,
    carf: canon.canonicalAppointmentReconciliationFailures,
    ancillaryAppointments: appts.ancillaryAppointments,
    globalPatients: plex.globalPlexusPatients,
    memberships: plex.patientClinicMemberships,
    clinics: clc.clinics,
    // Phase 2E
    documentReferences: docs.ancillaryDocumentReferences,
    documentFailures: docs.ancillaryDocumentReconciliationFailures,
    procedureNotes: genNotes.procedureNotes,
    caseDocumentReadiness: docReadiness.caseDocumentReadiness,
    adminReviewEvents: adminRev.ancillaryCaseAdminReviewEvents,
    procedureEvents: procEvents.procedureEvents,
    prerequisiteConfig: prereq.ancillaryServicePrerequisiteConfig,
    // Phase 2G code reads/writes the CANONICAL objects (full migration-0055
    // column set); tests spec against the same objects the code uses.
    billingReadinessChecks: billingReadiness.canonicalBillingReadinessChecks,
    billingDocumentRequests: billingDocs.canonicalBillingDocumentRequests,
    legacyBillingReadinessChecks: billingReadiness.billingReadinessChecks,
    legacyBillingDocumentRequests: billingDocs.billingDocumentRequests,
  };
}

export function countOps(calls: Call[], op: string, table?: unknown): number {
  return calls.filter((c) => c.op === op && (table === undefined || c.table === table)).length;
}
