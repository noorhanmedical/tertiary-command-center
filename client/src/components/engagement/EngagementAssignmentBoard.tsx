import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Loader2,
  UserCog,
  AlertCircle,
  CalendarDays,
  Building2,
  Users,
  Trash2,
  FileText,
  Shuffle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PatientScreening } from "@shared/schema";
import {
  generatePlexusPDFAsync,
  generateClinicianPDFAsync,
} from "@/lib/pdfGeneration";
import {
  validateSameFacilityDatePacket,
  type PdfPacketSourcePatient,
} from "@/lib/pdfPacketGrouping";

// Engagement Assignment Board.
//
// Reads /api/engagement/assignment-board (canonical
// patient_execution_cases + outreach_schedulers) and exposes per-row
// and bulk team-member assignment. Writes through
// POST /api/engagement/assignment-board/assign which appends a
// patient_journey_events row for every change.

type BoardRow = {
  patientScreeningId: number | null;
  executionCaseId: number;
  patientName: string;
  patientDob: string | null;
  phoneNumber: string | null;
  facility: string | null;
  scheduleDate: string | null;
  patientType: string | null;
  engagementBucket: string | null;
  engagementStatus: string | null;
  commitStatus: string | null;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  assignedName: string | null;
  assignedFacility: string | null;
  nextActionAt: string | null;
  lastActivityAt: string | null;
  lastActivitySummary: string | null;
  missingInfo: string[];
  selectedServices: string[];
};

type BoardSummary = {
  total: number;
  assigned: number;
  unassigned: number;
  needsInfo: number;
  byFacility: Array<{ facility: string; count: number }>;
  byAssignedTeamMember: Array<{ name: string; count: number }>;
  byEngagementStatus: Array<{ status: string; count: number }>;
};

type BoardResponse = { rows: BoardRow[]; summary: BoardSummary };

type SchedulerOption = {
  id: number;
  name: string;
  facility: string;
};

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return "just now";
  const m = Math.round(diffMs / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function EngagementAssignmentBoard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [q, setQ] = useState("");
  const [facilityFilter, setFacilityFilter] = useState<string>("__all");
  const [assignedFilter, setAssignedFilter] = useState<string>("__all");
  const [statusFilter, setStatusFilter] = useState<string>("__all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [missingInfoOnly, setMissingInfoOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSchedulerId, setBulkSchedulerId] = useState<string>("");
  const [bulkReason, setBulkReason] = useState("");
  // Engagement Center can group by date facility scheduler — toolbar
  // toggles between three axes. Default is Date per the spec.
  // SOURCE MARKER: Engagement Center can group by date facility scheduler
  type GroupMode = "none" | "date" | "facility" | "scheduler";
  const [groupMode, setGroupMode] = useState<GroupMode>("date");
  // Per-group selection state keyed by group key → set of
  // executionCaseIds. Distinct from selectedIds (which keys by
  // patientScreeningId for the bulk-assign flow) so switching
  // groupings cannot create cross-group selections.
  const [selectedByGroup, setSelectedByGroup] = useState<
    Record<string, Set<number>>
  >({});
  // Per-group PDF error surface. Two failure modes are tracked
  // separately so the inline UI can distinguish them:
  // - "validation" → packet validator (e.g. mixed facilities, mixed
  //    dates, mixed dated+outreach) — fix the selection.
  // - "generation" → fetch failure, missing patientScreeningId rows,
  //    or html2pdf error — fix the data / retry.
  // SOURCE MARKER: Engagement Center PDF generation error is surfaced
  type PdfErrorKind = "validation" | "generation";
  const [pdfErrorByGroup, setPdfErrorByGroup] = useState<
    Record<string, { kind: PdfErrorKind; message: string } | null>
  >({});
  // Per-group PDF pending state. Both PDF buttons in a group disable
  // while that group is generating; other groups stay enabled so one
  // slow packet does not block unrelated work.
  // SOURCE MARKER: PDF generation pending state is group scoped
  // SOURCE MARKER: Engagement Center PDF buttons are disabled while generating
  // SOURCE MARKER: PDF generation runs on demand
  const [pdfGeneratingByGroup, setPdfGeneratingByGroup] = useState<
    Record<string, boolean>
  >({});

  // Switching group mode invalidates both the per-group selection
  // (the group keys don't exist in the new mode) and any inline PDF
  // error pinned to a now-vanished group. Clearing both prevents the
  // "ghost selection / ghost error" flashes after toggling Date /
  // Facility / Scheduler.
  // SOURCE MARKER: Engagement Center clears stale selection when group mode changes
  // SOURCE MARKER: Engagement Center clears stale PDF errors when group mode changes
  useEffect(() => {
    setSelectedByGroup({});
    setPdfErrorByGroup({});
    setPdfGeneratingByGroup({});
  }, [groupMode]);

  const board = useQuery<BoardResponse>({
    queryKey: [
      "/api/engagement/assignment-board",
      q,
      facilityFilter,
      assignedFilter,
      statusFilter,
      unassignedOnly,
      missingInfoOnly,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      if (facilityFilter !== "__all") qs.set("facility", facilityFilter);
      if (assignedFilter !== "__all")
        qs.set("assignedTeamMemberId", assignedFilter);
      if (statusFilter !== "__all") qs.set("engagementStatus", statusFilter);
      if (unassignedOnly) qs.set("unassignedOnly", "1");
      if (missingInfoOnly) qs.set("missingInfoOnly", "1");
      const url = `/api/engagement/assignment-board${qs.toString() ? `?${qs}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return (await res.json()) as BoardResponse;
    },
    refetchInterval: 60_000,
  });

  const schedulers = useQuery<SchedulerOption[]>({
    queryKey: ["/api/outreach/schedulers"],
    queryFn: async () => {
      const res = await fetch("/api/outreach/schedulers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load schedulers");
      return (await res.json()) as SchedulerOption[];
    },
  });

  // SOURCE MARKER: Assignment updates only invalidate assignment board
  // Narrowed from a six-cache fan-out (board, engagement-assignment,
  // team-workspace-call-list, screening-batches, schedule/dashboard,
  // portal-command-center predicate) down to the surfaces that
  // genuinely reflect a board mutation: the board itself, the per-
  // patient engagement chip query, and the team-portal call list.
  // Scheduler-board mutations do not change patient screening rows or
  // the global schedule dashboard, so those caches stay warm and the
  // user no longer eats a full board+dashboard refetch on every
  // assign/distribute/cancel.
  const invalidateBoard = () => {
    queryClient.invalidateQueries({
      predicate: (qq) =>
        Array.isArray(qq.queryKey) &&
        qq.queryKey[0] === "/api/engagement/assignment-board",
    });
    queryClient.invalidateQueries({ queryKey: ["engagement-assignment"] });
    queryClient.invalidateQueries({ queryKey: ["team-workspace-call-list"] });
  };

  const assignMutation = useMutation({
    mutationFn: async (input: {
      patientScreeningIds: number[];
      schedulerId: number;
      reason?: string;
    }) => {
      const res = await fetch(
        "/api/engagement/assignment-board/assign",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const text = await res.text();
      let parsed: any = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        /* noop */
      }
      if (!res.ok) {
        throw new Error(parsed?.error ?? `Request failed (${res.status})`);
      }
      return parsed;
    },
    onSuccess: (resp) => {
      const updatedCount = resp?.updated?.length ?? 0;
      const failedCount = resp?.failed?.length ?? 0;
      toast({
        title:
          failedCount === 0
            ? `Assigned ${updatedCount} patient${updatedCount === 1 ? "" : "s"}`
            : `Assigned ${updatedCount}, failed ${failedCount}`,
        variant: failedCount === 0 ? undefined : "destructive",
      });
      setSelectedIds(new Set());
      setBulkSchedulerId("");
      setBulkReason("");
      invalidateBoard();
    },
    onError: (err: unknown) => {
      toast({
        title: "Assignment failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // SOURCE MARKER: Engagement Center delete removes assignment not patient record
  // SOURCE MARKER: Engagement Center delete all is scoped to current group
  const cancelManyMutation = useMutation({
    mutationFn: async (input: { executionCaseIds: number[]; reason?: string }) => {
      const res = await fetch(
        "/api/engagement/assignment-board/cancel-many",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const text = await res.text();
      let parsed: any = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        /* noop */
      }
      if (!res.ok) {
        throw new Error(parsed?.error ?? `Request failed (${res.status})`);
      }
      return parsed;
    },
    onSuccess: (resp) => {
      const cancelled = resp?.cancelled?.length ?? 0;
      const failed = resp?.failed?.length ?? 0;
      toast({
        title:
          failed === 0
            ? `Removed ${cancelled} assignment${cancelled === 1 ? "" : "s"}`
            : `Removed ${cancelled}, failed ${failed}`,
        variant: failed === 0 ? undefined : "destructive",
      });
      setSelectedByGroup({});
      invalidateBoard();
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not remove assignments",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const rows = board.data?.rows ?? [];
  const summary = board.data?.summary;

  const facilityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.facility) set.add(r.facility);
    }
    return Array.from(set).sort();
  }, [rows]);

  const assignedOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of rows) {
      if (r.assignedTeamMemberId != null && r.assignedName) {
        map.set(r.assignedTeamMemberId, r.assignedName);
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [rows]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.engagementStatus) set.add(r.engagementStatus);
    }
    return Array.from(set).sort();
  }, [rows]);

  // Build groups for the current grouping mode. Each group exposes
  // a stable key + label + the rows that fall into it. Unassigned /
  // missing values roll up into "No Date" / "No Facility" /
  // "Unassigned / Engagement Queue".
  //
  // Memoized on `rows` + `groupMode` so toolbar / filter / selection
  // state updates do not rebuild the group map. The downstream
  // grouped.map() reads constant references on every parent render
  // for the same board snapshot.
  // SOURCE MARKER: Engagement Center call lists grouped by scheduler
  // SOURCE MARKER: PDF by team member uses assigned scheduler group
  // SOURCE MARKER: Platform performance pass memoizes Engagement Center groups
  // SOURCE MARKER: Engagement Center avoids rendering inactive heavy group content
  // (GroupAssignPopover + InlineSchedulerPicker only render their
  // PopoverContent when open via Radix's default mount-on-open;
  // scheduler list iteration is therefore deferred until the operator
  // actually opens the picker.)
  type BoardGroup = { key: string; label: string; rows: BoardRow[]; tone: "date" | "facility" | "scheduler" };
  const grouped: BoardGroup[] = useMemo(() => {
    if (groupMode === "none") return [];
    const map = new Map<string, BoardGroup>();
    const keyFor = (r: BoardRow): { key: string; label: string } => {
      if (groupMode === "date") {
        const v = r.scheduleDate ?? "";
        if (!v) return { key: "__no_date__", label: "No Date" };
        return { key: `date:${v}`, label: v };
      }
      if (groupMode === "facility") {
        const v = (r.facility ?? "").trim();
        if (!v) return { key: "__no_facility__", label: "No Facility" };
        return { key: `facility:${v.toLowerCase()}`, label: v };
      }
      // scheduler
      if (r.assignedTeamMemberId == null) {
        return { key: "__unassigned__", label: "Unassigned / Engagement Queue" };
      }
      return {
        key: `scheduler:${r.assignedTeamMemberId}`,
        label: r.assignedName?.trim() || `Scheduler #${r.assignedTeamMemberId}`,
      };
    };
    for (const r of rows) {
      const { key, label } = keyFor(r);
      const existing = map.get(key);
      if (existing) existing.rows.push(r);
      else map.set(key, { key, label, rows: [r], tone: groupMode });
    }
    const out = Array.from(map.values());
    out.sort((a, b) => {
      // Date: newest first; Facility: A-Z; Scheduler: A-Z; unknown buckets last.
      const aUnknown = a.key.startsWith("__");
      const bUnknown = b.key.startsWith("__");
      if (aUnknown && !bUnknown) return 1;
      if (!aUnknown && bUnknown) return -1;
      if (groupMode === "date") return b.label.localeCompare(a.label);
      return a.label.localeCompare(b.label);
    });
    return out;
  }, [rows, groupMode]);

  function toggleSelectInGroup(groupKey: string, executionCaseId: number) {
    setSelectedByGroup((prev) => {
      const next = new Set(prev[groupKey] ?? []);
      if (next.has(executionCaseId)) next.delete(executionCaseId);
      else next.add(executionCaseId);
      return { ...prev, [groupKey]: next };
    });
  }

  function setAllSelectedInGroup(group: BoardGroup) {
    setSelectedByGroup((prev) => {
      const existing = prev[group.key] ?? new Set<number>();
      const allIds = group.rows.map((r) => r.executionCaseId);
      const allSel = allIds.length > 0 && allIds.every((id) => existing.has(id));
      const next = new Set<number>(allSel ? [] : allIds);
      return { ...prev, [group.key]: next };
    });
  }

  // Engagement Center PDF packets use selected patients only.
  // Engagement Center PDFs validate facility date packet.
  // SOURCE MARKER: Engagement Center PDF packets use selected patients only
  // SOURCE MARKER: Engagement Center PDFs validate facility date packet
  // SOURCE MARKER: Engagement Center scheduler PDFs are scoped to assigned scheduler
  // SOURCE MARKER: Engagement Center PDF maps execution cases to patient screenings
  // SOURCE MARKER: Engagement Center PDFs require patientScreeningId
  // SOURCE MARKER: Engagement Center PDF fetches full patient records
  // SOURCE MARKER: Engagement Center PDF generation error is surfaced
  async function generateGroupPdf(
    group: BoardGroup,
    executionCaseIds: number[],
    mode: "plexus" | "clinician",
  ) {
    // Double-click guard — the group is already generating, do nothing.
    if (pdfGeneratingByGroup[group.key]) return;
    setPdfGeneratingByGroup((prev) => ({ ...prev, [group.key]: true }));
    try {
      await runGroupPdf(group, executionCaseIds, mode);
    } finally {
      setPdfGeneratingByGroup((prev) => {
        const next = { ...prev };
        delete next[group.key];
        return next;
      });
    }
  }

  async function runGroupPdf(
    group: BoardGroup,
    executionCaseIds: number[],
    mode: "plexus" | "clinician",
  ) {
    // Reset any previous error for this group on every attempt so the
    // inline surface either disappears (success) or replaces itself
    // with the latest reason (new failure).
    // SOURCE MARKER: PDF generation clears stale error on success
    setPdfErrorByGroup((prev) => ({ ...prev, [group.key]: null }));

    // Large-packet advisory — html2pdf rasterizes every page so the
    // wall-clock cost scales roughly linearly with patient count. We
    // don't block, but we warn so the operator can choose to split
    // by scheduler instead of a single 200-patient export.
    // SOURCE MARKER: Large PDF packet generation warning
    if (executionCaseIds.length > 50) {
      toast({
        title: `Large PDF packet (${executionCaseIds.length} patients)`,
        description:
          "Large PDF packet may take longer. Consider generating by scheduler or smaller group.",
      });
    }

    const reportGenerationError = (message: string) => {
      setPdfErrorByGroup((prev) => ({
        ...prev,
        [group.key]: { kind: "generation", message },
      }));
      toast({ title: "PDF packet failed", description: message, variant: "destructive" });
    };
    const reportValidationError = (message: string) => {
      setPdfErrorByGroup((prev) => ({
        ...prev,
        [group.key]: { kind: "validation", message },
      }));
      toast({ title: "PDF packet blocked", description: message, variant: "destructive" });
    };

    if (executionCaseIds.length === 0) {
      reportValidationError(`Pick at least one patient under ${group.label}.`);
      return;
    }

    // Map executionCaseId → patientScreeningId via the in-memory rows.
    // Track rows that have no patient screening so the user sees the
    // *count* of dropped rows instead of a silent partial export.
    const idIndex = new Map<number, BoardRow>();
    for (const r of group.rows) idIndex.set(r.executionCaseId, r);
    const screeningIds: number[] = [];
    const missingScreeningExecIds: number[] = [];
    for (const execId of executionCaseIds) {
      const row = idIndex.get(execId);
      if (row?.patientScreeningId != null) {
        screeningIds.push(row.patientScreeningId);
      } else {
        missingScreeningExecIds.push(execId);
      }
    }
    if (screeningIds.length === 0) {
      reportGenerationError(
        `None of the ${executionCaseIds.length} selected execution case${executionCaseIds.length === 1 ? "" : "s"} maps to a patient screening record — PDF packets require patientScreeningId.`,
      );
      return;
    }

    let fullPatients: PatientScreening[] = [];
    try {
      const fetched = await Promise.all(
        screeningIds.map(async (id) => {
          try {
            const res = await fetch(`/api/patients/${id}`, { credentials: "include" });
            if (!res.ok) {
              return { id, ok: false as const, reason: `HTTP ${res.status}` };
            }
            const body = (await res.json()) as PatientScreening;
            return { id, ok: true as const, patient: body };
          } catch (err) {
            return {
              id,
              ok: false as const,
              reason: err instanceof Error ? err.message : "network error",
            };
          }
        }),
      );
      const failures = fetched.filter((r) => !r.ok) as Array<{ id: number; ok: false; reason: string }>;
      fullPatients = fetched
        .filter((r): r is { id: number; ok: true; patient: PatientScreening } => r.ok)
        .map((r) => r.patient);
      if (fullPatients.length === 0) {
        const detail = failures.length > 0 ? ` (${failures[0].reason})` : "";
        reportGenerationError(`Could not load any of the selected patient records${detail}.`);
        return;
      }
      if (failures.length > 0) {
        // Partial fetch — surface the count but continue so the
        // operator still gets a packet for the records that loaded.
        toast({
          title: `Skipped ${failures.length} patient${failures.length === 1 ? "" : "s"}`,
          description: `Could not load ${failures.length} of ${screeningIds.length} records (${failures[0].reason}).`,
        });
      }
    } catch (err) {
      reportGenerationError(err instanceof Error ? err.message : "Unknown fetch error");
      return;
    }

    const fallbackFacility = group.rows[0]?.facility ?? null;
    const fallbackDate = group.rows[0]?.scheduleDate ?? null;
    const validation = validateSameFacilityDatePacket(
      fullPatients as PdfPacketSourcePatient[],
      fallbackFacility,
      fallbackDate,
    );
    if (!validation.ok) {
      // SOURCE MARKER: Engagement Center PDF validation error is surfaced
      reportValidationError(validation.reason);
      return;
    }

    if (missingScreeningExecIds.length > 0) {
      toast({
        title: `Skipped ${missingScreeningExecIds.length} row${missingScreeningExecIds.length === 1 ? "" : "s"}`,
        description: `${missingScreeningExecIds.length} of ${executionCaseIds.length} selected execution case${executionCaseIds.length === 1 ? " has" : "s have"} no patientScreeningId and were dropped from the packet.`,
      });
    }

    const batchName = `${validation.patients[0]?.facility ?? group.label} · ${
      validation.isOutreachPacket ? "Outreach" : validation.scheduleDate
    }`;
    try {
      if (mode === "plexus") {
        await generatePlexusPDFAsync(batchName, validation.patients, validation.scheduleDate, null);
      } else {
        await generateClinicianPDFAsync(batchName, validation.patients, validation.scheduleDate, null);
      }
    } catch (err) {
      reportGenerationError(err instanceof Error ? err.message : "Unknown PDF export error");
    }
  }

  function confirmDeleteGroup(group: BoardGroup, executionCaseIds: number[]) {
    if (executionCaseIds.length === 0) return;
    const ok = confirm(
      `Remove ${executionCaseIds.length} assignment${executionCaseIds.length === 1 ? "" : "s"} from ${group.label}? The patient records stay in Plexus IQ.`,
    );
    if (!ok) return;
    cancelManyMutation.mutate({ executionCaseIds });
  }

  // Resolve selected execution cases → patientScreeningIds for the
  // assign-many endpoint. Rows without a screening id are skipped
  // (assignment-board flow can't reassign them).
  function patientScreeningIdsForGroupSelection(
    group: BoardGroup,
    executionCaseIds: number[],
  ): number[] {
    const ids: number[] = [];
    const index = new Map<number, BoardRow>();
    for (const r of group.rows) index.set(r.executionCaseId, r);
    for (const eid of executionCaseIds) {
      const row = index.get(eid);
      if (row?.patientScreeningId != null) ids.push(row.patientScreeningId);
    }
    return ids;
  }

  // Bulk-assign every selected row in a group to a single scheduler.
  // Reuses the existing /api/engagement/assignment-board/assign route.
  function assignSelectionToSingleScheduler(
    group: BoardGroup,
    executionCaseIds: number[],
    schedulerId: number,
  ) {
    const screeningIds = patientScreeningIdsForGroupSelection(group, executionCaseIds);
    if (screeningIds.length === 0) {
      toast({
        title: "Select patients first",
        description: `Pick at least one patient under ${group.label}.`,
        variant: "destructive",
      });
      return;
    }
    assignMutation.mutate(
      { patientScreeningIds: screeningIds, schedulerId },
      {
        onSuccess: () => {
          setSelectedByGroup((prev) => ({ ...prev, [group.key]: new Set() }));
        },
      },
    );
  }

  // Distribute every selected row across N schedulers AS EVENLY AS
  // POSSIBLE. Round-robin walks the screening ids; with 10 patients
  // and 3 schedulers the split is 4/3/3 (no even-divisibility
  // requirement). Fires one assign-many call per scheduler with
  // their slice. Each backend call appends its own
  // patient_journey_events audit row so the trail documents the
  // split. The toast surfaces the actual per-call error message so
  // the cause is visible — never a silent "failed N" count.
  //
  // SOURCE MARKER: Distribute round-robin tolerates uneven counts
  async function distributeSelectionAcrossSchedulers(
    group: BoardGroup,
    executionCaseIds: number[],
    schedulerIds: number[],
  ) {
    const screeningIds = patientScreeningIdsForGroupSelection(group, executionCaseIds);
    if (screeningIds.length === 0 || schedulerIds.length === 0) {
      toast({
        title: "Pick patients + schedulers",
        description: "Select patients and pick at least one scheduler to distribute to.",
        variant: "destructive",
      });
      return;
    }
    const schedulersById = new Map((schedulers.data ?? []).map((s) => [s.id, s]));
    const buckets: Record<number, number[]> = {};
    for (const sid of schedulerIds) buckets[sid] = [];
    screeningIds.forEach((pid, i) => {
      const sid = schedulerIds[i % schedulerIds.length];
      buckets[sid].push(pid);
    });
    let totalAssigned = 0;
    let totalFailed = 0;
    const errorMessages: string[] = [];
    for (const sid of schedulerIds) {
      const slice = buckets[sid] ?? [];
      if (slice.length === 0) continue;
      const schedulerLabel = schedulersById.get(sid)?.name ?? `Scheduler #${sid}`;
      try {
        const res = await fetch("/api/engagement/assignment-board/assign", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientScreeningIds: slice,
            schedulerId: sid,
            reason: "Distributed evenly from Engagement Center",
          }),
        });
        const text = await res.text();
        let parsed: any = {};
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          /* noop */
        }
        if (!res.ok) {
          totalFailed += slice.length;
          const reason = parsed?.error ?? text ?? `HTTP ${res.status}`;
          errorMessages.push(`${schedulerLabel}: ${reason}`);
          continue;
        }
        const updatedCount = parsed?.updated?.length ?? 0;
        const failedCount = parsed?.failed?.length ?? 0;
        totalAssigned += updatedCount;
        totalFailed += failedCount;
        if (failedCount > 0) {
          const firstReason =
            parsed?.failed?.[0]?.reason ?? "Unknown server reason";
          errorMessages.push(
            `${schedulerLabel}: ${failedCount} patient${failedCount === 1 ? "" : "s"} failed (${firstReason})`,
          );
        }
      } catch (err) {
        totalFailed += slice.length;
        const reason = err instanceof Error ? err.message : "Network error";
        errorMessages.push(`${schedulerLabel}: ${reason}`);
      }
    }
    if (totalFailed === 0) {
      toast({
        title: `Distributed ${totalAssigned} across ${schedulerIds.length} scheduler${schedulerIds.length === 1 ? "" : "s"}`,
      });
    } else {
      const summary = `${totalAssigned} assigned, ${totalFailed} failed`;
      const detail =
        errorMessages.length === 0
          ? summary
          : `${summary}. ${errorMessages.slice(0, 3).join(" · ")}${errorMessages.length > 3 ? ` · +${errorMessages.length - 3} more` : ""}`;
      toast({
        title: "Distribute partially failed",
        description: detail,
        variant: "destructive",
      });
    }
    setSelectedByGroup((prev) => ({ ...prev, [group.key]: new Set() }));
    invalidateBoard();
  }

  const allSelected = rows.length > 0 && rows.every((r) => r.patientScreeningId != null && selectedIds.has(r.patientScreeningId));
  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set<number>();
      for (const r of rows) {
        if (r.patientScreeningId != null) next.add(r.patientScreeningId);
      }
      setSelectedIds(next);
    }
  };

  const toggleRow = (pid: number | null) => {
    if (pid == null) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const submitBulk = () => {
    if (selectedIds.size === 0 || !bulkSchedulerId) return;
    const schedId = Number.parseInt(bulkSchedulerId, 10);
    if (!Number.isFinite(schedId)) return;
    assignMutation.mutate({
      patientScreeningIds: Array.from(selectedIds),
      schedulerId: schedId,
      reason: bulkReason.trim() || undefined,
    });
  };

  const submitOne = (pid: number, schedulerId: number) => {
    assignMutation.mutate({
      patientScreeningIds: [pid],
      schedulerId,
    });
  };

  return (
    <div className="space-y-4" data-testid="engagement-assignment-board">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total sent" value={summary?.total ?? 0} tone="slate" />
        <SummaryCard label="Assigned" value={summary?.assigned ?? 0} tone="emerald" />
        <SummaryCard
          label="Assignment pending"
          value={summary?.unassigned ?? 0}
          tone="amber"
        />
        <SummaryCard label="Needs info" value={summary?.needsInfo ?? 0} tone="rose" />
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <div className="md:col-span-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Search
            </Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, DOB, facility…"
              className="mt-1 h-8 text-xs"
              data-testid="input-engagement-board-search"
            />
          </div>
          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Facility
            </Label>
            <Select value={facilityFilter} onValueChange={setFacilityFilter}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-engagement-board-facility">
                <SelectValue placeholder="All facilities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All facilities</SelectItem>
                {facilityOptions.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Assigned to
            </Label>
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-engagement-board-assigned">
                <SelectValue placeholder="Anyone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Anyone</SelectItem>
                {assignedOptions.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Status
            </Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-engagement-board-status">
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any status</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <Checkbox
              checked={unassignedOnly}
              onCheckedChange={(v) => setUnassignedOnly(v === true)}
              data-testid="checkbox-engagement-board-unassigned-only"
            />
            Unassigned only
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <Checkbox
              checked={missingInfoOnly}
              onCheckedChange={(v) => setMissingInfoOnly(v === true)}
              data-testid="checkbox-engagement-board-missing-info-only"
            />
            Missing info only
          </label>
        </div>
      </Card>

      {/* Grouping toolbar — Date / Facility / Scheduler. */}
      <div
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1"
        data-testid="engagement-center-grouped-board"
      >
        {(
          [
            { id: "date" as GroupMode, label: "Date", icon: CalendarDays, testId: "engagement-center-group-mode-date" },
            { id: "facility" as GroupMode, label: "Facility", icon: Building2, testId: "engagement-center-group-mode-facility" },
            { id: "scheduler" as GroupMode, label: "Scheduler", icon: Users, testId: "engagement-center-group-mode-scheduler" },
          ] as const
        ).map((opt) => {
          const Icon = opt.icon;
          const active = groupMode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setGroupMode(opt.id);
                setSelectedByGroup({});
              }}
              data-testid={opt.testId}
              data-active={active ? "true" : "false"}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-3 w-3" />
              {opt.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setGroupMode("none");
            setSelectedByGroup({});
          }}
          data-testid="engagement-center-group-mode-flat"
          data-active={groupMode === "none" ? "true" : "false"}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            groupMode === "none"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Flat
        </button>
      </div>

      {/* Bulk assign */}
      {selectedIds.size > 0 && (
        <Card className="p-3 border-indigo-200 bg-indigo-50/40" data-testid="engagement-board-bulk">
          <div className="flex flex-wrap items-end gap-3">
            <div className="text-sm font-medium text-slate-900">
              Bulk assign {selectedIds.size} patient{selectedIds.size === 1 ? "" : "s"}
            </div>
            <div className="min-w-[220px]">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Team member
              </Label>
              <Select value={bulkSchedulerId} onValueChange={setBulkSchedulerId}>
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-engagement-board-bulk-scheduler">
                  <SelectValue placeholder="Pick a team member…" />
                </SelectTrigger>
                <SelectContent>
                  {(schedulers.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} · {s.facility}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Reason (optional)
              </Label>
              <Input
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                className="mt-1 h-8 text-xs"
                placeholder="e.g. PTO redistribution"
                data-testid="input-engagement-board-bulk-reason"
              />
            </div>
            <Button
              size="sm"
              onClick={submitBulk}
              disabled={
                assignMutation.isPending || !bulkSchedulerId || selectedIds.size === 0
              }
              className="gap-1.5"
              data-testid="button-engagement-board-bulk-assign"
            >
              {assignMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserCog className="h-3.5 w-3.5" />
              )}
              Assign
            </Button>
          </div>
        </Card>
      )}

      {/* Grouped board (Date / Facility / Scheduler). */}
      {groupMode !== "none" && (
        <div className="space-y-3">
          {board.isLoading && (
            <Card className="p-3 text-center text-xs text-slate-500 italic">
              <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1" />
              Loading board…
            </Card>
          )}
          {!board.isLoading && grouped.length === 0 && (
            <Card className="p-3 text-center text-xs text-slate-500 italic">
              No patients in Engagement yet.
            </Card>
          )}
          {grouped.map((group) => {
            const selected = selectedByGroup[group.key] ?? new Set<number>();
            const allIds = group.rows.map((r) => r.executionCaseId);
            const allSel = allIds.length > 0 && allIds.every((id) => selected.has(id));
            const selectedList = Array.from(selected);
            const selectedCount = selected.size;
            const pdfError = pdfErrorByGroup[group.key] ?? null;
            const pdfGenerating = pdfGeneratingByGroup[group.key] === true;
            const groupSection =
              groupMode === "date"
                ? "engagement-center-date-group"
                : groupMode === "facility"
                  ? "engagement-center-facility-group"
                  : "engagement-center-scheduler-group";
            const groupSelectAll =
              groupMode === "date"
                ? "engagement-center-date-select-all"
                : groupMode === "facility"
                  ? "engagement-center-facility-select-all"
                  : "engagement-center-scheduler-select-all";
            const groupPlexus =
              groupMode === "date"
                ? "engagement-center-date-plexus-pdf"
                : groupMode === "facility"
                  ? "engagement-center-facility-plexus-pdf"
                  : "engagement-center-scheduler-plexus-pdf";
            const groupClinician =
              groupMode === "date"
                ? "engagement-center-date-clinician-pdf"
                : groupMode === "facility"
                  ? "engagement-center-facility-clinician-pdf"
                  : "engagement-center-scheduler-clinician-pdf";
            const groupDelete =
              groupMode === "date"
                ? "engagement-center-date-delete-all"
                : groupMode === "facility"
                  ? "engagement-center-facility-delete-all"
                  : "engagement-center-scheduler-delete-all";
            const groupPatientTestId =
              groupMode === "date"
                ? "engagement-center-date-group-patient"
                : groupMode === "facility"
                  ? "engagement-center-facility-group-patient"
                  : "engagement-center-scheduler-group-patient";
            return (
              <Card
                key={group.key}
                className="overflow-hidden"
                data-testid={groupSection}
                data-group-key={group.key}
                data-group-tone={group.tone}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">{group.label}</span>
                    <span className="text-slate-400">·</span>
                    <span>{group.rows.length}</span>
                    <span
                      className="text-slate-400"
                      data-testid="engagement-center-selected-count"
                      data-group-key={group.key}
                    >
                      · {selectedCount} selected
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAllSelectedInGroup(group)}
                      className="h-7 gap-1 px-2 text-[11px]"
                      data-testid={groupSelectAll}
                      data-bar-testid="engagement-center-select-all-patients"
                    >
                      {allSel ? "Clear" : "Select All"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectedCount === 0 || pdfGenerating}
                      onClick={() => generateGroupPdf(group, selectedList, "plexus")}
                      className="h-7 gap-1 px-2 text-[11px]"
                      data-testid={groupPlexus}
                      data-bar-testid="engagement-center-plexus-pdf"
                      data-pdf-generating={pdfGenerating ? "true" : "false"}
                    >
                      {pdfGenerating ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <FileText className="h-3 w-3" />
                      )}
                      {pdfGenerating ? "Generating…" : "Plexus PDF"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectedCount === 0 || pdfGenerating}
                      onClick={() => generateGroupPdf(group, selectedList, "clinician")}
                      className="h-7 gap-1 px-2 text-[11px]"
                      data-testid={groupClinician}
                      data-bar-testid="engagement-center-clinician-pdf"
                      data-pdf-generating={pdfGenerating ? "true" : "false"}
                    >
                      {pdfGenerating ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <FileText className="h-3 w-3" />
                      )}
                      {pdfGenerating ? "Generating…" : "Clinician PDF"}
                    </Button>
                    {/* SOURCE MARKER: Engagement Center assign controls are disabled while pending */}
                    <GroupAssignPopover
                      group={group}
                      selectedExecutionCaseIds={selectedList}
                      schedulers={schedulers.data ?? []}
                      busy={assignMutation.isPending || cancelManyMutation.isPending}
                      onAssignOne={(sid) => assignSelectionToSingleScheduler(group, selectedList, sid)}
                      onDistribute={(sids) =>
                        distributeSelectionAcrossSchedulers(group, selectedList, sids)
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectedCount === 0 || cancelManyMutation.isPending}
                      onClick={() => confirmDeleteGroup(group, selectedList)}
                      className="h-7 gap-1 px-2 text-[11px] text-rose-700 border-rose-200 hover:bg-rose-50"
                      data-testid={groupDelete}
                      data-bar-testid="engagement-center-delete-group"
                      data-delete-confirm="engagement-center-delete-group-confirm"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete All
                    </Button>
                  </div>
                </div>
                {pdfError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700"
                    data-testid={
                      pdfError.kind === "validation"
                        ? "engagement-center-pdf-validation-error"
                        : "engagement-center-pdf-generation-error"
                    }
                    data-group-key={group.key}
                  >
                    <AlertCircle className="mt-[1px] h-3 w-3 flex-shrink-0" />
                    <span className="leading-snug">{pdfError.message}</span>
                  </div>
                )}
                <ul className="divide-y divide-slate-100">
                  {group.rows.map((r) => {
                    const isSelected = selected.has(r.executionCaseId);
                    return (
                      <li
                        key={r.executionCaseId}
                        className="flex items-start gap-3 px-3 py-2"
                        data-testid={groupPatientTestId}
                        data-execution-case-id={r.executionCaseId}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectInGroup(group.key, r.executionCaseId)}
                          data-testid="engagement-center-select-patient"
                          data-group-key={group.key}
                        />
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="font-medium text-slate-900 truncate">
                            {r.patientName}
                          </div>
                          <div className="text-slate-500 truncate">
                            {[r.facility, r.scheduleDate, r.engagementStatus]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                          {r.selectedServices?.length ? (
                            <div className="text-slate-400 truncate">
                              {r.selectedServices.join(", ")}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-slate-500 shrink-0 text-right">
                          <div>
                            {r.assignedName ?? "Unassigned"}
                          </div>
                          <div>{fmtRel(r.lastActivityAt)}</div>
                        </div>
                        <InlineSchedulerPicker
                          executionCaseId={r.executionCaseId}
                          patientScreeningId={r.patientScreeningId}
                          currentSchedulerId={r.assignedTeamMemberId}
                          currentSchedulerName={r.assignedName}
                          schedulers={schedulers.data ?? []}
                          busy={assignMutation.isPending}
                          onAssign={(schedulerId) => {
                            if (r.patientScreeningId != null) {
                              submitOne(r.patientScreeningId, schedulerId);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const ok = confirm(
                              `Remove this assignment from Engagement Center? The patient record stays in Plexus IQ.`,
                            );
                            if (ok) cancelManyMutation.mutate({ executionCaseIds: [r.executionCaseId] });
                          }}
                          disabled={cancelManyMutation.isPending}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                          data-testid="engagement-center-delete-patient"
                          aria-label="Remove this assignment"
                          title="Remove this assignment"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {/* Rows (flat fallback). */}
      {groupMode === "none" && (
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    data-testid="checkbox-engagement-board-select-all"
                  />
                </th>
                <th className="px-3 py-2 text-left">Patient</th>
                <th className="px-3 py-2 text-left">Facility · Date</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Assigned to</th>
                <th className="px-3 py-2 text-left">Last activity</th>
                <th className="px-3 py-2 text-left">Change</th>
              </tr>
            </thead>
            <tbody>
              {board.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-slate-500 italic">
                    <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1" />
                    Loading board…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-slate-500 italic">
                    No patients sent to Engagement yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <RowItem
                    key={r.executionCaseId}
                    row={r}
                    schedulers={schedulers.data ?? []}
                    selected={
                      r.patientScreeningId != null && selectedIds.has(r.patientScreeningId)
                    }
                    onToggle={() => toggleRow(r.patientScreeningId)}
                    onAssignOne={(schedId) =>
                      r.patientScreeningId != null && submitOne(r.patientScreeningId, schedId)
                    }
                    busy={assignMutation.isPending}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      )}
    </div>
  );
}

// Per-group bulk-assign popover. Two modes:
//   1. Assign all selected to a single scheduler.
//   2. Distribute selected evenly across N schedulers (round-robin).
// Both routes through /api/engagement/assignment-board/assign — the
// distribute path fires one call per chosen scheduler so the
// existing audit + permission flow stays intact.
//
// SOURCE MARKER: Engagement Center bulk assign selected to one scheduler
// SOURCE MARKER: Engagement Center distribute evenly across schedulers
function GroupAssignPopover({
  group,
  selectedExecutionCaseIds,
  schedulers,
  busy,
  onAssignOne,
  onDistribute,
}: {
  group: { key: string; label: string; rows: Array<{ executionCaseId: number; patientScreeningId: number | null }> };
  selectedExecutionCaseIds: number[];
  schedulers: SchedulerOption[];
  busy: boolean;
  onAssignOne: (schedulerId: number) => void;
  onDistribute: (schedulerIds: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickedOne, setPickedOne] = useState<string>("");
  const [pickedMany, setPickedMany] = useState<Set<number>>(new Set());
  const disabled = selectedExecutionCaseIds.length === 0;
  function togglePickedMany(id: number) {
    setPickedMany((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          className="h-7 gap-1 px-2 text-[11px]"
          data-testid="engagement-center-bulk-assign-trigger"
          data-bar-testid={`engagement-center-${group.key}-bulk-assign-trigger`}
          title={
            disabled
              ? "Select patients to assign"
              : `Assign ${selectedExecutionCaseIds.length} selected`
          }
        >
          <UserCog className="h-3 w-3" />
          Assign…
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[320px] p-3 space-y-3"
        data-testid="engagement-center-bulk-assign-popover"
      >
        <div className="space-y-1.5">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Assign {selectedExecutionCaseIds.length} selected to one scheduler
          </Label>
          <div className="flex items-center gap-1.5">
            <Select value={pickedOne} onValueChange={setPickedOne}>
              <SelectTrigger
                className="h-7 text-[11px] flex-1"
                data-testid="engagement-center-bulk-assign-one-select"
              >
                <SelectValue placeholder="Pick a scheduler…" />
              </SelectTrigger>
              <SelectContent>
                {schedulers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} · {s.facility}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={busy || !pickedOne}
              onClick={() => {
                const sid = Number.parseInt(pickedOne, 10);
                if (Number.isFinite(sid)) {
                  onAssignOne(sid);
                  setOpen(false);
                  setPickedOne("");
                }
              }}
              className="h-7 px-2 text-[11px]"
              data-testid="engagement-center-bulk-assign-one-save"
            >
              Assign
            </Button>
          </div>
        </div>
        <div className="space-y-1.5 border-t border-slate-100 pt-3">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Distribute evenly across multiple schedulers
          </Label>
          <div className="max-h-[180px] overflow-y-auto rounded-md border border-slate-200 bg-white">
            {schedulers.length === 0 ? (
              <div className="text-[11px] text-slate-400 italic px-2 py-1.5">
                No schedulers configured.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {schedulers.map((s) => {
                  const checked = pickedMany.has(s.id);
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 px-2 py-1.5 text-[11px]"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => togglePickedMany(s.id)}
                        data-testid="engagement-center-distribute-scheduler-checkbox"
                        data-scheduler-id={s.id}
                      />
                      <span className="min-w-0 truncate">
                        {s.name} <span className="text-slate-400">· {s.facility}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Button
            size="sm"
            disabled={busy || pickedMany.size === 0}
            onClick={() => {
              const sids = Array.from(pickedMany);
              onDistribute(sids);
              setOpen(false);
              setPickedMany(new Set());
            }}
            className="h-7 w-full gap-1 px-2 text-[11px]"
            data-testid="engagement-center-distribute-save"
          >
            <Shuffle className="h-3 w-3" />
            Distribute evenly to {pickedMany.size} scheduler{pickedMany.size === 1 ? "" : "s"}
          </Button>
          <div
            className="text-[10px] text-slate-500"
            data-testid="engagement-center-distribute-preview"
          >
            {(() => {
              if (pickedMany.size === 0) return "Pick schedulers to preview the split";
              const total = selectedExecutionCaseIds.length;
              const n = pickedMany.size;
              const base = Math.floor(total / n);
              const extra = total % n;
              // Round-robin gives `extra` schedulers (base+1) and (n - extra) schedulers (base).
              if (extra === 0) {
                return `${base} patient${base === 1 ? "" : "s"} each (${n} × ${base} = ${total})`;
              }
              return `${extra} × ${base + 1} + ${n - extra} × ${base} = ${total} (as even as possible)`;
            })()}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Compact per-row "Change" picker used in the grouped views.
// Same behavior as the flat-table RowItem Change column: click to
// open, pick a scheduler, Save calls assignMutation via the
// existing submitOne path. Disabled when the row has no
// patientScreeningId (i.e. the execution case is detached from a
// screening — assignment-board flow can't reassign it).
function InlineSchedulerPicker({
  executionCaseId,
  patientScreeningId,
  currentSchedulerId,
  currentSchedulerName,
  schedulers,
  busy,
  onAssign,
}: {
  executionCaseId: number;
  patientScreeningId: number | null;
  currentSchedulerId: number | null;
  currentSchedulerName: string | null;
  schedulers: SchedulerOption[];
  busy: boolean;
  onAssign: (schedulerId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>(
    currentSchedulerId != null ? String(currentSchedulerId) : "",
  );
  if (open) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <Select value={picked} onValueChange={setPicked}>
          <SelectTrigger
            className="h-7 text-[10px] w-[170px]"
            data-testid={`select-engagement-board-pick-${executionCaseId}`}
            data-grouped-row-testid="engagement-center-change-assignment-select"
          >
            <SelectValue placeholder="Team member" />
          </SelectTrigger>
          <SelectContent>
            {schedulers.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name} · {s.facility}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[10px]"
          disabled={busy || !picked}
          onClick={() => {
            const sid = Number.parseInt(picked, 10);
            if (Number.isFinite(sid)) {
              onAssign(sid);
              setOpen(false);
            }
          }}
          data-testid={`button-engagement-board-save-${executionCaseId}`}
          data-grouped-row-testid="engagement-center-change-assignment-save"
        >
          Save
        </Button>
        <button
          type="button"
          className="text-[10px] text-slate-500 hover:text-slate-700"
          onClick={() => setOpen(false)}
        >
          cancel
        </button>
      </div>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-[10px] gap-1 shrink-0"
      onClick={() => setOpen(true)}
      disabled={patientScreeningId == null}
      title={
        currentSchedulerName
          ? `Reassign from ${currentSchedulerName}`
          : "Assign a scheduler"
      }
      data-testid={`button-engagement-board-change-${executionCaseId}`}
      data-grouped-row-testid="engagement-center-change-assignment"
    >
      <UserCog className="h-3 w-3" />
      Change
    </Button>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "amber" | "rose";
}) {
  const toneClass: Record<typeof tone, string> = {
    slate: "bg-slate-50 text-slate-900 border-slate-200",
    emerald: "bg-emerald-50 text-emerald-900 border-emerald-200",
    amber: "bg-amber-50 text-amber-900 border-amber-200",
    rose: "bg-rose-50 text-rose-900 border-rose-200",
  };
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${toneClass[tone]}`}
      data-testid={`engagement-board-summary-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function RowItem({
  row,
  schedulers,
  selected,
  onToggle,
  onAssignOne,
  busy,
}: {
  row: BoardRow;
  schedulers: SchedulerOption[];
  selected: boolean;
  onToggle: () => void;
  onAssignOne: (schedulerId: number) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>(
    row.assignedTeamMemberId != null ? String(row.assignedTeamMemberId) : "",
  );

  const dateLabel = row.scheduleDate ?? "no date";
  const missing = row.missingInfo;

  return (
    <tr className="border-t border-slate-100 align-top" data-testid={`engagement-board-row-${row.executionCaseId}`}>
      <td className="px-3 py-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={row.patientScreeningId == null}
          data-testid={`checkbox-engagement-board-row-${row.executionCaseId}`}
        />
      </td>
      <td className="px-3 py-2">
        <div className="text-xs font-medium text-slate-900 truncate">{row.patientName}</div>
        <div className="text-[10px] text-slate-500 truncate">
          {row.patientDob ?? "—"}
          {row.phoneNumber ? ` · ${row.phoneNumber}` : ""}
        </div>
        {missing.length > 0 && (
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-rose-700">
            <AlertCircle className="h-3 w-3" />
            Missing: {missing.join(", ")}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-[11px] text-slate-700">
        {row.facility ?? "—"}
        <div className="text-[10px] text-slate-500">{dateLabel}</div>
      </td>
      <td className="px-3 py-2 text-[11px] text-slate-700">{row.patientType ?? "—"}</td>
      <td className="px-3 py-2 text-[11px] text-slate-700">{row.engagementStatus ?? "—"}</td>
      <td className="px-3 py-2 text-[11px]">
        {row.assignedName ? (
          <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-emerald-900">
            {row.assignedName}
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-900">
            Assignment pending
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-[11px] text-slate-700">
        <div>{fmtRel(row.lastActivityAt)}</div>
        {row.lastActivitySummary ? (
          <div className="text-[10px] text-slate-500 truncate max-w-[220px]">
            {row.lastActivitySummary}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2">
        {open ? (
          <div className="flex items-center gap-1.5">
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger className="h-7 text-[10px] w-[180px]" data-testid={`select-engagement-board-pick-${row.executionCaseId}`}>
                <SelectValue placeholder="Team member" />
              </SelectTrigger>
              <SelectContent>
                {schedulers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} · {s.facility}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[10px]"
              disabled={busy || !picked}
              onClick={() => {
                const sid = Number.parseInt(picked, 10);
                if (Number.isFinite(sid)) {
                  onAssignOne(sid);
                  setOpen(false);
                }
              }}
              data-testid={`button-engagement-board-save-${row.executionCaseId}`}
            >
              Save
            </Button>
            <button
              type="button"
              className="text-[10px] text-slate-500 hover:text-slate-700"
              onClick={() => setOpen(false)}
            >
              cancel
            </button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[10px] gap-1"
            onClick={() => setOpen(true)}
            disabled={row.patientScreeningId == null}
            data-testid={`button-engagement-board-change-${row.executionCaseId}`}
          >
            <UserCog className="h-3 w-3" />
            Change
          </Button>
        )}
      </td>
    </tr>
  );
}
