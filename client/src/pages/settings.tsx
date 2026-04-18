import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Database, Settings as SettingsIcon, Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TeamMember = {
  id: string;
  name: string;
  initials: string;
  role: string;
};

type ClinicSpreadsheetConnection = {
  clinicKey: string;
  clinicLabel: string;
  spreadsheetId: string;
  patientTabName: string;
  calendarTabName: string;
};

type SettingsSnapshot = {
  teamMembers: TeamMember[];
  clinicSpreadsheetConnections: ClinicSpreadsheetConnection[];
  sharedCalendarSpreadsheetId: string;
};

export default function SettingsPage() {
  const { data } = useQuery<SettingsSnapshot>({
    queryKey: ["/api/settings/platform"],
    queryFn: async () => {
      const res = await fetch("/api/settings/platform");
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-6 py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" className="rounded-2xl border-white/60 bg-white/80 backdrop-blur">
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <div className="rounded-2xl bg-slate-900/5 p-2 text-slate-700">
                <SettingsIcon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
                <p className="text-sm text-slate-600">Team members, patient databases, and clinic spreadsheet connections.</p>
              </div>
            </div>
          </div>
        </div>

        <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-700" />
            <h2 className="text-lg font-semibold text-slate-900">Team Members</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {(data?.teamMembers || []).map((member) => (
              <div key={member.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-sm font-semibold text-blue-700">
                    {member.initials}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{member.name}</p>
                    <p className="text-sm text-slate-500">{member.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <Sheet className="h-5 w-5 text-green-700" />
            <h2 className="text-lg font-semibold text-slate-900">Clinic Spreadsheet Connections</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(data?.clinicSpreadsheetConnections || []).map((conn) => (
              <div key={conn.clinicKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-900">{conn.clinicLabel}</p>
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                    {conn.clinicKey}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p>Spreadsheet ID: {conn.spreadsheetId || "Not configured"}</p>
                  <p>Patient tab: {conn.patientTabName}</p>
                  <p>Calendar tab: {conn.calendarTabName}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Shared calendar spreadsheet ID: {data?.sharedCalendarSpreadsheetId || "Not configured"}
          </div>
        </Card>
      </div>
    </div>
  );
}
