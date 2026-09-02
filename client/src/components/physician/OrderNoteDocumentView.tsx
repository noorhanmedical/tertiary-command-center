// Phase P1 — structured Order Note document viewer.
//
// Renders the canonical Order Note body as a clean, titled clinical document
// (parsed from the server-rendered section structure) plus a compact audit
// footer. It is deliberately NOT a raw text dump and NOT an AI-chat transcript.
//
// It shows audit METADATA only (evidence fingerprint, screening version the note
// was evaluated against, generator provenance, signed timestamp). It NEVER
// exposes model chain-of-thought, prompts, or raw evidence internals. ICD-10 /
// CPT codes are NOT part of the Order Note and are never rendered here — those
// live only on the separate Billing Document.

import { parseOrderNoteSections } from "./orderNoteLifecycle";

export type OrderNoteAudit = {
  evidenceFingerprint?: string | null;
  evaluatedScreeningEvidenceVersion?: string | null;
  generatedByAi?: boolean | null;
  signedAt?: string | null;
  effectiveClinicalDate?: string | null;
  version?: number | null;
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function shortFingerprint(fp: string | null | undefined): string {
  if (!fp) return "—";
  return fp.length > 16 ? `${fp.slice(0, 8)}…${fp.slice(-4)}` : fp;
}

export function OrderNoteDocumentView({
  text,
  audit,
  testId = "order-note-document",
}: {
  text: string | null | undefined;
  audit?: OrderNoteAudit;
  testId?: string;
}) {
  const sections = parseOrderNoteSections(text);

  return (
    <div data-testid={testId} className="space-y-4">
      <article className="max-h-[52vh] space-y-4 overflow-auto rounded-md border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-800">
        {sections.length === 0 ? (
          <p className="text-slate-500" data-testid={`${testId}-empty`}>No Order Note body generated yet.</p>
        ) : (
          sections.map((s, i) => (
            <section key={`${s.heading ?? "section"}-${i}`} data-testid={`${testId}-section-${i}`}>
              {s.heading && (
                <h4
                  data-testid={`${testId}-heading-${i}`}
                  className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {s.heading}
                </h4>
              )}
              <div className="whitespace-pre-wrap text-slate-800">{s.body}</div>
            </section>
          ))
        )}
      </article>

      {audit && (
        <div
          data-testid={`${testId}-audit`}
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500"
        >
          <div className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Document audit</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
            <div>
              <dt className="inline text-slate-400">Evidence fingerprint: </dt>
              <dd className="inline font-mono text-slate-600" data-testid={`${testId}-audit-fingerprint`}>{shortFingerprint(audit.evidenceFingerprint)}</dd>
            </div>
            <div>
              <dt className="inline text-slate-400">Screening version: </dt>
              <dd className="inline font-mono text-slate-600">{audit.evaluatedScreeningEvidenceVersion ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline text-slate-400">Source: </dt>
              <dd className="inline text-slate-600">{audit.generatedByAi ? "AI-assisted (reviewed)" : "Deterministic"}</dd>
            </div>
            {audit.version != null && (
              <div>
                <dt className="inline text-slate-400">Version: </dt>
                <dd className="inline text-slate-600">v{audit.version}</dd>
              </div>
            )}
            {audit.effectiveClinicalDate && (
              <div>
                <dt className="inline text-slate-400">Clinical date: </dt>
                <dd className="inline text-slate-600">{fmt(audit.effectiveClinicalDate)}</dd>
              </div>
            )}
            <div>
              <dt className="inline text-slate-400">Signed: </dt>
              <dd className="inline text-slate-600">{fmt(audit.signedAt)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
