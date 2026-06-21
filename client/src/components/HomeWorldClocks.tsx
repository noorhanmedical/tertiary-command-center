import { useEffect, useState } from "react";

type ClockCity = {
  label: string;
  timeZone: string;
};

const CLOCKS: ClockCity[] = [
  { label: "Manila", timeZone: "Asia/Manila" },
  { label: "Dhaka", timeZone: "Asia/Dhaka" },
  { label: "Arizona", timeZone: "America/Phoenix" },
  { label: "Houston", timeZone: "America/Chicago" },
  { label: "Michigan", timeZone: "America/Detroit" },
];

type ZonedTime = {
  hours: number;
  minutes: number;
  seconds: number;
  digital: string;
  date: string;
  abbr: string;
};

function getZonedTime(timeZone: string, now: Date): ZonedTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);

  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hours = pick("hour");
  if (hours === 24) hours = 0;
  const minutes = pick("minute");
  const seconds = pick("second");

  const digital = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: true,
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(now);

  const abbrParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
    hour: "2-digit",
  }).formatToParts(now);
  const abbr = abbrParts.find((p) => p.type === "timeZoneName")?.value ?? "";

  return { hours, minutes, seconds, digital, date, abbr };
}

export function HomeWorldClocks() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clocks = CLOCKS.map((clock) => ({
    ...clock,
    time: getZonedTime(clock.timeZone, now),
  })).sort((a, b) => {
    const aSecs = a.time.hours * 3600 + a.time.minutes * 60 + a.time.seconds;
    const bSecs = b.time.hours * 3600 + b.time.minutes * 60 + b.time.seconds;
    return aSecs - bSecs;
  });

  return (
    <div
      className="flex flex-wrap justify-center gap-3 sm:gap-4"
      data-testid="row-world-clocks"
    >
      {clocks.map((clock) => {
        const time = clock.time;
        return (
          <div
            key={clock.label}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200/70 dark:border-border bg-white/70 dark:bg-card/50 backdrop-blur px-4 py-3 min-w-[110px]"
            data-testid={`clock-${clock.label.toLowerCase()}`}
          >
            <div className="text-[12px] font-semibold text-slate-700 dark:text-foreground tracking-tight">
              {clock.label}
            </div>
            <div className="flex flex-col items-center leading-tight">
              <span
                className="text-[20px] font-semibold text-slate-900 dark:text-foreground tabular-nums"
                data-testid={`text-clock-time-${clock.label.toLowerCase()}`}
              >
                {time.digital}
              </span>
              {time.abbr && (
                <span className="text-[10px] font-medium text-slate-400 dark:text-muted-foreground uppercase tracking-wide">
                  {time.abbr}
                </span>
              )}
              <span
                className="text-[11px] font-medium text-slate-400 dark:text-muted-foreground"
                data-testid={`text-clock-date-${clock.label.toLowerCase()}`}
              >
                {time.date}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
