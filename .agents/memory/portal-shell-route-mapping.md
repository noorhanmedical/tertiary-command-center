---
name: Portal shell route mapping
description: Which portal routes mount TeamPortalShell vs the legacy PortalShell — critical for testing rail behavior on the right page.
---

Two portal shells coexist, dispatched by `ClinicWorkflowPortal` (`client/src/components/workflow/ClinicWorkflowPortal.tsx`):

- **TeamPortalShell** (new shell — peek rails, playground, tray): mounted at `/patient-care-specialist-portal` and `/ancillary-care-specialist-portal`.
- **Legacy PortalShell** (`client/src/components/portal/PortalShell.tsx` — click-toggle collapse rails, fixed layout): mounted at `/technician-portal` and `/liaison-portal`.

Both shells use the SAME data-testids (`portal-left-rail`, `portal-right-rail`), so an e2e test hitting `/technician-portal` silently exercises the legacy shell.

**Why:** an edge-hover e2e "failure" turned out to be testing the wrong shell entirely — the URL, not the testid, determines which component renders.

**How to apply:** when testing or changing Team Portal rail behavior, confirm which route → shell you're touching first; rail UX changes usually need mirroring in both shells.
