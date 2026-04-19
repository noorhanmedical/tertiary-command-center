import "./_group.css";
import {
  CalendarPlus,
  FileText,
  Upload,
  Users,
  Phone,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const tiles = [
  { icon: CalendarPlus, label: "New Schedule", hint: "Build today's run", accent: "#C46A4A" },
  { icon: FileText, label: "Documents", hint: "Notes & exports", accent: "#7A8C6A" },
  { icon: Upload, label: "Upload", hint: "Excel · CSV · text", accent: "#C8A75B" },
  { icon: Users, label: "Patient Directory", hint: "Search & history", accent: "#7A8C6A" },
  { icon: Phone, label: "Outreach", hint: "Call list & coverage", accent: "#C46A4A" },
  { icon: Settings, label: "Admin", hint: "Settings & users", accent: "#9B8FA8" },
];

const monthDays = Array.from({ length: 35 }, (_, i) => i - 2);
const today = 19;
const scheduled = new Set([3, 7, 8, 14, 17, 19, 22, 25, 28]);

export function WarmConcierge() {
  return (
    <div
      className="min-h-screen px-10 py-12 font-['DM_Sans']"
      style={{
        background:
          "radial-gradient(ellipse at top, #F5EFE6 0%, #ECE3D4 100%)",
        color: "#3A2E26",
      }}
    >
      {/* Wordmark */}
      <header className="flex flex-col items-center mb-12">
        <div
          className="w-14 h-14 rounded-3xl flex items-center justify-center mb-5 shadow-[0_8px_24px_-8px_rgba(196,106,74,0.45)]"
          style={{
            background:
              "linear-gradient(135deg, #C46A4A 0%, #E2956E 100%)",
          }}
        >
          <span
            className="text-white text-2xl"
            style={{ fontFamily: "'Fraunces', serif", fontWeight: 600 }}
          >
            p
          </span>
        </div>
        <h1
          className="text-4xl tracking-tight"
          style={{
            fontFamily: "'Fraunces', serif",
            fontWeight: 500,
            color: "#3A2E26",
            letterSpacing: "-0.02em",
          }}
        >
          Welcome back, Priya.
        </h1>
        <p className="mt-2 text-sm" style={{ color: "#7A6B5D" }}>
          Friday, April 19  ·  Let's take great care of folks today.
        </p>
      </header>

      {/* Tile grid */}
      <div className="grid grid-cols-3 gap-5 max-w-4xl mx-auto mb-12">
        {tiles.map(({ icon: Icon, label, hint, accent }) => (
          <button
            key={label}
            className="group rounded-3xl p-6 text-left transition-all hover:-translate-y-0.5"
            style={{
              background: "#FBF7F0",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -16px rgba(58,46,38,0.25), 0 2px 6px -3px rgba(58,46,38,0.12)",
            }}
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
              style={{
                background: `${accent}1A`,
                color: accent,
              }}
            >
              <Icon className="w-5 h-5" strokeWidth={2} />
            </div>
            <div
              className="text-base mb-1"
              style={{
                fontFamily: "'Fraunces', serif",
                fontWeight: 600,
                color: "#3A2E26",
              }}
            >
              {label}
            </div>
            <div className="text-xs" style={{ color: "#8A7B6B" }}>
              {hint}
            </div>
          </button>
        ))}
      </div>

      {/* Schedule Dashboard */}
      <section
        className="max-w-4xl mx-auto rounded-3xl p-7"
        style={{
          background: "#FBF7F0",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 16px 40px -24px rgba(58,46,38,0.25)",
        }}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: "#A89A88" }}>
              Schedule Dashboard
            </div>
            <h2
              className="text-2xl mt-0.5"
              style={{
                fontFamily: "'Fraunces', serif",
                fontWeight: 500,
                color: "#3A2E26",
              }}
            >
              April 2026
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: "#F0E7D5", color: "#3A2E26" }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: "#F0E7D5", color: "#3A2E26" }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="text-center text-[11px] py-2"
              style={{ color: "#A89A88" }}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {monthDays.map((d) => {
            const valid = d >= 1 && d <= 30;
            const isToday = d === today;
            const has = scheduled.has(d);
            return (
              <div
                key={d}
                className="aspect-square rounded-2xl p-2 flex flex-col"
                style={{
                  background: isToday
                    ? "linear-gradient(135deg, #C46A4A 0%, #E2956E 100%)"
                    : has && valid
                      ? "#F5EBDB"
                      : valid
                        ? "#FBF7F0"
                        : "transparent",
                  color: isToday
                    ? "#FFFFFF"
                    : valid
                      ? "#3A2E26"
                      : "#D6CCBC",
                  boxShadow: isToday
                    ? "0 6px 16px -8px rgba(196,106,74,0.55)"
                    : valid
                      ? "0 1px 0 rgba(255,255,255,0.8) inset"
                      : "none",
                }}
              >
                <div
                  className="text-sm"
                  style={{
                    fontFamily: "'Fraunces', serif",
                    fontWeight: isToday ? 600 : 500,
                  }}
                >
                  {valid ? d : ""}
                </div>
                {has && valid && (
                  <div
                    className="mt-auto self-start w-1.5 h-1.5 rounded-full"
                    style={{
                      background: isToday ? "#FFFFFF" : "#C46A4A",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
