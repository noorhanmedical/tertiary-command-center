// Organization Settings — Facilities + Clinicians management.
//
// Native platform Settings UI (NOT Playground sketch styling). Mirrors the
// SchedulerTeamSection pattern (useQuery + mutation + inline edit + toast).
// This is the source for the Plexus IQ batch facility/clinician dropdowns.
//
// Admin-only: rendered inside /admin/settings (AdminGuard); mutations are also
// enforced admin-only server-side.

import { useMemo, useState } from "react";
import { Building2, Stethoscope, Plus, Pencil, Check, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useFacilities,
  useClinicians,
  useCreateFacility,
  useUpdateFacility,
  useCreateClinician,
  useUpdateClinician,
  type OrgFacility,
  type OrgClinician,
} from "@/hooks/api/organization";

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-500">
      Inactive
    </Badge>
  );
}

// ── Facilities ──────────────────────────────────────────────────────────
function FacilitiesCard() {
  const { toast } = useToast();
  const { data: facilities = [], isLoading } = useFacilities(true);
  const { data: clinicians = [] } = useClinicians(true);
  const createMut = useCreateFacility();
  const updateMut = useUpdateFacility();

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShort, setNewShort] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const clinicianCountByFacility = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of clinicians) {
      if (!c.active) continue;
      for (const fid of c.facilityIds) m.set(fid, (m.get(fid) ?? 0) + 1);
    }
    return m;
  }, [clinicians]);

  const visible = useMemo(
    () =>
      facilities.filter((f) =>
        search.trim() ? f.name.toLowerCase().includes(search.trim().toLowerCase()) : true,
      ),
    [facilities, search],
  );

  function add() {
    const name = newName.trim();
    if (!name) return;
    // Duplicate warning (non-blocking).
    if (facilities.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: "Possible duplicate", description: `A facility named "${name}" already exists.`, variant: "destructive" });
    }
    createMut.mutate(
      { name, shortName: newShort.trim() || null, phone: newPhone.trim() || null },
      {
        onSuccess: () => {
          setNewName(""); setNewShort(""); setNewPhone(""); setAdding(false);
          toast({ title: "Facility added" });
        },
        onError: (e: unknown) => toast({ title: "Add failed", description: e instanceof Error ? e.message : "", variant: "destructive" }),
      },
    );
  }

  function saveEdit(f: OrgFacility) {
    if (!editName.trim()) return;
    updateMut.mutate(
      { id: f.id, body: { name: editName.trim() } },
      { onSuccess: () => { setEditId(null); toast({ title: "Facility updated" }); } },
    );
  }

  function toggleActive(f: OrgFacility) {
    updateMut.mutate({ id: f.id, body: { active: !f.active } }, {
      onSuccess: () => toast({ title: f.active ? "Facility deactivated" : "Facility activated" }),
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-blue-700" />
          <h2 className="text-lg font-semibold text-slate-900">Facilities</h2>
          <Badge variant="outline" className="rounded-full">{facilities.length}</Badge>
        </div>
        <Button size="sm" onClick={() => setAdding((v) => !v)} className="h-8 gap-1.5 rounded-xl" data-testid="button-add-facility">
          <Plus className="h-3.5 w-3.5" /> Add Facility
        </Button>
      </div>

      <div className="relative mb-3 w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search facilities…" className="h-9 pl-8 text-sm" data-testid="input-facility-search" />
      </div>

      {adding && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50/60 p-3" data-testid="facility-add-row">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Facility name" className="h-8 w-56 rounded-xl text-sm" data-testid="input-new-facility-name" />
          <Input value={newShort} onChange={(e) => setNewShort(e.target.value)} placeholder="Short name (optional)" className="h-8 w-40 rounded-xl text-sm" />
          <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (optional)" className="h-8 w-36 rounded-xl text-sm" />
          <Button size="sm" className="h-8 rounded-xl" onClick={add} disabled={createMut.isPending} data-testid="button-save-new-facility">Save</Button>
          <Button size="sm" variant="ghost" className="h-8 rounded-xl" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">No facilities.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3" data-testid={`facility-row-${f.id}`}>
              {editId === f.id ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 w-56 rounded-xl text-sm" data-testid={`input-edit-facility-${f.id}`} />
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" className="h-8 rounded-xl" onClick={() => saveEdit(f)}><Check className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-xl" onClick={() => setEditId(null)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{f.name}</span>
                      <StatusBadge active={f.active} />
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {clinicianCountByFacility.get(f.id) ?? 0} clinician{(clinicianCountByFacility.get(f.id) ?? 0) === 1 ? "" : "s"}
                      {f.phone ? ` · ${f.phone}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl text-xs" onClick={() => { setEditId(f.id); setEditName(f.name); }} data-testid={`button-edit-facility-${f.id}`}>
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs" onClick={() => toggleActive(f)} data-testid={`button-toggle-facility-${f.id}`}>
                      {f.active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Clinicians ────────────────────────────────────────────────────────────
function CliniciansCard() {
  const { toast } = useToast();
  const { data: clinicians = [], isLoading } = useClinicians(true);
  const { data: facilities = [] } = useFacilities(true);
  const createMut = useCreateClinician();
  const updateMut = useUpdateClinician();

  const [search, setSearch] = useState("");
  const [facilityFilter, setFacilityFilter] = useState<number | "all">("all");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCred, setNewCred] = useState("");
  const [newFacilityIds, setNewFacilityIds] = useState<number[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [editFacilityIds, setEditFacilityIds] = useState<number[]>([]);
  // Profile edit (display name + credentials) — kept separate from the
  // facilities editor so saving one never touches the other. A PATCH from
  // here sends ONLY { displayName, credentials }; it does not include
  // facilityIds or active, so associations and status are untouched.
  const [profileEditId, setProfileEditId] = useState<number | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editCredentials, setEditCredentials] = useState("");

  const facilityName = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of facilities) m.set(f.id, f.shortName || f.name);
    return m;
  }, [facilities]);

  const visible = useMemo(
    () =>
      clinicians.filter((c) => {
        if (search.trim() && !c.displayName.toLowerCase().includes(search.trim().toLowerCase())) return false;
        if (facilityFilter !== "all" && !c.facilityIds.includes(facilityFilter)) return false;
        return true;
      }),
    [clinicians, search, facilityFilter],
  );

  function toggleFacility(list: number[], id: number): number[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    if (clinicians.some((c) => c.displayName.toLowerCase() === name.toLowerCase())) {
      toast({ title: "Possible duplicate", description: `A clinician named "${name}" already exists.`, variant: "destructive" });
    }
    createMut.mutate(
      { displayName: name, credentials: newCred.trim() || null, facilityIds: newFacilityIds },
      {
        onSuccess: () => { setNewName(""); setNewCred(""); setNewFacilityIds([]); setAdding(false); toast({ title: "Clinician added" }); },
        onError: (e: unknown) => toast({ title: "Add failed", description: e instanceof Error ? e.message : "", variant: "destructive" }),
      },
    );
  }

  function saveFacilities(c: OrgClinician) {
    updateMut.mutate({ id: c.id, body: { facilityIds: editFacilityIds } }, {
      onSuccess: () => { setEditId(null); toast({ title: "Facilities updated" }); },
    });
  }

  function startProfileEdit(c: OrgClinician) {
    // Close the facilities editor if open on the same row so the two inline
    // editors don't stack.
    setEditId(null);
    setProfileEditId(c.id);
    setEditDisplayName(c.displayName);
    setEditCredentials(c.credentials ?? "");
  }

  function saveProfile(c: OrgClinician) {
    const name = editDisplayName.trim();
    if (!name) {
      toast({ title: "Display name is required", variant: "destructive" });
      return;
    }
    // Duplicate warning (non-blocking), ignoring the clinician being edited.
    if (
      clinicians.some(
        (x) => x.id !== c.id && x.displayName.toLowerCase() === name.toLowerCase(),
      )
    ) {
      toast({
        title: "Possible duplicate",
        description: `Another clinician named "${name}" already exists.`,
        variant: "destructive",
      });
    }
    // Send ONLY the profile fields. Omitting facilityIds/active means the
    // server leaves associations and status exactly as they are. Credentials
    // is nullable — an emptied field clears it (null), not "".
    const cred = editCredentials.trim();
    updateMut.mutate(
      { id: c.id, body: { displayName: name, credentials: cred || null } },
      {
        onSuccess: () => {
          setProfileEditId(null);
          toast({ title: "Clinician updated" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Update failed",
            description: e instanceof Error ? e.message : "",
            variant: "destructive",
          }),
      },
    );
  }

  function toggleActive(c: OrgClinician) {
    updateMut.mutate({ id: c.id, body: { active: !c.active } }, {
      onSuccess: () => toast({ title: c.active ? "Clinician deactivated" : "Clinician activated" }),
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-violet-600" />
          <h2 className="text-lg font-semibold text-slate-900">Clinicians</h2>
          <Badge variant="outline" className="rounded-full">{clinicians.length}</Badge>
        </div>
        <Button size="sm" onClick={() => setAdding((v) => !v)} className="h-8 gap-1.5 rounded-xl" data-testid="button-add-clinician">
          <Plus className="h-3.5 w-3.5" /> Add Clinician
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clinicians…" className="h-9 pl-8 text-sm" data-testid="input-clinician-search" />
        </div>
        <select
          value={facilityFilter === "all" ? "all" : String(facilityFilter)}
          onChange={(e) => setFacilityFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
          data-testid="select-clinician-facility-filter"
        >
          <option value="all">All facilities</option>
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {adding && (
        <div className="mb-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-3" data-testid="clinician-add-row">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Clinician name (e.g. Dr Taylor)" className="h-8 w-64 rounded-xl text-sm" data-testid="input-new-clinician-name" />
            <Input value={newCred} onChange={(e) => setNewCred(e.target.value)} placeholder="Credentials (MD)" className="h-8 w-28 rounded-xl text-sm" />
            <Button size="sm" className="h-8 rounded-xl" onClick={add} disabled={createMut.isPending} data-testid="button-save-new-clinician">Save</Button>
            <Button size="sm" variant="ghost" className="h-8 rounded-xl" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {facilities.filter((f) => f.active).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setNewFacilityIds((l) => toggleFacility(l, f.id))}
                className={`rounded-full border px-2.5 py-1 text-xs ${newFacilityIds.includes(f.id) ? "border-violet-400 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-slate-500"}`}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">No clinicians.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => (
            <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-3" data-testid={`clinician-row-${c.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{c.displayName}</span>
                    {c.credentials ? <span className="text-xs text-slate-500">{c.credentials}</span> : null}
                    <StatusBadge active={c.active} />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {c.facilityIds.length === 0
                      ? "No facilities"
                      : c.facilityIds.map((id) => facilityName.get(id) ?? `#${id}`).join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl text-xs" onClick={() => (profileEditId === c.id ? setProfileEditId(null) : startProfileEdit(c))} data-testid={`button-edit-clinician-${c.id}`}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl text-xs" onClick={() => { setProfileEditId(null); setEditId(editId === c.id ? null : c.id); setEditFacilityIds(c.facilityIds); }} data-testid={`button-manage-facilities-${c.id}`}>
                    <Pencil className="h-3 w-3" /> Facilities
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs" onClick={() => toggleActive(c)} data-testid={`button-toggle-clinician-${c.id}`}>
                    {c.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
              {profileEditId === c.id && (
                <div className="mt-2 border-t border-slate-100 pt-2" data-testid={`clinician-profile-edit-${c.id}`}>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display name</label>
                      <Input
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        placeholder="Display name (e.g. Dr Jane Smith)"
                        className="mt-1 h-8 w-64 rounded-xl text-sm"
                        data-testid={`input-edit-clinician-name-${c.id}`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Credentials</label>
                      <Input
                        value={editCredentials}
                        onChange={(e) => setEditCredentials(e.target.value)}
                        placeholder="MD, DO, NP (optional)"
                        className="mt-1 h-8 w-40 rounded-xl text-sm"
                        data-testid={`input-edit-clinician-credentials-${c.id}`}
                      />
                    </div>
                    <Button size="sm" className="h-8 rounded-xl" onClick={() => saveProfile(c)} disabled={updateMut.isPending} data-testid={`button-save-clinician-profile-${c.id}`}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-xl" onClick={() => setProfileEditId(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Editing name/credentials does not change facility associations or active status, and does not alter historical batch attribution.
                  </p>
                </div>
              )}
              {editId === c.id && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {facilities.filter((f) => f.active).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setEditFacilityIds((l) => toggleFacility(l, f.id))}
                        className={`rounded-full border px-2.5 py-1 text-xs ${editFacilityIds.includes(f.id) ? "border-violet-400 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-slate-500"}`}
                        data-testid={`toggle-facility-${c.id}-${f.id}`}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" className="h-8 rounded-xl" onClick={() => saveFacilities(c)} disabled={updateMut.isPending} data-testid={`button-save-facilities-${c.id}`}>
                    Save facilities
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OrganizationSettingsSection() {
  return (
    <div className="space-y-10">
      <FacilitiesCard />
      <CliniciansCard />
    </div>
  );
}
