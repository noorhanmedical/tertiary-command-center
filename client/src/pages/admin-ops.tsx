import { Link } from "wouter";
import { ArrowLeft, CreditCard, Settings as SettingsIcon, Shield, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QualificationModeSettings } from "@/components/QualificationModeSettings";
import { PageHeader } from "@/components/PageHeader";

export default function AdminOpsPage() {
  return (
    <div className="finance-page">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">
        <PageHeader
          backHref="/"
          eyebrow="PLEXUS ANCILLARY · ADMIN OPS"
          icon={Shield}
          title="Admin Ops"
          subtitle="Administrative-only surfaces for billing and system configuration."
        />

        <div className="grid gap-5 md:grid-cols-2">
          <Link href="/billing">
            <Card className="group cursor-pointer rounded-3xl border border-white/60 bg-white/75 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl transition hover:shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
                  <CreditCard className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Billing</h2>
                  <p className="text-sm text-slate-600">Billing tracker, spreadsheet sync, and invoice workflow.</p>
                </div>
              </div>
            </Card>
          </Link>

          <Link href="/settings">
            <Card className="group cursor-pointer rounded-3xl border border-white/60 bg-white/75 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl transition hover:shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-100 p-3 text-blue-700">
                  <SettingsIcon className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
                  <p className="text-sm text-slate-600">Team members, clinic sheet connections, and database mapping.</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>

        <Card className="rounded-3xl border border-white/60 bg-white/75 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-2xl bg-violet-100 p-3 text-violet-700">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Qualification Mode</h2>
              <p className="text-sm text-slate-600">Control how aggressively the AI qualifies patients per facility.</p>
            </div>
          </div>
          <QualificationModeSettings />
        </Card>
      </div>
    </div>
  );
}
