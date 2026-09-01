// Shared professional vector icon + accent per ancillary service (no emoji).
// Used by both the Ancillary Journey rows and the Current Qualifying Tests
// circular icons so the visual identity of a service is consistent.

import { Brain, HeartPulse, Activity, Droplets, Footprints, Waves, Stethoscope } from "lucide-react";

export type ServiceVisual = { Icon: typeof Brain; color: string; bg: string };

const SERVICE_VISUALS: Array<{ match: RegExp; Icon: typeof Brain; color: string; bg: string }> = [
  { match: /brainwave|brain|neuro|tcd/i, Icon: Brain, color: "#7758D9", bg: "#F3EEFF" },
  { match: /vitalwave|autonomic|abi/i, Icon: Activity, color: "#138B8B", bg: "#E8F7F7" },
  { match: /carotid/i, Icon: Waves, color: "#2E8BC0", bg: "#EAF5FB" },
  { match: /echo|cardiac|tte|stress/i, Icon: HeartPulse, color: "#D9455F", bg: "#FFF0F3" },
  { match: /renal|abdominal|aorta|aneurysm/i, Icon: Droplets, color: "#D8892D", bg: "#FFF6EA" },
  { match: /lower extremity|leg|ankle|foot|\ble\b/i, Icon: Footprints, color: "#526CCF", bg: "#EEF2FF" },
];
const DEFAULT_VISUAL: ServiceVisual = { Icon: Stethoscope, color: "#667085", bg: "#F4F6F8" };

export function serviceVisual(name: string): ServiceVisual {
  return SERVICE_VISUALS.find((v) => v.match.test(name)) ?? DEFAULT_VISUAL;
}
