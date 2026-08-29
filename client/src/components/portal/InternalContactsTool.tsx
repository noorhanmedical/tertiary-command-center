// InternalContactsTool — Phase 2 PR 2.7.
//
// Left-rail tool. Reads from canonical /api/contacts (NO hardcoded
// fallback). Read-only here; admin write happens on a dedicated
// settings surface (out of scope for PR 2.7).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Phone, Search, Mail, Users } from "lucide-react";
import { SketchSurface, SketchInput, SketchBadge } from "@/components/playground/sketch/SketchPrimitives";
import {
  fetchContacts,
  type ContactRow,
  type ContactCategory,
  CONTACT_CATEGORY_LABELS,
} from "@/lib/contactsApi";

// Canonical internal team directory (Phase 5B) — derived from users + teams +
// memberships + coverage, NOT the seeded /api/contacts table.
type DirectoryEntry = {
  userId: string;
  username: string;
  role: string | null;
  teams: { teamId: number; name: string; type: string; primary: boolean }[];
  facilities: string[];
};

function TeamDirectory() {
  const [q, setQ] = useState("");
  const { data, isLoading, isError, error } = useQuery<{ directory: DirectoryEntry[] }>({
    queryKey: ["/api/teams/directory"],
    queryFn: async () => {
      const res = await fetch("/api/teams/directory", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load directory (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });
  const rows = data?.directory ?? [];
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) =>
      r.username.toLowerCase().includes(n) ||
      (r.role ?? "").toLowerCase().includes(n) ||
      r.teams.some((t) => t.name.toLowerCase().includes(n)) ||
      r.facilities.some((f) => f.toLowerCase().includes(n)),
    );
  }, [rows, q]);

  return (
    <>
      <SketchSurface seedId="team-dir-search" className="space-y-2">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <SketchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / team / facility…" containerClassName="flex-1" data-testid="team-directory-search" />
        </div>
      </SketchSurface>
      <SketchSurface seedId="team-dir-list" className="flex-1 min-h-0 overflow-y-auto" data-testid="team-directory-list">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading directory…</div>
        ) : isError ? (
          <div className="text-xs text-rose-700">{error instanceof Error ? error.message : "Failed to load directory"}</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No team members match.</div>
        ) : (
          <ul className="divide-y divide-slate-200/60">
            {filtered.map((r) => (
              <li key={r.userId} className="px-1 py-2" data-testid={`team-directory-row-${r.userId}`}>
                <div className="text-[12px] font-semibold text-slate-900 truncate">{r.username}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  {r.role ? <SketchBadge tone="graphite">{r.role}</SketchBadge> : null}
                  {r.teams.map((t) => (
                    <SketchBadge key={t.teamId} tone={t.type === "PCS" ? "blue" : t.type === "ACS" ? "violet" : "graphite"}>
                      {t.name}{t.primary ? " ★" : ""}
                    </SketchBadge>
                  ))}
                </div>
                {r.facilities.length > 0 ? (
                  <div className="mt-1 text-[10px] text-slate-500 truncate">Covers: {r.facilities.join(", ")}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SketchSurface>
    </>
  );
}

export function InternalContactsTool() {
  const [source, setSource] = useState<"team" | "external">("team");
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
          <Phone className="h-4 w-4 text-slate-500" /> Contacts
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {([
            { id: "team", label: "Team Directory", icon: Users },
            { id: "external", label: "External", icon: Phone },
          ] as const).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSource(s.id)}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold transition ${
                source === s.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`contacts-source-${s.id}`}
            >
              <s.icon className="h-3 w-3" /> {s.label}
            </button>
          ))}
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          {source === "team"
            ? "Canonical internal directory from teams / memberships / coverage — no seeded rows."
            : "External contacts (facilities, physicians, vendors) from /api/contacts."}
        </div>
      </SketchSurface>

      {source === "team" ? (
        <TeamDirectory />
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}
