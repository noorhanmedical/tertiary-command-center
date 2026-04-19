import { Link } from "wouter";
import { Shield, Settings, Wrench, Lock, ClipboardList, Building2, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";

const ADMIN_SECTIONS = [
  {
    href: "/settings",
    icon: Settings,
    iconBg: "bg-blue-100 text-blue-700",
    title: "Settings",
    desc: "Team members, clinic spreadsheet connections, and scheduler team configuration.",
    available: true,
  },
  {
    href: "/admin-ops",
    icon: Wrench,
    iconBg: "bg-emerald-100 text-emerald-700",
    title: "System Architecture",
    desc: "Billing configuration, qualification mode, and system-level administrative controls.",
    available: true,
  },
  {
    href: "#",
    icon: Lock,
    iconBg: "bg-amber-100 text-amber-700",
    title: "Access Control",
    desc: "Role-based access, team permissions, and authentication policies.",
    available: false,
  },
  {
    href: "#",
    icon: ClipboardList,
    iconBg: "bg-violet-100 text-violet-700",
    title: "Ancillary Definitions",
    desc: "Manage the canonical list of qualifying tests, CPT codes, and cooldown rules.",
    available: false,
  },
  {
    href: "#",
    icon: Building2,
    iconBg: "bg-rose-100 text-rose-700",
    title: "Clinic Settings",
    desc: "Facility-level configuration, operating hours, and scheduling constraints.",
    available: false,
  },
];

export default function AdminPage() {
  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-900/8 p-3 text-slate-700">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin</h1>
            <p className="text-sm text-slate-600">
              System configuration, access control, and administrative surfaces.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {ADMIN_SECTIONS.map(({ href, icon: Icon, iconBg, title, desc, available }) => {
            const content = (
              <Card
                className={`rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl transition ${
                  available
                    ? "hover:shadow-[0_24px_80px_rgba(15,23,42,0.14)] cursor-pointer"
                    : "opacity-50 cursor-default"
                }`}
                data-testid={`admin-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`rounded-2xl p-3 shrink-0 ${iconBg}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                      {!available && (
                        <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          Coming soon
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{desc}</p>
                  </div>
                  {available && (
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                  )}
                </div>
              </Card>
            );

            return available ? (
              <Link key={title} href={href}>{content}</Link>
            ) : (
              <div key={title}>{content}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
