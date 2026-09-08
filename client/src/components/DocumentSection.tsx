import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, Printer } from "lucide-react";

type DocSection = { heading: string; body: string };

export interface DocumentSectionDoc {
  kind: string;
  title: string;
  sections: DocSection[];
}

const KIND_LABELS: Record<string, string> = {
  preProcedureOrder: "Pre-Procedure Order",
  postProcedureNote: "Post-Procedure Note",
  billing: "Billing Document",
  screening: "Screening",
};

export function DocumentSection({ doc, index }: { doc: DocumentSectionDoc; index: number }) {
  const [copied, setCopied] = useState(false);

  const kindLabel = KIND_LABELS[doc.kind] || doc.kind;

  const visibleSections = doc.sections.filter((s) => !s.heading.startsWith("__"));

  const fullText = visibleSections
    .map((s) => `${s.heading}\n${"─".repeat(s.heading.length)}\n${s.body}`)
    .join("\n\n");

  function handleCopy() {
    navigator.clipboard.writeText(`${doc.title}\n\n${fullText}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handlePrint() {
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    w.document.write(
      `<html><head><title>${esc(doc.title)}</title><style>` +
      `body{font-family:Arial,sans-serif;font-size:12pt;padding:1in}` +
      `h1{font-size:14pt;border-bottom:2px solid #000;padding-bottom:6px}` +
      `h2{font-size:12pt;margin-top:20px;margin-bottom:4px;color:#222}` +
      `p{white-space:pre-wrap;margin:0 0 8px 0}` +
      `</style></head><body>` +
      `<h1>${esc(doc.title)}</h1>` +
      visibleSections.map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>`).join("") +
      `</body></html>`
    );
    w.document.close();
    w.print();
  }

  // Accent color per document kind — drives the left rail + header tint so
  // each note reads as a distinct, branded clinical record rather than a
  // flat Word page.
  const kindAccent: Record<string, { rail: string; dot: string; tint: string }> = {
    preProcedureOrder: { rail: "bg-blue-500", dot: "bg-blue-500", tint: "from-blue-50/80" },
    postProcedureNote: { rail: "bg-teal-500", dot: "bg-teal-500", tint: "from-teal-50/80" },
    billing: { rail: "bg-emerald-500", dot: "bg-emerald-500", tint: "from-emerald-50/80" },
    screening: { rail: "bg-slate-400", dot: "bg-slate-400", tint: "from-slate-50/80" },
  };
  const accent = kindAccent[doc.kind] ?? kindAccent.screening;

  return (
    <Card
      className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-black/[0.02] transition-shadow hover:shadow-md dark:border-border dark:bg-card"
      data-testid={`document-card-${index}`}
    >
      {/* Colored spine — gives each note a bound-document feel */}
      <div className={`absolute inset-y-0 left-0 w-1 ${accent.rail}`} aria-hidden="true" />

      {/* Letterhead */}
      <div className={`flex items-start justify-between gap-4 bg-gradient-to-r ${accent.tint} to-transparent px-6 pt-5 pb-4 pl-7`}>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${accent.dot}`} aria-hidden="true" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-muted-foreground">
              {kindLabel}
            </span>
          </div>
          <h3 className="truncate font-serif text-lg font-semibold leading-tight text-slate-900 dark:text-foreground">
            {doc.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 opacity-70 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs text-slate-500 hover:bg-white hover:text-slate-800"
            onClick={handleCopy}
            data-testid={`button-copy-doc-${index}`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs text-slate-500 hover:bg-white hover:text-slate-800"
            onClick={handlePrint}
            data-testid={`button-print-doc-${index}`}
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
        </div>
      </div>

      <div className="h-px bg-gradient-to-r from-slate-200 via-slate-100 to-transparent dark:from-border" />

      {/* Body — a readable clinical column, not a full-bleed Word page */}
      <div className="px-6 py-5 pl-7">
        <div className="mx-auto max-w-2xl space-y-5">
          {visibleSections.map((section, si) => (
            <section key={si} data-testid={`doc-section-${index}-${si}`}>
              <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-muted-foreground">
                <span className="h-px w-4 bg-slate-300 dark:bg-border" aria-hidden="true" />
                {section.heading}
              </h4>
              <p className="whitespace-pre-wrap text-[13.5px] leading-7 text-slate-700 dark:text-foreground/90">
                {section.body}
              </p>
            </section>
          ))}
        </div>
      </div>
    </Card>
  );
}
