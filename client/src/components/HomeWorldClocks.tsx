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

  const abbrParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
    hour: "2-digit",
  }).formatToParts(now);
  const abbr = abbrParts.find((p) => p.type === "timeZoneName")?.value ?? "";

  return { hours, minutes, seconds, digital, abbr };
}

function ClockFace({ time }: { time: ZonedTime }) {
  const size = 96;
  const center = size / 2;
  const hourAngle = (time.hours % 12) * 30 + time.minutes * 0.5;
  const minuteAngle = time.minutes * 6 + time.seconds * 0.1;
  const secondAngle = time.seconds * 6;

  const hand = (angleDeg: number, length: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x2: center + length * Math.cos(rad),
      y2: center + length * Math.sin(rad),
    };
  };

  const hourHand = hand(hourAngle, 24);
  const minuteHand = hand(minuteAngle, 34);
  const secondHand = hand(secondAngle, 38);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="drop-shadow-sm"
      role="img"
      aria-label={`Analog clock showing ${time.digital}`}
    >
      <circle
        cx={center}
        cy={center}
        r={center - 3}
        className="fill-white dark:fill-card stroke-slate-200 dark:stroke-border"
        strokeWidth={2}
      />
      {Array.from({ length: 12 }).map((_, i) => {
        const rad = (i * 30 * Math.PI) / 180;
        const inner = center - 9;
        const outer = center - 5;
        return (
          <line
            key={i}
            x1={center + inner * Math.sin(rad)}
            y1={center - inner * Math.cos(rad)}
            x2={center + outer * Math.sin(rad)}
            y2={center - outer * Math.cos(rad)}
            className="stroke-slate-300 dark:stroke-muted-foreground/40"
            strokeWidth={i % 3 === 0 ? 2 : 1}
            strokeLinecap="round"
          />
        );
      })}
      <line
        x1={center}
        y1={center}
        x2={hourHand.x2}
        y2={hourHand.y2}
        className="stroke-slate-800 dark:stroke-foreground"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <line
        x1={center}
        y1={center}
        x2={minuteHand.x2}
        y2={minuteHand.y2}
        className="stroke-slate-600 dark:stroke-foreground/80"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <line
        x1={center}
        y1={center}
        x2={secondHand.x2}
        y2={secondHand.y2}
        className="stroke-rose-500"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <circle cx={center} cy={center} r={2.5} className="fill-slate-800 dark:fill-foreground" />
    </svg>
  );
}

export function HomeWorldClocks() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="flex flex-wrap justify-center gap-3 sm:gap-4"
      data-testid="row-world-clocks"
    >
      {CLOCKS.map((clock) => {
        const time = getZonedTime(clock.timeZone, now);
        return (
          <div
            key={clock.label}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200/70 dark:border-border bg-white/70 dark:bg-card/50 backdrop-blur px-4 py-3 min-w-[110px]"
            data-testid={`clock-${clock.label.toLowerCase()}`}
          >
            <div className="text-[12px] font-semibold text-slate-700 dark:text-foreground tracking-tight">
              {clock.label}
            </div>
            <ClockFace time={time} />
            <div className="flex flex-col items-center leading-tight">
              <span
                className="text-[13px] font-semibold text-slate-900 dark:text-foreground tabular-nums"
                data-testid={`text-clock-time-${clock.label.toLowerCase()}`}
              >
                {time.digital}
              </span>
              {time.abbr && (
                <span className="text-[10px] font-medium text-slate-400 dark:text-muted-foreground uppercase tracking-wide">
                  {time.abbr}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
