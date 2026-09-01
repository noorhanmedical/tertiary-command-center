import { useMemo, useState } from "react";
import { Loader2, Search, FileText, ExternalLink, BookOpen } from "lucide-react";
import {
  SketchSurface,
  SketchInput,
  SketchButton,
  SketchBadge,
} from "@/components/playground/sketch/SketchPrimitives";
import { SketchSelect } from "@/components/playground/sketch/SketchSelect";
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
      className="flex h-full w-full flex-col gap-3 overflow-hidden bg-transparent p-4"
      data-testid="portal-document-library"
    >
      <SketchSurface seedId="doclib-header">
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
      </SketchSurface>

      <SketchSurface seedId="doclib-filters">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-[160px]">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <SketchInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter title / description / filename"
              containerClassName="flex-1"
              data-testid="portal-document-library-search"
            />
          </div>
          <SketchSelect
            seedId="doclib-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            data-testid="portal-document-library-kind"
          >
            <option value="all">All kinds</option>
            {(meta?.kinds ?? []).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </SketchSelect>
          <SketchSelect
            seedId="doclib-surface"
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            data-testid="portal-document-library-surface"
          >
            <option value="all">All surfaces</option>
            {(meta?.surfaces ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </SketchSelect>
        </div>
      </SketchSurface>

      <SketchSurface
        seedId="doclib-list"
        className="flex-1 min-h-0 overflow-y-auto"
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
          <ul className="divide-y divide-slate-200/60">
            {filtered.map((d) => (
              <li
                key={d.id}
                className="px-1 py-2.5"
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
                        <SketchBadge tone="gold">superseded</SketchBadge>
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
                  <a
                    href={d.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                    data-testid={`portal-document-library-open-${d.id}`}
                  >
                    <SketchButton type="button" variant="secondary" size="sm" seedId={`doc-open-${d.id}`}>
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </SketchButton>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SketchSurface>
    </div>
  );
}
