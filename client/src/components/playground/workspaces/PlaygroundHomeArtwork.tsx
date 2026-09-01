// Playground Home — empty state.
//
// The previous hand-drawn "bicycle day" Rough.js scene was removed with the
// SketchUI look. The empty playground now renders nothing (a clean canvas)
// when no workspace is active. Kept as a component (with its test id) so the
// canvas has a stable, no-op placeholder the engine can render.

export function PlaygroundHomeArtwork() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-testid="playground-home-artwork"
      aria-hidden="true"
    />
  );
}
