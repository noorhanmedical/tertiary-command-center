// Phase 2D-C2 — shared canonical appointment presentation.
//
// Presentation-only. Renders one ancillary case's canonical appointment
// projection (already fetched by the parent). No API calls, no writes,
// no appointment mutation. Uses existing UI primitives + design tokens.
//
// The view-model derivation is a pure exported function so it can be
// unit-tested without a DOM.

import { Badge } from "@/components/ui/badge";
import type { AncillaryAppointmentProjection } from "@shared/types/canonicalAppointment";
import { deriveAppointmentSummary } from "@/components/canonical/appointmentSummaryModel";

export type {
  CanonicalAppointmentSummaryViewModel,
} from "@/components/canonical/appointmentSummaryModel";
export { deriveAppointmentSummary } from "@/components/canonical/appointmentSummaryModel";

export type CanonicalAppointmentSummaryProps = {
  projection: AncillaryAppointmentProjection;
  serviceType?: string | null;
  /** Show the cancelled/no_show/rescheduled history indicator. */
  showHistory?: boolean;
  /** Show the appointment-only Order Note readiness (from the server
   *  projection field — never recalculated in the client). */
  showReadiness?: boolean;
  "data-testid"?: string;
};

export function CanonicalAppointmentSummary(props: CanonicalAppointmentSummaryProps) {
  const vm = deriveAppointmentSummary(props.projection, props.serviceType);
  return (
    <div
      className="flex flex-col gap-1 text-sm"
      data-testid={props["data-testid"] ?? "canonical-appointment-summary"}
      data-global-schedule-event-id={vm.globalScheduleEventId ?? undefined}
    >
      <div className="flex items-center gap-2">
        {vm.serviceType ? <span className="font-medium">{vm.serviceType}</span> : null}
        {vm.notScheduled ? (
          <span className="text-muted-foreground" data-testid="canonical-appointment-not-scheduled">
            Not scheduled
          </span>
        ) : (
          <Badge variant={vm.statusVariant} data-testid="canonical-appointment-status">
            {vm.statusLabel}
          </Badge>
        )}
      </div>
      {vm.whenLabel ? (
        <div className="text-muted-foreground" data-testid="canonical-appointment-when">
          {vm.whenLabel}
          {vm.location ? ` · ${vm.location}` : vm.facilityId ? ` · ${vm.facilityId}` : ""}
        </div>
      ) : null}
      {props.showHistory && vm.historyCount > 0 ? (
        <div className="text-xs text-muted-foreground" data-testid="canonical-appointment-history">
          {vm.historyCount} prior event{vm.historyCount === 1 ? "" : "s"}
        </div>
      ) : null}
      {props.showReadiness ? (
        <div
          className="text-xs text-muted-foreground"
          data-testid="canonical-appointment-order-note-ready"
          data-order-note-ready={vm.eligibleForOrderNote ? "true" : "false"}
        >
          {vm.eligibleForOrderNote ? "Order Note: appointment ready" : "Order Note: appointment not ready"}
        </div>
      ) : null}
    </div>
  );
}
