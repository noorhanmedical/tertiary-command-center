import { Card } from "@/components/ui/card";
import { Users } from "lucide-react";
import {
  VisitCommandTile,
  OutreachCommandTile,
} from "@/features/command-center/tiles";

export default function QualificationPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-10 pb-16">
        <div className="max-w-5xl mx-auto">
          <div className="mb-10">
            <div className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase mb-3">
              PLEXUS ANCILLARY · PATIENT INTAKE
            </div>
            <h1 className="text-3xl font-semibold text-slate-900 tracking-tight" data-testid="text-qualification-heading">
              Patient Intake
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Send patients into the correct visit or outreach workflow from one place.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <VisitCommandTile surface="plexusIq" />
            <OutreachCommandTile surface="plexusIq" />
          </div>
          <Card className="glass-tile mt-6">
            <div className="p-6 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-indigo-600" strokeWidth={1.75} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Lifecycle rule</div>
                <div className="text-sm text-slate-600 mt-1">
                  Visit patients come from committed schedules and should flow into the global calendar and clinic workflow surfaces.
                  Outreach patients are standalone qualified patients and should flow into outreach and remote scheduler worklists.
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
