import React from "react";
import { CalendarDays, Mail, Megaphone, NotebookPen, Phone, Search } from "lucide-react";
import { useCommandCenter } from "../context/CommandCenterContext";
import { PlexusTasksWorkspace } from "@/features/plexus-tasks/PlexusTasksWorkspace";

function EmptyPlayground() {
  return (
    <main className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex h-full min-h-[720px] items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-blue-50 text-blue-700">
            <Search className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-bold text-slate-950">Playground</h2>
          <p className="mt-2 text-sm text-slate-500">Expand any popup or context into this full workspace.</p>
        </div>
      </div>
    </main>
  );
}

function WorkspaceCard({ children }: { children: React.ReactNode }) {
  return <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">{children}</section>;
}

export function CommandPlayground() {
  const { playgroundContext } = useCommandCenter();

  if (!playgroundContext) return <EmptyPlayground />;

  const title = playgroundContext.title ?? "Workspace";

  return (
    <main className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{playgroundContext.componentType}</div>
          <h1 className="text-3xl font-bold text-slate-950">{title}</h1>
        </div>
        <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">
          {playgroundContext.sourceSurface}
        </div>
      </div>

      {playgroundContext.componentType === "calendarDate" ? (
        <CalendarDateWorkspace />
      ) : playgroundContext.componentType === "callList" ? (
        <PhoneWorkspace />
      ) : playgroundContext.componentType === "marketing" ? (
        <MarketingWorkspace />
      ) : playgroundContext.componentType === "email" ? (
        <EmailWorkspace />
      ) : playgroundContext.componentType === "scratchpad" ? (
        <ScratchpadWorkspace />
      ) : playgroundContext.componentType === "searchResult" ? (
        <SearchWorkspace />
      ) : playgroundContext.componentType === "visit" ? (
        <VisitWorkspace surface={playgroundContext.sourceSurface} actions={(playgroundContext.metadata?.actions as string[]) ?? []} />
      ) : playgroundContext.componentType === "outreach" ? (
        <OutreachWorkspace surface={playgroundContext.sourceSurface} actions={(playgroundContext.metadata?.actions as string[]) ?? []} />
      ) : playgroundContext.componentType === "plexusTasks" ? (
        <div className="h-[760px]">
          <PlexusTasksWorkspace embedded />
        </div>
      ) : (
        <GenericWorkspace />
      )}
    </main>
  );
}

function CalendarDateWorkspace() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <WorkspaceCard>
        <div className="mb-3 flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-blue-700" />
          <h2 className="text-lg font-bold text-slate-950">Date Schedule</h2>
        </div>
        <div className="grid gap-3">
          {["Patients", "Scheduled ancillaries", "Procedure complete", "Callbacks"].map((item) => (
            <div key={item} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
              {item}
            </div>
          ))}
        </div>
      </WorkspaceCard>

      <WorkspaceCard>
        <h2 className="mb-3 text-lg font-bold text-slate-950">Ancillary Counts</h2>
        <div className="grid gap-3">
          <div className="rounded-2xl bg-violet-50 p-4 text-violet-700">BrainWave opportunities</div>
          <div className="rounded-2xl bg-rose-50 p-4 text-rose-700">VitalWave opportunities</div>
          <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-700">Ultrasound opportunities</div>
        </div>
      </WorkspaceCard>

      <WorkspaceCard>
        <h2 className="mb-3 text-lg font-bold text-slate-950">Actions</h2>
        <div className="grid gap-3">
          <button className="rounded-2xl bg-blue-700 p-4 text-left text-sm font-semibold text-white">Open patient list</button>
          <button className="rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm font-semibold text-slate-700">Filter ancillaries</button>
          <button className="rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm font-semibold text-slate-700">Review completed procedures</button>
        </div>
      </WorkspaceCard>
    </div>
  );
}

function PhoneWorkspace() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <WorkspaceCard>
        <div className="mb-4 flex items-center gap-3">
          <Phone className="h-6 w-6 text-slate-900" />
          <h2 className="text-lg font-bold text-slate-950">RingCentral Call Workspace</h2>
        </div>
        <div className="grid gap-3">
          <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" placeholder="Dial or search patient" />
          <textarea className="min-h-40 rounded-2xl border border-slate-200 bg-white p-4 text-sm" placeholder="Call notes" />
          <div className="grid grid-cols-3 gap-2">
            <button className="rounded-2xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white">Start call</button>
            <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Disposition</button>
            <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Callback</button>
          </div>
        </div>
      </WorkspaceCard>
      <WorkspaceCard>
        <h2 className="mb-3 text-lg font-bold text-slate-950">Provider Abstraction</h2>
        <div className="space-y-3 text-sm text-slate-600">
          <div className="rounded-2xl bg-white p-4">Default: RingCentral</div>
          <div className="rounded-2xl bg-white p-4">Fallback: Manual phone mode</div>
          <div className="rounded-2xl bg-white p-4">Future: Dialpad, Aircall, 8x8, GoTo</div>
        </div>
      </WorkspaceCard>
    </div>
  );
}

function MarketingWorkspace() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
      <WorkspaceCard>
        <div className="mb-4 flex items-center gap-3">
          <Megaphone className="h-6 w-6 text-violet-700" />
          <h2 className="text-lg font-bold text-slate-950">Marketing Library</h2>
        </div>
        <div className="grid gap-3">
          <div className="rounded-2xl bg-violet-50 p-4 text-violet-700">BrainWave</div>
          <div className="rounded-2xl bg-rose-50 p-4 text-rose-700">VitalWave</div>
          <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-700">Ultrasound</div>
        </div>
      </WorkspaceCard>
      <WorkspaceCard>
        <h2 className="mb-3 text-lg font-bold text-slate-950">Brochure Workspace</h2>
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          PDF preview / send history / templates / patient targeting
        </div>
      </WorkspaceCard>
    </div>
  );
}

function EmailWorkspace() {
  return (
    <WorkspaceCard>
      <div className="mb-4 flex items-center gap-3">
        <Mail className="h-6 w-6 text-blue-700" />
        <h2 className="text-lg font-bold text-slate-950">Email Composer</h2>
      </div>
      <div className="grid gap-3">
        <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" placeholder="Recipient" />
        <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" placeholder="Subject" />
        <textarea className="min-h-72 rounded-2xl border border-slate-200 bg-white p-4 text-sm" placeholder="Full message editor" />
        <div className="grid grid-cols-3 gap-2">
          <button className="rounded-2xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white">Send</button>
          <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Save draft</button>
          <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Attach brochure</button>
        </div>
      </div>
    </WorkspaceCard>
  );
}

function ScratchpadWorkspace() {
  return (
    <WorkspaceCard>
      <div className="mb-4 flex items-center gap-3">
        <NotebookPen className="h-6 w-6 text-amber-700" />
        <h2 className="text-lg font-bold text-slate-950">Scratchpad</h2>
      </div>
      <textarea className="min-h-96 w-full rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm" placeholder="Temporary notes, call notes, snippets..." />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button className="rounded-2xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white">Attach to patient</button>
        <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Convert callback</button>
        <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Copy</button>
      </div>
    </WorkspaceCard>
  );
}

function SearchWorkspace() {
  return (
    <WorkspaceCard>
      <h2 className="mb-4 text-lg font-bold text-slate-950">Command Search</h2>
      <input className="mb-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" placeholder="Search everything" />
      <div className="grid gap-3 md:grid-cols-3">
        {["Patients", "Clinics", "Appointments", "Ancillaries", "Documents", "Billing"].map((label) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700">
            {label}
          </div>
        ))}
      </div>
    </WorkspaceCard>
  );
}

function GenericWorkspace() {
  return (
    <WorkspaceCard>
      <h2 className="text-lg font-bold text-slate-950">Workspace</h2>
      <p className="mt-2 text-sm text-slate-500">This context is ready for a full detail implementation.</p>
    </WorkspaceCard>
  );
}

function VisitWorkspace({ surface, actions }: { surface: string; actions: string[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <WorkspaceCard>
        <div className="mb-4 flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-blue-700" />
          <h2 className="text-lg font-bold text-slate-950">Visit Patients Workspace</h2>
        </div>
        <div className="grid gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
            Committed clinic-day patients · driven by surface profile <span className="text-blue-700">{surface}</span>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Same parser, patient bars, qualification outputs, PDFs, and share path.
          </div>
        </div>
      </WorkspaceCard>
      <WorkspaceCard>
        <h2 className="mb-3 text-lg font-bold text-slate-950">Surface Actions</h2>
        <div className="space-y-2 text-sm text-slate-600">
          {actions.length === 0 ? (
            <div className="rounded-2xl bg-white p-4 text-slate-400">No surface-specific actions configured.</div>
          ) : (
            actions.map((action) => (
              <div key={action} className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-700">
                {action}
              </div>
            ))
          )}
        </div>
      </WorkspaceCard>
    </div>
  );
}

function OutreachWorkspace({ surface, actions }: { surface: string; actions: string[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <WorkspaceCard>
        <div className="mb-4 flex items-center gap-3">
          <Phone className="h-6 w-6 text-violet-700" />
          <h2 className="text-lg font-bold text-slate-950">Outreach Patients Workspace</h2>
        </div>
        <div className="grid gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
            Standalone outreach pool · driven by surface profile <span className="text-violet-700">{surface}</span>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Same parser, patient bars, and generation path as Visit Patients, without requiring a committed visit schedule.
          </div>
        </div>
      </WorkspaceCard>
      <WorkspaceCard>
        <h2 className="mb-3 text-lg font-bold text-slate-950">Surface Actions</h2>
        <div className="space-y-2 text-sm text-slate-600">
          {actions.length === 0 ? (
            <div className="rounded-2xl bg-white p-4 text-slate-400">No surface-specific actions configured.</div>
          ) : (
            actions.map((action) => (
              <div key={action} className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-700">
                {action}
              </div>
            ))
          )}
        </div>
      </WorkspaceCard>
    </div>
  );
}
