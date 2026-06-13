import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Search, FileText, ExternalLink, BookOpen } from "lucide-react";
import {
  useDocumentLibrary,
  useDocumentLibraryMeta,
} from "@/hooks/api/documents-library";

// Document Library tool — center-canvas browse / search wrapper over
// the existing canonical Document Library hook (`useDocumentLibrary`
// at `client/src/hooks/api/documents-library.ts`). Read-only:
//   - non-admin users still hit /api/documents-library
//   - delete / supersede / upload affordances live ONLY in the
//     /document-library admin page; this tool does not duplicate them
//
// IMPORTANT: this is the INTERNAL / SHARED document library. Patient-
// facing brochures are surfaced through the separate Marketing tool
// (see PortalMarketingTab). The two are deliberately kept distinct
// and the QA scripts forbid cross-pollution.

export function PortalDocumentLibraryTab() {
  const [kind, setKind] = useState<string>("all");
  const [surface, setSurface] = useState<string>("all");
  const [q, setQ] = useState<string>("");

  const { data: meta } = useDocumentLibraryMeta();
  const { data: docs = [], isLoading, isError, error } = useDocumentLibrary({
    kind,
    surface,
    patientId: "",
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return docs;
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(needle) ||
        d.description.toLowerCase().includes(needle) ||
        d.filename.toLowerCase().includes(needle),
    );
  }, [docs, q]);

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-hidden p-4"
      data-testid="portal-document-library"
    >
      <Card className="p-3 bg-white">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <BookOpen className="h-4 w-4 text-slate-500" />
          Document Library
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Internal / shared documents pulled from the canonical
          /api/documents-library. Read-only here — full upload / version
          management lives in the admin Document Library page. Patient-
          facing brochures live in the separate Marketing tool.
        </div>
      </Card>

      <Card className="p-3 bg-white">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-[160px]">
            <Search className="h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter title / description / filename"
              className="h-8 text-xs"
              data-testid="portal-document-library-search"
            />
          </div>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger
              className="h-8 w-[160px] text-xs"
              data-testid="portal-document-library-kind"
            >
              <SelectValue placeholder="Kind" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {(meta?.kinds ?? []).map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={surface} onValueChange={setSurface}>
            <SelectTrigger
              className="h-8 w-[160px] text-xs"
              data-testid="portal-document-library-surface"
            >
              <SelectValue placeholder="Surface" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All surfaces</SelectItem>
              {(meta?.surfaces ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card
        className="flex-1 min-h-0 bg-white overflow-y-auto p-3"
        data-testid="portal-document-library-list"
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 italic py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
          </div>
        ) : isError ? (
          <div className="text-xs text-rose-700 py-2">
            {error instanceof Error ? error.message : "Failed to load documents"}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-2">
            No documents match the current filter.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((d) => (
              <li
                key={d.id}
                className="rounded border border-slate-100 bg-slate-50/40 p-3"
                data-testid={`portal-document-library-row-${d.id}`}
              >
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-[12px] font-semibold text-slate-900 truncate">
                        {d.title}
                      </div>
                      <span className="text-[9px] font-medium uppercase tracking-wider text-slate-500">
                        {d.kind}
                      </span>
                      {!d.isCurrent && (
                        <span className="rounded bg-amber-100 px-1.5 text-[9px] font-medium text-amber-900">
                          superseded
                        </span>
                      )}
                    </div>
                    {d.description && (
                      <div className="text-[10px] text-slate-600 line-clamp-2 mt-0.5">
                        {d.description}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">
                      {d.filename} · {d.contentType}
                    </div>
                  </div>
                  <Button
                    asChild
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[10px] gap-1 shrink-0"
                    data-testid={`portal-document-library-open-${d.id}`}
                  >
                    <a
                      href={d.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </a>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
