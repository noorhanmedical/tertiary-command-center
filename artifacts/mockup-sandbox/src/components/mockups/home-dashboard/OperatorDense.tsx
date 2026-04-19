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
  { icon: CalendarPlus, label: "NEW SCHEDULE", code: "01", hint: "build today's run", primary: true },
  { icon: FileText, label: "DOCUMENTS", code: "02", hint: "notes / exports" },
  { icon: Upload, label: "UPLOAD", code: "03", hint: "xlsx · csv · txt" },
  { icon: Users, label: "DIRECTORY", code: "04", hint: "patients · history" },
  { icon: Phone, label: "OUTREACH", code: "05", hint: "calls · coverage" },
  { icon: Settings, label: "ADMIN", code: "06", hint: "users · settings" },
];

const monthDays = Array.from({ length: 35 }, (_, i) => i - 2);
const today = 19;
const scheduledLoad: Record<number, number> = {
  3: 8, 7: 14, 8: 6, 14: 22, 17: 11, 19: 18, 22: 9, 25: 25, 28: 7,
};

export function OperatorDense() {
  return (
    <div
      className="min-h-screen px-8 py-8 font-['Inter_Tight']"
      style={{
        background: "#0E1116",
        color: "#D6DBE3",
      }}
    >
      {/* Wordmark */}
      <header className="mb-10">
        <div className="flex items-center justify-between max-w-5xl mx-auto pb-4 border-b"
          style={{ borderColor: "#1F2630" }}>
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-sm flex items-center justify-center"
              style={{ background: "#00E5C7", color: "#0E1116" }}
            >
              <span
                className="text-sm font-bold"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                P
              </span>
            </div>
            <div className="leading-tight">
              <div
                className="text-[11px] tracking-[0.18em]"
                style={{ fontFamily: "'JetBrains Mono', monospace", color: "#00E5C7" }}
              >
                PLEXUS / SCREENING
              </div>
              <div className="text-[10px]" style={{ color: "#6B7280", fontFamily: "'JetBrains Mono', monospace" }}>
                v2.4.1 · build 882a · ops mode
              </div>
            </div>
          </div>
          <div
            className="flex items-center gap-6 text-[10px]"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "#6B7280" }}
          >
            <span>FRI 04.19.26 · 14:32 PT</span>
            <span style={{ color: "#00E5C7" }}>● ONLINE</span>
            <span>3 PENDING</span>
          </div>
        </div>
        <div className="text-center mt-8">
          <div
            className="text-[10px] tracking-[0.32em] mb-2"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "#6B7280" }}
          >
            COMMAND DECK
          </div>
          <h1
            className="text-3xl"
            style={{
              fontFamily: "'Inter Tight', sans-serif",
              fontWeight: 600,
              color: "#F1F4F9",
              letterSpacing: "-0.02em",
            }}
          >
            Dr. Mehra · 18 patients on the board today
          </h1>
        </div>
      </header>

      {/* Tile grid */}
      <div className="grid grid-cols-3 gap-2 max-w-5xl mx-auto mb-8">
        {tiles.map(({ icon: Icon, label, code, hint, primary }) => (
          <button
            key={label}
            className="group text-left p-5 transition-colors"
            style={{
              background: primary ? "#162028" : "#141A22",
              border: primary ? "1px solid #00E5C7" : "1px solid #1F2630",
              boxShadow: primary
                ? "0 0 0 1px rgba(0,229,199,0.15) inset, 0 0 32px -8px rgba(0,229,199,0.25)"
                : "none",
            }}
          >
            <div className="flex items-start justify-between mb-6">
              <div
                className="w-9 h-9 flex items-center justify-center"
                style={{
                  background: primary ? "#00E5C7" : "#0E1116",
                  color: primary ? "#0E1116" : "#D6DBE3",
                  border: primary ? "none" : "1px solid #1F2630",
                }}
              >
                <Icon className="w-4 h-4" strokeWidth={1.75} />
              </div>
              <span
                className="text-[10px]"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  color: primary ? "#00E5C7" : "#6B7280",
                }}
              >
                {code}
              </span>
            </div>
            <div
              className="text-[12px] tracking-[0.14em] mb-1"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                color: primary ? "#F1F4F9" : "#D6DBE3",
                fontWeight: 600,
              }}
            >
              {label}
            </div>
            <div
              className="text-[11px]"
              style={{ color: "#6B7280", fontFamily: "'JetBrains Mono', monospace" }}
            >
              {hint}
            </div>
          </button>
        ))}
      </div>

      {/* Schedule Dashboard */}
      <section
        className="max-w-5xl mx-auto p-6"
        style={{
          background: "#141A22",
          border: "1px solid #1F2630",
        }}
      >
        <div className="flex items-center justify-between mb-5 pb-4 border-b"
          style={{ borderColor: "#1F2630" }}>
          <div>
            <div
              className="text-[10px] tracking-[0.24em]"
              style={{ fontFamily: "'JetBrains Mono', monospace", color: "#6B7280" }}
            >
              SCHEDULE_DASHBOARD / APR_2026
            </div>
            <h2
              className="text-xl mt-1"
              style={{
                fontFamily: "'Inter Tight', sans-serif",
                fontWeight: 600,
                color: "#F1F4F9",
                letterSpacing: "-0.01em",
              }}
            >
              April 2026
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="w-7 h-7 flex items-center justify-center"
              style={{ background: "#0E1116", border: "1px solid #1F2630" }}
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center"
              style={{ background: "#0E1116", border: "1px solid #1F2630" }}
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px mb-px">
          {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
            <div
              key={d}
              className="text-center text-[9px] tracking-[0.2em] py-2"
              style={{ color: "#6B7280", fontFamily: "'JetBrains Mono', monospace" }}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px" style={{ background: "#1F2630" }}>
          {monthDays.map((d) => {
            const valid = d >= 1 && d <= 30;
            const isToday = d === today;
            const load = scheduledLoad[d];
            return (
              <div
                key={d}
                className="aspect-square p-1.5 flex flex-col justify-between"
                style={{
                  background: isToday ? "#162028" : "#141A22",
                  borderLeft: isToday ? "2px solid #00E5C7" : "none",
                }}
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className="text-[11px]"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: isToday
                        ? "#00E5C7"
                        : valid
                          ? "#D6DBE3"
                          : "#3A4250",
                      fontWeight: isToday ? 600 : 400,
                    }}
                  >
                    {valid ? String(d).padStart(2, "0") : ""}
                  </span>
                  {load && valid && (
                    <span
                      className="text-[9px]"
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        color: isToday ? "#00E5C7" : "#6B7280",
                      }}
                    >
                      {load}
                    </span>
                  )}
                </div>
                {load && valid && (
                  <div className="h-1 flex gap-px">
                    {Array.from({ length: Math.min(load, 8) }).map((_, i) => (
                      <div
                        key={i}
                        className="flex-1"
                        style={{
                          background:
                            isToday
                              ? "#00E5C7"
                              : load > 15
                                ? "#5B7BA8"
                                : "#3A4250",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
