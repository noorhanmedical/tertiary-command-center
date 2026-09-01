// Phase 2I — the REAL production work-queue composition used by TeamPortalShell.
//
// It renders the sticky mode-switcher `header` (kept sticky as before), then, in
// the NORMAL scrollable work-queue body, the flag-gated canonical lifecycle
// `canonicalSection` followed by the EXISTING mode-body `children`. TeamPortalShell
// passes its actual mode-body subtree here as `children` (no test-only children
// path; no duplication), and the behavioral test renders THIS same component the
// same way. The canonical section is in the scrollable body — never inside the
// sticky header — so it can never obscure the existing queue.

export function WorkspaceWorkQueueComposition({
  header, canonicalSection, children,
}: {
  header?: React.ReactNode;         // sticky mode-switcher header (kept sticky by its own classes)
  canonicalSection?: React.ReactNode; // flag-gated canonical lifecycle section
  children?: React.ReactNode;        // the existing mode body
}) {
  return (
    <div data-testid="workspace-work-queue">
      {header}
      <div className="p-3" data-testid="workspace-work-queue-body">
        {canonicalSection}
        {children}
      </div>
    </div>
  );
}
