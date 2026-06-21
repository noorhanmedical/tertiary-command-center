import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Pencil, Plus, Trash2, ChevronUp, ChevronDown, Check } from "lucide-react";

type ClockCity = {
  label: string;
  timeZone: string;
};

const DEFAULT_CLOCKS: ClockCity[] = [
  { label: "Manila", timeZone: "Asia/Manila" },
  { label: "Dhaka", timeZone: "Asia/Dhaka" },
  { label: "Arizona", timeZone: "America/Phoenix" },
  { label: "Houston", timeZone: "America/Chicago" },
  { label: "Michigan", timeZone: "America/Detroit" },
];

function getSupportedTimeZones(): string[] {
  try {
    const fn = (Intl as any).supportedValuesOf;
    if (typeof fn === "function") {
      return fn("timeZone") as string[];
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CLOCKS.map((c) => c.timeZone);
}

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

function TimeZoneCombobox({
  value,
  onChange,
  zones,
}: {
  value: string;
  onChange: (tz: string) => void;
  zones: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          data-testid="button-select-timezone"
        >
          <span className="truncate">{value || "Select time zone"}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search time zone..." />
          <CommandList>
            <CommandEmpty>No time zone found.</CommandEmpty>
            <CommandGroup>
              {zones.map((tz) => (
                <CommandItem
                  key={tz}
                  value={tz}
                  onSelect={() => {
                    onChange(tz);
                    setOpen(false);
                  }}
                  data-testid={`option-timezone-${tz}`}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${value === tz ? "opacity-100" : "opacity-0"}`}
                  />
                  {tz}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function WorldClocksEditor({
  cities,
  onSaved,
}: {
  cities: ClockCity[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ClockCity[]>(cities);
  const zones = useMemo(() => getSupportedTimeZones(), []);

  useEffect(() => {
    if (open) setDraft(cities);
  }, [open, cities]);

  const saveMutation = useMutation({
    mutationFn: async (next: ClockCity[]) => {
      const res = await apiRequest("POST", "/api/settings/world-clocks", { cities: next });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/world-clocks"] });
      toast({ title: "World clocks updated" });
      setOpen(false);
      onSaved();
    },
    onError: (err: any) => {
      toast({
        title: "Could not save",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateCity = (index: number, patch: Partial<ClockCity>) => {
    setDraft((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const removeCity = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const moveCity = (index: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addCity = () => {
    setDraft((prev) => [...prev, { label: "", timeZone: "" }]);
  };

  const canSave =
    draft.length > 0 &&
    draft.every((c) => c.label.trim().length > 0 && c.timeZone.trim().length > 0) &&
    draft.length <= 12;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-slate-500 dark:text-muted-foreground"
          data-testid="button-edit-world-clocks"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit clocks
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit world clocks</DialogTitle>
          <DialogDescription>
            Add, remove, or reorder the cities shown in the world clocks row. The row always
            sorts from earliest to latest local time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[55vh] overflow-auto pr-1">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No cities yet. Add one below.
            </p>
          )}
          {draft.map((city, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-lg border border-border p-2"
              data-testid={`row-edit-city-${index}`}
            >
              <div className="flex flex-col gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => moveCity(index, -1)}
                  disabled={index === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  data-testid={`button-move-up-${index}`}
                  aria-label="Move up"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveCity(index, 1)}
                  disabled={index === draft.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  data-testid={`button-move-down-${index}`}
                  aria-label="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  value={city.label}
                  placeholder="Label (e.g. Manila)"
                  onChange={(e) => updateCity(index, { label: e.target.value })}
                  data-testid={`input-city-label-${index}`}
                />
                <TimeZoneCombobox
                  value={city.timeZone}
                  zones={zones}
                  onChange={(tz) => updateCity(index, { timeZone: tz })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => removeCity(index)}
                data-testid={`button-remove-city-${index}`}
                aria-label="Remove city"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            className="w-full gap-1.5"
            onClick={addCity}
            disabled={draft.length >= 12}
            data-testid="button-add-city"
          >
            <Plus className="h-4 w-4" />
            Add city
          </Button>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            data-testid="button-cancel-world-clocks"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate(draft.map((c) => ({ label: c.label.trim(), timeZone: c.timeZone.trim() })))}
            disabled={!canSave || saveMutation.isPending}
            data-testid="button-save-world-clocks"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HomeWorldClocks() {
  const [now, setNow] = useState(() => new Date());

  const { data } = useQuery<{ cities: ClockCity[] }>({
    queryKey: ["/api/settings/world-clocks"],
  });

  const cities = data?.cities ?? DEFAULT_CLOCKS;

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clocks = cities
    .map((clock) => ({
      ...clock,
      time: getZonedTime(clock.timeZone, now),
    }))
    .sort((a, b) => {
      const aSecs = a.time.hours * 3600 + a.time.minutes * 60 + a.time.seconds;
      const bSecs = b.time.hours * 3600 + b.time.minutes * 60 + b.time.seconds;
      return aSecs - bSecs;
    });

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex flex-wrap justify-center gap-3 sm:gap-4"
        data-testid="row-world-clocks"
      >
        {clocks.map((clock, index) => {
          const time = clock.time;
          const key = `${clock.label}-${clock.timeZone}-${index}`;
          const idBase = clock.label.toLowerCase().replace(/\s+/g, "-");
          return (
            <div
              key={key}
              className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200/70 dark:border-border bg-white/70 dark:bg-card/50 backdrop-blur px-4 py-3 min-w-[110px]"
              data-testid={`clock-${idBase}`}
            >
              <div className="text-[12px] font-semibold text-slate-700 dark:text-foreground tracking-tight">
                {clock.label}
              </div>
              <div className="flex flex-col items-center leading-tight">
                <span
                  className="text-[20px] font-semibold text-slate-900 dark:text-foreground tabular-nums"
                  data-testid={`text-clock-time-${idBase}`}
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
                  data-testid={`text-clock-date-${idBase}`}
                >
                  {time.date}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <WorldClocksEditor cities={cities} onSaved={() => {}} />
    </div>
  );
}
