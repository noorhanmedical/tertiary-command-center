import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ClipboardCopy, Mail, Phone, FileText, BookOpen, Sparkles } from "lucide-react";
import { SketchSurface, SketchButton } from "@/components/playground/sketch/SketchPrimitives";
import {
  STAFF_RESOURCES,
  type StaffResource,
  type StaffResourceKind,
} from "@/lib/portal/staffResources";
import { useToast } from "@/hooks/use-toast";

// Templates / Staff Resources — center-canvas surface for the Team
// Portal left-rail Templates tool. Staff-facing only: email templates,
// call scripts, prep language, internal SOP, FAQs.
//
// IMPORTANT: this catalog is intentionally SEPARATE from the patient-
// facing MARKETING_MATERIALS catalog (server/services/marketing-
// Materials.ts → /api/outreach/materials). Patient-facing brochures
// live in the Marketing tool. Staff resources live here. They must
// not be confused with one another.
//
// "Insert into composer" support: when the parent provides
// `onInsertIntoComposer`, items with an `email-template` kind expose
// a button that hands the body off to the Email Composer tab. Other
// kinds (call scripts, prep language, SOP, FAQ) are read-only because
// they don't make sense as raw email bodies.

const KIND_LABELS: Record<StaffResourceKind, string> = {
  "email-template": "Email Templates",
  "call-script": "Call Scripts",
  "prep-language": "Prep Language",
  "sop": "SOP",
  "faq": "FAQ",
};

const KIND_ICONS: Record<StaffResourceKind, React.ComponentType<{ className?: string }>> = {
  "email-template": Mail,
  "call-script": Phone,
  "prep-language": Sparkles,
  "sop": BookOpen,
  "faq": FileText,
};

const KIND_ORDER: ReadonlyArray<StaffResourceKind> = [
  "email-template",
  "call-script",
  "prep-language",
  "sop",
  "faq",
];

export function PortalTemplatesResourcesTab({
  onInsertIntoComposer,
}: {
  /** Optional handoff so an Email Template's body can be inserted
   *  directly into the active Email Composer subject/body. */
  onInsertIntoComposer?: (template: { subject: string; body: string }) => void;
}) {
  const { toast } = useToast();
  const [activeKind, setActiveKind] = useState<StaffResourceKind>("email-template");

  const grouped = useMemo(() => {
    const byKind: Record<StaffResourceKind, StaffResource[]> = {
      "email-template": [],
      "call-script": [],
      "prep-language": [],
      "sop": [],
      "faq": [],
    };
    for (const r of STAFF_RESOURCES) byKind[r.kind].push(r);
    return byKind;
  }, []);

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({
        title: "Could not copy",
        description: "Clipboard access denied — select + copy manually.",
        variant: "destructive",
      });
    }
  }

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-hidden bg-transparent p-4"
      data-testid="portal-templates-resources"
    >
      <SketchSurface seedId="scripts-header">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <BookOpen className="h-4 w-4 text-slate-500" />
          Templates &amp; Staff Resources
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Internal helpers for scheduling / coordination. Patient-facing
          marketing brochures live in the separate Marketing tool.
        </div>
      </SketchSurface>

      <SketchSurface seedId="scripts-body" className="flex-1 min-h-0 overflow-hidden">
        <Tabs
          value={activeKind}
          onValueChange={(v) => setActiveKind(v as StaffResourceKind)}
          className="flex h-full flex-col"
        >
          <TabsList
            className="grid w-full grid-cols-5"
            data-testid="portal-templates-resources-tablist"
          >
            {KIND_ORDER.map((kind) => {
              const Icon = KIND_ICONS[kind];
              return (
                <TabsTrigger
                  key={kind}
                  value={kind}
                  className="text-[11px] gap-1.5"
                  data-testid={`portal-templates-resources-tab-${kind}`}
                >
                  <Icon className="h-3 w-3" />
                  {KIND_LABELS[kind]}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {KIND_ORDER.map((kind) => (
            <TabsContent
              key={kind}
              value={kind}
              className="mt-3 flex-1 min-h-0 overflow-y-auto"
            >
              <ul className="space-y-2">
                {grouped[kind].length === 0 && (
                  <li className="text-[11px] text-slate-500 italic">
                    No {KIND_LABELS[kind]} on file yet.
                  </li>
                )}
                {grouped[kind].map((r) => (
                  <li
                    key={r.id}
                    className="rounded border p-3"
                    style={{ borderColor: "rgba(148,163,184,0.35)", backgroundColor: "rgba(148,163,184,0.06)" }}
                    data-testid={`portal-templates-resources-item-${r.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-slate-900">
                          {r.title}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {r.description}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <SketchButton
                          type="button"
                          variant="secondary"
                          size="sm"
                          seedId={`scripts-copy-${r.id}`}
                          onClick={() => copyToClipboard(r.body)}
                          data-testid={`portal-templates-resources-copy-${r.id}`}
                        >
                          <ClipboardCopy className="h-3 w-3" />
                          Copy
                        </SketchButton>
                        {r.kind === "email-template" && onInsertIntoComposer && (
                          <SketchButton
                            type="button"
                            variant="primary"
                            size="sm"
                            seedId={`scripts-insert-${r.id}`}
                            onClick={() =>
                              onInsertIntoComposer({
                                subject: r.title,
                                body: r.body,
                              })
                            }
                            data-testid={`portal-templates-resources-insert-${r.id}`}
                          >
                            <Mail className="h-3 w-3" />
                            Insert into composer
                          </SketchButton>
                        )}
                      </div>
                    </div>
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-[10px] text-slate-700">
                      {r.body}
                    </pre>
                  </li>
                ))}
              </ul>
            </TabsContent>
          ))}
        </Tabs>
      </SketchSurface>
    </div>
  );
}
