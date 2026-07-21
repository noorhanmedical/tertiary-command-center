import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Shield, Clock, FileText } from "lucide-react";
import { NAV_ITEMS } from "@/components/GlobalNav";
import type { AuthUser } from "@/App";

export default function WinterHomePage({ user }: { user?: AuthUser }) {
  const [location] = useLocation();
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const userRole = user?.role ?? "clinician";

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      setDate(now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: todaySummary } = useQuery<{ patientCount: number; batchCount: number }>({
    queryKey: ["/api/schedule/today-summary"],
    refetchInterval: 60_000,
  });

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(userRole));
  const mainItems = visibleItems.filter(
    (i) => !["/clinician-portal", "/technician-portal", "/liaison-technician-portal", "/admin/settings"].includes(i.href),
  );
  const portalItems = visibleItems.filter(
    (i) => ["/clinician-portal", "/technician-portal", "/liaison-technician-portal", "/admin/settings"].includes(i.href),
  );

  const renderDockItem = (item: (typeof NAV_ITEMS)[number]) => {
    const isActive = location === item.href || location.startsWith(item.href + "/");
    return (
      <Link key={item.href} href={item.href}>
        <div
          className="relative group flex flex-col items-center cursor-pointer"
          data-testid={`dock-item-${item.href.replace(/\//g, "")}`}
        >
          <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap pointer-events-none z-10">
            {item.label}
          </div>
          <div className="w-11 h-11 rounded-[10px] flex items-center justify-center shadow-lg transform transition-all duration-200 origin-bottom group-hover:scale-[1.3] group-hover:-translate-y-2 border border-white/20 bg-gradient-to-b from-sky-700/90 to-blue-900/90 group-hover:from-cyan-400 group-hover:to-teal-500 group-hover:shadow-[0_0_18px_rgba(45,212,191,0.8)] group-hover:border-cyan-200/60">
            <item.Icon className="w-6 h-6 text-sky-100 group-hover:text-white transition-colors" strokeWidth={1.5} />
          </div>
          <div className={`w-1 h-1 rounded-full mt-1.5 ${isActive ? "bg-cyan-300" : "bg-transparent"}`} />
        </div>
      </Link>
    );
  };

  return (
    <div className="relative h-full w-full overflow-hidden font-sans select-none">
      {/* Wallpaper */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url("/winter-wallpaper.png")' }}
      />

      {/* Falling snow */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @keyframes wh-snowfall {
            0% { transform: translateY(-10vh) translateX(0); opacity: 1; }
            100% { transform: translateY(110vh) translateX(20px); opacity: 0.3; }
          }
          .wh-snowflake {
            position: absolute;
            background: white;
            border-radius: 50%;
            filter: blur(1px);
            animation: wh-snowfall linear infinite;
          }
          `,
        }}
      />
      {[...Array(40)].map((_, i) => (
        <div
          key={i}
          className="wh-snowflake"
          style={{
            left: `${(i * 61) % 100}vw`,
            animationDuration: `${((i * 7) % 50) / 10 + 5}s`,
            animationDelay: `-${(i * 13) % 10}s`,
            opacity: ((i * 17) % 50) / 100 + 0.3,
            width: `${((i * 11) % 30) / 10 + 2}px`,
            height: `${((i * 11) % 30) / 10 + 2}px`,
          }}
        />
      ))}

      {/* Glass status bar */}
      <div className="absolute top-0 left-0 right-0 z-40 flex h-12 items-center justify-between bg-white/10 px-5 backdrop-blur-xl border-b border-white/20 text-sm font-medium text-slate-700 shadow-sm">
        <div className="flex items-center gap-3">
          {todaySummary && (
            <span className="opacity-80" data-testid="text-today-summary">
              Today: {todaySummary.patientCount} patients · {todaySummary.batchCount} schedules
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 opacity-90 cursor-default hover:bg-white/20 px-2 py-0.5 rounded transition-colors">
            <Shield className="w-4 h-4" />
            <span>VPN</span>
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 ml-0.5" />
          </div>
          <div className="flex items-center gap-1.5 opacity-90 cursor-default hover:bg-white/20 px-2 py-0.5 rounded transition-colors">
            <Clock className="w-4 h-4" />
            <span>Time Doctor</span>
          </div>
          <div className="flex items-center gap-1.5 opacity-90 cursor-default hover:bg-white/20 px-2 py-0.5 rounded transition-colors">
            <FileText className="w-4 h-4" />
            <span>EOD Report</span>
          </div>
          <div className="flex items-center gap-2 pl-2" data-testid="text-clock">
            <span>{date}</span>
            <span>{time}</span>
          </div>
        </div>
      </div>

      {/* Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40">
        <div className="flex items-end gap-2 px-3 pb-2 pt-3 bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-2xl">
          {mainItems.map(renderDockItem)}
          {portalItems.length > 0 && <div className="w-px h-11 bg-white/30 mx-1 self-start mt-2" />}
          {portalItems.map(renderDockItem)}
        </div>
      </div>
    </div>
  );
}
