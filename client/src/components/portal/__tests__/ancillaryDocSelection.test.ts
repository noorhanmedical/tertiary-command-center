import { describe, it, expect } from "vitest";
import {
  resolveOpenInstanceId,
  resolveActiveAncillary,
  type AncillaryServiceContext,
} from "@/components/portal/AncillaryDocModals";

function svc(
  instanceId: string,
  serviceType: string,
  executionCaseId: number | null,
): AncillaryServiceContext {
  return {
    instanceId,
    serviceType,
    executionCaseId,
    patientScreeningId: 100,
    readiness: null,
  };
}

describe("ancillary doc-modal instance selection", () => {
  // Two BrainWave visits (repeat/return) for the same patient — they must NOT
  // collapse and each must route to its own execution case.
  const brainWaveA = svc("appt-1", "BrainWave", 11);
  const brainWaveB = svc("appt-2", "BrainWave", 22);
  const ultrasound = svc("appt-3", "Bilateral Carotid Duplex (93880)", 33);
  const services = [brainWaveA, brainWaveB, ultrasound];

  it("opens on the caller's instance", () => {
    expect(resolveOpenInstanceId("appt-2", services)).toBe("appt-2");
  });

  it("falls back to the first ancillary when no opener instance is given", () => {
    expect(resolveOpenInstanceId(null, services)).toBe("appt-1");
    expect(resolveOpenInstanceId(undefined, [])).toBe("");
  });

  it("resolves the active ancillary by the current selection", () => {
    expect(resolveActiveAncillary(services, "appt-2", "appt-1")).toBe(brainWaveB);
  });

  it("keeps two same-type visits distinct (no serviceType collapse)", () => {
    const a = resolveActiveAncillary(services, "appt-1", "appt-1");
    const b = resolveActiveAncillary(services, "appt-2", "appt-1");
    expect(a?.executionCaseId).toBe(11);
    expect(b?.executionCaseId).toBe(22);
    expect(a).not.toBe(b);
  });

  it("falls back to the opener instance, then the first, for a stale selection", () => {
    expect(resolveActiveAncillary(services, "gone", "appt-3")).toBe(ultrasound);
    expect(resolveActiveAncillary(services, "gone", "also-gone")).toBe(brainWaveA);
    expect(resolveActiveAncillary([], "x", "y")).toBeNull();
  });

  it("re-syncs selection to the opener when a card reopens a different instance", () => {
    // Simulates the reused modal: open on A, then reopen on B.
    let selected = resolveOpenInstanceId("appt-1", services);
    expect(resolveActiveAncillary(services, selected, "appt-1")).toBe(brainWaveA);
    selected = resolveOpenInstanceId("appt-2", services);
    expect(resolveActiveAncillary(services, selected, "appt-2")).toBe(brainWaveB);
  });
});
