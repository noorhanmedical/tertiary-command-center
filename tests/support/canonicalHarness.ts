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
};

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
  };
  const { db: fake, calls } = buildFakeDb(spec);
  for (const k of Object.keys(savedDb)) dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  if (flags.canonicalAppointment !== undefined) ff.canonicalAppointment = flags.canonicalAppointment;
  if (flags.ancillaryCaseWrite !== undefined) ff.ancillaryCaseWrite = flags.ancillaryCaseWrite;
  if (flags.plexusIdentityWrite !== undefined) ff.plexusIdentityWrite = flags.plexusIdentityWrite;
  if (flags.unifiedAncillaryDocuments !== undefined) ff.unifiedAncillaryDocuments = flags.unifiedAncillaryDocuments;
  if (flags.canonicalOrderNote !== undefined) ff.canonicalOrderNote = flags.canonicalOrderNote;
  if (flags.canonicalProcedureLifecycle !== undefined) ff.canonicalProcedureLifecycle = flags.canonicalProcedureLifecycle;
  if (flags.canonicalProcedureNote !== undefined) ff.canonicalProcedureNote = flags.canonicalProcedureNote;
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
  return {
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
  };
}

export function countOps(calls: Call[], op: string, table?: unknown): number {
  return calls.filter((c) => c.op === op && (table === undefined || c.table === table)).length;
}
