import { BarChart3, CalendarDays, FileText, Plus, Sparkles, UsersRound, Workflow } from "lucide-react";
import LegacyPlexusIQPage from "@/pages/plexus-iq";

function clickLegacy(testId: string) {
  const target = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  target?.click();
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-light uppercase tracking-[0.18em] text-slate-300">{label}</div>
      <div className="mt-2 text-3xl font-light tabular-nums tracking-[-0.04em] text-white">{value}</div>
    </div>
  );
}

function CommandCard({ icon: Icon, title, text }: { icon: typeof Sparkles; title: string; text: string }) {
  return (
    <div className="border border-slate-200 bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,.045)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center border border-slate-200 bg-slate-50 text-slate-700">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium tracking-[-0.02em] text-slate-950">{title}</div>
          <div className="mt-1 text-xs font-light leading-5 text-slate-500">{text}</div>
        </div>
      </div>
    </div>
  );
}

export default function PlexusIQPremiumPage() {
  return (
    <div className="flex h-full min-w-0 flex-col bg-[#EEF1F6] text-[#101115]">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#101115] text-white">
        <div className="flex h-20 w-full items-center justify-between gap-4 px-6 lg:px-10">
          <div className="flex items-center gap-4">
            <div className="flex h-8 w-8 items-center justify-center border border-slate-700 bg-slate-900 text-slate-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-medium tracking-[-0.02em] text-white">Plexus IQ</h1>
              <div className="mt-1 text-[10px] font-light uppercase tracking-[0.22em] text-slate-400">
                Multi-day, multi-facility workspace
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={() => clickLegacy("button-plexus-iq-add-patient")}
              className="border border-white bg-white px-4 py-2 text-[11px] font-light uppercase tracking-[0.12em] text-[#101115]"
            >
              Add Patient(s)
            </button>
            <button
              type="button"
              onClick={() => clickLegacy("button-plexus-iq-calendar")}
              className="border border-slate-700 bg-slate-900 px-4 py-2 text-[11px] font-light uppercase tracking-[0.12em] text-slate-300"
            >
              Calendar
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto bg-[#EEF1F6]">
        <div className="w-full px-6 py-8 lg:px-10">
          <section className="relative mb-5 overflow-hidden border border-slate-800 bg-[linear-gradient(135deg,#0D0E12_0%,#171B26_52%,#2A3D5A_100%)] px-8 py-10 text-white shadow-[0_34px_90px_rgba(4,8,16,0.20)]">
            <div
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
                backgroundSize: "56px 56px",
              }}
              aria-hidden="true"
            />
            <div className="relative z-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div>
                <div className="text-[11px] font-light uppercase tracking-[0.22em] text-slate-300">Plexus Clinical</div>
                <div className="mt-4 text-[52px] font-light leading-[0.95] tracking-[-0.055em] sm:text-[62px]">
                  Plexus IQ
                </div>
                <p className="mt-5 max-w-3xl text-[15px] font-light leading-6 text-slate-300">
                  Facility-first qualification workspace for Batch Flow, Visit patients, Outreach patients, calendar review, and final day packet review.
                </p>
                <div className="mt-8 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => clickLegacy("button-plexus-iq-add-patient")}
                    className="border border-white bg-white px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-[#101115]"
                  >
                    Add Patient(s)
                  </button>
                  <button
                    type="button"
                    onClick={() => clickLegacy("button-plexus-iq-add-patient")}
                    className="border border-white/20 bg-white/10 px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-white"
                  >
                    Batch Flow
                  </button>
                  <button
                    type="button"
                    onClick={() => clickLegacy("button-plexus-iq-calendar")}
                    className="border border-white/20 bg-white/10 px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-white"
                  >
                    Calendar
                  </button>
                </div>
              </div>
              <div className="border border-white/15 bg-white/10 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="text-lg font-medium tracking-[-0.02em] text-white">IQ status</div>
                  <div className="text-[11px] font-light uppercase tracking-[0.12em] text-slate-200">Live</div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-white/15 pt-5">
                  <HeroMetric label="Patients" value="Live" />
                  <HeroMetric label="Facilities" value="Active" />
                  <HeroMetric label="Batches" value="Real" />
                  <HeroMetric label="Review" value="Open" />
                </div>
              </div>
            </div>
          </section>

          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <CommandCard icon={Workflow} title="Batch Flow" text="Import clinic rows into the existing screening batch spine." />
            <CommandCard icon={UsersRound} title="Visit + Outreach" text="Add patients through the existing Visit and Outreach modals." />
            <CommandCard icon={FileText} title="Packet Review" text="Keep final day review, PDFs, and scheduler handoff in the canonical flow." />
          </div>

          <section className="legacy-plexus-iq-shell min-w-0">
            <LegacyPlexusIQPage />
          </section>
        </div>
      </main>

      <style>{`
        .legacy-plexus-iq-shell > div > header {
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          overflow: hidden !important;
          clip: rect(0 0 0 0) !important;
          white-space: nowrap !important;
        }
        .legacy-plexus-iq-shell > div {
          height: auto !important;
          min-height: 0 !important;
        }
        .legacy-plexus-iq-shell main {
          overflow: visible !important;
          background: transparent !important;
        }
        .legacy-plexus-iq-shell [data-testid="plexus-iq-facility-overview"],
        .legacy-plexus-iq-shell [data-testid="plexus-iq-clinic-detail-header"] {
          max-width: none !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        .legacy-plexus-iq-shell [data-testid="plexus-iq-facility-overview"] > div:first-child,
        .legacy-plexus-iq-shell [data-testid="plexus-iq-clinic-detail-header"] {
          border: 1px solid #DCE2EA;
          background: #FFFFFF;
          padding: 16px !important;
          box-shadow: 0 18px 48px rgba(15, 23, 42, .055);
          border-radius: 0 !important;
        }
        .legacy-plexus-iq-shell [data-testid^="plexus-iq-facility-tile-"] {
          border-radius: 0 !important;
          border-color: #DCE2EA !important;
          background: #FFFFFF !important;
          box-shadow: 0 22px 60px rgba(15, 23, 42, .055) !important;
        }
        .legacy-plexus-iq-shell [data-testid^="plexus-iq-worklist-group-"] {
          border-radius: 0 !important;
          border: 1px solid #DCE2EA !important;
          box-shadow: none !important;
        }
      `}</style>
    </div>
  );
}
