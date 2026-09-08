// Phase 4B — Security section. Reflects REAL capabilities only.
//
// Account-status management and last-login visibility are real. MFA requirement
// is a stored flag whose ENFORCEMENT is not yet enabled — we say so plainly and
// never imply a security capability that does not exist. Session revocation and
// device management are intentionally absent (they do not exist yet).

import { Lock, ShieldAlert, Clock, Users } from "lucide-react";
import { AccessGroup } from "./AccessPrimitives";

export function SecuritySection() {
  return (
    <AccessGroup title="Security" desc="Account and access-security controls that are actually in effect.">
      <div className="space-y-3">
        <Row
          Icon={Users}
          title="Account Status Management"
          status="Active"
          statusTone="ok"
          body="Deactivating a user revokes their access on the next request. Manage per-user status from Users & Access → user detail → Account."
        />
        <Row
          Icon={ShieldAlert}
          title="MFA Requirement"
          status="Configuration present · enforcement not yet enabled"
          statusTone="warn"
          body="An MFA-required flag is stored per user, but MFA is not yet enforced at sign-in. This flag is informational until enforcement ships."
        />
        <Row
          Icon={Clock}
          title="Last-Login Visibility"
          status="Available"
          statusTone="ok"
          body="Each user's last sign-in time is shown in Users & Access and in their detail Account panel."
        />
        <Row
          Icon={Lock}
          title="Session Revocation & Device Management"
          status="Not available"
          statusTone="muted"
          body="Active-session revocation and device management are not implemented. Deactivation is the current access-revocation mechanism."
        />
      </div>
    </AccessGroup>
  );
}

function Row({
  Icon,
  title,
  status,
  statusTone,
  body,
}: {
  Icon: typeof Lock;
  title: string;
  status: string;
  statusTone: "ok" | "warn" | "muted";
  body: string;
}) {
  const tone =
    statusTone === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : statusTone === "warn"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-slate-100 text-slate-500 border-slate-200";
  return (
    <div className="flex gap-3 rounded-xl border border-slate-200/80 p-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{status}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{body}</p>
      </div>
    </div>
  );
}
