import { Building2, CalendarPlus, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OutreachCallItem } from "./types";

export function MissionControlBar({
  selectedItem, onDisposition, onBook, onSkip,
}: {
  selectedItem: OutreachCallItem | null;
  onDisposition: () => void;
  onBook: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="px-5 py-4"
      data-testid="mission-control-bar"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mission control</span>
        {selectedItem ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="mc-active-status">
            <Megaphone className="h-3.5 w-3.5 text-indigo-500" />
            <span className="font-semibold text-slate-800 truncate max-w-[160px]">{selectedItem.patientName}</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-0.5"><Building2 className="h-3 w-3" />{selectedItem.facility}</span>
            {selectedItem.qualifyingTests[0] && (
              <Badge className="rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-100 text-[10px]">
                Next: {selectedItem.qualifyingTests[0]}
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-xs italic text-slate-400" data-testid="mc-idle-status">Pick a patient to start</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!selectedItem} onClick={onSkip} data-testid="mc-skip">
            Skip
          </Button>
          <Button size="sm" variant="outline" disabled={!selectedItem} onClick={onBook} data-testid="mc-book">
            <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Book
          </Button>
          <Button size="sm" disabled={!selectedItem} onClick={onDisposition} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="mc-disposition">
            Disposition
          </Button>
        </div>
      </div>
    </div>
  );
}
