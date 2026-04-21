import { Calendar, Clock, Mail, Megaphone, MessageCircle, Minimize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AncillaryAppointment, OutreachCall } from "@shared/schema";
import type { BookingSlot } from "@/components/clinic-calendar";
import type { PlexusTaskSummary, UserEntry } from "@/components/plexus/SchedulerIcon";
import type { CallBucket, OutreachCallItem } from "./types";
import { TriClinicCalendar } from "./TriClinicCalendar";
import { EmailComposer } from "./EmailComposer";
import { MaterialsPanel } from "./MaterialsPanel";
import { CurrentCallCard } from "./CurrentCallCard";
import { calcTimeRemaining, urgencyBadgeClass, urgencyShortLabel } from "./utils";

export function ExpandedSectionView(props: {
  section: "calendar" | "email" | "materials" | "tasks" | "currentCall" | "messages";
  onClose: () => void;
  facility: string;
  appointments: AncillaryAppointment[];
  selectedItem: OutreachCallItem | null;
  calYear: number;
  calMonth: number;
  setCalMonth: (m: number | ((p: number) => number)) => void;
  setCalYear: (y: number | ((p: number) => number)) => void;
  selectedDay: number | null;
  setSelectedDay: (d: number | null) => void;
  onConfirmSlot: (slot: BookingSlot) => void;
  sortedCallList: { item: OutreachCallItem; bucket: CallBucket }[];
  selectPatient: (id: number | null) => void;
  setCallListBookPatient: (item: OutreachCallItem | null) => void;
  urgentTasks: PlexusTaskSummary[];
  openTasks: PlexusTaskSummary[];
  users: UserEntry[];
  unreadTaskIds: Set<number>;
  openTaskDrawer: (task: PlexusTaskSummary) => void;
  schedulerName: string;
  latestCallByPatient: Map<number, OutreachCall>;
  onDisposition: () => void;
  onSkip: () => void;
}) {
  const { section, onClose } = props;
  const titleMap = {
    calendar: "Booking calendar",
    email: "Email composer",
    materials: "Marketing materials",
    tasks: "Tasks",
    currentCall: "Current call",
    messages: "Messages",
  };
  return (
    <div
      className="rounded-3xl border border-white/60 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl overflow-hidden"
      data-testid={`expanded-${section}`}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        {section === "calendar" && <Calendar className="h-4 w-4 text-blue-600" />}
        {section === "email" && <Mail className="h-4 w-4 text-emerald-600" />}
        {section === "materials" && <Megaphone className="h-4 w-4 text-amber-600" />}
        {section === "messages" && <MessageCircle className="h-4 w-4 text-emerald-600" />}
        <h2 className="text-base font-semibold text-slate-800">{titleMap[section]}</h2>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
          data-testid="expanded-close"
        >
          <Minimize2 className="h-3.5 w-3.5" /> Collapse
        </button>
      </div>
      {section === "calendar" && (
        <TriClinicCalendar
          fullWidth
          facility={props.facility}
          appointments={props.appointments}
          selectedItem={props.selectedItem}
          calYear={props.calYear}
          calMonth={props.calMonth}
          setCalMonth={props.setCalMonth}
          setCalYear={props.setCalYear}
          selectedDay={props.selectedDay}
          setSelectedDay={props.setSelectedDay}
          onConfirmSlot={props.onConfirmSlot}
        />
      )}
      {section === "email" && (
        <div className="p-6">
          <EmailComposer fullWidth selectedItem={props.selectedItem} facility={props.facility} />
        </div>
      )}
      {section === "materials" && (
        <div className="p-6">
          <MaterialsPanel fullWidth selectedItem={props.selectedItem} />
        </div>
      )}
      {section === "tasks" && (
        <div className="p-6 space-y-2 max-h-[70vh] overflow-y-auto">
          {(props.urgentTasks.length + props.openTasks.length) === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-12 text-center text-sm text-slate-400">
              No open tasks
            </div>
          ) : (
            [
              ...props.urgentTasks.map((t) => ({ task: t, isUrgent: true as const })),
              ...props.openTasks
                .filter((t) => !props.urgentTasks.some((u) => u.id === t.id))
                .map((t) => ({ task: t, isUrgent: false as const })),
            ].map(({ task, isUrgent }) => {
              const userMap = new Map<string, UserEntry>(props.users.map((u) => [u.id, u]));
              const requester = task.createdByUserId ? (userMap.get(task.createdByUserId)?.username ?? task.createdByUserId) : "Unknown";
              const timeRemaining = isUrgent ? calcTimeRemaining(task.urgency, task.createdAt) : null;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => { props.openTaskDrawer(task); onClose(); }}
                  className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    isUrgent
                      ? "border-orange-200 bg-orange-50/40 hover:border-orange-300"
                      : "border-slate-200 bg-white hover:border-violet-300"
                  }`}
                  data-testid={`expanded-task-${task.id}`}
                >
                  {isUrgent && (
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500 ring-2 ring-orange-200" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{task.title}</span>
                      {props.unreadTaskIds.has(task.id) && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                    </div>
                    {task.patientName && <p className="mt-0.5 text-xs text-slate-500">Patient: {task.patientName}</p>}
                    {isUrgent && (
                      <p className="mt-1 text-[11px] text-orange-700">
                        <Clock className="inline h-3 w-3 mr-0.5" />{timeRemaining} · Requested by {requester}
                      </p>
                    )}
                  </div>
                  {task.urgency !== "none" && (
                    <Badge className={`rounded-full border text-[10px] ${urgencyBadgeClass(task.urgency)}`}>
                      {urgencyShortLabel(task.urgency)}
                    </Badge>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
      {section === "messages" && (
        <div className="p-6 space-y-2 max-h-[70vh] overflow-y-auto">
          {[...props.urgentTasks, ...props.openTasks.filter((t) => !props.urgentTasks.some((u) => u.id === t.id))].length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-12 text-center text-sm text-slate-400">
              No active threads
            </div>
          ) : (
            [...props.urgentTasks, ...props.openTasks.filter((t) => !props.urgentTasks.some((u) => u.id === t.id))].map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => { props.openTaskDrawer(task); onClose(); }}
                className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-emerald-300"
                data-testid={`expanded-message-${task.id}`}
              >
                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{task.title}</span>
                    {props.unreadTaskIds.has(task.id) && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                  </div>
                  {task.patientName && <p className="mt-0.5 text-xs text-slate-500">Patient: {task.patientName}</p>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
      {section === "currentCall" && (
        <div className="max-h-[70vh] overflow-y-auto">
          <CurrentCallCard
            item={props.selectedItem}
            latestCall={props.selectedItem ? props.latestCallByPatient.get(props.selectedItem.patientId) : undefined}
            schedulerName={props.schedulerName}
            facilityName={props.facility}
            lineageFromName={null}
            lineageReason={null}
            scriptOpen={true}
            setScriptOpen={() => {}}
            onDisposition={props.onDisposition}
            onBook={() => {
              if (props.selectedItem) props.setCallListBookPatient(props.selectedItem);
            }}
            onSkip={props.onSkip}
          />
        </div>
      )}
    </div>
  );
}

