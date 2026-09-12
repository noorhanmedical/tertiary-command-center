// Unified Add / Edit Patient dialog for Plexus EHR.
//
// ONE form, two input methods for Add (Enter Manually | Paste Patient Data),
// plus an Edit mode. All writes go through the canonical patient endpoints:
//   POST  /api/patients/canonical/parse-draft   (smart paste → draft, no write)
//   POST  /api/patients/canonical               (create; 409 on duplicate)
//   PATCH /api/patients/canonical/:id           (update; 409 on identity collision)
// No parsing/identity/dedup logic lives here — the server owns it.

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { VALID_FACILITIES } from "@shared/plexus";
import { Loader2, Plus, Save, ClipboardPaste, PencilLine, AlertTriangle } from "lucide-react";

type Draft = {
  name: string; dob: string; gender: string; phoneNumber: string; email: string;
  address: string; mrn: string; insurance: string; memberId: string; facility: string;
  provider: string; diagnoses: string; medications: string; history: string; allergies: string; notes: string;
};
const EMPTY: Draft = {
  name: "", dob: "", gender: "", phoneNumber: "", email: "", address: "", mrn: "",
  insurance: "", memberId: "", facility: "", provider: "", diagnoses: "", medications: "", history: "", allergies: "", notes: "",
};

type Ambiguity = { field: string; candidates: Array<{ label: string; value: string }> };
type DuplicateInfo = { screeningId: number; name: string; dob: string | null; mrn: string | null; facility: string | null; phone: string | null; matchTier: string };

export type EditPatientSeed = Partial<Draft> & { screeningId: number };

export function AddEditPatientDialog({
  open, onOpenChange, mode, seed, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "add" | "edit";
  seed?: EditPatientSeed | null;
  onSaved?: (screeningId: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"manual" | "paste">("manual");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ambiguities, setAmbiguities] = useState<Ambiguity[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [collision, setCollision] = useState<DuplicateInfo | null>(null);

  useEffect(() => {
    if (open) {
      if (mode === "edit" && seed) setDraft({ ...EMPTY, ...stripSeed(seed) });
      else setDraft(EMPTY);
      setTab("manual"); setPasteText(""); setAmbiguities([]); setWarnings([]); setDuplicate(null); setCollision(null);
    }
  }, [open, mode, seed]);

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const parsePaste = async () => {
    if (!pasteText.trim()) return;
    setParsing(true); setAmbiguities([]); setWarnings([]);
    try {
      const res = await apiRequest("POST", "/api/patients/canonical/parse-draft", { text: pasteText });
      const data = await res.json();
      const d = data.draft ?? {};
      setDraft((prev) => ({
        ...prev,
        name: d.name ?? "", dob: d.dob ?? "", gender: d.gender ?? "", phoneNumber: d.phoneNumber ?? "",
        email: d.email ?? "", address: d.address ?? "", mrn: d.mrn ?? "", insurance: d.insurance ?? "",
        memberId: d.memberId ?? "", facility: prev.facility || d.facility || "", provider: d.provider ?? "",
        diagnoses: d.diagnoses ?? "", medications: d.medications ?? "", history: d.history ?? "", allergies: d.allergies ?? "", notes: d.notes ?? "",
      }));
      setAmbiguities(Array.isArray(data.ambiguities) ? data.ambiguities : []);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setTab("manual"); // drop into the review form
      toast({ title: `Parsed (${data.method})`, description: "Review the extracted fields before saving." });
    } catch (e) {
      toast({ title: "Couldn't parse", description: e instanceof Error ? e.message : "Parse failed", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const applyAmbiguity = (field: string, value: string) => {
    const key = field === "mrn" ? "mrn" : field === "phone" ? "phoneNumber" : field;
    if (key in EMPTY) set(key as keyof Draft, value);
    setAmbiguities((prev) => prev.filter((a) => a.field !== field));
  };

  const save = async (force = false) => {
    if (!draft.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (mode === "add" && !draft.facility) { toast({ title: "Facility is required", variant: "destructive" }); return; }
    setSaving(true); setDuplicate(null); setCollision(null);
    try {
      if (mode === "add") {
        const res = await apiRequest("POST", "/api/patients/canonical", {
          draft: toApiDraft(draft),
          sourceType: pasteText.trim() ? "manual_paste" : "manual",
          force,
        });
        const data = await res.json();
        finishSuccess(data.patient?.id);
      } else if (seed) {
        const res = await apiRequest("PATCH", `/api/patients/canonical/${seed.screeningId}`, {
          updates: toApiDraft(draft), force,
        });
        const data = await res.json();
        finishSuccess(data.patient?.id ?? seed.screeningId);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          const body = JSON.parse(e.body);
          if (body.duplicate) { setDuplicate(body.duplicate); setSaving(false); return; }
          if (body.collision) { setCollision(body.collision); setSaving(false); return; }
        } catch { /* fall through */ }
      }
      toast({ title: mode === "add" ? "Could not add patient" : "Could not save changes", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const finishSuccess = (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["/api/patients/database"] });
    queryClient.invalidateQueries({ queryKey: ["/api/patients/database/cooldown-summary"] });
    toast({ title: mode === "add" ? "Patient added" : "Patient updated" });
    if (id && onSaved) onSaved(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-add-edit-patient">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "add" ? <><Plus className="w-4 h-4" /> Add Patient</> : <><PencilLine className="w-4 h-4" /> Edit Patient</>}
          </DialogTitle>
          <DialogDescription>
            {mode === "add" ? "Enter a patient manually or paste patient information to auto-fill, then review before saving." : "Update patient demographics. Identity-sensitive changes are checked for collisions."}
          </DialogDescription>
        </DialogHeader>

        {mode === "add" && (
          <div className="flex gap-2 border-b pb-2">
            <Button size="sm" variant={tab === "manual" ? "default" : "outline"} onClick={() => setTab("manual")} data-testid="tab-manual"><PencilLine className="w-3.5 h-3.5 mr-1" />Enter Manually</Button>
            <Button size="sm" variant={tab === "paste" ? "default" : "outline"} onClick={() => setTab("paste")} data-testid="tab-paste"><ClipboardPaste className="w-3.5 h-3.5 mr-1" />Paste Patient Data</Button>
          </div>
        )}

        {mode === "add" && tab === "paste" && (
          <div className="space-y-2 py-1">
            <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8} placeholder={"Paste patient information from any source — referral, chart, insurance portal, spreadsheet row…"} className="text-sm font-mono" data-testid="textarea-paste-patient" />
            <Button size="sm" onClick={parsePaste} disabled={!pasteText.trim() || parsing} data-testid="button-parse-patient">
              {parsing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ClipboardPaste className="w-3 h-3 mr-1" />} Parse Patient
            </Button>
            <p className="text-[11px] text-muted-foreground">Parsing extracts a draft into the form. Nothing is saved until you review and click {mode === "add" ? "Add Patient" : "Save"}.</p>
          </div>
        )}

        {(mode === "edit" || tab === "manual") && (
          <div className="space-y-3 py-1">
            {ambiguities.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 space-y-2" data-testid="ambiguities">
                <div className="text-xs font-semibold text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Ambiguous fields — choose the correct value</div>
                {ambiguities.map((a) => (
                  <div key={a.field} className="text-xs">
                    <span className="font-medium capitalize">{a.field}:</span>
                    <span className="ml-2 inline-flex flex-wrap gap-1">
                      {a.candidates.map((c) => (
                        <Button key={c.label} size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => applyAmbiguity(a.field, c.value)} data-testid={`ambiguity-${a.field}-${c.value}`}>
                          {c.label}: {c.value}
                        </Button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="text-[11px] text-amber-700">{warnings.join(" · ")}</div>
            )}

            <Section title="Patient">
              <Field label="Name *"><Input value={draft.name} onChange={(e) => set("name", e.target.value)} data-testid="field-name" /></Field>
              <Field label="DOB"><Input value={draft.dob} onChange={(e) => set("dob", e.target.value)} placeholder="YYYY-MM-DD" data-testid="field-dob" /></Field>
              <Field label="Sex"><Input value={draft.gender} onChange={(e) => set("gender", e.target.value)} data-testid="field-gender" /></Field>
              <Field label="MRN"><Input value={draft.mrn} onChange={(e) => set("mrn", e.target.value)} data-testid="field-mrn" /></Field>
            </Section>
            <Section title="Contact">
              <Field label="Phone"><Input value={draft.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value)} data-testid="field-phone" /></Field>
              <Field label="Email"><Input value={draft.email} onChange={(e) => set("email", e.target.value)} data-testid="field-email" /></Field>
              <Field label="Address" wide><Input value={draft.address} onChange={(e) => set("address", e.target.value)} data-testid="field-address" /></Field>
            </Section>
            <Section title="Facility / Provider">
              <Field label="Facility *">
                <Select value={draft.facility} onValueChange={(v) => set("facility", v)}>
                  <SelectTrigger className="h-9" data-testid="field-facility"><SelectValue placeholder="Select facility…" /></SelectTrigger>
                  <SelectContent>{VALID_FACILITIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Provider"><Input value={draft.provider} onChange={(e) => set("provider", e.target.value)} data-testid="field-provider" /></Field>
            </Section>
            <Section title="Insurance">
              <Field label="Payer"><Input value={draft.insurance} onChange={(e) => set("insurance", e.target.value)} data-testid="field-insurance" /></Field>
              <Field label="Member ID"><Input value={draft.memberId} onChange={(e) => set("memberId", e.target.value)} data-testid="field-memberid" /></Field>
            </Section>
            <Section title="Clinical">
              <Field label="Diagnoses" wide><Input value={draft.diagnoses} onChange={(e) => set("diagnoses", e.target.value)} data-testid="field-diagnoses" /></Field>
              <Field label="Medications" wide><Input value={draft.medications} onChange={(e) => set("medications", e.target.value)} data-testid="field-medications" /></Field>
              <Field label="History" wide><Input value={draft.history} onChange={(e) => set("history", e.target.value)} data-testid="field-history" /></Field>
              <Field label="Allergies" wide><Input value={draft.allergies} onChange={(e) => set("allergies", e.target.value)} data-testid="field-allergies" /></Field>
            </Section>
          </div>
        )}

        {/* Duplicate (add) */}
        {duplicate && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs space-y-2" data-testid="duplicate-warning">
            <div className="font-semibold text-amber-800 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Potential existing patient</div>
            <div>{duplicate.name} · DOB {duplicate.dob ?? "—"} · MRN {duplicate.mrn ?? "—"} · {duplicate.facility ?? "—"} <Badge variant="outline" className="ml-1">{duplicate.matchTier}</Badge></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onSaved?.(duplicate.screeningId)} data-testid="button-view-existing">View Existing</Button>
              <Button size="sm" variant="outline" onClick={() => setDuplicate(null)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={() => save(true)} data-testid="button-create-as-new">Create As New</Button>
            </div>
          </div>
        )}
        {/* Collision (edit) */}
        {collision && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs space-y-2" data-testid="collision-warning">
            <div className="font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> This change collides with another patient</div>
            <div>{collision.name} · DOB {collision.dob ?? "—"} · MRN {collision.mrn ?? "—"} · {collision.facility ?? "—"} <Badge variant="outline" className="ml-1">{collision.matchTier}</Badge></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setCollision(null)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={() => save(true)} data-testid="button-save-anyway">Save Anyway</Button>
            </div>
          </div>
        )}

        {!duplicate && !collision && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={() => save(false)} data-testid="button-save-patient">
              {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : mode === "add" ? <Plus className="w-3 h-3 mr-1" /> : <Save className="w-3 h-3 mr-1" />}
              {mode === "add" ? "Add Patient" : "Save Changes"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{title}</div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <Label className="text-[11px] text-slate-500">{label}</Label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function toApiDraft(d: Draft) {
  return {
    name: d.name.trim(), dob: emptyNull(d.dob), gender: emptyNull(d.gender), phoneNumber: emptyNull(d.phoneNumber),
    email: emptyNull(d.email), address: emptyNull(d.address), mrn: emptyNull(d.mrn), insurance: emptyNull(d.insurance),
    memberId: emptyNull(d.memberId), facility: emptyNull(d.facility), provider: emptyNull(d.provider),
    diagnoses: emptyNull(d.diagnoses), medications: emptyNull(d.medications), history: emptyNull(d.history),
    allergies: emptyNull(d.allergies), notes: emptyNull(d.notes),
  };
}
function emptyNull(v: string): string | null { const t = v.trim(); return t.length ? t : null; }
function stripSeed(seed: EditPatientSeed): Partial<Draft> {
  const { screeningId, ...rest } = seed; void screeningId; return rest;
}
