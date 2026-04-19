import { Brain, Sparkles, LineChart, MessagesSquare } from "lucide-react";
import { Card } from "@/components/ui/card";

export default function TaskBrainPage() {
  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-600/10 p-3 text-indigo-700">
            <Brain className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Task Brain</h1>
            <p className="text-sm text-slate-600">
              AI reasoning, operational intelligence, and workflow automation support.
            </p>
          </div>
        </div>

        <Card className="rounded-3xl border border-white/60 bg-white/75 p-8 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="rounded-3xl bg-indigo-100 p-5 text-indigo-600">
              <Sparkles className="h-10 w-10" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Coming soon</h2>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Task Brain will be the AI reasoning hub for the platform — surfacing operational insights,
                automating follow-up tasks, and providing an intelligent layer on top of schedule, outreach,
                and billing data.
              </p>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Brain,          label: "AI Insights",     desc: "Intelligent reasoning over schedule, outreach, and billing patterns." },
            { icon: LineChart,      label: "Analytics",       desc: "Conversion trends, qualification rates, and clinic-level performance." },
            { icon: MessagesSquare, label: "Workflow Assist", desc: "Automated follow-up suggestions and task prioritization." },
          ].map(({ icon: Icon, label, desc }) => (
            <Card key={label} className="rounded-3xl border border-white/60 bg-white/50 p-5 backdrop-blur-xl opacity-50">
              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-2xl bg-indigo-100 p-2 text-indigo-600">
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
