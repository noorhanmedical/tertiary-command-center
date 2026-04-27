import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchPatientPacket,
  patientPacketQueryKey,
  type PatientPacket,
  type PatientPacketLookup,
} from "@/lib/workflow/patientPacketApi";

type PatientJourneyDrawerProps = {
  lookup: PatientPacketLookup;
  triggerLabel?: string;
  triggerSize?: "sm" | "default" | "lg" | "icon";
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerClassName?: string;
};

export function PatientJourneyDrawer({
  lookup,
  triggerLabel = "Journey",
  triggerSize = "sm",
  triggerVariant = "outline",
  triggerClassName,
}: PatientJourneyDrawerProps) {
  const [open, setOpen] = useState(false);

  const hasLookup = lookup.executionCaseId != null
    || lookup.patientScreeningId != null
    || (lookup.patientName && lookup.patientDob);

  const { data, isLoading, isError, error } = useQuery<PatientPacket>({
    queryKey: patientPacketQueryKey(lookup),
    queryFn: () => fetchPatientPacket(lookup),
    enabled: open && !!hasLookup,
    staleTime: 30_000,
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          size={triggerSize}
          variant={triggerVariant}
          className={triggerClassName}
          data-testid="patient-journey-trigger"
          disabled={!hasLookup}
        >
          <Activity className="h-4 w-4" />
          <span className="ml-1.5">{triggerLabel}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-md sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-base font-semibold text-slate-900">
            Patient Journey
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-7rem)] pr-4">
          {!hasLookup ? (
            <EmptyState message="No patient identifier was provided." />
          ) : isLoading ? (
            <LoadingState />
          ) : isError ? (
            <ErrorState message={error instanceof Error ? error.message : "Failed to load patient packet"} />
          ) : !data ? (
            <EmptyState message="No data available for this patient." />
          ) : (
            <JourneyBody packet={data} />
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col gap-3" data-testid="journey-loading">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800"
      data-testid="journey-error"
    >
      {message}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500"
      data-testid="journey-empty"
    >
      {message}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        {typeof count === "number" && (
          <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">{count}</Badge>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
        {children}
      </div>
    </section>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="truncate text-right text-sm font-medium text-slate-800">
        {value ?? <span className="text-slate-400">—</span>}
      </span>
    </div>
  );
}

function readField(row: unknown, key: string): string | null {
  if (!row || typeof row !== "object") return null;
  const v = (row as Record<string, unknown>)[key];
  if (v == null) return null;
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
}

/** Defensive array accessor — anything that isn't an array becomes []. */
function asArray<T = Record<string, unknown>>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Defensive object accessor — anything that isn't a plain object becomes null. */
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Defensive number accessor — null/undefined/NaN become null. */
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  try {
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return value;
    return dt.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return value;
  }
}

function JourneyBody({ packet }: { packet: PatientPacket }) {
  // Defensive shape coercion. Server contract says these are arrays/objects,
  // but a single bad cell would otherwise crash the entire page render.
  const ec = asObject(packet?.executionCase);
  const ps = asObject(packet?.patientScreening);

  const insuranceReviews = asArray(packet?.insuranceEligibilityReviews);
  const cooldown = asArray(packet?.cooldownRecords);
  const docs = asArray(packet?.caseDocumentReadiness);
  const schedule = asArray(packet?.globalScheduleEvents);
  const billingReadyRows = asArray(packet?.billingReadinessChecks);
  const billingDocReqRows = asArray(packet?.billingDocumentRequests);
  const completedPackages = asArray(packet?.completedBillingPackages);
  const projected = asArray(packet?.projectedInvoiceRows);
  const procedureNotes = asArray(packet?.procedureNotes);
  const journeyEvents = asArray(packet?.journeyEvents);

  const patientName = readField(ps, "name") ?? readField(ec, "patientName");
  const patientDob = readField(ps, "dob") ?? readField(ec, "patientDob");
  const facility = readField(ps, "facility") ?? readField(ec, "facilityId");
  const engagementBucket = readField(ec, "engagementBucket");
  const lifecycleStatus = readField(ec, "lifecycleStatus");
  const engagementStatus = readField(ec, "engagementStatus");
  const qualificationStatus = readField(ec, "qualificationStatus");

  const latestInsurance = asObject(insuranceReviews[0]);
  const eligibilityStatus = readField(latestInsurance, "eligibilityStatus");
  const approvalStatus = readField(latestInsurance, "approvalStatus");
  const priorityClass = readField(latestInsurance, "priorityClass");

  const billingReady = asObject(billingReadyRows[0]);
  const billingDocReq = asObject(billingDocReqRows[0]);
  const latestPackage = asObject(completedPackages[0]);
  const recentJourney = journeyEvents.slice(0, 8);

  const screeningId = asNumber(packet?.resolvedPatientScreeningId);
  const executionCaseId = asNumber(packet?.resolvedExecutionCaseId);

  return (
    <div data-testid="journey-body">
      <Section title="Patient Summary">
        <KV label="Name" value={patientName} />
        <KV label="DOB" value={patientDob} />
        <KV label="Facility" value={facility} />
        <KV label="Bucket" value={engagementBucket} />
        <KV label="Lifecycle" value={lifecycleStatus} />
        <KV label="Engagement" value={engagementStatus} />
      </Section>

      <Section title="Qualification">
        <KV label="Status" value={qualificationStatus} />
        <KV label="Screening ID" value={screeningId} />
        <KV label="Execution Case" value={executionCaseId} />
      </Section>

      <Section title="Insurance" count={insuranceReviews.length}>
        {latestInsurance ? (
          <>
            <KV label="Eligibility" value={eligibilityStatus} />
            <KV label="Approval" value={approvalStatus} />
            <KV label="Priority Class" value={priorityClass} />
          </>
        ) : (
          <div className="text-xs text-slate-400">No data yet.</div>
        )}
      </Section>

      <Section title="Cooldown" count={cooldown.length}>
        {cooldown.length === 0 ? (
          <div className="text-xs text-slate-400">No data yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {cooldown.slice(0, 5).map((r, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <span className="truncate text-slate-700">{readField(r, "serviceType") ?? "—"}</span>
                <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">
                  {readField(r, "cooldownStatus") ?? "unknown"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Schedule" count={schedule.length}>
        {schedule.length === 0 ? (
          <div className="text-xs text-slate-400">No data yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {schedule.slice(0, 5).map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-700">
                  {readField(e, "eventType") ?? "—"}
                  {readField(e, "status") ? ` · ${readField(e, "status")}` : ""}
                </span>
                <span className="text-slate-500">{formatDate(readField(e, "startsAt")) ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Documents" count={docs.length}>
        {docs.length === 0 ? (
          <div className="text-xs text-slate-400">No data yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {docs.slice(0, 6).map((d, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <span className="truncate text-slate-700">{readField(d, "documentType") ?? "—"}</span>
                <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">
                  {readField(d, "documentStatus") ?? "—"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Billing">
        <KV label="Readiness" value={readField(billingReady, "readinessStatus")} />
        <KV label="Doc Request" value={readField(billingDocReq, "requestStatus")} />
        <KV label="Procedure Notes" value={procedureNotes.length} />
      </Section>

      <Section title="Invoices" count={completedPackages.length + projected.length}>
        <KV label="Completed Packages" value={completedPackages.length} />
        <KV label="Projected Rows" value={projected.length} />
        {latestPackage && (
          <KV
            label="Latest Package"
            value={`${readField(latestPackage, "packageStatus") ?? "—"} · ${readField(latestPackage, "paymentStatus") ?? "—"}`}
          />
        )}
      </Section>

      <Section title="Recent Journey Events" count={recentJourney.length}>
        {recentJourney.length === 0 ? (
          <div className="text-xs text-slate-400">No data yet.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recentJourney.map((e, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700">{readField(e, "eventType") ?? "—"}</span>
                  <span className="text-slate-500">{formatDate(readField(e, "createdAt")) ?? ""}</span>
                </div>
                {readField(e, "summary") && (
                  <div className="mt-0.5 text-slate-500">{readField(e, "summary")}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
