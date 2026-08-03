// Phase 2I — canonical lifecycle SECTION embedded INSIDE the existing
// TeamPortalShell (never a parallel standalone page).
//
// Flag OFF (default): renders nothing and issues ZERO canonical requests — the
// shell (WorkspaceModeSwitcher, modes, tabs, tools, dialogs, actions) is exactly
// as before. Flag ON: renders a compact, read-only canonical stage-vector panel
// for the current workspace (PCS = patient-grouped episodes; ACS = one row per
// ancillary case), alongside the existing shell UI. No mock data, no mutations.

import { useState } from "react";
import { usePcsCanonicalView, useAcsCanonicalView } from "./useCanonicalViews";
import { CanonicalPcsView } from "./CanonicalPcsPage";
import { CanonicalAcsView } from "./CanonicalAcsPage";

// Public workspace roles handed down by ClinicWorkflowPortal → TeamPortalShell.
type WorkspaceRoleLike = "patientCareSpecialist" | "ancillaryCareSpecialist" | "technician" | "liaison" | undefined;

function isPcs(role: WorkspaceRoleLike): boolean {
  return role === "patientCareSpecialist" || role === "liaison";
}

/** PCS variant — mounted only when the PCS flag is ON (hook gates the request). */
function PcsSection() {
  const [cursor, setCursor] = useState<string | null>(null);
  const { enabled, data, isLoading, isError, isMigrationMissing } = usePcsCanonicalView(cursor);
  if (!enabled) return null;
  return (
    <Panel testId="canonical-lifecycle-pcs" title="Canonical patient lifecycle">
      {isLoading && <Note testId="pcs-loading">Loading canonical data…</Note>}
      {!isLoading && isError && isMigrationMissing && <Note testId="pcs-migration-error">Canonical storage is not yet available (migration pending).</Note>}
      {!isLoading && isError && !isMigrationMissing && <Note testId="pcs-error">Could not load canonical data.</Note>}
      {!isLoading && !isError && data && <CanonicalPcsView data={data} />}
      {!isLoading && !isError && data && (data.pageInfo.nextCursor || cursor) && (
        <Pager cursor={cursor} nextCursor={data.pageInfo.nextCursor} onFirst={() => setCursor(null)} onNext={() => setCursor(data.pageInfo.nextCursor)} prefix="pcs" />
      )}
    </Panel>
  );
}

/** ACS variant — mounted only when the ACS flag is ON. */
function AcsSection() {
  const [cursor, setCursor] = useState<string | null>(null);
  const { enabled, data, isLoading, isError, isMigrationMissing } = useAcsCanonicalView(cursor);
  if (!enabled) return null;
  return (
    <Panel testId="canonical-lifecycle-acs" title="Canonical case lifecycle">
      {isLoading && <Note testId="acs-loading">Loading canonical data…</Note>}
      {!isLoading && isError && isMigrationMissing && <Note testId="acs-migration-error">Canonical storage is not yet available (migration pending).</Note>}
      {!isLoading && isError && !isMigrationMissing && <Note testId="acs-error">Could not load canonical data.</Note>}
      {!isLoading && !isError && data && <CanonicalAcsView data={data} />}
      {!isLoading && !isError && data && (data.pageInfo.nextCursor || cursor) && (
        <Pager cursor={cursor} nextCursor={data.pageInfo.nextCursor} onFirst={() => setCursor(null)} onNext={() => setCursor(data.pageInfo.nextCursor)} prefix="acs" />
      )}
    </Panel>
  );
}

/** The single canonical section the shell mounts. Chooses PCS/ACS by workspace
 *  role; each variant self-gates on its own flag (nothing renders when OFF). */
export function CanonicalLifecycleSection({ workspaceRole }: { workspaceRole?: WorkspaceRoleLike }) {
  return isPcs(workspaceRole) ? <PcsSection /> : <AcsSection />;
}

function Panel({ children, title, testId }: { children: React.ReactNode; title: string; testId: string }) {
  return (
    <section data-testid={testId} className="mb-3 rounded-lg border border-slate-200 bg-white/70 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      {children}
    </section>
  );
}
function Note({ children, testId }: { children: React.ReactNode; testId: string }) {
  return <div data-testid={testId} className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">{children}</div>;
}
function Pager({ cursor, nextCursor, onFirst, onNext, prefix }: { cursor: string | null; nextCursor: string | null; onFirst: () => void; onNext: () => void; prefix: string }) {
  return (
    <div className="mt-2 flex gap-2">
      <button type="button" disabled={!cursor} onClick={onFirst} data-testid={`${prefix}-first`} className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40">First</button>
      <button type="button" disabled={!nextCursor} onClick={onNext} data-testid={`${prefix}-next`} className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40">Next</button>
    </div>
  );
}
