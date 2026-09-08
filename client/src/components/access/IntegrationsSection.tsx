// Phase 4B — Integrations placeholder.
//
// Integrations are NOT migrated to the permission model in this phase. This
// section preserves the current admin-only access rule (it is shown only to
// legacy admins via admin-access.tsx section gating) and points operators to
// where technical/integration configuration currently lives. No integration
// controls are recreated here.

import { Plug } from "lucide-react";
import { AccessGroup } from "./AccessPrimitives";

export function IntegrationsSection() {
  return (
    <AccessGroup title="Integrations">
      <div className="flex gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm">
          <Plug className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-800">Integrations are managed elsewhere for now</h4>
          <p className="mt-1 text-sm text-slate-500">
            External integrations and technical configuration have not been migrated to the access-control
            permission model yet. Access rules for these remain unchanged and are administered from the existing
            Admin → System settings. This section is a placeholder until Integrations is migrated in a later phase.
          </p>
        </div>
      </div>
    </AccessGroup>
  );
}
