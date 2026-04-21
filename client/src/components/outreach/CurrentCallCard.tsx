import {
  ArrowRight,
  Building2,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Maximize2,
  Megaphone,
  Phone,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OutreachCall } from "@shared/schema";
import { getScriptForTest, fillScript } from "@/lib/outreachScripts";
import type { OutreachCallItem } from "./types";
import { digitsOnly, formatRelative, statusBadgeClass, statusLabel } from "./utils";

export function CurrentCallCard({
  item,
  latestCall,
  schedulerName,
  facilityName,
  lineageFromName,
  lineageReason,
  scriptOpen,
  setScriptOpen,
  onDisposition,
  onBook,
  onSkip,
  onExpand,
}: {
  item: OutreachCallItem | null;
  latestCall: OutreachCall | undefined;
  schedulerName: string;
  facilityName: string;
  lineageFromName: string | null;
  lineageReason: string | null;
  scriptOpen: boolean;
  setScriptOpen: (v: boolean) => void;
  onDisposition: () => void;
  onBook: () => void;
  onSkip: () => void;
  onExpand?: () => void;
}) {
  if (!item) {
    return (
      <div className="px-5 py-5 bg-gradient-to-br from-indigo-50/60 via-transparent to-blue-50/40">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
          <Megaphone className="h-3.5 w-3.5" />
          Current call
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Pick a patient from the call list to start working through the queue.
        </p>
      </div>
    );
  }

  const primaryTest = item.qualifyingTests[0];
  const script = primaryTest ? getScriptForTest(primaryTest) : null;
  return (
    <div className="px-5 py-5 bg-gradient-to-br from-indigo-50/60 via-transparent to-blue-50/40" data-testid="current-call-card">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
        <Megaphone className="h-3.5 w-3.5" />
        Current call
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            title="Expand to playing field"
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50"
            data-testid="current-call-expand"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <h2 className="text-xl font-semibold text-slate-900">{item.patientName}</h2>
        <Badge className={`rounded-full border text-[10px] ${statusBadgeClass(item.appointmentStatus)}`}>
          {statusLabel(item.appointmentStatus)}
        </Badge>
        {lineageFromName && (
          <Badge
            className="rounded-full border bg-violet-50 text-violet-700 border-violet-200 text-[10px]"
            data-testid="current-call-reassigned-from"
            title={lineageReason ?? "Reassigned"}
          >
            ↩ from {lineageFromName}
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <a
          href={`tel:${digitsOnly(item.phoneNumber)}`}
          className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
          data-testid="current-call-tel"
        >
          <Phone className="h-3.5 w-3.5" />Call {item.phoneNumber}
        </a>
        <span className="inline-flex items-center gap-0.5"><Building2 className="h-3 w-3" />{item.facility}</span>
        {item.dob && <span>DOB {item.dob}</span>}
        {item.age != null && <span>· {item.age} y/o</span>}
        {item.insurance && (
          <span className="inline-flex items-center gap-0.5"><ShieldCheck className="h-3 w-3" />{item.insurance}</span>
        )}
      </div>

      {/* AI reasoning summary — why this patient qualifies */}
      {item.reasoning?.length > 0 && (
        <div
          className="mt-3 rounded-xl border border-indigo-100 bg-white/80 p-3 text-[11px] text-slate-700"
          data-testid="current-call-reasoning"
        >
          <div className="flex items-center gap-1.5 text-indigo-600">
            <Sparkles className="h-3 w-3" />
            <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">Why this patient qualifies</span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {item.reasoning.slice(0, 3).map((r, i) => (
              <li key={`reason-${i}`}>
                <span className="font-semibold text-indigo-700">{r.testName}:</span>{" "}
                <span className="leading-relaxed line-clamp-3">{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prior tests / cooldown reasoning summary */}
      {(item.previousTests || item.previousTestsDate) && (
        <div
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] text-amber-900"
          data-testid="current-call-cooldown"
        >
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">Prior tests · cooldown</span>
          </div>
          <div className="mt-1 leading-relaxed">
            {item.previousTests && <span>{item.previousTests}</span>}
            {item.previousTestsDate && (
              <span className="ml-1 text-amber-700">(last {item.previousTestsDate})</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 rounded-xl bg-white/70 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 inline-flex items-center gap-1">
          <Stethoscope className="h-3 w-3" />Provider · {item.providerName}
        </div>
        {item.qualifyingTests.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.qualifyingTests.map((t) => (
              <Badge key={`cur-${t}`} className="rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-100 text-[11px]">{t}</Badge>
            ))}
          </div>
        )}
        {(item.diagnoses?.trim() || item.history?.trim()) && (
          <div className="mt-2 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
            {item.diagnoses?.trim() && (
              <div><span className="font-semibold text-slate-500">Dx:</span> <span className="line-clamp-2">{item.diagnoses}</span></div>
            )}
            {item.history?.trim() && (
              <div><span className="font-semibold text-slate-500">Hx:</span> <span className="line-clamp-2">{item.history}</span></div>
            )}
          </div>
        )}
      </div>

      {/* Scripts */}
      {script && primaryTest && (
        <div className="mt-3 rounded-xl border border-indigo-100 bg-white/80 p-3" data-testid="current-call-script">
          <button
            type="button"
            onClick={() => setScriptOpen(!scriptOpen)}
            className="flex w-full items-center gap-2 text-left"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            <span className="text-xs font-semibold text-indigo-700">Script · {primaryTest}</span>
            <span className="ml-auto text-slate-400">{scriptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
          </button>
          {scriptOpen && (
            <div className="mt-2 space-y-2 text-xs text-slate-700">
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Intro</p>
                <p className="mt-1 leading-relaxed">
                  {fillScript(script.intro, {
                    name: item.patientName.split(" ")[0],
                    scheduler: schedulerName,
                    clinic: facilityName,
                    provider: item.providerName,
                  })}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Why this matters</p>
                <p className="mt-1 leading-relaxed">{script.whyThisMatters}</p>
              </div>
              {script.objections.length > 0 && (
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">If they say…</p>
                  <ul className="mt-1 space-y-1">
                    {script.objections.map((o, i) => (
                      <li key={i} className="leading-relaxed">
                        <span className="font-semibold text-slate-600">"{o.objection}"</span> → <span>{o.response}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Last call summary */}
      {latestCall && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-2.5 text-[11px] text-slate-600">
          <span className="font-semibold text-slate-500">Last attempt:</span>{" "}
          <Badge className={`rounded-full border text-[10px] ${statusBadgeClass(latestCall.outcome)}`}>{latestCall.outcome.replace("_", " ")}</Badge>
          <span className="ml-1">· {formatRelative(latestCall.startedAt)}</span>
          {latestCall.notes && <p className="mt-1 italic text-slate-500">"{latestCall.notes}"</p>}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-indigo-100/60 pt-3">
        <Button
          onClick={onDisposition}
          className="rounded-full bg-indigo-600 px-4 text-white hover:bg-indigo-700"
          data-testid="current-call-disposition"
        >
          <FileText className="mr-1 h-4 w-4" /> Disposition <kbd className="ml-2 rounded bg-indigo-700 px-1.5 py-0.5 text-[10px]">D</kbd>
        </Button>
        <Button
          variant="outline"
          onClick={onBook}
          className="rounded-full border-blue-300 text-blue-700 hover:bg-blue-50"
          data-testid="current-call-book"
        >
          <CalendarPlus className="mr-1 h-4 w-4" /> Book slot <kbd className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">S</kbd>
        </Button>
        <Button
          variant="ghost"
          onClick={onSkip}
          className="ml-auto rounded-full text-slate-500"
          data-testid="current-call-next"
        >
          Next <ArrowRight className="ml-1 h-4 w-4" /> <kbd className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">N</kbd>
        </Button>
      </div>
    </div>
  );
}
