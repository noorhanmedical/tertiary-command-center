import { Link } from "wouter";
import { ArrowLeft, CreditCard, Settings as SettingsIcon, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AdminOpsPage() {
  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" className="rounded-2xl border-white/60 bg-white/80 backdrop-blur">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-slate-900/5 p-2 text-slate-700">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin Ops</h1>
              <p className="text-sm text-slate-600">Administrative-only surfaces for billing and system configuration.</p>
            </div>
          </div>
        </div>

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
      </div>
    </div>
  );
}
