import type { Dispatch, SetStateAction } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Calendar, Loader2, Plus, Trash2, Users,
} from "lucide-react";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

interface HomeSidebarProps {
  view: string;
  batches: ScreeningBatchWithPatients[];
  batchesLoading: boolean;
  selectedBatchId: number | null;
  selectedBatchIds: Set<number>;
  setSelectedBatchIds: Dispatch<SetStateAction<Set<number>>>;
  onHistoryTab?: () => void;
  onReferencesTab: () => void;
  onNewSchedule: () => void;
  onSelectSchedule: (batch: ScreeningBatchWithPatients) => void;
  onDeleteBatch: (id: number) => void;
  onDeleteSelected: () => void;
  isDeletingBatch: boolean;
  setSidebarOpen: (v: boolean) => void;
}

export function HomeSidebar({
  view,
  batches,
  batchesLoading,
  selectedBatchId,
  selectedBatchIds,
  setSelectedBatchIds,
  onReferencesTab,
  onNewSchedule,
  onSelectSchedule,
  onDeleteBatch,
  onDeleteSelected,
  isDeletingBatch,
  setSidebarOpen,
}: HomeSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas" data-testid="sidebar-history">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Schedule Views</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => { onReferencesTab(); setSidebarOpen(false); }}
                  isActive={view === "references"}
                  data-testid="sidebar-patient-directory"
                >
                  <Users className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">Patient Directory</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <div className="flex items-center justify-between px-2 pt-2 pb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule History</span>
            {batches.length > 0 && (
              <button
                className="text-[10px] text-primary hover:underline"
                onClick={() =>
                  setSelectedBatchIds(selectedBatchIds.size === batches.length
                    ? new Set()
                    : new Set(batches.map((b) => b.id))
                  )
                }
                data-testid="button-select-all-schedules"
              >
                {selectedBatchIds.size === batches.length && batches.length > 0 ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => { onNewSchedule(); setSidebarOpen(false); }}
                  data-testid="sidebar-new-schedule"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">New Schedule</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {batchesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : batches.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">No schedules yet</div>
              ) : (
                batches.map((batch) => (
                  <SidebarMenuItem key={batch.id}>
                    <div className="flex items-center w-full group">
                      <Checkbox
                        checked={selectedBatchIds.has(batch.id)}
                        onCheckedChange={() => {
                          setSelectedBatchIds((prev) => {
                            const next = new Set(prev);
                            next.has(batch.id) ? next.delete(batch.id) : next.add(batch.id);
                            return next;
                          });
                        }}
                        className="shrink-0 ml-1 mr-1 opacity-40 group-hover:opacity-100 data-[state=checked]:opacity-100 transition-opacity"
                        data-testid={`checkbox-schedule-${batch.id}`}
                      />
                      <SidebarMenuButton
                        onClick={() => onSelectSchedule(batch)}
                        isActive={selectedBatchId === batch.id}
                        tooltip={batch.name}
                        data-testid={`sidebar-schedule-${batch.id}`}
                        className="flex-1 min-w-0"
                      >
                        <Calendar className="w-4 h-4 shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <span className="truncate text-sm">{batch.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {batch.patientCount} patients
                            {batch.status === "completed" && " · Complete"}
                          </span>
                        </div>
                      </SidebarMenuButton>
                      {selectedBatchIds.size === 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mr-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete "${batch.name}"?`)) onDeleteBatch(batch.id);
                          }}
                          data-testid={`button-delete-schedule-${batch.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
            {selectedBatchIds.size > 0 && (
              <div className="px-2 pt-2 pb-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full text-xs h-7 gap-1"
                  onClick={onDeleteSelected}
                  disabled={isDeletingBatch}
                  data-testid="button-delete-selected-schedules"
                >
                  {isDeletingBatch ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete {selectedBatchIds.size} Schedule{selectedBatchIds.size !== 1 ? "s" : ""}
                </Button>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
