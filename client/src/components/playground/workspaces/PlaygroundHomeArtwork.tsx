// Playground Home — clean empty state.
//
// The previous hand-drawn "bicycle day" Rough.js scene has been removed with
// the rest of the SketchUI look. This renders a simple, quiet empty state shown
// when no workspace is active.

import { LayoutGrid } from "lucide-react";

export function PlaygroundHomeArtwork() {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center pb-20"
      data-testid="playground-home-artwork"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <LayoutGrid className="h-6 w-6 text-slate-400" />
        </div>
      </div>
    </div>
  );
}
