// Engagement "Generate Call List" flow (Task 9) — lives entirely inside the
// Engagement Center (no new top-level nav).
//
//   select  → choose facility + canonical cohort + service filter, Preview
//   distribute → Auto-Distribute preview: per-member capacity + ancillary/status
//                mix + expandable exact patient membership
//   results → Confirm & Generate committed; per-member Generated Call List cards
//             with Copy Link / Download PDF / View List / Revoke (+ Retry PDF)
//
// Confirm assigns EXACTLY the reviewed mapping (server revalidates + excludes
// conflicts). After confirm, the browser renders + uploads each member's
// durable combined PDF from the frozen snapshot.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Users,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Ban,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  CALL_LIST_COHORTS,
  NOT_CONTACTED_DEFAULT_DAYS,
  type CallListCohortKey,
} from "@shared/engagement/callListCohorts";
import {
  fetchCohortPreview,
  fetchDistributionPreview,
  confirmDistribution,
  generateAndUploadPackagePdf,
  revokePackage,
  buildShareUrl,
  type CohortPreviewResult,
  type DistributionPreview,
  type ConfirmMemberResult,
  type ServiceCategory,
} from "@/lib/api/callListPackages";

// Category tokens (server expands "ultrasound" to canonical service names).
const SERVICE_CATEGORY_OPTIONS: { label: string; value: ServiceCategory }[] = [
  { label: "BrainWave", value: "brainwave" },
  { label: "VitalWave", value: "vitalwave" },
  { label: "Ultrasound", value: "ultrasound" },
];

const STATUS_LABELS: Record<string, string> = {
  never_called: "Never Called",
  callback_due: "Callback Due",
  lvm: "LVM",
  no_answer: "No Answer",
  reached_not_scheduled: "Reached — Not Scheduled",
  other: "Other",
};

type Step = "select" | "distribute" | "results";

type ResultMember = ConfirmMemberResult & {
  liveGenerationStatus: string | null;
  retrying?: boolean;
  revoked?: boolean;
};

export function GenerateCallListDialog({
  open,
  onOpenChange,
  facilities,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilities: string[];
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("select");

  // ── selection ──
  const [facility, setFacility] = useState<string>("");
  const [cohort, setCohort] = useState<CallListCohortKey>("never_called");
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>([]);
  const [notContactedDays, setNotContactedDays] = useState<number>(NOT_CONTACTED_DEFAULT_DAYS);

  const [cohortPreview, setCohortPreview] = useState<CohortPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // ── distribution ──
  const [distribution, setDistribution] = useState<DistributionPreview | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);

  // ── results ──
  const [results, setResults] = useState<ResultMember[]>([]);
  const [conflicts, setConflicts] = useState<Array<{ executionCaseId: number; reason: string }>>([]);

  const cohortDef = CALL_LIST_COHORTS.find((c) => c.key === cohort);

  function reset() {
    setStep("select");
    setCohortPreview(null);
    setDistribution(null);
    setExpanded(new Set());
    setResults([]);
    setConflicts([]);
  }

  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function toggleCategory(c: ServiceCategory) {
    setServiceCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
    setCohortPreview(null);
  }

  async function handlePreview() {
    if (!facility) {
      toast({ title: "Choose a facility first", variant: "destructive" });
      return;
    }
    setPreviewing(true);
    try {
      const result = await fetchCohortPreview({
        cohort,
        facility,
        serviceCategories: serviceCategories.length ? serviceCategories : undefined,
        notContactedDays: cohort === "not_contacted_in_x_days" ? notContactedDays : undefined,
        limit: 50,
      });
      setCohortPreview(result);
    } catch (e) {
      toast({ title: "Preview failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleAutoDistribute() {
    setDistributing(true);
    try {
      const result = await fetchDistributionPreview({
        cohort,
        facility,
        serviceCategories: serviceCategories.length ? serviceCategories : undefined,
        notContactedDays: cohort === "not_contacted_in_x_days" ? notContactedDays : undefined,
      });
      setDistribution(result);
      setStep("distribute");
    } catch (e) {
      toast({ title: "Distribution failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setDistributing(false);
    }
  }

  async function handleConfirm() {
    if (!distribution) return;
    setConfirming(true);
    try {
      const res = await confirmDistribution({
        distributionOperationId: distribution.previewOperationId,
        cohort: distribution.cohort,
        facility: distribution.facility,
        serviceDate: distribution.serviceDate,
        services: distribution.services ?? undefined,
        mapping: distribution.mapping,
      });
      setConflicts(res.conflicts);
      const members: ResultMember[] = res.members.map((m) => ({
        ...m,
        liveGenerationStatus: m.generationStatus,
      }));
      setResults(members);
      setStep("results");
      // Generate + upload each member's durable PDF from the frozen snapshot.
      for (const m of members) {
        if (m.packageId == null) continue;
        const status = await generateAndUploadPackagePdf(m.packageId);
        setResults((prev) =>
          prev.map((r) =>
            r.teamMemberId === m.teamMemberId ? { ...r, liveGenerationStatus: status } : r,
          ),
        );
      }
    } catch (e) {
      toast({ title: "Confirm failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }

  async function handleCopyLink(token: string | null) {
    if (!token) {
      toast({ title: "No link available", description: "This link was already surfaced or the package failed.", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(buildShareUrl(token));
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", description: buildShareUrl(token), variant: "destructive" });
    }
  }

  async function handleRetryPdf(m: ResultMember) {
    if (m.packageId == null) return;
    setResults((prev) => prev.map((r) => (r.teamMemberId === m.teamMemberId ? { ...r, retrying: true } : r)));
    const status = await generateAndUploadPackagePdf(m.packageId);
    setResults((prev) =>
      prev.map((r) =>
        r.teamMemberId === m.teamMemberId ? { ...r, retrying: false, liveGenerationStatus: status } : r,
      ),
    );
  }

  async function handleRevoke(m: ResultMember) {
    if (m.packageId == null) return;
    try {
      await revokePackage(m.packageId);
      setResults((prev) => prev.map((r) => (r.teamMemberId === m.teamMemberId ? { ...r, revoked: true } : r)));
      toast({ title: "Link revoked" });
    } catch (e) {
      toast({ title: "Revoke failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Call List</DialogTitle>
          <DialogDescription>
            Pick a facility + cohort, review the distribution, then confirm to
            assign, push to Team Portals, and generate secure share packages.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-600">Facility</label>
                <Select value={facility} onValueChange={(v) => { setFacility(v); setCohortPreview(null); }}>
                  <SelectTrigger className="mt-1" data-testid="gcl-facility">
                    <SelectValue placeholder="Choose facility" />
                  </SelectTrigger>
                  <SelectContent>
                    {facilities.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Cohort</label>
                <Select value={cohort} onValueChange={(v) => { setCohort(v as CallListCohortKey); setCohortPreview(null); }}>
                  <SelectTrigger className="mt-1" data-testid="gcl-cohort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_LIST_COHORTS.map((c) => (
                      <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {cohortDef?.description && (
              <p className="text-xs text-slate-500">{cohortDef.description}</p>
            )}

            {cohort === "not_contacted_in_x_days" && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-600">Not contacted in</label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={notContactedDays}
                  onChange={(e) => { setNotContactedDays(Number(e.target.value) || NOT_CONTACTED_DEFAULT_DAYS); setCohortPreview(null); }}
                  className="h-8 w-20"
                  data-testid="gcl-notcontacted-days"
                />
                <span className="text-xs text-slate-600">days</span>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-slate-600">Services (All Ancillaries if none selected)</label>
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setServiceCategories([]); setCohortPreview(null); }}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    serviceCategories.length === 0
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-600"
                  }`}
                  data-testid="gcl-service-all"
                >
                  All Ancillaries
                </button>
                {SERVICE_CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleCategory(opt.value)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      serviceCategories.includes(opt.value)
                        ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 text-slate-600"
                    }`}
                    data-testid={`gcl-service-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handlePreview} disabled={previewing || !facility} variant="outline" data-testid="gcl-preview">
                {previewing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Users className="mr-1.5 h-3.5 w-3.5" />}
                Preview Patients
              </Button>
              {cohortPreview && (
                <span className="text-sm text-slate-700" data-testid="gcl-preview-total">
                  {cohortPreview.total} match{cohortPreview.total === 1 ? "" : "es"}
                </span>
              )}
            </div>

            {cohortPreview && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 max-h-52 overflow-y-auto">
                {cohortPreview.preview.length === 0 ? (
                  <div className="text-xs text-slate-400 p-2">No patients match this cohort right now.</div>
                ) : (
                  <ul className="text-xs text-slate-700 space-y-0.5">
                    {cohortPreview.preview.map((p) => (
                      <li key={p.executionCaseId} className="flex justify-between gap-2">
                        <span className="truncate">{p.patientName}</span>
                        <span className="text-slate-400 shrink-0">{(p.selectedServices ?? []).join(", ")}</span>
                      </li>
                    ))}
                    {cohortPreview.total > cohortPreview.preview.length && (
                      <li className="text-slate-400 pt-1">+ {cohortPreview.total - cohortPreview.preview.length} more…</li>
                    )}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleAutoDistribute}
                disabled={distributing || !cohortPreview || cohortPreview.total === 0}
                data-testid="gcl-auto-distribute"
              >
                {distributing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Auto-Distribute {cohortPreview ? `${cohortPreview.total} Patients` : ""}
              </Button>
            </div>
          </div>
        )}

        {step === "distribute" && distribution && (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <span className="font-semibold">{distribution.facility}</span> · {distribution.cohortLabel} ·{" "}
              {distribution.serviceDate} · <span className="font-semibold">{distribution.totalMatches}</span> matches
            </div>

            {distribution.members.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                No working members with capacity to receive this cohort.
              </div>
            ) : (
              distribution.members.map((m) => {
                const isOpen = expanded.has(m.teamMemberId);
                return (
                  <div key={m.teamMemberId} className="rounded-lg border border-slate-200 bg-white">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          next.has(m.teamMemberId) ? next.delete(m.teamMemberId) : next.add(m.teamMemberId);
                          return next;
                        })
                      }
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      data-testid={`gcl-member-${m.teamMemberId}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        <span className="font-medium text-slate-900 truncate">{m.name}</span>
                        <span className="text-xs text-slate-500">{m.patientCount} patients</span>
                      </div>
                      <div className="text-xs text-slate-500 shrink-0">
                        Capacity {m.capacity.assignedThisPlan} / {m.capacity.dailyCallCapacity}
                      </div>
                    </button>
                    <div className="px-3 pb-2 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">BW {m.ancillaryMix.brainwave}</span>
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">VW {m.ancillaryMix.vitalwave}</span>
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">US {m.ancillaryMix.ultrasound}</span>
                      {Object.entries(m.statusMix).map(([k, v]) => (
                        <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                          {STATUS_LABELS[k] ?? k}: {v}
                        </span>
                      ))}
                    </div>
                    {isOpen && (
                      <ul className="border-t border-slate-100 px-3 py-2 text-xs text-slate-700 space-y-0.5 max-h-48 overflow-y-auto">
                        {m.patients.map((p) => (
                          <li key={p.executionCaseId} className="flex justify-between gap-2">
                            <span className="truncate">{p.patientName}</span>
                            <span className="text-slate-400 shrink-0">{(p.services ?? []).join(", ")}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("select")}>Back</Button>
              <Button
                onClick={handleConfirm}
                disabled={confirming || distribution.members.length === 0}
                data-testid="gcl-confirm"
              >
                {confirming ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Confirm &amp; Generate
              </Button>
            </div>
          </div>
        )}

        {step === "results" && (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-800">Generated Call Lists</div>
            {conflicts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{conflicts.length} patient(s) excluded at commit (became ineligible since preview). They were not assigned.</span>
              </div>
            )}
            {results.map((m) => {
              const pdfReady = m.liveGenerationStatus === "ready";
              const pdfFailed = m.liveGenerationStatus === "failed";
              return (
                <div key={m.teamMemberId} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`gcl-result-${m.teamMemberId}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-900">{m.name}</div>
                      <div className="text-xs text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {m.committedCount} patients · Added to Team Portal
                      </div>
                      {m.visibility === "missing_user_mapping" && (
                        <div className="text-[11px] text-amber-600 mt-0.5">
                          Not linked to a login — assign a user so it appears in their portal.
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 shrink-0">
                      Package: {m.packageError ? "error" : "ready"} · PDF:{" "}
                      {pdfReady ? "ready" : pdfFailed ? "failed" : "generating…"}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleCopyLink(m.shareToken)} disabled={m.revoked} data-testid={`gcl-copy-${m.teamMemberId}`}>
                      <Copy className="mr-1 h-3.5 w-3.5" /> Copy Link
                    </Button>
                    {m.packageId != null && (
                      <a
                        href={`/api/engagement/call-lists/packages/${m.packageId}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs ${pdfReady ? "border-slate-200 text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-100 text-slate-300"}`}
                        data-testid={`gcl-download-${m.teamMemberId}`}
                      >
                        <Download className="mr-1 h-3.5 w-3.5" /> Download PDF
                      </a>
                    )}
                    {m.shareToken && (
                      <a
                        href={buildShareUrl(m.shareToken)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        data-testid={`gcl-view-${m.teamMemberId}`}
                      >
                        <ExternalLink className="mr-1 h-3.5 w-3.5" /> View List
                      </a>
                    )}
                    {pdfFailed && (
                      <Button size="sm" variant="outline" onClick={() => handleRetryPdf(m)} disabled={m.retrying} data-testid={`gcl-retry-${m.teamMemberId}`}>
                        {m.retrying ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                        Retry PDF
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => handleRevoke(m)} disabled={m.revoked} data-testid={`gcl-revoke-${m.teamMemberId}`}>
                      <Ban className="mr-1 h-3.5 w-3.5" /> {m.revoked ? "Revoked" : "Revoke"}
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => handleClose(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
