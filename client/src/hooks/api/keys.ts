// Canonical query keys for the data hooks layer. All cache reads, writes and
// invalidations go through these so two screens never accidentally use
// different keys for the same endpoint.

export const qk = {
  auth: {
    me: () => ["/api/auth/me"] as const,
  },
  screeningBatches: {
    all: () => ["/api/screening-batches"] as const,
    detail: (id: number | null | undefined) =>
      ["/api/screening-batches", id] as const,
    analysisStatus: (id: number) =>
      ["/api/batches", id, "analysis-status"] as const,
  },
  testHistory: {
    all: () => ["/api/test-history"] as const,
  },
  scheduleDashboard: {
    weekly: (weekStart: string | null | undefined) =>
      ["/api/schedule/dashboard", weekStart || "current"] as const,
  },
  outreach: {
    dashboard: () => ["/api/outreach/dashboard"] as const,
    schedulers: () => ["/api/outreach/schedulers"] as const,
    callsToday: (schedulerUserId: string | null | undefined) =>
      ["/api/outreach/calls/today", schedulerUserId ?? null] as const,
    callsByPatients: (patientIds: number[]) =>
      ["/api/outreach/calls/by-patients", patientIds.join(",")] as const,
  },
  schedulerAssignments: {
    all: () => ["/api/scheduler-assignments"] as const,
  },
  appointments: {
    byFacility: (facility: string | null | undefined) =>
      ["/api/appointments", facility ?? null] as const,
  },
  plexus: {
    users: () => ["/api/plexus/users"] as const,
    myWorkTasks: () => ["/api/plexus/tasks/my-work"] as const,
    urgentTasks: () => ["/api/plexus/tasks/urgent"] as const,
    unreadPerTask: () => ["/api/plexus/tasks/unread-per-task"] as const,
  },
  invoices: {
    all: () => ["/api/invoices"] as const,
    aging: () => ["/api/invoices/aging"] as const,
    detail: (id: number) => ["/api/invoices", id] as const,
  },
  documentsLibrary: {
    meta: () => ["/api/documents-library/meta"] as const,
    list: (kind: string, surface: string, patientId: string) =>
      ["/api/documents-library", kind, surface, patientId] as const,
    versions: (docId: number) =>
      ["/api/documents-library", docId, "versions"] as const,
  },
  marketingMaterials: {
    all: () => ["/api/marketing-materials"] as const,
  },
} as const;
