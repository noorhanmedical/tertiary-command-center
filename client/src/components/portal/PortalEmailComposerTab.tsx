import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, FileText, AlertTriangle } from "lucide-react";
import {
  SketchSurface,
  SketchInput,
  SketchTextarea,
  SketchButton,
} from "@/components/playground/sketch/SketchPrimitives";
import {
  fetchMarketingMaterials,
  sendMarketingMaterial,
  sendOutreachEmail,
} from "@/lib/portal/commandCenterApi";
import { useToast } from "@/hooks/use-toast";

// Email Composer — center-canvas surface for the Team Portal left-rail
// Email tool.
//
// Backend state:
//   - /api/outreach/send-email   → Live (nodemailer + SMTP)
//   - /api/outreach/send-material → Live (nodemailer + SMTP)
//   - SMTP env activation required: SMTP_HOST, SMTP_PORT, SMTP_USER,
//     SMTP_PASS, SMTP_FROM. Without them the backend returns 502 with
//     "Email is not configured ..." — this component surfaces that
//     error literally rather than faking a sent state.
//
// Send modes:
//   - 0 attached materials → POST /api/outreach/send-email with the
//     composer's subject/body verbatim.
//   - 1+ attached materials → loop POST /api/outreach/send-material
//     once per material so each brochure attaches with its canonical
//     filename/contentType from server/services/marketingMaterials.ts.
//     This preserves the existing send semantics; we don't invent a
//     new multi-attachment endpoint.

type MarketingMaterial = {
  id: string | number;
  title: string;
  description: string | null;
  filename: string;
};

export type PortalEmailComposerSelectedPatient = {
  patientScreeningId: number;
  name: string;
  email?: string | null;
};

export function PortalEmailComposerTab({
  selectedPatient,
  preAttachedMaterialIds,
  onClearPreAttached,
  prefilledTemplate,
  onClearPrefilledTemplate,
}: {
  selectedPatient: PortalEmailComposerSelectedPatient | null;
  /** Material IDs handed off from the Marketing tool via the Compose
   *  Email handoff button. Replaces the local attachment state when
   *  non-null. */
  preAttachedMaterialIds?: ReadonlyArray<string | number> | null;
  /** Called after the composer adopts the pre-attached materials so
   *  the upstream handoff state can be cleared. */
  onClearPreAttached?: () => void;
  /** Subject + body handed off from the Templates / Staff Resources
   *  tool via "Insert into composer". Replaces the local subject + body
   *  state when non-null. */
  prefilledTemplate?: { subject: string; body: string } | null;
  /** Called after the composer adopts the prefilled template. */
  onClearPrefilledTemplate?: () => void;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachedIds, setAttachedIds] = useState<Set<string | number>>(new Set());

  // Adopt the prefilled template handed off from Templates / Resources.
  useEffect(() => {
    if (prefilledTemplate) {
      setSubject(prefilledTemplate.subject);
      setBody(prefilledTemplate.body);
      setAttachedIds(new Set()); // templates + brochures are mutually exclusive
      onClearPrefilledTemplate?.();
    }
  }, [prefilledTemplate, onClearPrefilledTemplate]);

  const { data: materials = [] } = useQuery<MarketingMaterial[]>({
    queryKey: ["portal-marketing-materials"],
    queryFn: () => fetchMarketingMaterials(),
  });

  // Adopt the pre-attached materials from the Marketing handoff.
  useEffect(() => {
    if (preAttachedMaterialIds && preAttachedMaterialIds.length > 0) {
      setAttachedIds(new Set(preAttachedMaterialIds));
      onClearPreAttached?.();
    }
  }, [preAttachedMaterialIds, onClearPreAttached]);

  // Re-seed `to` when the patient changes.
  useEffect(() => {
    setTo((selectedPatient?.email ?? "").trim());
  }, [selectedPatient?.email, selectedPatient?.patientScreeningId]);

  const attachedMaterials = useMemo(
    () => materials.filter((m) => attachedIds.has(m.id)),
    [materials, attachedIds],
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPatient) throw new Error("Open a patient first.");
      const recipient = to.trim();
      if (!recipient) throw new Error("Recipient email is required.");
      if (attachedMaterials.length === 0) {
        if (!subject.trim()) throw new Error("Subject is required.");
        if (!body.trim()) throw new Error("Body is required.");
        return sendOutreachEmail({
          patientScreeningId: selectedPatient.patientScreeningId,
          to: recipient,
          subject: subject.trim(),
          body,
        });
      }
      // One canonical send per attached material so each brochure
      // carries its own canonical filename / contentType.
      let lastResult: { ok: boolean } = { ok: true };
      for (const m of attachedMaterials) {
        lastResult = await sendMarketingMaterial({
          patientScreeningId: selectedPatient.patientScreeningId,
          materialId: m.id,
          to: recipient,
        });
      }
      return lastResult;
    },
    onSuccess: () => {
      toast({
        title: "Email sent",
        description: `${selectedPatient?.name ?? "Patient"} · ${attachedMaterials.length} attachment(s)`,
      });
      setSubject("");
      setBody("");
      setAttachedIds(new Set());
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not send email";
      toast({
        title: "Send failed",
        description: msg,
        variant: "destructive",
      });
    },
  });

  // Live error from the latest send, surfaced inline so SMTP-not-
  // configured failures are obvious.
  const sendError =
    sendMutation.isError && sendMutation.error instanceof Error
      ? sendMutation.error.message
      : null;

  const sendDisabled =
    !selectedPatient || !to.trim() || sendMutation.isPending ||
    (attachedMaterials.length === 0 && (!subject.trim() || !body.trim()));

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-hidden bg-transparent p-4"
      data-testid="portal-email-composer"
    >
      <SketchSurface seedId="email-header">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Mail className="h-4 w-4 text-slate-500" />
          Email Composer
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Sends through the canonical /api/outreach/send-email and
          /api/outreach/send-material routes. Requires SMTP activation
          (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM) —
          without it, sends fail loudly and the composer does NOT pretend
          to have sent.
        </div>
      </SketchSurface>

      <div className="grid flex-1 min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_300px] overflow-hidden">
        <SketchSurface
          seedId="email-form"
          className="overflow-y-auto"
          data-testid="portal-email-composer-form"
        >
          {!selectedPatient && (
            <div className="text-[12px] text-slate-500 italic mb-3">
              Open a patient first to compose. The composer will pre-fill
              the recipient address from the patient record.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label
                htmlFor="email-to"
                className="text-[10px] uppercase tracking-wider text-slate-500"
              >
                To
              </Label>
              <SketchInput
                id="email-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="patient@example.com"
                containerClassName="mt-1"
                data-testid="portal-email-composer-to"
              />
            </div>
            <div>
              <Label
                htmlFor="email-subject"
                className="text-[10px] uppercase tracking-wider text-slate-500"
              >
                Subject
              </Label>
              <SketchInput
                id="email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={
                  attachedMaterials.length > 0
                    ? "(Subject is auto-generated when sending marketing material)"
                    : "Subject"
                }
                disabled={attachedMaterials.length > 0}
                containerClassName="mt-1"
                data-testid="portal-email-composer-subject"
              />
            </div>
            <div>
              <Label
                htmlFor="email-body"
                className="text-[10px] uppercase tracking-wider text-slate-500"
              >
                Body
              </Label>
              <SketchTextarea
                id="email-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  attachedMaterials.length > 0
                    ? "(Body is auto-generated when sending marketing material)"
                    : "Write your message…"
                }
                disabled={attachedMaterials.length > 0}
                containerClassName="mt-1"
                className="min-h-[180px]"
                data-testid="portal-email-composer-body"
              />
            </div>
          </div>

          {sendError && (
            <div
              className="mt-3 flex items-start gap-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800"
              data-testid="portal-email-composer-error"
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="min-w-0">{sendError}</div>
            </div>
          )}
        </SketchSurface>

        <SketchSurface
          seedId="email-attachments"
          className="overflow-y-auto"
          data-testid="portal-email-composer-attachments"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-900">Attachments</div>
            <span className="text-[10px] text-slate-500">
              {attachedMaterials.length} of {materials.length}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mb-2">
            Marketing materials selected for attachment. Pick from the
            Marketing tool or toggle here.
          </div>
          <ul className="space-y-1.5">
            {materials.length === 0 && (
              <li className="text-[11px] text-slate-500 italic">
                No marketing materials available.
              </li>
            )}
            {materials.map((m) => {
              const isAttached = attachedIds.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id);
                        else next.add(m.id);
                        return next;
                      })
                    }
                    className="flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-slate-900/[0.03]"
                    style={
                      isAttached
                        ? { borderColor: "var(--sketch-blue)", backgroundColor: "rgba(84,106,154,0.12)" }
                        : { borderColor: "rgba(148,163,184,0.35)", backgroundColor: "transparent" }
                    }
                    data-testid={`portal-email-attach-${m.id}`}
                  >
                    <FileText className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-slate-900 truncate">
                        {m.title}
                      </div>
                      <div className="text-[9px] text-slate-400 truncate">
                        {m.filename}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <SketchButton
            type="button"
            variant="primary"
            size="sm"
            seedId="email-send"
            disabled={sendDisabled}
            onClick={() => sendMutation.mutate()}
            className="mt-3 w-full"
            data-testid="portal-email-composer-send"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
            Send email
          </SketchButton>
        </SketchSurface>
      </div>
    </div>
  );
}
