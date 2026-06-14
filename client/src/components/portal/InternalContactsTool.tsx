// InternalContactsTool — placeholder shell for the Phase 2 PR 2.7
// Internal Contacts tool. PR 2.6 mounts the slot in the left rail
// + center-canvas tab so the layout is reserved; PR 2.7 fills in
// the canonical /api/contacts wiring.

import { Card } from "@/components/ui/card";
import { Phone } from "lucide-react";

export function InternalContactsTool() {
  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-hidden p-4"
      data-testid="portal-internal-contacts"
    >
      <Card className="p-3 bg-white">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Phone className="h-4 w-4 text-slate-500" /> Internal Contacts
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Pending: canonical contacts directory ships in PR 2.7. The
          slot is reserved here so the left-rail layout stays
          consistent across PCS / ACS.
        </div>
      </Card>
    </div>
  );
}
