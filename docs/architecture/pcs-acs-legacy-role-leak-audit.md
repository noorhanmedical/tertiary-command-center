# PCS / ACS — Legacy Role Leak Audit

> **Scope:** Inventory of the surviving `"technician"` / `"liaison"`
> legacy role strings inside the PCS / ACS portal stack. The user-
> facing workspace roles today are `patientCareSpecialist` and
> `ancillaryCareSpecialist`, but a back-compat shim still translates
> these to the older `"technician" | "liaison"` internal split for
> code paths that haven't been migrated to capability flags.

## Mapping reference

`client/src/components/workflow/ClinicWorkflowPortal.tsx`:

```ts
type WorkspaceRole =
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist"
  | "technician"
  | "liaison";

const INTERNAL_ROLE: Record<WorkspaceRole, "technician" | "liaison"> = {
  technician: "technician",
  liaison: "liaison",
  ancillaryCareSpecialist: "technician",
  patientCareSpecialist: "liaison",
};
```

PortalShell is invoked with the internal role, but also receives
the original `workspaceRole` in some paths. Both are passed through.

## Leak points

| Location | Pattern | Risk | Notes |
| --- | --- | --- | --- |
| `client/src/components/workflow/ClinicWorkflowPortal.tsx:21-26,49` | `INTERNAL_ROLE` map + `role={INTERNAL_ROLE[role]}` | **Architectural** — every PCS/ACS mount goes through this translator | The translator is the source of every other leak below. It exists because the PortalShell `role` prop type is still `"technician" | "liaison"` (see next row). |
| `client/src/components/portal/PortalShell.tsx:55` | `type Role = "technician" | "liaison";` | **High** | PortalShell's `role` prop type. The whole shell still types the role as the legacy split. |
| `client/src/components/portal/PortalShell.tsx:1160` | `const RoleIcon = role === "technician" ? Stethoscope : HeartHandshake;` | Medium | Determines the workspace icon. Visual only. |
| `client/src/components/portal/PortalShell.tsx:1166-1167` | `role === "technician" ? "Technician Portal" : "Liaison Technician Portal"` | Medium | Default title fallback. The actual workspace title is overridden when `workspaceRole` is set, so this is only visible on legacy direct mounts. |
| `client/src/components/portal/PortalShell.tsx:789-790` | `workspaceRole === "technician" || workspaceRole === "liaison"` | Low (after Batch 9) | Used in `workspaceIsAncillaryCareSpecialist`. Batch 9 removed the unsafe `undefined` fallback. The remaining string compares are intentional — legacy direct mounts still need to be classified ACS. |
| `client/src/components/portal/PatientCommandCanvas.tsx:311` | `workspaceRole === "ancillaryCareSpecialist" || workspaceRole === "technician"` | Low | Same ACS classifier pattern. Comments out `"liaison"` (which is PCS), so this is correctly aligned with the role's intent. |
| `client/src/components/workflow/PortalWorkflowPanel.tsx:24` | `type Role = "technician" | "liaison";` | Medium | Workflow panel's local role type. Probably ok to keep narrow since the panel is internal. |

## Risk classification

- **Architectural** — the `INTERNAL_ROLE` translator. Removing it
  means widening PortalShell's `role` prop type to accept the four
  WorkspaceRole values directly. Mechanically simple but touches
  ~10 PortalShell sites that test against `role === "technician"` or
  `role === "liaison"`. Best done in a dedicated batch.
- **High** — PortalShell's `Role` type alias. Removing the alias
  forces the migration of every leak point above.
- **Medium** — icon + default title resolution. Cosmetic; can stay
  until the architectural batch lands.
- **Low** — the `workspaceRole === "technician" / "liaison"` string
  compares that classify ACS-typed mounts. After Batch 9 these are
  intentional and safe; they treat legacy direct mounts as ACS,
  which is the back-compat behaviour we want.

## Safe migration plan

Step 1 (this batch, done): Document every leak. **No code changes.**

Step 2 (a future dedicated batch): Widen the PortalShell `role`
prop type to accept the full `WorkspaceRole` set
(`"patientCareSpecialist" | "ancillaryCareSpecialist" | "technician" | "liaison"`).
Remove `INTERNAL_ROLE`. Update PortalShell's role-string compares
to map directly:
- `role === "technician" || role === "ancillaryCareSpecialist"` →
  ACS classifier
- `role === "liaison" || role === "patientCareSpecialist"` → PCS
  classifier

Step 3 (after Batch 11 lands): Replace role-string compares with
the capability resolver
(`canMarkProcedureCompleted`, `canUseCallList`, …). The
`workspaceRole` string is then only used for icon + title +
analytics tagging, never for gating.

Step 4: Remove the `Role` type alias in `PortalShell.tsx:55` once
no remaining call site needs it. Same in `PortalWorkflowPanel.tsx`.

## What this audit does NOT touch

- `INTERNAL_ROLE` stays. The translator is required until step 2.
- No UI changes.
- No prop signature changes.
- No capability resolver changes.

## Cross-references

- `docs/architecture/pcs-acs-portal-solidness-audit.md` — broader
  PCS/ACS audit; this doc is the focused legacy-role inventory.
- `docs/architecture/tertiary-command-center-canonical-spine.md` —
  canonical spine reference.
- Batch 9 (`1f4f44c`) — removed the unsafe ACS-as-undefined-default
  in `workspaceIsAncillaryCareSpecialist`.
- Batch 11 (next) — `client/src/lib/portal/portalCapabilities.ts`
  capability resolver.
