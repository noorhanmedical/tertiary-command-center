// QA — Mission Control is now a shipped surface.
//
// This guard previously failed the build if any Mission Control page,
// component, route, or nav entry existed (it was reserved for a future
// phase). Mission Control has since been intentionally built as a
// read-only operations overview (client/src/pages/mission-control.tsx,
// the /mission-control route, and the home "Mission Control" tile), so
// the prohibition no longer applies. This script is now a no-op kept in
// place so any lingering references / docs that invoke it still pass.
//
// Run: node scripts/qa-no-mission-control-anywhere.mjs

console.log("Mission Control guard retired — surface is intentionally present.");
