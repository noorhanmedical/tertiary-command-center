// Mission Control — right-side detail Sheet for one selected lane row.
//
// Monitoring + routing actions only (no qualify / approve / reject).
// Extracted from `client/src/pages/mission-control.tsx` to keep the page
// focused on filters + lanes table.

import {
  Button,
} from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  CalendarClock,
  CheckCircle2,
  FileText,
  Receipt,
  Send,
  ShieldAlert,
  UserCog,
} from "lucide-react";
import type {
  LaneStatus,
  MissionControlLaneRow,
  Priority,
} from "@/lib/enterprise-demo/types";

// Local copies of the two style maps used inside the workbench. The
// page maintains its own copies for the lanes table; future cleanup
// can dedupe via a shared `missionControlStyles.ts` if the surface
// grows.
const statusStyles: Record<LaneStatus, string> = {
  Watch: "rounded-md bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 text-xs font-medium",
  Blocked: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  Ready: "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "In Progress": "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Complete: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const priorityStyles: Record<Priority, string> = {
  Urgent: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  High: "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  Medium: "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Low: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}

export interface MissionControlWorkbenchProps {
  selected: MissionControlLaneRow | null;
  onClose: () => void;
  // Fire-and-forget action handler. The page wires this to a toast.
  // Productionizing should swap this for real route handoffs.
  onAction: (title: string, description: string) => void;
}

export function MissionControlWorkbench({
  selected,
  onClose,
  onAction,
}: MissionControlWorkbenchProps) {
  return (
    <Sheet open={!!selected} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        {selected && (
          <>
            <SheetHeader>
              <SheetTitle data-testid="text-workbench-patient">{selected.patient}</SheetTitle>
              <SheetDescription>
                {selected.patientId} · {selected.clinic}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={statusStyles[selected.status]}>{selected.status}</span>
                <span className={priorityStyles[selected.priority]}>{selected.priority}</span>
                <span className="rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium">{selected.laneLabel}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Service" value={selected.service} />
                <Field label="Ancillary" value={selected.ancillary} />
                <Field label="Owner" value={selected.owner} />
                <Field label="Responsible team" value={selected.team} />
                <Field label="Imaging / report" value={selected.imagingStatus} />
                <Field label="Billing readiness" value={selected.billingReadiness} />
                <Field label="Call result" value={selected.callResult} />
                <Field label="Due date" value={selected.dueDate} />
              </div>

              <div>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Current blocker</div>
                <p className="text-sm text-slate-700">{selected.blocker ?? "None — lane is clear."}</p>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Next required action</div>
                <p className="text-sm text-slate-700">{selected.nextAction}</p>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Timeline</div>
                <ol className="space-y-2">
                  {selected.timeline.map((t, i) => (
                    <li key={i} className="flex gap-3 text-sm" data-testid={`timeline-${selected.id}-${i}`}>
                      <span className="text-xs text-slate-400 tabular-nums w-12 shrink-0">{t.time}</span>
                      <span className="text-slate-700">{t.event}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Related documents</div>
                {selected.documents.length === 0 ? (
                  <p className="text-sm text-slate-400">No documents on file.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selected.documents.map((d) => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs">
                        <FileText className="w-3 h-3" /> {d}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              {/* Monitoring / triage actions — no qualify/approve here. */}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => onAction("Marked Ready", `${selected.patient} flagged ready in ${selected.laneLabel}.`)} data-testid="button-mark-ready">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" /> Mark Ready
                </Button>
                <Button variant="outline" size="sm" onClick={() => onAction("Marked Blocked", `${selected.patient} flagged blocked for review.`)} data-testid="button-mark-blocked">
                  <ShieldAlert className="w-4 h-4 mr-1.5" /> Mark Blocked
                </Button>
                <Button variant="outline" size="sm" onClick={() => onAction("Assign Owner", `Owner reassignment requested for ${selected.patient}.`)} data-testid="button-assign-owner">
                  <UserCog className="w-4 h-4 mr-1.5" /> Assign Owner
                </Button>
                <Button variant="outline" size="sm" onClick={() => onAction("Sent to Engagement", `${selected.patient} routed to Engagement Center.`)} data-testid="button-send-engagement">
                  <Send className="w-4 h-4 mr-1.5" /> To Engagement
                </Button>
                <Button variant="outline" size="sm" onClick={() => onAction("Sent to Scheduler", `${selected.patient} routed to Scheduler.`)} data-testid="button-send-scheduler">
                  <CalendarClock className="w-4 h-4 mr-1.5" /> To Scheduler
                </Button>
                <Button variant="outline" size="sm" onClick={() => onAction("Sent to Billing", `${selected.patient} routed to Billing.`)} data-testid="button-send-billing">
                  <Receipt className="w-4 h-4 mr-1.5" /> To Billing
                </Button>
                <Button variant="outline" size="sm" className="col-span-2" onClick={() => onAction("Documents", `Opening document package for ${selected.patient}.`)} data-testid="button-view-documents">
                  <FileText className="w-4 h-4 mr-1.5" /> View Documents
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
