/**
 * Plexus OS — canonical page layout primitives (barrel export).
 *
 * The one standard for page structure on live (non-`.plexus-ui`) pages:
 * PageShell (wrapper), PageHeader/InteriorPageTitle (title — re-exported for
 * one import site), BackButton, SectionHeader, PlexusCard, and the
 * loading/empty/error states. Structural rhythm/sizing lives in layoutTokens.
 */
export * from "./layoutTokens";
export * from "./PageShell";
export * from "./BackButton";
export * from "./SectionHeader";
export * from "./PlexusCard";
export * from "./states";
export { PageHeader } from "@/components/PageHeader";
export { InteriorPageTitle } from "@/components/InteriorPageTitle";
