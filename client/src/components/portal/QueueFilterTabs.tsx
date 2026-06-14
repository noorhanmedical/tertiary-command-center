// QueueFilterTabs — Phase 2 PR 2.3
//
// Right-panel filter tabs for the Team Portal workspace call list.
// Renders one tab per applicable FollowUpFilterTag with a count
// badge. Counts come from the shared client-side classifier so the
// numbers always match what the Engagement Center server side
// would compute over the same rows.
//
// The tabs DO NOT mutate the underlying call-list data. They emit
// an `onSelect(tag | null)` event and the parent (TeamPortalShell)
// applies the filter when rendering the right-panel list.
//
// Contract:
//   - The tabs sit ABOVE the right-panel list, inside the
//     portal-right-rail container.
//   - The right-panel content remains the work queue. Tab selection
//     just narrows the visible rows.
//   - When no tag is selected, the full list is shown.

import { useMemo } from "react";
import {
  classifyFollowUpRow,
  countFollowUpTags,
  FOLLOW_UP_TAG_LABELS,
  type FollowUpFilterTag,
  type FollowUpRowProjection,
} from "@/lib/portal/followUpQueueClassifier";

type Props = {
  rows: FollowUpRowProjection[];
  activeTag: FollowUpFilterTag | null;
  onSelect: (tag: FollowUpFilterTag | null) => void;
};

const PREFERRED_ORDER: FollowUpFilterTag[] = [
  "callbacks_due_now",
  "lvm_follow_up",
  "no_answer_follow_up",
  "ready_to_schedule",
  "needs_follow_up",
  "manager_review",
  "unable_to_reach",
  "dnc_or_declined",
];

export function QueueFilterTabs({ rows, activeTag, onSelect }: Props) {
  const counts = useMemo(() => countFollowUpTags(rows), [rows]);
  const totalVisible = rows.length;

  return (
    <div
      className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-slate-100 bg-white/60"
      data-testid="portal-queue-filter-tabs"
    >
      <button
        type="button"
        className={`px-2 py-1 text-[10px] rounded ${activeTag === null ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700"}`}
        onClick={() => onSelect(null)}
        data-testid="queue-filter-tab-all"
      >
        All <span className="opacity-70">({totalVisible})</span>
      </button>
      {PREFERRED_ORDER.map((tag) => {
        const n = counts[tag];
        if (n === 0) return null;
        const active = activeTag === tag;
        return (
          <button
            key={tag}
            type="button"
            className={`px-2 py-1 text-[10px] rounded ${active ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700"}`}
            onClick={() => onSelect(active ? null : tag)}
            data-testid={`queue-filter-tab-${tag}`}
          >
            {FOLLOW_UP_TAG_LABELS[tag]} <span className="opacity-70">({n})</span>
          </button>
        );
      })}
    </div>
  );
}

export function applyTagFilter(
  rows: FollowUpRowProjection[],
  tag: FollowUpFilterTag | null,
): FollowUpRowProjection[] {
  if (!tag) return rows;
  return rows.filter((r) => classifyFollowUpRow(r).includes(tag));
}
