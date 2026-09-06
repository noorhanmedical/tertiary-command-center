// Phase 4B — per-user permission overrides editor.
//
// Renders the full permission catalog grouped by category, showing each key's
// state: Inherited (from a role) / Explicit Grant / Explicit Deny / Not Granted.
// The operator sets Grant / Deny / Remove Override; on Save we submit the FULL
// override set (the backend replaces overrides), then consume the returned
// effective[] and refetch. DENY is authoritative over inherited/granted access.

import { useMemo, useState } from "react";
import { Check, ShieldMinus, ShieldPlus, RotateCcw } from "lucide-react";
import { PERMISSION_CATALOG, ROLE_CATALOG } from "@shared/accessControl/catalog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { accessApi, describeAccessError, type AccessUserProfile } from "@/lib/access/accessApi";
import { AccessStateBadge, type AccessState } from "./AccessPrimitives";

type Override = "grant" | "deny" | null;

/** Which of the user's roles supplies an inherited permission (for display). */
function inheritedSource(key: string, roleKeys: string[]): string | undefined {
  for (const rk of roleKeys) {
    const def = ROLE_CATALOG.find((r) => r.key === rk);
    if (def && def.permissions.includes(key)) return def.displayName;
  }
  return undefined;
}

export function PermissionsEditor({
  userId,
  profile,
  canManage,
  onSaved,
}: {
  userId: string;
  profile: AccessUserProfile;
  canManage: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const inherited = useMemo(() => new Set(profile.permissions.inherited), [profile]);
  const roleKeys = useMemo(
    () => [profile.roles.primary, ...profile.roles.additional].filter(Boolean) as string[],
    [profile],
  );

  // Working override map, seeded from the profile's explicit grants/denies.
  const [overrides, setOverrides] = useState<Record<string, Override>>(() => {
    const m: Record<string, Override> = {};
    for (const k of profile.permissions.grants) m[k] = "grant";
    for (const k of profile.permissions.denies) m[k] = "deny";
    return m;
  });
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    const original: Record<string, Override> = {};
    for (const k of profile.permissions.grants) original[k] = "grant";
    for (const k of profile.permissions.denies) original[k] = "deny";
    const keys = new Set([...Object.keys(original), ...Object.keys(overrides)]);
    for (const k of keys) if ((original[k] ?? null) !== (overrides[k] ?? null)) return true;
    return false;
  }, [overrides, profile]);

  function setOverride(key: string, next: Override) {
    setOverrides((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }

  function stateFor(key: string): AccessState {
    const o = overrides[key] ?? null;
    if (o === "deny") return "deny";
    if (o === "grant") return "grant";
    if (inherited.has(key)) return "inherited";
    return "none";
  }

  async function save() {
    setSaving(true);
    try {
      const grants = Object.entries(overrides).filter(([, v]) => v === "grant").map(([k]) => k);
      const denies = Object.entries(overrides).filter(([, v]) => v === "deny").map(([k]) => k);
      await accessApi.setPermissions(userId, grants, denies);
      toast({ title: "Permissions saved", description: "Effective access recalculated." });
      onSaved();
    } catch (err) {
      toast({ title: "Could not save permissions", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // Group catalog by category, preserving catalog order.
  const grouped = useMemo(() => {
    const groups: { category: string; items: typeof PERMISSION_CATALOG[number][] }[] = [];
    for (const p of PERMISSION_CATALOG) {
      let g = groups.find((x) => x.category === p.category);
      if (!g) {
        g = { category: p.category, items: [] };
        groups.push(g);
      }
      g.items.push(p);
    }
    return groups;
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-600">Inherited</span> comes from assigned roles.{" "}
        <span className="font-semibold text-slate-600">Grant</span> adds access for this user.{" "}
        <span className="font-semibold text-slate-600">Deny</span> removes access even if a role grants it.
      </div>

      {grouped.map((group) => (
        <div key={group.category}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {group.category}
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80">
            {group.items.map((p) => {
              const state = stateFor(p.key);
              const source = state === "inherited" ? inheritedSource(p.key, roleKeys) : undefined;
              return (
                <div key={p.key} className="flex items-center gap-3 px-3 py-2" data-testid={`perm-row-${p.key}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-[12px] font-medium text-slate-700">{p.key}</code>
                      <AccessStateBadge state={state} source={source} />
                    </div>
                    <div className="truncate text-[11px] text-slate-400">{p.description}</div>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <IconToggle
                        active={overrides[p.key] === "grant"}
                        activeClass="bg-emerald-100 text-emerald-700"
                        title="Grant"
                        onClick={() => setOverride(p.key, overrides[p.key] === "grant" ? null : "grant")}
                        testId={`grant-${p.key}`}
                      >
                        <ShieldPlus className="h-3.5 w-3.5" />
                      </IconToggle>
                      <IconToggle
                        active={overrides[p.key] === "deny"}
                        activeClass="bg-rose-100 text-rose-700"
                        title="Deny"
                        onClick={() => setOverride(p.key, overrides[p.key] === "deny" ? null : "deny")}
                        testId={`deny-${p.key}`}
                      >
                        <ShieldMinus className="h-3.5 w-3.5" />
                      </IconToggle>
                      <IconToggle
                        active={false}
                        activeClass=""
                        title="Remove override"
                        disabled={!overrides[p.key]}
                        onClick={() => setOverride(p.key, null)}
                        testId={`clear-${p.key}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </IconToggle>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {canManage && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 bg-white/95 py-2 backdrop-blur">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="button-save-permissions">
            <Check className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save Permissions"}
          </Button>
        </div>
      )}
    </div>
  );
}

function IconToggle({
  active,
  activeClass,
  title,
  onClick,
  disabled,
  testId,
  children,
}: {
  active: boolean;
  activeClass: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40",
        active && activeClass,
      )}
      data-testid={`button-${testId}`}
    >
      {children}
    </button>
  );
}
