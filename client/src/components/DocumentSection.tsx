import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const KIND_COLORS: Record<string, string> = {
  preProcedureOrder: "bg-blue-100 text-blue-800",
  postProcedureNote: "bg-teal-100 text-teal-800",
  billing: "bg-emerald-100 text-emerald-800",
  screening: "bg-slate-100 text-slate-800",
};

export function DocumentSection({ doc, index }: { doc: DocumentSectionDoc; index: number }) {
  const [copied, setCopied] = useState(false);

  const kindLabel = KIND_LABELS[doc.kind] || doc.kind;
  const kindColor = KIND_COLORS[doc.kind] || "bg-slate-100 text-slate-800";

  const visibleSections = doc.sections.filter((s) => s.heading !== "__screening_meta__");

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

  return (
    <Card
      className="overflow-hidden border border-slate-200 dark:border-border"
      data-testid={`document-card-${index}`}
    >
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-muted/30 border-b border-slate-200 dark:border-border">
        <div className="flex items-center gap-3">
          <Badge className={`text-xs font-semibold ${kindColor}`} data-testid={`badge-doc-kind-${index}`}>
            {kindLabel}
          </Badge>
          <span className="text-sm font-semibold text-slate-800 dark:text-foreground">{doc.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            onClick={handleCopy}
            data-testid={`button-copy-doc-${index}`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            onClick={handlePrint}
            data-testid={`button-print-doc-${index}`}
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </Button>
        </div>
      </div>
      <div className="p-5 space-y-4">
        {visibleSections.map((section, si) => (
          <div key={si} data-testid={`doc-section-${index}-${si}`}>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground mb-1">
              {section.heading}
            </h4>
            <p className="text-sm text-slate-800 dark:text-foreground whitespace-pre-wrap leading-relaxed">
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
