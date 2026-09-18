import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PenLine, FileText, Send, History, Eye, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "../portalContext";
import { BackToDashboard } from "../ClinicianPortalShell";
import {
  ServiceChip, StatusPill, SearchInput, EmptyState, PanelCard, Section,
} from "../ui/primitives";
import { DataTable, type Column } from "../ui/DataTable";
import {
  DOCUMENTS, AUDIT_EVENTS,
  type EncounterNote, type Order, type NoteStatus, type LinkedDocument, type AuditEvent,
} from "../mockData";
import { usePortalData } from "../usePortalData";
import { isClinicianPortalCanonicalDataEnabled } from "@/lib/clinicianPortalCanonicalFlag";
import { CanonicalOrdersNotesPage } from "../canonical/CanonicalOrdersNotesPage";

type NoteOverlay = { status: NoteStatus; version: number; soap: EncounterNote["soap"] | null };
type PersistedAudit = { id: string; recordId: string; type: string; actor: string; timestamp: string };
type NotesStateResponse = { overlays: Record<string, NoteOverlay>; audit: PersistedAudit[] };

const NOTES_QUERY_KEY = ["/api/clinician-portal/notes"] as const;
const PORTAL_QUERY_KEY = ["/api/clinician-portal"] as const;

const NOTE_TONE: Record<NoteStatus, "amber" | "gray" | "green"> = {
  "Needs Signature": "amber", Draft: "gray", Signed: "green",
};

const TABS = ["All", "Needs Signature", "Draft", "Pending Order Review", "Completed Study", "Signed"] as const;
type Tab = typeof TABS[number];

// Banner shown when the physician arrived via an EHR chart "Review & Sign"
// deep link. Confirms the EXACT patient-chart note that routed them here so the
// landing is note-specific, never a generic Orders & Notes dump.
function SignFocusBanner() {
  const { signFocus, clearSignFocus } = usePortal();
  if (!signFocus || (signFocus.noteId == null && !signFocus.serviceType)) return null;
  const noteLabel = signFocus.noteType === "post_procedure_note" ? "Procedure Note"
    : signFocus.noteType === "order_note" ? "Order Note" : "Note";
  const detail = [signFocus.serviceType, noteLabel].filter(Boolean).join(" · ");
  return (
    <div
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
      data-testid="sign-focus-banner"
    >
      <div className="flex items-start gap-2.5">
        <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="text-sm">
          <div className="font-semibold text-amber-900">Review &amp; Sign requested from the patient chart</div>
          <div className="text-amber-800">
            {detail}{signFocus.noteId != null ? ` · Note #${signFocus.noteId}` : ""}. Locate it in the signature worklist below to review and sign.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={clearSignFocus}
        className="text-xs font-medium text-amber-700 hover:underline"
        data-testid="sign-focus-dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}

export function OrdersNotesPage() {
  // Phase 2H — flag ON replaces the entire mock-backed body with canonical
  // document rows (no mock orders/notes; no second signing workflow). Flag OFF
  // renders the exact pre-Phase-2H legacy body below (real endpoints unchanged).
  return (
    <>
      <SignFocusBanner />
      {isClinicianPortalCanonicalDataEnabled() ? <CanonicalOrdersNotesPage /> : <LegacyOrdersNotesPage />}
    </>
  );
}

function LegacyOrdersNotesPage() {
  const { incrementSignedToday } = usePortal();
  const { toast } = useToast();
  const { data, isLoading } = usePortalData();
  const ORDERS = data?.orders ?? [];
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [attested, setAttested] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<EncounterNote["soap"] | null>(null);

  // Persisted note overlays + audit trail from the backend. Merged on top of
  // the live aggregator notes so signed/amended/drafted states survive a
  // refresh even before the aggregator refetches.
  const { data: state } = useQuery<NotesStateResponse>({ queryKey: NOTES_QUERY_KEY });
  const overlays = state?.overlays ?? {};

  const notes = useMemo<EncounterNote[]>(() => (data?.notes ?? []).map((n) => {
    const o = overlays[n.id];
    if (!o) return n;
    return {
      ...n,
      status: o.status ?? n.status,
      version: o.version ?? n.version,
      soap: o.soap ?? n.soap,
    };
  }), [data?.notes, overlays]);

  // Seed audit (empty fallback) + persisted backend events.
  const audit = useMemo<AuditEvent[]>(
    () => [...AUDIT_EVENTS, ...(state?.audit ?? [])],
    [state?.audit],
  );

  useEffect(() => {
    if (!selectedId && notes.length) setSelectedId(notes[0].id);
  }, [notes, selectedId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: PORTAL_QUERY_KEY });
  };
  const onError = (e: unknown) =>
    toast({ title: "Action failed", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });

  const signMutation = useMutation({
    mutationFn: ({ id, baseVersion }: { id: string; baseVersion: number }) =>
      apiRequest("POST", `/api/clinician-portal/notes/${id}/sign`, { baseVersion }),
    onSuccess: () => { incrementSignedToday(1); invalidate(); },
    onError,
  });
  const sendBackMutation = useMutation({
    mutationFn: ({ id, baseVersion }: { id: string; baseVersion: number }) =>
      apiRequest("POST", `/api/clinician-portal/notes/${id}/send-back`, { baseVersion }),
    onSuccess: invalidate,
    onError,
  });
  const amendMutation = useMutation({
    mutationFn: ({ id, baseVersion }: { id: string; baseVersion: number }) =>
      apiRequest("POST", `/api/clinician-portal/notes/${id}/amend`, { baseVersion }),
    onSuccess: invalidate,
    onError,
  });
  const draftMutation = useMutation({
    mutationFn: ({ id, baseVersion, soap }: { id: string; baseVersion: number; soap: EncounterNote["soap"] }) =>
      apiRequest("POST", `/api/clinician-portal/notes/${id}/draft`, { baseVersion, soap }),
    onSuccess: () => { setEditing(false); invalidate(); },
    onError,
  });
  const bulkSignMutation = useMutation({
    mutationFn: (payload: { attested: true; notes: { noteId: string; baseVersion: number }[] }) =>
      apiRequest("POST", `/api/clinician-portal/notes/bulk-sign`, payload),
    onSuccess: (_res, vars) => {
      incrementSignedToday(vars.notes.length);
      setChecked(new Set());
      setBulkOpen(false);
      setAttested(false);
      invalidate();
    },
    onError,
  });

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const matchesSearch = (patientName: string, mrn: string, service: string) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return patientName.toLowerCase().includes(q) || mrn.toLowerCase().includes(q) || service.toLowerCase().includes(q);
  };

  const visibleNotes = useMemo(() => notes.filter((n) => {
    if (!matchesSearch(n.patientName, n.mrn, n.service)) return false;
    if (tab === "Needs Signature") return n.status === "Needs Signature";
    if (tab === "Draft") return n.status === "Draft";
    if (tab === "Signed") return n.status === "Signed";
    if (tab === "Completed Study" || tab === "Pending Order Review") return false;
    return true;
  }), [notes, tab, search]);

  const visibleOrders = useMemo(() => ORDERS.filter((o) => {
    if (!matchesSearch(o.patientName, o.mrn, o.service)) return false;
    if (tab === "Pending Order Review") return o.status === "Pending Review";
    if (tab === "Completed Study") return o.status === "Completed Study";
    if (tab === "Needs Signature" || tab === "Draft" || tab === "Signed") return false;
    return true;
  }), [ORDERS, tab, search]);

  function noteVersion(id: string) {
    return notes.find((n) => n.id === id)?.version ?? 1;
  }

  function signNote(id: string) {
    signMutation.mutate({ id, baseVersion: noteVersion(id) });
  }

  function sendBack(id: string) {
    sendBackMutation.mutate({ id, baseVersion: noteVersion(id) });
  }

  function createAmendment(id: string) {
    amendMutation.mutate({ id, baseVersion: noteVersion(id) });
  }

  function confirmBulkSign() {
    const payload = {
      attested: true as const,
      notes: Array.from(checked).map((id) => ({ noteId: id, baseVersion: noteVersion(id) })),
    };
    if (payload.notes.length === 0) return;
    bulkSignMutation.mutate(payload);
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startEdit() {
    if (!selected) return;
    setEditDraft({ ...selected.soap });
    setEditing(true);
  }
  function saveDraft() {
    if (!selected || !editDraft) return;
    draftMutation.mutate({ id: selected.id, baseVersion: selected.version, soap: editDraft });
  }

  const orderColumns: Column<Order>[] = [
    { key: "patient", header: "Patient", render: (o) => <div><div>{o.patientName}</div><div className="text-xs text-finance-text-muted">{o.mrn}</div></div> },
    { key: "service", header: "Service", render: (o) => <ServiceChip service={o.service} /> },
    { key: "source", header: "Source", render: (o) => <span className="text-xs text-finance-text-secondary">{o.source}</span> },
    { key: "status", header: "Status", render: (o) => <StatusPill label={o.status} tone={o.status === "Completed Study" ? "green" : o.status === "Approved" ? "blue" : "amber"} /> },
  ];

  const checkedNeedsSig = Array.from(checked).filter((id) => notes.find((n) => n.id === id)?.status === "Needs Signature");

  return (
    <div className="space-y-6">
      <BackToDashboard />
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-finance-text">Orders & Notes</h1>
          <p className="text-sm text-finance-text-muted">Review orders, document studies, and sign encounter notes.</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        {/* Left pane */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-[14px] border border-finance-border bg-white p-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-[10px] px-3 py-1.5 text-xs font-medium transition-colors ${tab === t ? "bg-finance-dark text-white" : "text-finance-text-secondary hover:bg-finance-bg-soft"}`}
                  data-testid={`tab-${t.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <SearchInput value={search} onChange={setSearch} placeholder="Search patients…" testId="input-orders-search" className="ml-auto w-56" />
          </div>

          <Section title="Orders Queue" testId="section-orders-queue">
            {visibleOrders.length === 0 ? (
              <EmptyState message={isLoading ? "Loading orders…" : "No orders in this view."} testId="empty-orders" />
            ) : (
              <DataTable columns={orderColumns} rows={visibleOrders} rowTestId={(o) => `row-order-${o.id}`} />
            )}
          </Section>

          <Section
            title="Notes Queue"
            action={
              <Button
                size="sm"
                disabled={checkedNeedsSig.length === 0}
                onClick={() => setBulkOpen(true)}
                data-testid="button-bulk-sign"
              >
                <PenLine className="mr-1.5 h-4 w-4" /> Bulk Sign ({checkedNeedsSig.length})
              </Button>
            }
            testId="section-notes-queue"
          >
            {visibleNotes.length === 0 ? (
              <EmptyState message={isLoading ? "Loading notes…" : "No notes in this view."} testId="empty-notes" />
            ) : (
              <DataTable
                columns={[
                  { key: "patient", header: "Patient", render: (n: EncounterNote) => <div><div className={n.id === selectedId ? "font-semibold" : ""}>{n.patientName}</div><div className="text-xs text-finance-text-muted">{n.mrn}</div></div> },
                  { key: "service", header: "Service", render: (n) => <ServiceChip service={n.service} /> },
                  { key: "encounter", header: "Encounter", render: (n) => n.encounterDate },
                  { key: "author", header: "Author", render: (n) => <span className="text-xs">{n.author}</span> },
                  { key: "status", header: "Status", render: (n) => <StatusPill label={n.status} tone={NOTE_TONE[n.status]} /> },
                ]}
                rows={visibleNotes}
                onRowClick={(n) => { setSelectedId(n.id); setEditing(false); }}
                rowTestId={(n) => `row-note-${n.id}`}
                selectable
                selectedIds={checked}
                onToggle={toggle}
              />
            )}
          </Section>
        </div>

        {/* Right pane — note editor */}
        <div className="space-y-4">
          <NoteEditor
            note={selected}
            editing={editing}
            editDraft={editDraft}
            onEditField={(k, v) => setEditDraft((d) => (d ? { ...d, [k]: v } : d))}
            onStartEdit={startEdit}
            onSaveDraft={saveDraft}
            onCancelEdit={() => setEditing(false)}
            onSign={() => selected && signNote(selected.id)}
            onSendBack={() => selected && sendBack(selected.id)}
            onAmend={() => selected && createAmendment(selected.id)}
          />
          {selected && <LinkedDocumentsPanel patientName={selected.patientName} />}
          {selected && <AuditTimeline recordId={selected.id} events={audit} />}
        </div>
      </div>

      {/* Bulk sign modal */}
      <Dialog open={bulkOpen} onOpenChange={(o) => { setBulkOpen(o); if (!o) setAttested(false); }}>
        <DialogContent data-testid="dialog-bulk-sign">
          <DialogHeader><DialogTitle>Bulk Sign Notes</DialogTitle></DialogHeader>
          <p className="text-sm text-finance-text-muted">You are about to sign {checkedNeedsSig.length} encounter note(s). Signing locks each note.</p>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-[10px] border border-finance-border bg-finance-bg-soft p-2">
            {checkedNeedsSig.map((id) => {
              const n = notes.find((x) => x.id === id)!;
              return (
                <div key={id} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm">
                  <span>{n.patientName}</span>
                  <ServiceChip service={n.service} />
                </div>
              );
            })}
          </div>
          <label className="flex items-start gap-2 text-sm text-finance-text">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 h-4 w-4 accent-finance-periwinkle" data-testid="checkbox-attestation" />
            I attest that I have reviewed each note and the documentation accurately reflects the encounter.
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} data-testid="button-bulk-cancel">Cancel</Button>
            <Button disabled={!attested} onClick={confirmBulkSign} data-testid="button-bulk-confirm">Sign {checkedNeedsSig.length} Note(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function nowStamp() {
  return "2026-06-25 " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function NoteEditor({
  note, editing, editDraft, onEditField, onStartEdit, onSaveDraft, onCancelEdit, onSign, onSendBack, onAmend,
}: {
  note: EncounterNote | null;
  editing: boolean;
  editDraft: EncounterNote["soap"] | null;
  onEditField: (k: keyof EncounterNote["soap"], v: string) => void;
  onStartEdit: () => void;
  onSaveDraft: () => void;
  onCancelEdit: () => void;
  onSign: () => void;
  onSendBack: () => void;
  onAmend: () => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  if (!note) return <EmptyState message="Select a note to view details." testId="empty-note-editor" />;
  const locked = note.status === "Signed";
  const soap = editing && editDraft ? editDraft : note.soap;
  // Edit mode shows inline fields; Preview (during edit) and read/signed show
  // the continuous read-only document.
  const showFields = editing && !locked && !previewing;
  const sections: { key: keyof EncounterNote["soap"]; label: string }[] = [
    { key: "subjective", label: "Subjective" },
    { key: "objective", label: "Objective" },
    { key: "assessment", label: "Assessment" },
    { key: "plan", label: "Plan" },
  ];

  return (
    <div className="overflow-hidden rounded-[16px] border border-finance-border bg-white" data-testid="panel-note-editor">
      {/* ── Sticky note toolbar ── */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-finance-border bg-white/85 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-finance-text-muted" />
          <span className="truncate text-sm font-semibold text-finance-text">Encounter Note</span>
          <span className="truncate text-xs text-finance-text-muted">· {note.patientName} · {note.mrn}</span>
          <StatusPill label={note.status} tone={NOTE_TONE[note.status]} />
          {note.version > 1 && <span className="text-xs text-finance-text-muted">v{note.version}</span>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Edit | Preview segmented control (hidden once signed). */}
          {!locked && (
            <div className="flex rounded-[10px] border border-finance-border p-0.5">
              <button
                type="button"
                onClick={() => { setPreviewing(false); if (!editing) onStartEdit(); }}
                className={`rounded-[8px] px-2.5 py-1 text-xs font-medium transition-colors ${showFields ? "bg-finance-dark text-white" : "text-finance-text-secondary hover:bg-finance-bg-soft"}`}
                data-testid="button-edit-note"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setPreviewing(true)}
                className={`rounded-[8px] px-2.5 py-1 text-xs font-medium transition-colors ${!showFields ? "bg-finance-dark text-white" : "text-finance-text-secondary hover:bg-finance-bg-soft"}`}
                data-testid="button-preview-note"
              >
                Preview
              </button>
            </div>
          )}
          {locked ? (
            <>
              <StatusPill label="Locked — Signed" tone="green" />
              <Button size="sm" variant="outline" onClick={onAmend} data-testid="button-create-amendment"><FileText className="mr-1.5 h-4 w-4" /> Create Amendment</Button>
              <Button size="sm" variant="ghost" data-testid="button-version-history"><History className="mr-1.5 h-4 w-4" /> History</Button>
            </>
          ) : editing ? (
            <>
              <Button size="sm" onClick={onSaveDraft} data-testid="button-save-draft">Save Draft</Button>
              <Button size="sm" variant="outline" onClick={() => { setPreviewing(false); onCancelEdit(); }} data-testid="button-done-editing">Done</Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={onSign} data-testid="button-sign-note"><PenLine className="mr-1.5 h-4 w-4" /> Sign</Button>
              <Button size="sm" variant="outline" onClick={onSendBack} data-testid="button-send-back"><Send className="mr-1.5 h-4 w-4" /> Send Back</Button>
              <Button size="sm" variant="ghost" data-testid="button-version-history-2"><History className="mr-1.5 h-4 w-4" /> History</Button>
            </>
          )}
        </div>
      </div>

      {/* ── Document canvas: white page on a pale winter surround ── */}
      <div className="max-h-[70vh] overflow-y-auto bg-[#eef4fb] p-4 sm:p-6">
        <article className="mx-auto max-w-[720px] rounded-[12px] bg-white px-7 py-7 sm:px-10 sm:py-9 shadow-sm ring-1 ring-slate-200/70">
          {/* Document masthead */}
          <div className="mb-5 border-b border-slate-100 pb-4">
            <div className="text-[17px] font-semibold text-finance-text">{note.patientName}</div>
            <div className="mt-0.5 text-xs text-finance-text-muted">
              {note.mrn} · {note.age}{note.gender} · Encounter {note.encounterDate} · {note.service}
            </div>
          </div>

          {/* Vitals — a compact inline strip, not boxed cards */}
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#3169E8]">Vitals</h3>
          <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-finance-text">
            {Object.entries(note.vitals).map(([k, v]) => (
              <span key={k}><span className="uppercase text-[11px] text-finance-text-muted">{k} </span><span className="tabular-nums">{v}</span></span>
            ))}
          </div>

          {/* SOAP — continuous document headings, not separate editors */}
          {sections.map((s) => (
            <section key={s.key} className="mb-5">
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#3169E8]">{s.label}</h3>
              {showFields ? (
                <Textarea
                  value={soap[s.key]}
                  onChange={(e) => onEditField(s.key, e.target.value)}
                  className="min-h-[72px] resize-y border-0 bg-transparent p-0 text-[13.5px] leading-[1.7] text-finance-text shadow-none focus-visible:ring-0"
                  style={{ boxShadow: "none" }}
                  data-testid={`textarea-${s.key}`}
                />
              ) : (
                <p className="whitespace-pre-wrap text-[13.5px] leading-[1.7] text-finance-text">{soap[s.key] || "—"}</p>
              )}
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

function LinkedDocumentsPanel({ patientName }: { patientName: string }) {
  const docs = DOCUMENTS.filter((d) => d.patientName === patientName);
  return (
    <PanelCard testId="panel-linked-documents">
      <div className="border-b border-finance-border px-4 py-3 text-sm font-semibold text-finance-text">Linked Documents</div>
      {docs.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-finance-text-muted">No linked documents.</div>
      ) : (
        <div className="divide-y divide-finance-border/60">
          {docs.map((d: LinkedDocument) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5" data-testid={`doc-${d.id}`}>
              <div className="min-w-0">
                <div className="truncate text-sm text-finance-text">{d.type}</div>
                <div className="flex items-center gap-2 text-xs text-finance-text-muted">
                  <ServiceChip service={d.service} />
                  <span>{d.date}{d.signedBy ? ` · ${d.signedBy}` : ""}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusPill label={d.status} tone={d.status === "On File" ? "gray" : "green"} />
                <button className="text-finance-text-muted hover:text-finance-periwinkle" data-testid={`button-view-doc-${d.id}`}><Eye className="h-4 w-4" /></button>
                <button className="text-finance-text-muted hover:text-finance-periwinkle" data-testid={`button-download-doc-${d.id}`}><Download className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function AuditTimeline({ recordId, events }: { recordId: string; events: AuditEvent[] }) {
  const items = events.filter((e) => e.recordId === recordId);
  return (
    <PanelCard testId="panel-audit-timeline">
      <div className="border-b border-finance-border px-4 py-3 text-sm font-semibold text-finance-text">Audit Trail</div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-finance-text-muted">No audit events yet.</div>
      ) : (
        <ol className="space-y-3 p-4">
          {items.map((e) => (
            <li key={e.id} className="flex gap-3" data-testid={`audit-${e.id}`}>
              <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-finance-periwinkle" />
              <div>
                <div className="text-sm text-finance-text">{e.type}</div>
                <div className="text-xs text-finance-text-muted">{e.actor} · {e.timestamp}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </PanelCard>
  );
}
