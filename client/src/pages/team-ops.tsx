import { Users2, Clock, Building2, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";

export default function TeamOpsPage() {
  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-violet-600/10 p-3 text-violet-700">
            <Users2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Team Ops</h1>
            <p className="text-sm text-slate-600">
              Staffing authority, coverage coordination, and technician scheduling.
            </p>
          </div>
        </div>

        <Card className="rounded-3xl border border-white/60 bg-white/75 p-8 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="rounded-3xl bg-violet-100 p-5 text-violet-600">
              <Wrench className="h-10 w-10" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Coming soon</h2>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Team Ops will be the canonical surface for staffing assignments, clinic coverage authority,
                and technician scheduling. All team-level operational decisions will flow through here.
              </p>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Users2,    label: "Staffing",        desc: "Assign team members to clinics and coverage shifts." },
            { icon: Clock,     label: "Technician Scheduling", desc: "Coordinate BrainWave and VitalWave technician slots." },
            { icon: Building2, label: "Clinic Coverage", desc: "Manage which scheduler covers which facility on a given day." },
          ].map(({ icon: Icon, label, desc }) => (
            <Card key={label} className="rounded-3xl border border-white/60 bg-white/50 p-5 backdrop-blur-xl opacity-50">
              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-2xl bg-violet-100 p-2 text-violet-600">
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-slate-900">{label}</h3>
              </div>
              <p className="text-sm text-slate-500">{desc}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
