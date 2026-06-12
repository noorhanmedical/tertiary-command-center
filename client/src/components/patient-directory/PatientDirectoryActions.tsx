// Patient Directory action dialogs (Parts 8 / 9 / 10).
//
// Reachable from PatientDirectoryLivePage row menus / profile drawer:
//   - BulkImportDialog (Part 8): paste CSV/TXT → preview classifier → confirm
//   - DncCooldownDialog (Part 9): set/clear DNC; set/clear cooldown
//   - AddPriorTestDialog (Part 10): record an ancillary test on file
//
// All three call the activation-flag-gated routes through the existing
// patientDirectoryApi helpers. When the flag is OFF the calls return
// 404 and the dialogs surface the error via toast without crashing.

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  addPriorTest,
  clearCooldown,
  clearDoNotContact,
  importConfirm,
  importPreview,
  setCooldown,
  setDoNotContact,
} from "@/lib/patientDirectoryApi";
import { COOLDOWN_PRESET_LABEL, endsAtForPreset, type CooldownPreset } from "../../../../shared/contactRestrictions";

// ─── Bulk Import ─────────────────────────────────────────────────────────

export function BulkImportDialog({
  open,
  onOpenChange,
  batchId,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: number;
  onComplete?: (createdIds: number[]) => void;
}) {
  const [format, setFormat] = useState<"csv" | "txt">("csv");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReadonlyArray<{
    rowIndex: number;
    identity: { name?: string | null; dob?: string | null; mrn?: string | null; facility?: string | null; phoneNumber?: string | null };
    classifications: ReadonlyArray<string>;
    missingFields: ReadonlyArray<string>;
    selected: boolean;
  }>>([]);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function runPreview() {
    setBusy(true);
    try {
      const res = await importPreview({ format, text });
      setPreview(res.rows as never);
    } catch (e) {
      toast({ title: "Preview failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function toggle(rowIndex: number) {
    setPreview((rows) => rows.map((r) => (r.rowIndex === rowIndex ? { ...r, selected: !r.selected } : r)));
  }

  async function confirmImport() {
    const selected = preview
      .filter((r) => r.selected && !r.classifications.includes("missing_required_fields"))
      .map((r) => ({
        identity: {
          name: r.identity.name ?? null,
          dob: r.identity.dob ?? null,
          mrn: r.identity.mrn ?? null,
          facility: r.identity.facility ?? null,
          phoneNumber: r.identity.phoneNumber ?? null,
        },
        patientType: undefined as "visit" | "outreach" | undefined,
      }));
    if (selected.length === 0) {
      toast({ title: "Nothing to import", description: "Select at least one valid row." });
      return;
    }
    setBusy(true);
    try {
      const res = await importConfirm({ batchId, selected });
      toast({ title: "Imported", description: `${res.createdIds.length} patient(s) created.` });
      onComplete?.(res.createdIds);
      onOpenChange(false);
      setText("");
      setPreview([]);
    } catch (e) {
      toast({ title: "Import failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="patient-directory-bulk-import-dialog">
        <DialogHeader>
          <DialogTitle>Bulk import — Patient Directory</DialogTitle>
          <DialogDescription>
            CSV with headers (name, dob, mrn, facility, phone), or pipe-separated TXT
            (Name | DOB | Phone | Facility | MRN). DOC / DOCX / PDF parsing not supported.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-[12px]">
          <Label>Format:</Label>
          <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "txt")} className="rounded border border-slate-200 px-2 py-1">
            <option value="csv">CSV</option>
            <option value="txt">TXT</option>
          </select>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={format === "csv" ? "name,dob,phone,mrn,facility\nJane Doe,1980-05-12,..." : "Jane Doe | 1980-05-12 | 2025550101 | Plexus Cary | M-1"}
          className="font-mono text-[12px]"
          data-testid="patient-directory-bulk-import-text"
        />

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" onClick={runPreview} disabled={busy || text.trim().length === 0} data-testid="patient-directory-bulk-import-preview">
            Preview
          </Button>
          <div className="text-[11px] text-slate-500">{preview.length} row(s) parsed</div>
        </div>

        {preview.length > 0 && (
          <div className="max-h-[40vh] overflow-y-auto rounded border border-slate-200" data-testid="patient-directory-bulk-import-preview-list">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-2 py-1">✓</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">DOB</th>
                  <th className="px-2 py-1">Facility</th>
                  <th className="px-2 py-1">MRN</th>
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.rowIndex} className="border-t border-slate-200">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={() => toggle(r.rowIndex)}
                        disabled={r.classifications.includes("missing_required_fields")}
                        data-testid={`patient-directory-bulk-import-row-${r.rowIndex}`}
                      />
                    </td>
                    <td className="px-2 py-1">{r.identity.name ?? "—"}</td>
                    <td className="px-2 py-1">{r.identity.dob ?? "—"}</td>
                    <td className="px-2 py-1">{r.identity.facility ?? "—"}</td>
                    <td className="px-2 py-1">{r.identity.mrn ?? "—"}</td>
                    <td className="px-2 py-1 space-x-1">
                      {r.classifications.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={confirmImport}
            disabled={busy || preview.length === 0}
            className="rounded-full bg-indigo-600 px-4 text-white hover:bg-indigo-700 disabled:opacity-40"
            data-testid="patient-directory-bulk-import-confirm"
          >
            Confirm import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── DNC + cooldown ──────────────────────────────────────────────────────

export function DncCooldownDialog({
  open,
  onOpenChange,
  patientScreeningId,
  currentDnc,
  currentCooldownActive,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientScreeningId: number;
  currentDnc?: boolean;
  currentCooldownActive?: boolean;
  onComplete?: () => void;
}) {
  const [dncReason, setDncReason] = useState("");
  const [cdPreset, setCdPreset] = useState<Exclude<CooldownPreset, "custom">>("30d");
  const [cdReason, setCdReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function applyDnc(action: "set" | "clear") {
    setBusy(true);
    try {
      if (action === "set") await setDoNotContact(patientScreeningId, dncReason || null);
      else await clearDoNotContact(patientScreeningId);
      toast({ title: action === "set" ? "DNC set" : "DNC cleared" });
      onComplete?.();
    } catch (e) {
      toast({ title: "DNC update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function applyCooldown(action: "set" | "clear") {
    setBusy(true);
    try {
      if (action === "set") {
        const endsAt = endsAtForPreset(new Date(), cdPreset).toISOString();
        await setCooldown(patientScreeningId, endsAt, cdReason || null);
      } else {
        await clearCooldown(patientScreeningId);
      }
      toast({ title: action === "set" ? "Cooldown set" : "Cooldown cleared" });
      onComplete?.();
    } catch (e) {
      toast({ title: "Cooldown update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="patient-directory-dnc-cooldown-dialog">
        <DialogHeader>
          <DialogTitle>Contact restrictions</DialogTitle>
          <DialogDescription>DNC blocks outreach. Active cooldown blocks outreach until the end date.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[12px]">
          <section className="rounded-xl border border-slate-200 p-3">
            <div className="mb-1 flex items-center justify-between">
              <Label className="font-semibold">Do Not Contact</Label>
              {currentDnc ? <Badge className="bg-rose-100 text-rose-800 border-rose-200">Active</Badge> : <Badge variant="secondary">Off</Badge>}
            </div>
            <Input value={dncReason} onChange={(e) => setDncReason(e.target.value)} placeholder="Reason (optional)" data-testid="patient-directory-dnc-reason" />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => applyDnc("clear")} disabled={busy} data-testid="patient-directory-dnc-clear">Clear DNC</Button>
              <Button size="sm" onClick={() => applyDnc("set")} disabled={busy} data-testid="patient-directory-dnc-set">Set DNC</Button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-3">
            <div className="mb-1 flex items-center justify-between">
              <Label className="font-semibold">Cooldown</Label>
              {currentCooldownActive ? <Badge className="bg-rose-100 text-rose-800 border-rose-200">Active</Badge> : <Badge variant="secondary">Off</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <select value={cdPreset} onChange={(e) => setCdPreset(e.target.value as never)} className="rounded border border-slate-200 px-2 py-1 text-[12px]" data-testid="patient-directory-cooldown-preset">
                {(["30d", "60d", "90d", "6m", "12m"] as const).map((p) => (
                  <option key={p} value={p}>{COOLDOWN_PRESET_LABEL[p]}</option>
                ))}
              </select>
              <Input value={cdReason} onChange={(e) => setCdReason(e.target.value)} placeholder="Reason (optional)" data-testid="patient-directory-cooldown-reason" />
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => applyCooldown("clear")} disabled={busy} data-testid="patient-directory-cooldown-clear">Clear cooldown</Button>
              <Button size="sm" onClick={() => applyCooldown("set")} disabled={busy} data-testid="patient-directory-cooldown-set">Set cooldown</Button>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add prior ancillary test ────────────────────────────────────────────

export function AddPriorTestDialog({
  open,
  onOpenChange,
  patientScreeningId,
  patientName,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientScreeningId: number;
  patientName: string;
  onComplete?: () => void;
}) {
  const [testName, setTestName] = useState("");
  const [dateOfService, setDateOfService] = useState("");
  const [facility, setFacility] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function save() {
    if (!testName) {
      toast({ title: "Test name required" });
      return;
    }
    setBusy(true);
    try {
      await addPriorTest(patientScreeningId, {
        patientName,
        testName,
        dateOfService: dateOfService || null,
        facility: facility || null,
        source: source || null,
        notes: notes || null,
      });
      toast({ title: "Prior test added" });
      onComplete?.();
      onOpenChange(false);
      setTestName(""); setDateOfService(""); setFacility(""); setSource(""); setNotes("");
    } catch (e) {
      toast({ title: "Could not add prior test", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="patient-directory-add-prior-test-dialog">
        <DialogHeader>
          <DialogTitle>Add prior ancillary test</DialogTitle>
          <DialogDescription>Records the test in patient_test_history and writes a prior_test_added audit event.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-[12px]">
          <div>
            <Label>Test name *</Label>
            <Input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="e.g. Echocardiogram TTE" data-testid="patient-directory-add-prior-test-name" />
          </div>
          <div>
            <Label>Date of service</Label>
            <Input type="date" value={dateOfService} onChange={(e) => setDateOfService(e.target.value)} data-testid="patient-directory-add-prior-test-date" />
          </div>
          <div>
            <Label>Facility</Label>
            <Input value={facility} onChange={(e) => setFacility(e.target.value)} data-testid="patient-directory-add-prior-test-facility" />
          </div>
          <div>
            <Label>Source</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. outside imaging center" data-testid="patient-directory-add-prior-test-source" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="patient-directory-add-prior-test-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="patient-directory-add-prior-test-save">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
