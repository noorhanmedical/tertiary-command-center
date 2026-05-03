import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Flame, FlameKindling, Settings as SettingsIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { VALID_FACILITIES } from "@shared/plexus";

type StoveKey = "low" | "mediumLow" | "medium" | "mediumHigh" | "high";

const REGIONS = ["Southwest", "West", "Midwest", "South", "Northeast"] as const;

const STOVE_OPTIONS: Array<{
  key: StoveKey;
  label: string;
  description: string;
  flames: number;
}> = [
  { key: "low", label: "Low / Simmer", description: "Keeping food warm, gentle simmer", flames: 1 },
  { key: "mediumLow", label: "Medium-Low", description: "Slow cooking, sauces", flames: 2 },
  { key: "medium", label: "Medium", description: "General cooking", flames: 3 },
  { key: "mediumHigh", label: "Medium-High", description: "Sauteing, pan frying", flames: 4 },
  { key: "high", label: "High", description: "Boiling water, searing", flames: 5 },
];

function heatHeaderTheme(knob: StoveKey) {
  switch (knob) {
    case "low":
      return "bg-yellow-50 border-yellow-200";
    case "mediumLow":
      return "bg-amber-50 border-amber-200";
    case "medium":
      return "bg-orange-50 border-orange-200";
    case "mediumHigh":
      return "bg-orange-100 border-orange-300";
    case "high":
      return "bg-red-100 border-red-300";
    default:
      return "bg-slate-50 border-slate-200";
  }
}

function Field({
  label,
  defaultValue,
  type = "text",
}: {
  label: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        defaultValue={defaultValue}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
      />
    </div>
  );
}

export default function StovetopHeatSettingsPage() {
  const [stoveRegion, setStoveRegion] = useState<string>("Southwest");
  const [stoveFacility, setStoveFacility] = useState<string>("NWPG - Spring");
  const [stoveKnob, setStoveKnob] = useState<StoveKey>("medium");

  const active = STOVE_OPTIONS.find((option) => option.key === stoveKnob) ?? STOVE_OPTIONS[2];
  const heatHeaderClass = heatHeaderTheme(stoveKnob);

  return (
    <div className="min-h-full flex-1 overflow-auto plexus-page-radial">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-6 py-6">
        <PageHeader
          backHref="/admin"
          eyebrow="PLEXUS ANCILLARY · ADMIN"
          icon={SettingsIcon}
          title="Stovetop Heat Settings"
          subtitle="Facility-level preset controls for payout, qualification permissiveness, KPI thresholds, and Plex Factor."
        />

        <Card className="rounded-3xl border border-white/60 bg-white/75 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Top-Level Stove Controls</h2>
              <p className="mt-1 text-sm text-slate-500">
                Choose region, choose facility, then turn the knob to drive the preset behavior for that facility.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              Interior Page
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Choose Region</label>
              <select
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={stoveRegion}
                onChange={(e) => setStoveRegion(e.target.value)}
              >
                {REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Choose Facility</label>
              <select
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={stoveFacility}
                onChange={(e) => setStoveFacility(e.target.value)}
              >
                {VALID_FACILITIES.map((facility) => (
                  <option key={facility} value={facility}>
                    {facility}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-medium text-slate-900">Active Preset</div>
              <div className="mt-1 text-xs text-slate-500">{stoveRegion} · {stoveFacility}</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">{active.label}</div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-sm font-medium text-slate-700">Stove Knob</div>
            <div className="grid gap-3 md:grid-cols-5">
              {STOVE_OPTIONS.map((option) => {
                const selected = stoveKnob === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setStoveKnob(option.key)}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      selected
                        ? "border-orange-400 bg-orange-50 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                    data-testid={`stove-knob-${option.key}`}
                  >
                    <div className="flex items-center gap-1 text-orange-600">
                      {Array.from({ length: option.flames }).map((_, i) =>
                        i % 2 === 0 ? (
                          <Flame key={i} className="h-4 w-4" />
                        ) : (
                          <FlameKindling key={i} className="h-4 w-4" />
                        ),
                      )}
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-900">{option.label}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4" data-testid="stove-knob-description">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Typical Use</div>
              <div className="mt-1 text-sm font-medium text-slate-900">{active.description}</div>
              <div className="mt-2 text-xs text-slate-500">
                This top-level knob is the master preset for the selected facility and will later drive percentages, RVU multipliers, Plex Factor, and permissive qualification settings together.
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className={`-mt-5 -mx-5 mb-4 rounded-t-3xl border-b px-5 py-3 ${heatHeaderClass}`} />
            <h3 className="text-base font-semibold text-slate-900">1. RVU and Multiplier Settings</h3>
            <p className="mt-1 text-sm text-slate-500">Editable base RVU values and payout multipliers.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="BrainWave RVU" defaultValue="9" />
              <Field label="VitalWave RVU" defaultValue="6" />
              <Field label="Onsite $ per RVU" defaultValue="1.00" />
              <Field label="Remote $ per RVU" defaultValue="0.10" />
              <Field label="If Insurance Does Not Pay — Onsite" defaultValue="0.20" />
              <Field label="If Insurance Does Not Pay — Remote" defaultValue="0.00" />
            </div>
          </Card>

          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className={`-mt-5 -mx-5 mb-4 rounded-t-3xl border-b px-5 py-3 ${heatHeaderClass}`} />
            <h3 className="text-base font-semibold text-slate-900">2. KPI Threshold Settings</h3>
            <p className="mt-1 text-sm text-slate-500">Thresholds for BrainWave and VitalWave KPI targets.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="BrainWave KPI Threshold" defaultValue="3" />
              <Field label="VitalWave KPI Threshold" defaultValue="3" />
            </div>
          </Card>

          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className={`-mt-5 -mx-5 mb-4 rounded-t-3xl border-b px-5 py-3 ${heatHeaderClass}`} />
            <h3 className="text-base font-semibold text-slate-900">3. Permissive Prescreening and Qualification Settings</h3>
            <p className="mt-1 text-sm text-slate-500">Controls how permissive the platform is during prescreening and qualification.</p>
            <div className="mt-4 space-y-3">
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <input type="checkbox" className="mt-1" defaultChecked />
                <span>
                  <span className="block text-sm font-medium text-slate-900">Allow permissive prescreening</span>
                  <span className="block mt-1 text-xs text-slate-500">Loosen prescreening behavior before final admin or qualification logic.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <input type="checkbox" className="mt-1" defaultChecked />
                <span>
                  <span className="block text-sm font-medium text-slate-900">Allow permissive qualifying</span>
                  <span className="block mt-1 text-xs text-slate-500">Permit broader qualifying behavior when admin settings allow it.</span>
                </span>
              </label>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fallback Rule</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="admin_review">
                    <option value="admin_review">Admin review</option>
                    <option value="strict_only">Strict only</option>
                    <option value="manual_hold">Manual hold</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Insurance Permissive Rule</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="no_tests_until_review">
                    <option value="no_tests_until_review">No tests until review</option>
                    <option value="manual_release">Manual release</option>
                    <option value="auto_hold">Auto hold</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Review Mode</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="approve_deny">
                    <option value="approve_deny">Approve / Deny</option>
                    <option value="approve_only">Approve only</option>
                    <option value="manual_release">Manual release</option>
                  </select>
                </div>
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className={`-mt-5 -mx-5 mb-4 rounded-t-3xl border-b px-5 py-3 ${heatHeaderClass}`} />
            <h3 className="text-base font-semibold text-slate-900">4. Quarterly Team Member Payout Settings</h3>
            <p className="mt-1 text-sm text-slate-500">Defines cadence and payout basis for team-member compensation.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payout Cadence</label>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="quarterly">
                  <option value="quarterly">Quarterly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payout Basis</label>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="rvu_multiplier">
                  <option value="rvu_multiplier">RVU × Multiplier</option>
                  <option value="flat_bonus">Flat bonus</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl xl:col-span-2">
            <div className={`-mt-5 -mx-5 mb-4 rounded-t-3xl border-b px-5 py-3 ${heatHeaderClass}`} />
            <h3 className="text-base font-semibold text-slate-900">5. Plex Factor Settings</h3>
            <p className="mt-1 text-sm text-slate-500">
              If selected ancillaries are completed within the chosen time window, their payout multiplier increases by the Plex Factor.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Field label="Required Ancillary Count" defaultValue="2" />
              <Field label="Plex Factor Multiplier" defaultValue="2" />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Time Window</label>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="same_day">
                  <option value="same_day">Same day</option>
                  <option value="7_days">Within 7 days</option>
                  <option value="30_days">Within 30 days</option>
                  <option value="90_days">Within 90 days</option>
                  <option value="custom_months">Custom months</option>
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-900 mb-2">Ancillary A</div>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="brainwave">
                  <option value="brainwave">BrainWave</option>
                  <option value="vitalwave">VitalWave</option>
                  <option value="urinalysis">Urinalysis</option>
                </select>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-900 mb-2">Ancillary B</div>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="urinalysis">
                  <option value="brainwave">BrainWave</option>
                  <option value="vitalwave">VitalWave</option>
                  <option value="urinalysis">Urinalysis</option>
                </select>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              Example: BrainWave 9 RVU and Urinalysis 0.5 RVU with Plex Factor 2 become 18 and 1 if both are completed within the selected time window.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
