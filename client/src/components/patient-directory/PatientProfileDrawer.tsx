// Patient Profile drawer (Batch B11).
//
// Read-only drawer rendered from the new Patient EHR scaffold
// page. Accepts a snapshot-shaped object from the future
// /api/patient-directory/:id endpoint; until that endpoint lands, the
// drawer renders gracefully on null fields.

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PatientDirectoryEvent } from "@/lib/patientDirectoryAuditTypes";
import type { DuplicateWarningResult } from "@/lib/patientDuplicateWarnings";
import { DuplicateWarningSummary } from "@/components/patient-directory/DuplicateWarningBadge";

export type PatientProfileSnapshot = {
  patientScreeningId: number;
  identity: {
    name: string;
    facility: string | null;
    mrn?: string | null;
    dob: string | null;
    phoneNumber: string | null;
    email: string | null;
    insurance: string | null;
    gender?: string | null;
  };
  patientType: "visit" | "outreach" | string;
  notes?: string | null;
  source: {
    batchId: number;
    batchName: string | null;
    batchCreatedAt: string;
    sourceFileName: string | null;
  };
  createdAt: string;
  flags: {
    doNotContact: boolean;
    doNotContactReason: string | null;
    everSentToEngagement: boolean;
    activeCooldown: boolean;
    priorTestsCount: number;
    duplicateMatchCount: number;
  };
  priorTests?: ReadonlyArray<{ testName: string; dateOfService: string | null; facility: string | null; source: string | null; notes: string | null }>;
  engagement?: { currentAssignmentStatus: string | null; currentAssignedTo: string | null; lastEngagementUpdate: string | null };
  callHistory?: ReadonlyArray<{ id: number; startedAt: string; outcome: string; notes: string | null; callbackAt: string | null; attemptNumber: number | null; durationSeconds: number | null }>;
  adminReviewHistory?: ReadonlyArray<{ status: string; at: string; byUserId: string | null; note: string | null }>;
  imports?: ReadonlyArray<{ batchId: number; batchName: string; batchCreatedAt: string; sourceFileName: string | null }>;
  events?: ReadonlyArray<PatientDirectoryEvent>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: PatientProfileSnapshot | null;
  warningResult?: DuplicateWarningResult | null;
};

export function PatientProfileDrawer({ open, onOpenChange, snapshot, warningResult }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid="patient-profile-drawer"
      >
        <SheetHeader>
          <SheetTitle>
            {snapshot?.identity?.name ?? "Patient profile"}
            {snapshot ? (
              <span className="ml-2 text-[12px] font-normal text-slate-500">
                #{snapshot.patientScreeningId}
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>

        {!snapshot ? (
          <div className="py-8 text-center text-[12px] text-slate-500" data-testid="patient-profile-empty">
            Select a patient to view their profile.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <ProfileHeaderBadges snapshot={snapshot} warningResult={warningResult} />
            <Tabs defaultValue="demographics" className="w-full">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="demographics" data-testid="patient-profile-tab-demographics">Demographics</TabsTrigger>
                <TabsTrigger value="prior-tests" data-testid="patient-profile-tab-prior-tests">Prior tests</TabsTrigger>
                <TabsTrigger value="contact-restrictions" data-testid="patient-profile-tab-contact-restrictions">Contact restrictions</TabsTrigger>
                <TabsTrigger value="cooldown" data-testid="patient-profile-tab-cooldown">Cooldown</TabsTrigger>
                <TabsTrigger value="engagement-history" data-testid="patient-profile-tab-engagement-history">Engagement history</TabsTrigger>
                <TabsTrigger value="call-history" data-testid="patient-profile-tab-call-history">Call history</TabsTrigger>
                <TabsTrigger value="admin-review-history" data-testid="patient-profile-tab-admin-review-history">Admin Review history</TabsTrigger>
                <TabsTrigger value="imports" data-testid="patient-profile-tab-imports">Import/source history</TabsTrigger>
                <TabsTrigger value="audit-trail" data-testid="patient-profile-tab-audit-trail">Full audit trail</TabsTrigger>
              </TabsList>

              <TabsContent value="demographics">
                <DemographicsBlock snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="prior-tests">
                <PriorTestsBlock snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="contact-restrictions">
                <ContactRestrictionsBlock snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="cooldown">
                <CooldownBlock snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="engagement-history">
                <EngagementHistoryBlock snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="call-history">
                <CallHistoryBlock snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="admin-review-history">
                <AdminReviewHistoryBlock snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="imports">
                <ImportsBlock snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="audit-trail">
                <FullAuditTrailBlock snapshot={snapshot} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProfileHeaderBadges({
  snapshot,
  warningResult,
}: {
  snapshot: PatientProfileSnapshot;
  warningResult?: DuplicateWarningResult | null;
}) {
  const chips: Array<{ label: string; tone: "block" | "warn" | "info" }> = [];
  if (snapshot.flags.doNotContact) chips.push({ label: "Do Not Contact", tone: "block" });
  if (snapshot.flags.activeCooldown) chips.push({ label: "Active cooldown", tone: "block" });
  if (snapshot.flags.everSentToEngagement) chips.push({ label: "Previously sent to Engagement", tone: "warn" });
  if (snapshot.flags.priorTestsCount > 0) chips.push({ label: `${snapshot.flags.priorTestsCount} prior ancillary test(s)`, tone: "warn" });
  if (snapshot.flags.duplicateMatchCount > 0) chips.push({ label: `${snapshot.flags.duplicateMatchCount} duplicate match(es)`, tone: "warn" });
  if (chips.length === 0 && (!warningResult || warningResult.warnings.length === 0)) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="patient-profile-header-badges">
      {chips.map((c) => (
        <Badge
          key={c.label}
          variant="secondary"
          className={[
            "border text-[11px] font-semibold",
            c.tone === "block"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : c.tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-slate-200 bg-slate-100 text-slate-700",
          ].join(" ")}
        >
          {c.label}
        </Badge>
      ))}
      <DuplicateWarningSummary result={warningResult ?? null} />
    </div>
  );
}

function row(label: string, value: string | number | null | undefined) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1 text-[12px]">
      <div className="text-slate-500">{label}</div>
      <div className="col-span-2 text-slate-800">{value == null || value === "" ? "—" : String(value)}</div>
    </div>
  );
}

function DemographicsBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  return (
    <Card className="p-3" data-testid="patient-profile-demographics">
      {row("Name", snapshot.identity.name)}
      {row("DOB", snapshot.identity.dob)}
      {row("MRN", snapshot.identity.mrn ?? null)}
      {row("Facility", snapshot.identity.facility)}
      {row("Phone", snapshot.identity.phoneNumber)}
      {row("Email", snapshot.identity.email)}
      {row("Insurance", snapshot.identity.insurance)}
      {row("Gender", snapshot.identity.gender ?? null)}
      {row("Patient type", snapshot.patientType)}
      {row("Created", snapshot.createdAt)}
      {row("Source batch", snapshot.source.batchName ?? `Batch ${snapshot.source.batchId}`)}
      {row("Source file", snapshot.source.sourceFileName)}
    </Card>
  );
}

function PriorTestsBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  const list = snapshot.priorTests ?? [];
  if (list.length === 0) {
    return <div className="py-6 text-center text-[12px] text-slate-500" data-testid="patient-profile-prior-tests-empty">No prior ancillary tests on file.</div>;
  }
  return (
    <ul className="space-y-2" data-testid="patient-profile-prior-tests-list">
      {list.map((t, i) => (
        <li key={i} className="rounded-xl border border-slate-200 bg-white p-2.5 text-[12px]">
          <div className="font-medium">{t.testName}</div>
          <div className="text-slate-500">{[t.dateOfService, t.facility, t.source].filter(Boolean).join(" · ") || "—"}</div>
          {t.notes ? <div className="mt-0.5 text-slate-600">{t.notes}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function ContactRestrictionsBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  return (
    <Card className="p-3 text-[12px]" data-testid="patient-profile-contact-restrictions">
      {row("Do Not Contact", snapshot.flags.doNotContact ? "Yes" : "No")}
      {row("Reason", snapshot.flags.doNotContactReason)}
    </Card>
  );
}

function CooldownBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  return (
    <Card className="p-3 text-[12px]" data-testid="patient-profile-cooldown">
      {row("Active cooldown", snapshot.flags.activeCooldown ? "Yes" : "No")}
    </Card>
  );
}

function EngagementHistoryBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  return (
    <Card className="p-3 text-[12px]" data-testid="patient-profile-engagement-history">
      {row("Current assignment status", snapshot.engagement?.currentAssignmentStatus ?? null)}
      {row("Assigned to", snapshot.engagement?.currentAssignedTo ?? null)}
      {row("Last engagement update", snapshot.engagement?.lastEngagementUpdate ?? null)}
    </Card>
  );
}

function CallHistoryBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  const list = snapshot.callHistory ?? [];
  if (list.length === 0) return <div className="py-6 text-center text-[12px] text-slate-500" data-testid="patient-profile-call-history-empty">No calls logged yet.</div>;
  return (
    <ul className="space-y-2" data-testid="patient-profile-call-history-list">
      {list.map((c) => (
        <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-2.5 text-[12px]">
          <div className="flex items-center justify-between">
            <div className="font-medium">{c.outcome}</div>
            <div className="text-[11px] text-slate-500">{c.startedAt}</div>
          </div>
          {c.notes ? <div className="mt-0.5 text-slate-600">{c.notes}</div> : null}
          {c.callbackAt ? <div className="mt-0.5 text-slate-500">Callback {c.callbackAt}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function AdminReviewHistoryBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  const list = snapshot.adminReviewHistory ?? [];
  if (list.length === 0) return <div className="py-6 text-center text-[12px] text-slate-500" data-testid="patient-profile-admin-review-history-empty">No Admin Review history.</div>;
  return (
    <ul className="space-y-2" data-testid="patient-profile-admin-review-history-list">
      {list.map((r, i) => (
        <li key={i} className="rounded-xl border border-slate-200 bg-white p-2.5 text-[12px]">
          <div className="flex items-center justify-between">
            <div className="font-medium">{r.status}</div>
            <div className="text-[11px] text-slate-500">{r.at}</div>
          </div>
          {r.byUserId ? <div className="text-[11px] text-slate-500">by {r.byUserId}</div> : null}
          {r.note ? <div className="mt-0.5 text-slate-600">{r.note}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function ImportsBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  const list = snapshot.imports ?? [{
    batchId: snapshot.source.batchId,
    batchName: snapshot.source.batchName ?? `Batch ${snapshot.source.batchId}`,
    batchCreatedAt: snapshot.source.batchCreatedAt,
    sourceFileName: snapshot.source.sourceFileName,
  }];
  return (
    <ul className="space-y-2" data-testid="patient-profile-imports-list">
      {list.map((b) => (
        <li key={b.batchId} className="rounded-xl border border-slate-200 bg-white p-2.5 text-[12px]">
          <div className="font-medium">{b.batchName}</div>
          <div className="text-slate-500">{b.batchCreatedAt}{b.sourceFileName ? ` · ${b.sourceFileName}` : ""}</div>
        </li>
      ))}
    </ul>
  );
}

function FullAuditTrailBlock({ snapshot }: { snapshot: PatientProfileSnapshot }) {
  const list = snapshot.events ?? [];
  if (list.length === 0) return <div className="py-6 text-center text-[12px] text-slate-500" data-testid="patient-profile-audit-trail-empty">No audit events available yet.</div>;
  return (
    <ul className="space-y-2" data-testid="patient-profile-audit-trail-list">
      {list.map((e, i) => (
        <li key={i} className="rounded-xl border border-slate-200 bg-white p-2.5 text-[12px]">
          <div className="flex items-center justify-between">
            <div className="font-medium">{String(e.kind)}</div>
            <div className="text-[11px] text-slate-500">{e.occurredAt}</div>
          </div>
          {e.actorUserId ? <div className="text-[11px] text-slate-500">by {e.actorUserId}</div> : null}
        </li>
      ))}
    </ul>
  );
}
