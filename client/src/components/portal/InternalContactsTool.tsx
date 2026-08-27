// InternalContactsTool — Phase 2 PR 2.7.
//
// Left-rail tool. Reads from canonical /api/contacts (NO hardcoded
// fallback). Read-only here; admin write happens on a dedicated
// settings surface (out of scope for PR 2.7).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Phone, Search, Mail } from "lucide-react";
import { SketchSurface, SketchInput, SketchBadge } from "@/components/playground/sketch/SketchPrimitives";
import {
  fetchContacts,
  type ContactRow,
  type ContactCategory,
  CONTACT_CATEGORY_LABELS,
} from "@/lib/contactsApi";

export function InternalContactsTool() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<ContactCategory | "all">("all");

  const { data: rows = [], isLoading, isError, error } = useQuery<ContactRow[]>({
    queryKey: ["contacts", category],
    queryFn: () => fetchContacts(category === "all" ? {} : { category }),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.phone.toLowerCase().includes(needle) ||
        (r.email ?? "").toLowerCase().includes(needle) ||
        (r.organization ?? "").toLowerCase().includes(needle) ||
        (r.role ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-hidden bg-transparent p-4"
      data-testid="portal-internal-contacts"
    >
      <SketchSurface seedId="contacts-header">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Phone className="h-4 w-4 text-slate-500" /> Internal Contacts
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Live directory from /api/contacts — no hardcoded list.
          Admins maintain the directory; everyone reads.
        </div>
      </SketchSurface>

      <SketchSurface seedId="contacts-filters" className="space-y-2">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <SketchInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / phone / org…"
            containerClassName="flex-1"
            data-testid="contacts-search"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "facility", "physician", "vendor_report", "escalation", "team_member"] as const).map((c) => {
            const on = category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className="rounded px-2 py-0.5 text-[10px] transition-colors"
                style={
                  on
                    ? { color: "var(--sketch-blue)", backgroundColor: "rgba(84,106,154,0.14)", boxShadow: "inset 0 -1.5px 0 var(--sketch-blue)" }
                    : { color: "#64748B", backgroundColor: "rgba(148,163,184,0.12)" }
                }
                data-testid={`contacts-cat-${c}`}
              >
                {c === "all" ? "All" : CONTACT_CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </SketchSurface>

      <SketchSurface seedId="contacts-list" className="flex-1 min-h-0 overflow-y-auto" data-testid="contacts-list">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading contacts…
          </div>
        ) : isError ? (
          <div className="text-xs text-rose-700">
            {error instanceof Error ? error.message : "Failed to load contacts"}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-slate-500 italic">
            {rows.length === 0
              ? "No contacts have been added yet. Admin can seed via /api/contacts."
              : "No matches."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-200/60">
            {filtered.map((r) => (
              <li
                key={r.id}
                className="px-1 py-2"
                data-testid={`contact-row-${r.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-slate-900 truncate">{r.name}</div>
                    <div className="text-[11px] text-slate-600 truncate">
                      {r.role ?? CONTACT_CATEGORY_LABELS[r.category]}
                      {r.organization ? ` · ${r.organization}` : ""}
                      {r.facilityId ? ` · ${r.facilityId}` : ""}
                    </div>
                  </div>
                  {r.isOnCall ? (
                    <SketchBadge tone="green">on-call</SketchBadge>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-700">
                  <a href={`tel:${r.phone.replace(/\s+/g, "")}`} className="hover:underline flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {r.phone}
                  </a>
                  {r.email ? (
                    <a href={`mailto:${r.email}`} className="hover:underline flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {r.email}
                    </a>
                  ) : null}
                </div>
                {r.notes ? <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">{r.notes}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </SketchSurface>
    </div>
  );
}
