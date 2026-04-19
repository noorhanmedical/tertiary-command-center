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
  { icon: CalendarPlus, label: "New Schedule", hint: "Build today's run" },
  { icon: FileText, label: "Documents", hint: "Notes & exports" },
  { icon: Upload, label: "Upload", hint: "Excel · CSV · text" },
  { icon: Users, label: "Patient Directory", hint: "Search & history" },
  { icon: Phone, label: "Outreach", hint: "Call list & coverage" },
  { icon: Settings, label: "Admin", hint: "Settings & users" },
];

const monthDays = Array.from({ length: 35 }, (_, i) => i - 2);
const today = 19;
const scheduled = new Set([3, 7, 8, 14, 17, 19, 22, 25, 28]);

export function CalmClinical() {
  return (
    <div
      className="min-h-screen px-12 py-14 font-['Inter']"
      style={{
        background:
          "linear-gradient(180deg, #FAF7F1 0%, #F4EFE6 100%)",
        color: "#1B1F2A",
      }}
    >
      {/* Wordmark */}
      <header className="flex flex-col items-center mb-14">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-full border"
            style={{
              borderColor: "#1B1F2A",
              background:
                "radial-gradient(circle at 30% 30%, #FAF7F1 0%, #C9BFAB 100%)",
            }}
          />
          <span
            className="text-[11px] tracking-[0.32em] uppercase"
            style={{ color: "#6B6757" }}
          >
            Plexus · Ancillary Screening
          </span>
        </div>
        <h1
          className="text-6xl tracking-tight"
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontWeight: 500,
            letterSpacing: "-0.02em",
          }}
        >
          Good afternoon, Dr. Mehra.
        </h1>
        <p
          className="mt-3 text-sm italic"
          style={{ color: "#6B6757", fontFamily: "'Cormorant Garamond', serif" }}
        >
          Friday, April 19 · Three schedules pending review
        </p>
      </header>

      {/* Tile grid */}
      <div className="grid grid-cols-3 gap-px max-w-4xl mx-auto mb-14"
        style={{ background: "#D8CFBC" }}>
        {tiles.map(({ icon: Icon, label, hint }) => (
          <button
            key={label}
            className="group flex flex-col items-start text-left p-7 transition-colors"
            style={{ background: "#FAF7F1" }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center border mb-5 transition-colors group-hover:bg-[#1B1F2A] group-hover:text-[#FAF7F1]"
              style={{ borderColor: "#1B1F2A", color: "#1B1F2A" }}
            >
              <Icon className="w-4 h-4" strokeWidth={1.25} />
            </div>
            <div
              className="text-[15px] mb-1"
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontWeight: 600,
                fontSize: "20px",
                letterSpacing: "-0.01em",
              }}
            >
              {label}
            </div>
            <div className="text-[11px]" style={{ color: "#6B6757" }}>
              {hint}
            </div>
          </button>
        ))}
      </div>

      {/* Schedule Dashboard */}
      <section
        className="max-w-4xl mx-auto p-8"
        style={{
          background: "#FAF7F1",
          border: "1px solid #1B1F2A",
        }}
      >
        <div className="flex items-baseline justify-between mb-6 pb-4"
          style={{ borderBottom: "1px solid #D8CFBC" }}>
          <div>
            <div className="text-[10px] tracking-[0.32em] uppercase" style={{ color: "#6B6757" }}>
              Schedule Dashboard
            </div>
            <h2
              className="text-3xl mt-1"
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontWeight: 500,
                letterSpacing: "-0.01em",
              }}
            >
              April 2026
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button className="w-8 h-8 flex items-center justify-center border" style={{ borderColor: "#1B1F2A" }}>
              <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.25} />
            </button>
            <button className="w-8 h-8 flex items-center justify-center border" style={{ borderColor: "#1B1F2A" }}>
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.25} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px mb-2">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div
              key={i}
              className="text-center text-[10px] tracking-[0.2em] py-2"
              style={{ color: "#6B6757" }}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px" style={{ background: "#D8CFBC" }}>
          {monthDays.map((d) => {
            const valid = d >= 1 && d <= 30;
            const isToday = d === today;
            const has = scheduled.has(d);
            return (
              <div
                key={d}
                className="aspect-square p-2 flex flex-col"
                style={{
                  background: isToday ? "#1B1F2A" : "#FAF7F1",
                  color: isToday ? "#FAF7F1" : valid ? "#1B1F2A" : "#C9BFAB",
                }}
              >
                <div
                  className="text-xs"
                  style={{
                    fontFamily: "'Cormorant Garamond', serif",
                    fontWeight: 500,
                    fontSize: "15px",
                  }}
                >
                  {valid ? d : ""}
                </div>
                {has && valid && (
                  <div
                    className="mt-auto h-px w-4"
                    style={{ background: isToday ? "#FAF7F1" : "#1B1F2A" }}
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
