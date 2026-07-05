// Patient EHR facts card — surfaces the canonical Patient
// Directory snapshot inside the center canvas (PatientCommandCanvas).
//
// Background: the audit (PR A) flagged that PatientCommandCanvas
// renders patient-level operational facts (latest call, next
// appointment, document readiness, billing readiness) but does NOT
// surface the canonical Patient EHR facts:
//   - DNC / contact-restrictions
//   - cooldown window (active + reason)
//   - prior ancillaries that touched this patient
//   - engagement history (current assignment + last update)
//
// These facts were previously only reachable from the dedicated
// /patient-directory page (PatientProfileDrawer). The brief required
// they be visible inline in the center canvas so a PCS/ACS operator
// clicking a row sees the patient's restrictions before calling.
//
// This component is a READ-ONLY surface. The single canonical write
// path for DNC / cooldown / prior-tests remains the Patient EHR
// page; this card only mirrors the snapshot. We deliberately do not
// add new routes — the underlying `/api/patient-directory/:id` route
// already serves the same shape consumed by the Patient EHR
// page.

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { AlertOctagon, ClockAlert, History, FlaskConical, Loader2 } from "lucide-react";
import {
  getPatientDirectorySnapshot,
  type DirectorySnapshot,
} from "@/lib/patientDirectoryApi";

type Props = {
  patientScreeningId: number;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PatientDirectoryFactsCard({ patientScreeningId }: Props) {
  const { data, isLoading, isError } = useQuery<DirectorySnapshot | null>({
    queryKey: ["patient-directory-snapshot", patientScreeningId],
    queryFn: () => getPatientDirectorySnapshot(patientScreeningId),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card
        className="p-4 bg-white"
        data-testid="patient-directory-facts-card-loading"
      >
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading Patient EHR facts…
        </div>
      </Card>
    );
  }

  if (isError || !data) {
    // The snapshot route can return null for a not-yet-imported patient;
    // we keep the card silent in that case rather than render an error.
    return null;
  }

  const { flags, cooldown, priorTests, engagement } = data;
  const hasDnc = flags.doNotContact;
  const hasCooldown = cooldown?.active === true;
  const priorAncillaries = priorTests.slice(0, 4);
  const hasEngagement = !!(engagement.currentAssignedTo || engagement.lastEngagementUpdate);
  const hasAnyFact = hasDnc || hasCooldown || priorAncillaries.length > 0 || hasEngagement;

  if (!hasAnyFact) return null;

  return (
    <Card
      className="p-4 bg-white"
      data-testid="patient-directory-facts-card"
    >
      <div className="mb-2 text-sm font-semibold text-slate-900">
        Patient EHR facts
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {hasDnc ? (
          <div
            className="flex items-start gap-2 rounded border border-rose-200 bg-rose-50 p-2"
            data-testid="patient-directory-facts-dnc"
          >
            <AlertOctagon className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-900">
                Do Not Contact
              </div>
              <div className="text-[12px] text-rose-900 truncate">
                {flags.doNotContactReason || "Marked DNC — do not call or message."}
              </div>
            </div>
          </div>
        ) : null}

        {hasCooldown && cooldown ? (
          <div
            className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2"
            data-testid="patient-directory-facts-cooldown"
          >
            <ClockAlert className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                Cooldown active
              </div>
              <div className="text-[12px] text-amber-900 truncate">
                {cooldown.intervalLabel} · ends {formatDate(cooldown.endsAt)}
              </div>
              {cooldown.reason ? (
                <div className="text-[11px] text-amber-800 truncate">
                  {cooldown.reason}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {priorAncillaries.length > 0 ? (
          <div
            className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-2"
            data-testid="patient-directory-facts-prior-tests"
          >
            <FlaskConical className="h-4 w-4 text-slate-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                Prior ancillaries ({priorTests.length})
              </div>
              <ul className="text-[12px] text-slate-800 space-y-0.5">
                {priorAncillaries.map((t, idx) => (
                  <li key={`${t.testName}-${idx}`} className="truncate">
                    {t.testName}
                    {t.dateOfService ? ` · ${formatDate(t.dateOfService)}` : ""}
                    {t.facility ? ` · ${t.facility}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {hasEngagement ? (
          <div
            className="flex items-start gap-2 rounded border border-sky-200 bg-sky-50 p-2"
            data-testid="patient-directory-facts-engagement"
          >
            <History className="h-4 w-4 text-sky-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-900">
                Engagement
              </div>
              <div className="text-[12px] text-sky-900 truncate">
                {engagement.currentAssignedTo
                  ? `Assigned to ${engagement.currentAssignedTo}`
                  : "No current assignment"}
              </div>
              <div className="text-[11px] text-sky-800 truncate">
                Last update {formatDate(engagement.lastEngagementUpdate)}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
