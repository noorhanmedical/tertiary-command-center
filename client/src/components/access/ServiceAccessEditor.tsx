// Phase 4B — per-user service-access override editor.
//
// Service access is DISTINCT from a permission: a permission is a capability
// (e.g. procedure.perform); a service is which ancillary line the user may act
// on (e.g. Ultrasound). Both may be required for a real workflow. The service
// universe comes from the backend service registry — never hard-coded.

import { useMemo, useState } from "react";
import { Check, ShieldMinus, ShieldPlus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { accessApi, describeAccessError, type AccessUserProfile } from "@/lib/access/accessApi";
import { useAccessServices } from "@/hooks/api/access";
import { AccessStateBadge, LoadingState, EmptyState, type AccessState } from "./AccessPrimitives";

type Override = "grant" | "deny" | null;

export function ServiceAccessEditor({
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
  const servicesQuery = useAccessServices();
  const inherited = useMemo(() => new Set(profile.serviceAccess.inherited), [profile]);

  const [overrides, setOverrides] = useState<Record<string, Override>>(() => {
    const m: Record<string, Override> = {};
    for (const c of profile.serviceAccess.grants) m[c] = "grant";
    for (const c of profile.serviceAccess.denies) m[c] = "deny";
    return m;
  });
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    const original: Record<string, Override> = {};
    for (const c of profile.serviceAccess.grants) original[c] = "grant";
    for (const c of profile.serviceAccess.denies) original[c] = "deny";
    const keys = new Set([...Object.keys(original), ...Object.keys(overrides)]);
    for (const k of keys) if ((original[k] ?? null) !== (overrides[k] ?? null)) return true;
    return false;
  }, [overrides, profile]);

  function setOverride(code: string, next: Override) {
    setOverrides((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[code];
      else copy[code] = next;
      return copy;
    });
  }

  function stateFor(code: string): AccessState {
    const o = overrides[code] ?? null;
    if (o === "deny") return "deny";
    if (o === "grant") return "grant";
    if (inherited.has(code)) return "inherited";
    return "none";
  }

  async function save() {
    setSaving(true);
    try {
      const grants = Object.entries(overrides).filter(([, v]) => v === "grant").map(([k]) => k);
      const denies = Object.entries(overrides).filter(([, v]) => v === "deny").map(([k]) => k);
      await accessApi.setServices(userId, grants, denies);
      toast({ title: "Service access saved", description: "Effective service access recalculated." });
      onSaved();
    } catch (err) {
      toast({ title: "Could not save service access", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (servicesQuery.isLoading) return <LoadingState label="Loading services…" />;
  const services = (servicesQuery.data ?? []).filter((s) => s.active);
  if (services.length === 0) return <EmptyState label="No services available" />;

  return (
    <div className="space-y-3">
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80">
        {services.map((s) => {
          const state = stateFor(s.internalCode);
          return (
            <div key={s.internalCode} className="flex items-center gap-3 px-3 py-2" data-testid={`svc-row-${s.internalCode}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-slate-700">{s.displayName}</span>
                  <AccessStateBadge state={state} source={state === "inherited" ? "role" : undefined} />
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  <code>{s.internalCode}</code>
                  {s.category ? ` · ${s.category}` : ""}
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  <ServiceToggle
                    active={overrides[s.internalCode] === "grant"}
                    activeClass="bg-emerald-100 text-emerald-700"
                    title="Grant"
                    onClick={() => setOverride(s.internalCode, overrides[s.internalCode] === "grant" ? null : "grant")}
                    testId={`svc-grant-${s.internalCode}`}
                  >
                    <ShieldPlus className="h-3.5 w-3.5" />
                  </ServiceToggle>
                  <ServiceToggle
                    active={overrides[s.internalCode] === "deny"}
                    activeClass="bg-rose-100 text-rose-700"
                    title="Deny"
                    onClick={() => setOverride(s.internalCode, overrides[s.internalCode] === "deny" ? null : "deny")}
                    testId={`svc-deny-${s.internalCode}`}
                  >
                    <ShieldMinus className="h-3.5 w-3.5" />
                  </ServiceToggle>
                  <ServiceToggle
                    active={false}
                    activeClass=""
                    title="Remove override"
                    disabled={!overrides[s.internalCode]}
                    onClick={() => setOverride(s.internalCode, null)}
                    testId={`svc-clear-${s.internalCode}`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </ServiceToggle>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canManage && (
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="button-save-services">
            <Check className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save Service Access"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ServiceToggle({
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
