// World Time location registry helpers.
//
// The dashboard renders cards purely from configuration (the editable
// world-clocks list) merged with the approved image registry from the backend.
// This module holds the pure, presentation-agnostic helpers shared by the
// dashboard and the admin approval surface:
//
//   • slugify()            — stable id from a label ("San Francisco" → "san-francisco")
//   • FALLBACK_GRADIENT    — the premium Plexus navy gradient used whenever no
//                            APPROVED image exists (new/pending/rejected/missing)
//   • LANDMARK_SUGGESTIONS — the "most iconic landmark" hint used ONLY by the
//                            admin workflow to pre-propose a candidate. This is
//                            a convenience, not per-location render logic — the
//                            card component treats every location identically.

/** Stable, url-safe id derived from a display label. */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Premium fallback background — used for any location without an APPROVED
 *  image. Kept identical everywhere so unapproved/new cities still look like
 *  one component family. */
export const FALLBACK_GRADIENT =
  "linear-gradient(135deg, #07142F 0%, #0B1F49 55%, #153A78 100%)";

export type LandmarkSuggestion = {
  landmarkName: string;
  imagePosition: string;
  /** A bundled asset shipped in /public/world-time, when one exists. New
   *  locations without a bundled asset supply their own assetUrl at approval
   *  time; the workflow still works with assetUrl left empty (fallback). */
  bundledAsset?: string;
};

/**
 * Iconic-landmark hints, keyed by location slug. Selection priority follows
 * the spec: iconic structure → monument → recognizable skyline → natural
 * landmark. States/regions (Arizona, Michigan) use a recognizable regional
 * identity rather than pretending to be a single city.
 *
 * Adding a NEW city needs NO code change to render — this map only powers the
 * admin "propose candidate" convenience. Unknown locations fall back to a
 * generic skyline suggestion (see suggestLandmark()).
 */
export const LANDMARK_SUGGESTIONS: Record<string, LandmarkSuggestion> = {
  // ── Currently configured locations (bundled assets, seeded APPROVED) ──
  arizona: { landmarkName: "Sonoran Desert", imagePosition: "center 58%", bundledAsset: "/world-time/arizona.svg" },
  houston: { landmarkName: "Houston Skyline", imagePosition: "center 48%", bundledAsset: "/world-time/houston.svg" },
  michigan: { landmarkName: "Detroit Riverfront", imagePosition: "center 52%", bundledAsset: "/world-time/michigan.svg" },
  dhaka: { landmarkName: "Dhaka Skyline & Mosque", imagePosition: "center 45%", bundledAsset: "/world-time/dhaka.svg" },
  manila: { landmarkName: "Manila Bay Skyline", imagePosition: "center 50%", bundledAsset: "/world-time/manila.svg" },

  // ── Ready-to-propose landmarks for likely future locations ──
  dubai: { landmarkName: "Burj Khalifa", imagePosition: "center 40%", bundledAsset: "/world-time/dubai.svg" },
  paris: { landmarkName: "Eiffel Tower", imagePosition: "center 40%" },
  london: { landmarkName: "Big Ben / Palace of Westminster", imagePosition: "center 45%" },
  sydney: { landmarkName: "Sydney Opera House", imagePosition: "center 50%" },
  toronto: { landmarkName: "CN Tower", imagePosition: "center 42%" },
  seattle: { landmarkName: "Space Needle", imagePosition: "center 42%" },
  "new-york": { landmarkName: "Empire State Building", imagePosition: "center 42%" },
  chicago: { landmarkName: "Chicago Skyline", imagePosition: "center 48%" },
  "san-francisco": { landmarkName: "Golden Gate Bridge", imagePosition: "center 55%" },
  "washington-dc": { landmarkName: "United States Capitol", imagePosition: "center 50%" },
  rome: { landmarkName: "Colosseum", imagePosition: "center 50%" },
  barcelona: { landmarkName: "Sagrada Família", imagePosition: "center 42%" },
  agra: { landmarkName: "Taj Mahal", imagePosition: "center 50%" },
  "kuala-lumpur": { landmarkName: "Petronas Towers", imagePosition: "center 40%" },
  singapore: { landmarkName: "Marina Bay Sands", imagePosition: "center 50%" },
  riyadh: { landmarkName: "Kingdom Centre", imagePosition: "center 45%" },
  tokyo: { landmarkName: "Tokyo Tower", imagePosition: "center 45%" },
  karachi: { landmarkName: "Karachi Skyline", imagePosition: "center 50%" },
  bangalore: { landmarkName: "Bangalore Skyline", imagePosition: "center 50%" },
};

/** Returns the iconic-landmark hint for a slug, or a generic skyline hint so
 *  the admin workflow always has something to propose. */
export function suggestLandmark(slug: string, label: string): LandmarkSuggestion {
  return (
    LANDMARK_SUGGESTIONS[slug] ?? {
      landmarkName: `${label} Skyline`,
      imagePosition: "center center",
    }
  );
}

/** Concise alt text, e.g. "Burj Khalifa in Dubai". */
export function imageAltText(landmarkName: string | undefined, label: string): string {
  if (!landmarkName) return `${label} background`;
  return landmarkName.toLowerCase().includes(label.toLowerCase())
    ? landmarkName
    : `${landmarkName} in ${label}`;
}
