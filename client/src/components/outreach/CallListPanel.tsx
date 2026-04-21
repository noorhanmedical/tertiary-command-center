import {
  Building2, CalendarPlus, ChevronDown, ChevronUp,
  History as HistoryIcon, Phone, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OutreachCall } from "@shared/schema";
import { SchedulerIcon } from "@/components/plexus/SchedulerIcon";
import type { AssignmentRow, CallBucket, OutreachCallItem } from "./types";
import { BucketIndicator } from "./SmallBits";
import { digitsOnly, formatRelative, statusBadgeClass, statusLabel, toDate } from "./utils";

export type CallListEntry = { item: OutreachCallItem; latest: OutreachCall | undefined; bucket: CallBucket };

export function CallListPanel({
  sortedCallList,
  selectedId,
  callsByPatient,
  expandedTimeline,
  setExpandedTimeline,
  assignmentByPatient,
  schedulerNameById,
  selectPatient,
  setCallListBookPatient,
}: {
  sortedCallList: CallListEntry[];
  selectedId: number | null;
  callsByPatient: Record<number, OutreachCall[]>;
  expandedTimeline: Set<number>;
  setExpandedTimeline: (updater: (prev: Set<number>) => Set<number>) => void;
  assignmentByPatient: Map<number, AssignmentRow>;
  schedulerNameById: Map<number, string>;
  selectPatient: (id: number | null) => void;
  setCallListBookPatient: (item: OutreachCallItem | null) => void;
}) {
  return (
    <div className="min-w-0 flex flex-col max-h-[calc(100vh-140px)] xl:max-h-none xl:min-h-0 xl:h-full">
      <div className="rounded-3xl border border-white/60 bg-white/85 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl overflow-hidden flex flex-col min-h-0 flex-1">
        <div className="px-5 pt-5 pb-4 flex flex-col flex-1 min-h-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Call list</h2>
            <Badge variant="outline" className="rounded-full text-[11px] text-slate-500">
              {sortedCallList.length} {sortedCallList.length === 1 ? "patient" : "patients"}
            </Badge>
          </div>

          {sortedCallList.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-500">
              No patients in this view.
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pr-1 space-y-2">
              {sortedCallList.map(({ item, latest, bucket }) => {
                const isSelected = selectedId === item.patientId;
                const tlOpen = expandedTimeline.has(item.patientId);
                const calls = callsByPatient[item.patientId] ?? [];
                const attemptCount = latest?.attemptNumber ?? calls.length;
                return (
                  <div
                    key={item.id}
                    className={[
                      "rounded-2xl border p-3 transition",
                      isSelected
                        ? "border-indigo-300 bg-indigo-50/40 shadow-[0_4px_22px_rgba(79,70,229,0.16)]"
                        : "border-slate-200/80 bg-white hover:border-indigo-200 hover:bg-indigo-50/20",
                    ].join(" ")}
                    data-testid={`portal-call-row-${item.patientId}`}
                  >
                    <div className="flex w-full items-start gap-3 text-left">
                      <BucketIndicator bucket={bucket} />
                      <button
                        type="button"
                        onClick={() => selectPatient(item.patientId)}
                        className="flex-1 min-w-0 text-left"
                        data-testid={`portal-row-select-${item.patientId}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <SchedulerIcon patientScreeningId={item.patientId} patientName={item.patientName} size="xs" />
                          <span className="text-sm font-semibold text-slate-900 truncate">{item.patientName}</span>
                          <Badge className={`rounded-full border text-[10px] ${statusBadgeClass(item.appointmentStatus)}`}>
                            {statusLabel(item.appointmentStatus)}
                          </Badge>
                          <Badge
                            className={`rounded-full border text-[10px] uppercase tracking-wide ${
                              (item.patientType || "").toLowerCase() === "visit"
                                ? "bg-sky-100 text-sky-800 border-sky-200"
                                : "bg-violet-100 text-violet-800 border-violet-200"
                            }`}
                            title={
                              (item.patientType || "").toLowerCase() === "visit"
                                ? "Visit patient — has an appointment within the next 90 days"
                                : "Outreach patient — no appointment within the next 90 days"
                            }
                            data-testid={`portal-row-patient-type-${item.patientId}`}
                          >
                            {(item.patientType || "outreach").toLowerCase()}
                          </Badge>
                          {latest && (
                            <Badge
                              className={`rounded-full border text-[10px] ${statusBadgeClass(latest.outcome)}`}
                              data-testid={`portal-row-last-outcome-${item.patientId}`}
                            >
                              Last: {latest.outcome.replace(/_/g, " ")}
                            </Badge>
                          )}
                          {attemptCount > 0 && (
                            <Badge
                              className="rounded-full border border-slate-200 bg-slate-50 text-slate-600 text-[10px]"
                              data-testid={`portal-row-attempts-${item.patientId}`}
                            >
                              Attempt #{attemptCount}
                            </Badge>
                          )}
                          {bucket === "callback_due" && latest?.callbackAt && (
                            <Badge className="rounded-full border bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                              Due {formatRelative(latest.callbackAt)}
                            </Badge>
                          )}
                          {(() => {
                            const a = assignmentByPatient.get(item.patientId);
                            if (!a || a.source !== "reassigned" || !a.originalSchedulerId) return null;
                            const fromName = schedulerNameById.get(a.originalSchedulerId) ?? `#${a.originalSchedulerId}`;
                            return (
                              <Badge
                                className="rounded-full border bg-violet-50 text-violet-700 border-violet-200 text-[10px]"
                                title={a.reason ?? "Reassigned"}
                                data-testid={`portal-row-reassigned-${item.patientId}`}
                              >
                                ↩ from {fromName}
                              </Badge>
                            );
                          })()}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-0.5"><Building2 className="h-3 w-3" />{item.facility}</span>
                          <span>·</span>
                          <a
                            href={`tel:${digitsOnly(item.phoneNumber)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                            data-testid={`portal-tel-${item.patientId}`}
                          >
                            <Phone className="h-3 w-3" />{item.phoneNumber}
                          </a>
                          {item.insurance && (
                            <>
                              <span>·</span>
                              <span
                                className="inline-flex items-center gap-0.5 text-slate-500"
                                data-testid={`portal-row-insurance-${item.patientId}`}
                              >
                                <ShieldCheck className="h-3 w-3" />{item.insurance}
                              </span>
                            </>
                          )}
                          {calls.length > 0 && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-0.5">
                                <HistoryIcon className="h-3 w-3" />{calls.length} call{calls.length !== 1 ? "s" : ""}
                              </span>
                            </>
                          )}
                        </div>
                        {item.qualifyingTests.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {item.qualifyingTests.slice(0, 4).map((t) => (
                              <Badge key={`${item.id}-${t}`} className="rounded-full bg-blue-50 text-blue-700 hover:bg-blue-50 text-[10px]">{t}</Badge>
                            ))}
                            {item.qualifyingTests.length > 4 && (
                              <span className="text-[10px] text-slate-400">+{item.qualifyingTests.length - 4} more</span>
                            )}
                          </div>
                        )}
                      </button>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <a
                          href={`tel:${digitsOnly(item.phoneNumber)}`}
                          onClick={(e) => { e.stopPropagation(); selectPatient(item.patientId); }}
                          title={`Call ${item.phoneNumber}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 bg-white text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
                          data-testid={`portal-row-call-${item.patientId}`}
                        >
                          <Phone className="h-4 w-4" />
                        </a>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectPatient(item.patientId);
                            setCallListBookPatient(item);
                          }}
                          title="Add to schedule"
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-600 transition hover:border-violet-300 hover:bg-violet-50"
                          data-testid={`portal-row-add-to-schedule-${item.patientId}`}
                        >
                          <CalendarPlus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {calls.length > 0 && (
                      <div className="mt-2 border-t border-slate-100 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedTimeline((prev) => {
                              const n = new Set(prev);
                              n.has(item.patientId) ? n.delete(item.patientId) : n.add(item.patientId);
                              return n;
                            });
                          }}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
                          data-testid={`portal-timeline-toggle-${item.patientId}`}
                        >
                          <HistoryIcon className="h-3 w-3" />
                          {tlOpen ? "Hide timeline" : `Show timeline (${calls.length})`}
                          {tlOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                        {tlOpen && (
                          <div className="mt-2 space-y-1.5" data-testid={`portal-timeline-${item.patientId}`}>
                            {calls.map((c) => (
                              <div key={c.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]">
                                <div className="flex items-center gap-2">
                                  <Badge className={`rounded-full border text-[9px] ${statusBadgeClass(c.outcome)}`}>{c.outcome.replace("_", " ")}</Badge>
                                  <span className="text-slate-500">{formatRelative(c.startedAt)}</span>
                                  <span className="ml-auto text-slate-400">attempt #{c.attemptNumber}</span>
                                </div>
                                {c.notes && <p className="mt-1 text-slate-600">{c.notes}</p>}
                                {c.callbackAt && (
                                  <p className="mt-0.5 text-amber-700">
                                    Callback: {toDate(c.callbackAt)?.toLocaleString() ?? ""}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
