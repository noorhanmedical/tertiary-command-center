// Patient Directory live page (Batch E).
//
// Route-connected wrapper around the existing PatientDirectoryPage
// scaffold. Uses react-query to fetch search results + per-patient
// snapshots from the real API. When the activation flag is OFF on the
// server, all reads degrade to empty (the API helper returns []/null
// for 404) and the page renders the scaffold's empty state.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  PatientDirectoryPage,
  type PatientDirectoryRow,
} from "@/components/patient-directory/PatientDirectoryPage";
import {
  AddPriorTestDialog,
  BulkImportDialog,
  DncCooldownDialog,
} from "@/components/patient-directory/PatientDirectoryActions";
import type { PatientProfileSnapshot } from "@/components/patient-directory/PatientProfileDrawer";
import {
  type DirectorySnapshot,
  getPatientDirectoryAudit,
  getPatientDirectorySnapshot,
  isPatientDirectoryActivationReachable,
  searchPatientDirectory,
} from "@/lib/patientDirectoryApi";
import type { DuplicateWarningResult } from "@/lib/patientDuplicateWarnings";

function snapshotToProfile(s: DirectorySnapshot): PatientProfileSnapshot {
  return {
    patientScreeningId: s.profile.patientScreeningId,
    identity: {
      name: s.profile.identity.name,
      facility: s.profile.identity.facility,
      mrn: s.profile.identity.mrn,
      dob: s.profile.identity.dob,
      phoneNumber: s.profile.identity.phoneNumber,
      email: s.profile.identity.email,
      insurance: s.profile.identity.insurance,
      gender: null,
    },
    patientType: s.profile.patientType,
    source: s.profile.source,
    createdAt: s.profile.createdAt,
    flags: {
      doNotContact: s.flags.doNotContact,
      doNotContactReason: s.flags.doNotContactReason,
      everSentToEngagement: s.flags.everSentToEngagement,
      activeCooldown: !!s.cooldown?.active,
      priorTestsCount: s.priorTests.length,
      duplicateMatchCount: 0,
    },
    priorTests: s.priorTests.map((t) => ({ ...t })),
    engagement: {
      currentAssignmentStatus: s.engagement.currentAssignmentStatus,
      currentAssignedTo: s.engagement.currentAssignedTo,
      lastEngagementUpdate: s.engagement.lastEngagementUpdate,
    },
    callHistory: s.callHistory.map((c) => ({
      id: c.id,
      startedAt: c.startedAt,
      outcome: c.outcome,
      notes: c.notes,
      callbackAt: c.callbackAt,
      attemptNumber: c.attemptNumber,
      durationSeconds: c.durationSeconds,
    })),
    adminReviewHistory: [],
    imports: s.profile.source
      ? [{
          batchId: s.profile.source.batchId,
          batchName: s.profile.source.batchName ?? `Batch ${s.profile.source.batchId}`,
          batchCreatedAt: s.profile.source.batchCreatedAt,
          sourceFileName: s.profile.source.sourceFileName,
        }]
      : [],
    events: s.events,
  };
}

export function PatientDirectoryLivePage({
  warningResultsById,
}: {
  warningResultsById?: Record<number, DuplicateWarningResult>;
} = {}) {
  const [query, setQuery] = useState("");
  const qc = useQueryClient();
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [dncOpen, setDncOpen] = useState<{ id: number; dnc: boolean; cd: boolean } | null>(null);
  const [priorOpen, setPriorOpen] = useState<{ id: number; name: string } | null>(null);

  const reachableQ = useQuery({
    queryKey: ["patient-directory-activation-reachable"],
    queryFn: () => isPatientDirectoryActivationReachable(),
    staleTime: 60_000,
  });
  const reachable = reachableQ.data ?? false;

  const searchQ = useQuery({
    queryKey: ["patient-directory-search", query],
    queryFn: () => searchPatientDirectory(query, 100),
    enabled: reachable && query.trim().length > 0,
  });

  // Cache snapshot per patient row so the drawer can render
  // synchronously after a row click without flashing skeletons.
  const [snapshotById, setSnapshotById] = useState<Record<number, PatientProfileSnapshot>>({});

  useEffect(() => {
    if (!searchQ.data) return;
    let cancelled = false;
    (async () => {
      const next: Record<number, PatientProfileSnapshot> = { ...snapshotById };
      for (const row of searchQ.data) {
        if (next[row.patientScreeningId]) continue;
        try {
          const snap = await getPatientDirectorySnapshot(row.patientScreeningId);
          if (cancelled) return;
          if (snap) {
            // Also fetch the latest audit events.
            const events = await getPatientDirectoryAudit(row.patientScreeningId);
            const merged: DirectorySnapshot = { ...snap, events };
            next[row.patientScreeningId] = snapshotToProfile(merged);
          }
        } catch {
          // best-effort — leave the row without a cached snapshot
        }
      }
      if (!cancelled) setSnapshotById(next);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ.data]);

  const searchResults: ReadonlyArray<PatientDirectoryRow> = (searchQ.data ?? []).map((hit) => {
    const snap = snapshotById[hit.patientScreeningId];
    return {
      patientScreeningId: hit.patientScreeningId,
      name: hit.name,
      facility: hit.facility,
      dob: hit.dob,
      mrn: hit.mrn,
      phoneNumber: hit.phoneNumber,
      badges: {
        doNotContact: snap?.flags.doNotContact ?? false,
        activeCooldown: snap?.flags.activeCooldown ?? false,
        everSentToEngagement: snap?.flags.everSentToEngagement ?? false,
        priorTestsCount: snap?.flags.priorTestsCount ?? 0,
        duplicateMatchCount: warningResultsById?.[hit.patientScreeningId]?.matchedRuns.length ?? 0,
      },
    } satisfies PatientDirectoryRow;
  });

  // Wrap the existing scaffold; pass the snapshot map + audit-unavailable
  // signal so the modal renders its source-unavailable state when the
  // activation flag is OFF.
  return (
    <>
      <PatientDirectoryPage
        searchResults={searchResults}
        warningResultsById={warningResultsById}
        snapshotById={snapshotById}
        onSearch={(q) => {
          setQuery(q);
          qc.invalidateQueries({ queryKey: ["patient-directory-search"] });
        }}
        onBulkImport={() => setBulkImportOpen(true)}
        auditEndpointUnavailable={!reachable}
      />

      <BulkImportDialog
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
        batchId={0 /* operator picks via the existing flow until a batch picker lands */}
        onComplete={() => qc.invalidateQueries({ queryKey: ["patient-directory-search"] })}
      />
      {dncOpen ? (
        <DncCooldownDialog
          open={dncOpen !== null}
          onOpenChange={(o) => !o && setDncOpen(null)}
          patientScreeningId={dncOpen.id}
          currentDnc={dncOpen.dnc}
          currentCooldownActive={dncOpen.cd}
          onComplete={() => qc.invalidateQueries({ queryKey: ["patient-directory-search"] })}
        />
      ) : null}
      {priorOpen ? (
        <AddPriorTestDialog
          open={priorOpen !== null}
          onOpenChange={(o) => !o && setPriorOpen(null)}
          patientScreeningId={priorOpen.id}
          patientName={priorOpen.name}
          onComplete={() => qc.invalidateQueries({ queryKey: ["patient-directory-search"] })}
        />
      ) : null}
    </>
  );
}
