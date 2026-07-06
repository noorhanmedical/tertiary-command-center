import React, { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";
import { PlexusIQCalendar, type CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";

export function CalendarDockPopup() {
  const { profile } = useCommandCenter();
  const [, navigate] = useLocation();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: summary = [] } = useQuery<CalendarSummaryRow[]>({
    queryKey: ["/api/screening-batches/calendar-summary"],
    queryFn: async () => {
      const res = await fetch("/api/screening-batches/calendar-summary", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Calendar summary fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const context = {
    sourceSurface: profile.surface,
    componentType: "calendarDate" as const,
    selectedDate: selectedDate ?? new Date().toISOString().slice(0, 10),
    facilityId: "all",
    title: "Calendar Date",
  };

  return (
    <PanelPopupCard title="Calendar" eyebrow="Date preview" icon={<CalendarDays className="h-5 w-5" />} context={context}>
      <div className="max-h-[60vh] overflow-y-auto" data-testid="command-left-rail-calendar-panel">
        <PlexusIQCalendar
          summary={summary}
          onSelectDate={(isoDate) => setSelectedDate(isoDate)}
          onAssignDate={() => navigate("/plexus-iq")}
          selectedDate={selectedDate}
          compact
        />
      </div>
    </PanelPopupCard>
  );
}
