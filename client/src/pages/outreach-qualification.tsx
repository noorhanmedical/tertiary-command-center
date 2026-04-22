import { Card } from "@/components/ui/card";
import { Phone, ClipboardList } from "lucide-react";

export default function OutreachQualificationPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-10 pb-16">
        <div className="max-w-5xl mx-auto">
          <div className="mb-10">
            <div className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase mb-3">
              PLEXUS ANCILLARY · OUTREACH QUALIFICATION
            </div>
            <h1 className="text-3xl font-semibold text-slate-900 tracking-tight" data-testid="text-outreach-qualification-heading">
              Outreach Qualification
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Outreach qualification will use the same parser, patient bars, qualification generation, PDFs, and share actions as visit qualification, but will end in a final outreach list instead of a final schedule.
            </p>
          </div>

          <Card className="glass-tile">
            <div className="p-6 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 flex items-center justify-center shrink-0">
                <Phone className="w-5 h-5 text-indigo-600" strokeWidth={1.75} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Next build target</div>
                <div className="text-sm text-slate-600 mt-1">
                  This branch is reserved for standalone outreach patients who are not part of a committed visit schedule.
                </div>
              </div>
            </div>
          </Card>

          <Card className="glass-tile mt-6">
            <div className="p-6 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 flex items-center justify-center shrink-0">
                <ClipboardList className="w-5 h-5 text-indigo-600" strokeWidth={1.75} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Planned parity with visit flow</div>
                <div className="text-sm text-slate-600 mt-1">
                  Same parser. Same patient bars. Same qualification outputs. Same clinician PDF and Plexus PDF. Same share path. Different final container: outreach list instead of visit schedule.
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
