// Compact notification center for the Team Portal header (Phase 6A).
//
// A single bell with an unread count that opens a popover of recent items —
// NOT another rail. Each item shows its source/context and click-through opens
// the canonical workspace (task / handoff-call / conversation / needs-coverage)
// using the canonical ids on the notification. High-severity items get a red
// dot and an Acknowledge action; everything else is mark-read on click.

import { Bell, Check, Loader2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { SketchButton } from "@/components/playground/sketch/SketchPrimitives";
import { dispatchOpenWorkspace } from "@/components/playground/playgroundEvents";
import { useNotifications, type PortalNotification } from "./useNotifications";

// Route a notification click to the right canonical workspace using whichever
// canonical pointer is present. Falls back to no-op navigation (still marks
// read) when a notification carries no openable target.
function openTargetForNotification(n: PortalNotification): void {
  // Handoff / call-reassignment → open the call case (patient-scoped console).
  if (n.handoffId != null || n.type === "call_reassigned" || n.type === "callback_due") {
    if (n.executionCaseId != null || n.patientScreeningId != null) {
      dispatchOpenWorkspace({
        type: "call",
        title: n.title,
        executionCaseId: n.executionCaseId ?? null,
        patientScreeningId: n.patientScreeningId ?? null,
        facilityId: n.facilityId ?? null,
      });
      return;
    }
  }
  // Task notification → open the Tasks workspace.
  if (n.taskId != null || n.type === "task_assigned" || n.type === "task_due" || n.type === "task_overdue") {
    dispatchOpenWorkspace({ type: "tasks", title: "Tasks" });
    return;
  }
  // Message notification → open Team Chat (conversation-scoped surface).
  if (n.conversationId != null || n.type === "direct_message" || n.type === "team_message") {
    dispatchOpenWorkspace({ type: "team_chat", title: "Team Chat" });
    return;
  }
  // Manager exception (needs coverage / failed redistribution) → patient/case
  // context if we have it; otherwise leave the center open (manager reviews in
  // Engagement). We still mark it read on click.
  if (n.patientScreeningId != null || n.executionCaseId != null) {
    dispatchOpenWorkspace({
      type: "patient_ehr",
      title: n.title,
      patientScreeningId: n.patientScreeningId ?? null,
      executionCaseId: n.executionCaseId ?? null,
      facilityId: n.facilityId ?? null,
    });
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function NotificationCenter() {
  const {
    notifications,
    unreadCount,
    isLoading,
    isError,
    markRead,
    acknowledge,
    markAllRead,
  } = useNotifications();

  const handleItemClick = (n: PortalNotification) => {
    if (n.readAt == null) markRead.mutate(n.id);
    openTargetForNotification(n);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <SketchButton
          variant="icon"
          size="sm"
          seedId="notification-center"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          title="Notifications"
          data-testid="button-notification-center"
        >
          <span className="relative inline-flex">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span
                className="absolute -right-2 -top-2 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-semibold leading-none text-white"
                data-testid="notification-unread-badge"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
        </SketchButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        data-testid="notification-center-panel"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold text-slate-900">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              className="text-[11px] font-medium text-blue-600 hover:underline disabled:opacity-50"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              data-testid="notification-mark-all-read"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-slate-500" data-testid="notification-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <div className="px-3 py-8 text-center text-xs text-rose-600" data-testid="notification-error">
              Couldn't load notifications. It will retry automatically.
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-slate-500" data-testid="notification-empty">
              You're all caught up.
            </div>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => {
                const unread = n.readAt == null;
                const high = n.severity === "HIGH";
                const needsAck = n.type === "handoff_ack_required" && n.acknowledgedAt == null;
                return (
                  <li
                    key={n.id}
                    className={`px-3 py-2 ${unread ? "bg-blue-50/60" : "bg-white"}`}
                    data-testid={`notification-item-${n.id}`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 text-left"
                      onClick={() => handleItemClick(n)}
                    >
                      <span
                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                          high ? "bg-rose-500" : unread ? "bg-blue-500" : "bg-transparent"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-slate-900">
                            {n.title}
                          </span>
                          {n.priorityLevel && (
                            <span className="shrink-0 rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-600">
                              {n.priorityLevel}
                            </span>
                          )}
                        </span>
                        {n.shortBody && (
                          <span className="mt-0.5 block truncate text-[11px] text-slate-600">
                            {n.shortBody}
                          </span>
                        )}
                        <span className="mt-0.5 block text-[10px] text-slate-400">
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                    {needsAck && (
                      <div className="mt-1.5 pl-3.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                          onClick={() => acknowledge.mutate(n.id)}
                          disabled={acknowledge.isPending}
                          data-testid={`notification-acknowledge-${n.id}`}
                        >
                          <Check className="h-3 w-3" /> Acknowledge
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
