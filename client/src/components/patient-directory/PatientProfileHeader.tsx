import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Phone, CalendarPlus, Sparkles, Building2, ShieldCheck, BadgeCheck,
  Clock, CheckCircle2, ChevronLeft,
} from "lucide-react";
import {
  type DirectoryProfile, initials, uniqueQualifyingTests, testBucket,
} from "./profileTypes";

export type ProfileBadgeFlags = {
  callDue?: boolean;
  needsFollowUp?: boolean;
  billingReady?: boolean;
};

const BUCKET_STYLES: Record<string, string> = {
  brainwave: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  vitalwave: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  ultrasound: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

const BUCKET_LABEL: Record<string, string> = {
  brainwave: "BrainWave eligible",
  vitalwave: "VitalWave eligible",
  ultrasound: "Ultrasound eligible",
};

function Pill({ tone, children, testId }: { tone: string; children: React.ReactNode; testId?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${tone}`}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

export function PatientProfileHeader({
  profile,
  flags,
  onBack,
}: {
  profile: DirectoryProfile;
  flags?: ProfileBadgeFlags;
  onBack?: () => void;
}) {
  const id = profile.identity;
  const qualifying = uniqueQualifyingTests(profile.screenings);
  const buckets = new Set(qualifying.map(testBucket));

  const scheduled = profile.screenings.some(
    (s) => (s.appointmentStatus || "").toLowerCase() === "scheduled",
  );
  const activeCooldowns = profile.cooldowns.filter((c) => !c.cleared).length;
  const nextClear = profile.cooldowns
    .filter((c) => !c.cleared)
    .sort((a, b) => a.daysUntilClear - b.daysUntilClear)[0];

  const phoneHref = id.phoneNumber ? `tel:${id.phoneNumber.replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="border-b bg-white/70 dark:bg-card/70 backdrop-blur px-5 py-4" data-testid="profile-header">
      <div className="flex items-start gap-3">
        {onBack && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 lg:hidden"
            onClick={onBack}
            data-testid="button-profile-back"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        )}
        <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm font-semibold shrink-0">
          {initials(id.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-lg font-bold leading-tight truncate" data-testid="text-profile-name">{id.name}</h1>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Building2 className="w-3 h-3" />{id.clinic}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5" data-testid="text-profile-demographics">
            <span>{id.dob ? `DOB ${id.dob}` : "DOB unknown"}</span>
            <span>{[id.age ? `${id.age}yo` : null, id.gender].filter(Boolean).join(" · ") || "Age/Gender —"}</span>
            <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" />{id.insurance || "Insurance —"}</span>
            {id.phoneNumber && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{id.phoneNumber}</span>}
          </div>

          {/* Status / eligibility badges */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="row-profile-badges">
            {Array.from(buckets).map((b) => (
              <Pill key={b} tone={BUCKET_STYLES[b]} testId={`badge-eligible-${b}`}>
                <Sparkles className="w-3 h-3" />{BUCKET_LABEL[b]}
              </Pill>
            ))}
            {scheduled && (
              <Pill tone="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" testId="badge-scheduled">
                <CalendarPlus className="w-3 h-3" />Scheduled
              </Pill>
            )}
            {flags?.callDue && (
              <Pill tone="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" testId="badge-call-due">
                <Phone className="w-3 h-3" />Call due
              </Pill>
            )}
            {flags?.needsFollowUp && (
              <Pill tone="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" testId="badge-needs-follow-up">
                <Clock className="w-3 h-3" />Needs follow-up
              </Pill>
            )}
            {flags?.billingReady && (
              <Pill tone="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" testId="badge-billing-ready">
                <BadgeCheck className="w-3 h-3" />Billing ready
              </Pill>
            )}
            {activeCooldowns === 0 ? (
              <Pill tone="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" testId="badge-cooldown-clear">
                <CheckCircle2 className="w-3 h-3" />No active cooldowns
              </Pill>
            ) : (
              <Pill tone="bg-slate-100 text-slate-700 dark:bg-muted dark:text-foreground" testId="badge-cooldown-active">
                <Clock className="w-3 h-3" />
                {activeCooldowns} on cooldown{nextClear ? ` · next clears in ${Math.max(0, nextClear.daysUntilClear)}d` : ""}
              </Pill>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2 shrink-0">
          {phoneHref ? (
            <a href={phoneHref} data-testid="button-quick-call">
              <Button size="sm" variant="outline" className="gap-1.5">
                <Phone className="w-3.5 h-3.5" />Call
              </Button>
            </a>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" disabled data-testid="button-quick-call">
              <Phone className="w-3.5 h-3.5" />Call
            </Button>
          )}
          <Link href="/appointments" data-testid="button-quick-schedule">
            <Button size="sm" variant="outline" className="gap-1.5">
              <CalendarPlus className="w-3.5 h-3.5" />Schedule
            </Button>
          </Link>
          <Link href="/plexus-iq" data-testid="button-quick-playground">
            <Button size="sm" className="gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />Push to Plexus IQ
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
